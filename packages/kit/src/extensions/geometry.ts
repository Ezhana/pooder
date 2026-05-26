import paper from "paper";
import type {
  CoordinateSpace,
  GeometryPathSnapshot,
  GeometryPoint,
  GeometryRect,
  GeometryRef,
} from "@pooder/core";
import { pickExitIndex, scoreOutsideAbove } from "./bridgeSelection";
import {
  DEFAULT_DIELINE_SHAPE,
  getHeartShapeParams,
  getShapeFitMode,
} from "./dielineShape";
import type {
  BuiltinDielineShape,
  DielineShape,
  DielineShapeStyle,
  ShapeFitMode,
} from "./dielineShape";
import { sampleWrappedOffsets, wrappedDistance } from "./wrappedOffsets";

export type FeatureOperation = "add" | "subtract";
export type FeatureShape = "rect" | "circle";

export interface DielineFeature {
  id: string;
  groupId?: string;
  operation: FeatureOperation;
  shape: FeatureShape;
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  rotation?: number;
  // Rendering behavior: 'edge' (modifies perimeter) or 'surface' (hole/island)
  renderBehavior?: "edge" | "surface";
  color?: string;
  strokeDash?: number[];
  skipCut?: boolean;
  bridge?: {
    type: "vertical";
  };
}

export interface GeometryOptions {
  shape: DielineShape;
  width: number;
  height: number;
  radius: number;
  x: number;
  y: number;
  features: Array<DielineFeature>;
  pathData?: string;
  shapeStyle?: DielineShapeStyle;
  customSourceWidthPx?: number;
  customSourceHeightPx?: number;
  canvasWidth?: number;
  canvasHeight?: number;
}

/**
 * Resolves the absolute position of a feature based on normalized coordinates.
 */
export function resolveFeaturePosition(
  feature: DielineFeature,
  geometry: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const { x, y, width, height } = geometry;
  // geometry.x/y is the Center.
  const left = x - width / 2;
  const top = y - height / 2;

  return {
    x: left + feature.x * width,
    y: top + feature.y * height,
  };
}

/**
 * Initializes paper.js project if not already initialized.
 */
function ensurePaper(width: number, height: number) {
  if (!paper.project) {
    paper.setup(new paper.Size(width, height));
  } else {
    paper.view.viewSize = new paper.Size(width, height);
  }
}

const isBridgeDebugEnabled = () =>
  Boolean((globalThis as any).__POODER_BRIDGE_DEBUG__);

function normalizePathItem(shape: paper.PathItem): paper.PathItem {
  let result: any = shape;
  if (typeof result.resolveCrossings === "function") result = result.resolveCrossings();
  if (typeof result.reduce === "function") result = result.reduce({});
  if (typeof result.reorient === "function") result = result.reorient(true, true);
  if (typeof result.reduce === "function") result = result.reduce({});
  return result as paper.PathItem;
}

function getBridgeDelta(itemBounds: paper.Rectangle, overlap: number) {
  return Math.max(overlap, Math.min(5, Math.max(1, itemBounds.height * 0.02)));
}

function getExitHit(args: {
  mainShape: paper.Path;
  x: number;
  bridgeBottom: number;
  toY: number;
  eps: number;
  delta: number;
  overlap: number;
  op: FeatureOperation;
}) {
  const { mainShape, x, bridgeBottom, toY, eps, delta, overlap, op } = args;

  const ray = new paper.Path.Line({
    from: [x, bridgeBottom],
    to: [x, toY],
    insert: false,
  });

  const intersections = mainShape.getIntersections(ray) || [];
  ray.remove();

  const validHits = intersections.filter((i) => i.point.y < bridgeBottom - eps);
  if (validHits.length === 0) return null;

  validHits.sort((a, b) => b.point.y - a.point.y);
  const flags = validHits.map((h) => {
    const above = h.point.add(new paper.Point(0, -delta));
    const below = h.point.add(new paper.Point(0, delta));
    return {
      insideAbove: mainShape.contains(above),
      insideBelow: mainShape.contains(below),
    };
  });

  const idx = pickExitIndex(flags);
  if (idx < 0) return null;

  if (isBridgeDebugEnabled()) {
    console.debug("Geometry: Bridge ray", {
      x,
      validHits: validHits.length,
      idx,
      delta,
      overlap,
      op,
    });
  }

  const hit = validHits[idx];
  return { point: hit.point, location: hit };
}

function selectOuterChain(args: {
  mainShape: paper.Path;
  pointsA: paper.Point[];
  pointsB: paper.Point[];
  delta: number;
  overlap: number;
  op: FeatureOperation;
}) {
  const { mainShape, pointsA, pointsB, delta, overlap, op } = args;

  const scoreA = scoreOutsideAbove(
    pointsA.map((p) => ({
      outsideAbove: !mainShape.contains(p.add(new paper.Point(0, -delta))),
    })),
  );
  const scoreB = scoreOutsideAbove(
    pointsB.map((p) => ({
      outsideAbove: !mainShape.contains(p.add(new paper.Point(0, -delta))),
    })),
  );

  const ratioA = scoreA / pointsA.length;
  const ratioB = scoreB / pointsB.length;

  if (isBridgeDebugEnabled()) {
    console.debug("Geometry: Bridge chain", {
      scoreA,
      scoreB,
      lenA: pointsA.length,
      lenB: pointsB.length,
      ratioA,
      ratioB,
      delta,
      overlap,
      op,
    });
  }

  const ratioEps = 1e-6;
  if (Math.abs(ratioA - ratioB) > ratioEps) {
    return ratioA > ratioB ? pointsA : pointsB;
  }
  if (scoreA !== scoreB) return scoreA > scoreB ? pointsA : pointsB;
  return pointsA.length <= pointsB.length ? pointsA : pointsB;
}

/**
 * Creates the base dieline shape (Rect/Circle/Ellipse/Heart/Custom).
 */
type BuiltinShapeBuilder = (options: GeometryOptions) => paper.PathItem;

function fitPathItemToRect(
  item: paper.PathItem,
  rect: { left: number; top: number; width: number; height: number },
  fitMode: ShapeFitMode,
): paper.PathItem {
  const { left, top, width, height } = rect;
  const bounds = item.bounds;
  if (
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    item.position = new paper.Point(left + width / 2, top + height / 2);
    return item;
  }

  item.translate(new paper.Point(-bounds.left, -bounds.top));
  if (fitMode === "stretch") {
    item.scale(width / bounds.width, height / bounds.height, new paper.Point(0, 0));
    item.translate(new paper.Point(left, top));
    return item;
  }

  const uniformScale = Math.min(width / bounds.width, height / bounds.height);
  item.scale(uniformScale, uniformScale, new paper.Point(0, 0));
  const scaledWidth = bounds.width * uniformScale;
  const scaledHeight = bounds.height * uniformScale;
  item.translate(
    new paper.Point(
      left + (width - scaledWidth) / 2,
      top + (height - scaledHeight) / 2,
    ),
  );
  return item;
}

function createNormalizedHeartPath(params: {
  lobeSpread: number;
  notchDepth: number;
  tipSharpness: number;
}): paper.Path {
  const { lobeSpread, notchDepth, tipSharpness } = params;

  const halfSpread = 0.22 + lobeSpread * 0.18;
  const notchY = 0.06 + notchDepth * 0.2;
  const shoulderY = 0.24 + notchDepth * 0.2;
  const topLift = 0.12 + (1 - notchDepth) * 0.06;
  const topY = notchY - topLift;
  const sideCtrlY = shoulderY - (0.18 - notchDepth * 0.08);
  const lowerCtrlY = 0.58 + (1 - tipSharpness) * 0.16;
  const tipCtrlX = 0.34 - tipSharpness * 0.2;
  const notchCtrlX = 0.06 + lobeSpread * 0.06;
  const lobeCtrlX = 0.1 + lobeSpread * 0.08;
  const notchCtrlY = notchY - topLift * 0.45;

  const xPeakL = 0.5 - halfSpread;
  const xPeakR = 0.5 + halfSpread;

  const heartPath = new paper.Path({ insert: false });
  heartPath.moveTo(new paper.Point(0.5, notchY));
  heartPath.cubicCurveTo(
    new paper.Point(0.5 - notchCtrlX, notchCtrlY),
    new paper.Point(xPeakL + lobeCtrlX, topY),
    new paper.Point(xPeakL, topY),
  );
  heartPath.cubicCurveTo(
    new paper.Point(xPeakL - lobeCtrlX, topY),
    new paper.Point(0, sideCtrlY),
    new paper.Point(0, shoulderY),
  );
  heartPath.cubicCurveTo(
    new paper.Point(0, lowerCtrlY),
    new paper.Point(tipCtrlX, 1),
    new paper.Point(0.5, 1),
  );
  heartPath.cubicCurveTo(
    new paper.Point(1 - tipCtrlX, 1),
    new paper.Point(1, lowerCtrlY),
    new paper.Point(1, shoulderY),
  );
  heartPath.cubicCurveTo(
    new paper.Point(1, sideCtrlY),
    new paper.Point(xPeakR + lobeCtrlX, topY),
    new paper.Point(xPeakR, topY),
  );
  heartPath.cubicCurveTo(
    new paper.Point(xPeakR - lobeCtrlX, topY),
    new paper.Point(0.5 + notchCtrlX, notchCtrlY),
    new paper.Point(0.5, notchY),
  );
  heartPath.closed = true;
  return heartPath;
}

function createHeartBaseShape(options: GeometryOptions): paper.PathItem {
  const { x, y, width, height } = options;
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const left = x - w / 2;
  const top = y - h / 2;
  const fitMode = getShapeFitMode(options.shapeStyle);
  const heartParams = getHeartShapeParams(options.shapeStyle);
  const rawHeart = createNormalizedHeartPath(heartParams);
  return fitPathItemToRect(rawHeart, { left, top, width: w, height: h }, fitMode);
}

const BUILTIN_SHAPE_BUILDERS: Record<BuiltinDielineShape, BuiltinShapeBuilder> =
  {
    rect: (options) => {
      const { x, y, width, height, radius } = options;
      return new paper.Path.Rectangle({
        point: [x - width / 2, y - height / 2],
        size: [Math.max(0, width), Math.max(0, height)],
        radius: Math.max(0, radius),
      });
    },
    circle: (options) => {
      const { x, y, width, height } = options;
      const r = Math.min(width, height) / 2;
      return new paper.Path.Circle({
        center: new paper.Point(x, y),
        radius: Math.max(0, r),
      });
    },
    ellipse: (options) => {
      const { x, y, width, height } = options;
      return new paper.Path.Ellipse({
        center: new paper.Point(x, y),
        radius: [Math.max(0, width / 2), Math.max(0, height / 2)],
      });
    },
    heart: createHeartBaseShape,
  };

function createCustomBaseShape(options: GeometryOptions): paper.PathItem | null {
  const {
    pathData,
    customSourceWidthPx,
    customSourceHeightPx,
    x,
    y,
    width,
    height,
  } = options;
  if (typeof pathData !== "string" || pathData.trim().length === 0) {
    return null;
  }

  const center = new paper.Point(x, y);
  const hasMultipleSubPaths = ((pathData.match(/[Mm]/g) || []).length ?? 0) > 1;
  const path: paper.PathItem = hasMultipleSubPaths
    ? new paper.CompoundPath(pathData)
    : (() => {
        const single = new paper.Path();
        single.pathData = pathData;
        return single;
      })();
  const sourceWidth = Number(customSourceWidthPx ?? 0);
  const sourceHeight = Number(customSourceHeightPx ?? 0);
  if (
    Number.isFinite(sourceWidth) &&
    Number.isFinite(sourceHeight) &&
    sourceWidth > 0 &&
    sourceHeight > 0 &&
    width > 0 &&
    height > 0
  ) {
    // Preserve original detect-space offset/expand by mapping source image
    // coordinates directly into the target dieline frame.
    const targetLeft = x - width / 2;
    const targetTop = y - height / 2;
    path.scale(width / sourceWidth, height / sourceHeight, new paper.Point(0, 0));
    path.translate(new paper.Point(targetLeft, targetTop));
    return path;
  }

  if (width > 0 && height > 0 && path.bounds.width > 0 && path.bounds.height > 0) {
    // Fallback for malformed custom-path metadata.
    path.position = center;
    path.scale(width / path.bounds.width, height / path.bounds.height);
    return path;
  }
  path.position = center;
  return path;
}

function createBaseShape(options: GeometryOptions): paper.PathItem {
  const { shape } = options;
  if (shape === "custom") {
    const customShape = createCustomBaseShape(options);
    if (customShape) return customShape;
    return BUILTIN_SHAPE_BUILDERS[DEFAULT_DIELINE_SHAPE](options);
  }
  return BUILTIN_SHAPE_BUILDERS[shape](options);
}

function resolveBridgeBasePath(
  shape: paper.PathItem,
  anchor: paper.Point,
): paper.Path | null {
  if (shape instanceof paper.Path) {
    return shape;
  }

  if (shape instanceof paper.CompoundPath) {
    const children = (shape.children || []).filter(
      (child): child is paper.Path => child instanceof paper.Path,
    );
    if (!children.length) return null;
    let best = children[0];
    let bestDistance = Infinity;
    for (const child of children) {
      const location = child.getNearestLocation(anchor);
      const point = location?.point;
      if (!point) continue;
      const distance = point.getDistance(anchor);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = child;
      }
    }
    return best;
  }

  return null;
}

/**
 * Creates a Paper.js Item for a single feature.
 */
function createFeatureItem(
  feature: DielineFeature,
  center: paper.Point,
): paper.PathItem {
  let item: paper.PathItem;

  if (feature.shape === "rect") {
    const w = feature.width || 10;
    const h = feature.height || 10;
    const r = feature.radius || 0;
    item = new paper.Path.Rectangle({
      point: [center.x - w / 2, center.y - h / 2],
      size: [w, h],
      radius: r,
    });
  } else {
    // Circle
    const r = feature.radius || 5;
    item = new paper.Path.Circle({
      center: center,
      radius: r,
    });
  }

  if (feature.rotation) {
    item.rotate(feature.rotation, center);
  }

  return item;
}

/**
 * Internal helper to generate the Perimeter Shape (Base + Edge Features).
 */
function getPerimeterShape(options: GeometryOptions): paper.PathItem {
  // 1. Create Base Shape
  let mainShape = createBaseShape(options);

  const { features } = options;

  if (features && features.length > 0) {
    // Filter for Edge Features (Default is Edge, unless explicit 'surface')
    const edgeFeatures = features.filter(
      (f) => !f.renderBehavior || f.renderBehavior === "edge",
    );

    const adds: paper.PathItem[] = [];
    const subtracts: paper.PathItem[] = [];

    edgeFeatures.forEach((f) => {
      const pos = resolveFeaturePosition(f, options);
      const center = new paper.Point(pos.x, pos.y);
      const item = createFeatureItem(f, center);

      // Handle Bridge logic: Create a connection shape to the main body
      if (f.bridge && f.bridge.type === "vertical") {
        const itemBounds = item.bounds;
        const mainBounds = mainShape.bounds;
        const bridgeTop = mainBounds.top;
        const bridgeBottom = itemBounds.top;

        if (bridgeBottom > bridgeTop) {
          const overlap = 2;
          const rayPadding = 10;
          const eps = 0.1;
          const delta = getBridgeDelta(itemBounds, overlap);

          const toY = bridgeTop - rayPadding;
          const inset = Math.min(1, Math.max(0, itemBounds.width * 0.01));
          const xLeft = itemBounds.left + inset;
          const xRight = itemBounds.right - inset;
          const bridgeBasePath = resolveBridgeBasePath(mainShape, center);
          const canBridge = !!bridgeBasePath && xRight - xLeft > eps;

          if (canBridge && bridgeBasePath) {
            const leftHit = getExitHit({
              mainShape: bridgeBasePath,
              x: xLeft,
              bridgeBottom,
              toY,
              eps,
              delta,
              overlap,
              op: f.operation,
            });
            const rightHit = getExitHit({
              mainShape: bridgeBasePath,
              x: xRight,
              bridgeBottom,
              toY,
              eps,
              delta,
              overlap,
              op: f.operation,
            });

            if (leftHit && rightHit) {
              const pathLength = bridgeBasePath.length;
              const leftOffset = leftHit.location.offset;
              const rightOffset = rightHit.location.offset;

              const distanceA = wrappedDistance(pathLength, leftOffset, rightOffset);
              const distanceB = wrappedDistance(pathLength, rightOffset, leftOffset);
              const countFor = (d: number) =>
                Math.max(8, Math.min(80, Math.ceil(d / 6)));

              const offsetsA = sampleWrappedOffsets(
                pathLength,
                leftOffset,
                rightOffset,
                countFor(distanceA),
              );

              const offsetsB = sampleWrappedOffsets(
                pathLength,
                rightOffset,
                leftOffset,
                countFor(distanceB),
              );

              const pointsA = offsetsA
                .map((o) => bridgeBasePath.getPointAt(o))
                .filter((p): p is paper.Point => Boolean(p));
              const pointsB = offsetsB
                .map((o) => bridgeBasePath.getPointAt(o))
                .filter((p): p is paper.Point => Boolean(p));

              if (pointsA.length >= 2 && pointsB.length >= 2) {
                let topBase = selectOuterChain({
                  mainShape: bridgeBasePath,
                  pointsA,
                  pointsB,
                  delta,
                  overlap,
                  op: f.operation,
                });

                const dist2 = (a: paper.Point, b: paper.Point) => {
                  const dx = a.x - b.x;
                  const dy = a.y - b.y;
                  return dx * dx + dy * dy;
                };

                if (
                  dist2(topBase[0], leftHit.point) >
                  dist2(topBase[0], rightHit.point)
                ) {
                  topBase = topBase.slice().reverse();
                }

                topBase = topBase.slice();
                topBase[0] = leftHit.point;
                topBase[topBase.length - 1] = rightHit.point;

                const capShiftY =
                  f.operation === "subtract"
                    ? -Math.max(overlap * 2, delta)
                    : overlap;
                const topPoints = topBase.map((p) =>
                  p.add(new paper.Point(0, capShiftY)),
                );

                const bridgeBottomY = bridgeBottom + overlap * 2;
                const bridgePoly = new paper.Path({ insert: false });
                for (const p of topPoints) bridgePoly.add(p);
                bridgePoly.add(new paper.Point(xRight, bridgeBottomY));
                bridgePoly.add(new paper.Point(xLeft, bridgeBottomY));
                bridgePoly.closed = true;

                const unitedItem = item.unite(bridgePoly);
                item.remove();
                bridgePoly.remove();

                if (f.operation === "add") {
                  adds.push(unitedItem);
                } else {
                  subtracts.push(unitedItem);
                }
                return;
              }
            }
          }

          if (f.operation === "add") {
            adds.push(item);
          } else {
            subtracts.push(item);
          }
        } else {
          if (f.operation === "add") {
            adds.push(item);
          } else {
            subtracts.push(item);
          }
        }
      } else {
        if (f.operation === "add") {
          adds.push(item);
        } else {
          subtracts.push(item);
        }
      }
    });

    // 2. Process Additions (Union)
    if (adds.length > 0) {
      for (const item of adds) {
        try {
          const temp = mainShape.unite(item);
          mainShape.remove();
          item.remove();
          mainShape = normalizePathItem(temp);
        } catch (e) {
          console.error("Geometry: Failed to unite feature", e);
          item.remove();
        }
      }
    }

    // 3. Process Subtractions (Difference)
    if (subtracts.length > 0) {
      for (const item of subtracts) {
        try {
          const temp = mainShape.subtract(item);
          mainShape.remove();
          item.remove();
          mainShape = normalizePathItem(temp);
        } catch (e) {
          console.error("Geometry: Failed to subtract feature", e);
          item.remove();
        }
      }
    }
  }

  return mainShape;
}

/**
 * Applies Internal/Surface features to a shape.
 */
function applySurfaceFeatures(
  shape: paper.PathItem,
  features: DielineFeature[],
  options: GeometryOptions,
): paper.PathItem {
  const surfaceFeatures = features.filter(
    (f) => f.renderBehavior === "surface",
  );

  if (surfaceFeatures.length === 0) return shape;

  let result = shape;

  // Internal features are usually subtractive (holes)
  // But we support 'add' too (islands? maybe just unite)

  for (const f of surfaceFeatures) {
    const pos = resolveFeaturePosition(f, options);
    const center = new paper.Point(pos.x, pos.y);
    const item = createFeatureItem(f, center);

    try {
      if (f.operation === "add") {
        const temp = result.unite(item);
        result.remove();
        item.remove();
        result = normalizePathItem(temp);
      } else {
        const temp = result.subtract(item);
        result.remove();
        item.remove();
        result = normalizePathItem(temp);
      }
    } catch (e) {
      console.error("Geometry: Failed to apply surface feature", e);
      item.remove();
    }
  }

  return result;
}

/**
 * Generates the path data for the Dieline (Product Shape).
 */
export function generateDielinePath(options: GeometryOptions): string {
  const paperWidth = options.canvasWidth || options.width * 2 || 2000;
  const paperHeight = options.canvasHeight || options.height * 2 || 2000;
  ensurePaper(paperWidth, paperHeight);
  paper.project.activeLayer.removeChildren();

  const perimeter = getPerimeterShape(options);
  const finalShape = applySurfaceFeatures(perimeter, options.features, options);

  const pathData = finalShape.pathData;
  finalShape.remove();

  return pathData;
}

/**
 * Generates the path data for the Bleed Zone.
 */
export function generateBleedZonePath(
  originalOptions: GeometryOptions,
  offsetOptions: GeometryOptions,
  offset: number,
): string {
  const paperWidth =
    originalOptions.canvasWidth || originalOptions.width * 2 || 2000;
  const paperHeight =
    originalOptions.canvasHeight || originalOptions.height * 2 || 2000;
  ensurePaper(paperWidth, paperHeight);
  paper.project.activeLayer.removeChildren();

  // 1. Generate Original Shape
  const pOriginal = getPerimeterShape(originalOptions);
  const shapeOriginal = applySurfaceFeatures(
    pOriginal,
    originalOptions.features,
    originalOptions,
  );

  // 2. Generate Offset Shape
  const pOffset = getPerimeterShape(offsetOptions);
  const shapeOffset = applySurfaceFeatures(
    pOffset,
    offsetOptions.features,
    offsetOptions,
  );

  // 3. Calculate Difference
  let bleedZone: paper.PathItem;
  if (offset > 0) {
    bleedZone = shapeOffset.subtract(shapeOriginal);
  } else {
    bleedZone = shapeOriginal.subtract(shapeOffset);
  }

  const pathData = bleedZone.pathData;

  shapeOriginal.remove();
  shapeOffset.remove();
  bleedZone.remove();

  return pathData;
}

/**
 * Finds the lowest point (Max Y) on the Dieline geometry (Base Shape ONLY).
 */
export function getLowestPointOnDieline(
  options: GeometryOptions,
): { x: number; y: number } {
  ensurePaper(options.width * 2, options.height * 2);
  paper.project.activeLayer.removeChildren();

  const shape = createBaseShape(options);
  const bounds = shape.bounds;

  const result = {
    x: bounds.center.x,
    y: bounds.bottom,
  };
  shape.remove();

  return result;
}

/**
 * Finds the nearest point on the Dieline geometry (Base Shape ONLY) for a given target point.
 * Used for constraining feature movement.
 */
export function getNearestPointOnDieline(
  point: { x: number; y: number },
  options: GeometryOptions,
): { x: number; y: number; normal?: { x: number; y: number } } {
  ensurePaper(options.width * 2, options.height * 2);
  paper.project.activeLayer.removeChildren();

  // We constrain to the BASE shape, not including other features,
  // because usually you want to snap to the main edge.
  const shape = createBaseShape(options);

  const p = new paper.Point(point.x, point.y);
  const location = shape.getNearestLocation(p);

  const result = {
    x: location.point.x,
    y: location.point.y,
    normal: location.normal ? { x: location.normal.x, y: location.normal.y } : undefined
  };
  shape.remove();

  return result;
}

export function getPathBounds(pathData: string): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const path = new paper.Path();
  path.pathData = pathData;
  const bounds = path.bounds;
  path.remove();
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

export function createPaperPathGeometrySnapshot(options: {
  ref?: GeometryRef;
  pathData: string;
  space?: CoordinateSpace;
  metadata?: Record<string, unknown>;
}): GeometryPathSnapshot {
  const snapshot: GeometryPathSnapshot = {
    kind: "path",
    pathData: options.pathData,
    ...(options.ref ? { ref: options.ref } : {}),
    ...(options.space ? { space: options.space } : {}),
    ...(options.metadata ? { metadata: { ...options.metadata } } : {}),
    utilities: {
      bounds: ({ snapshot: pathSnapshot }) =>
        getPaperPathBounds(pathSnapshot.pathData),
      nearestPoint: (point, { snapshot: pathSnapshot }) =>
        getPaperPathNearestPoint(pathSnapshot.pathData, point)?.point ?? null,
      contains: (point, { snapshot: pathSnapshot }) =>
        withPaperPath(pathSnapshot.pathData, (path) =>
          path.contains(new paper.Point(point.x, point.y)),
        ) ?? false,
      sample: (ratio, { snapshot: pathSnapshot }) =>
        withPaperPath(pathSnapshot.pathData, (path) => {
          const pathWithLength = path as paper.PathItem & {
            length?: number;
            getPointAt?(offset: number): paper.Point | null;
          };
          const length = Math.max(0, pathWithLength.length || 0);
          const point = length > 0
            ? pathWithLength.getPointAt?.(
                Math.max(0, Math.min(1, ratio)) * length,
              )
            : null;
          return point ? { x: point.x, y: point.y } : null;
        }),
      normalAt: (point, { snapshot: pathSnapshot }) =>
        getPaperPathNearestPoint(pathSnapshot.pathData, point)?.normal ?? null,
    },
  };
  const bounds = getPaperPathBounds(options.pathData);
  return bounds ? { ...snapshot, bounds } : snapshot;
}

function getPaperPathBounds(pathData: string): GeometryRect | null {
  return withPaperPath(pathData, (path) => ({
    left: path.bounds.x,
    top: path.bounds.y,
    width: path.bounds.width,
    height: path.bounds.height,
  }));
}

function getPaperPathNearestPoint(
  pathData: string,
  point: GeometryPoint,
): { point: GeometryPoint; normal?: GeometryPoint } | null {
  return withPaperPath(pathData, (path) => {
    const location = path.getNearestLocation(new paper.Point(point.x, point.y));
    if (!location?.point) return null;
    return {
      point: { x: location.point.x, y: location.point.y },
      normal: location.normal
        ? { x: location.normal.x, y: location.normal.y }
        : undefined,
    };
  });
}

function withPaperPath<T>(
  pathData: string,
  read: (path: paper.PathItem) => T,
): T | null {
  if (typeof pathData !== "string" || pathData.trim().length === 0) {
    return null;
  }
  ensurePaper(1000, 1000);
  const hasMultipleSubPaths = ((pathData.match(/[Mm]/g) || []).length ?? 0) > 1;
  const path: paper.PathItem = hasMultipleSubPaths
    ? new paper.CompoundPath(pathData)
    : (() => {
        const item = new paper.Path();
        item.pathData = pathData;
        return item;
      })();
  try {
    return read(path);
  } finally {
    path.remove();
  }
}
