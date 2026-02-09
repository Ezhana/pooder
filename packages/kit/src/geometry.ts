import paper from "paper";

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
  shape: "rect" | "circle" | "ellipse" | "custom";
  width: number;
  height: number;
  radius: number;
  x: number;
  y: number;
  features: Array<DielineFeature>;
  pathData?: string;
  canvasWidth?: number;
  canvasHeight?: number;
}

export interface MaskGeometryOptions extends GeometryOptions {
  canvasWidth: number;
  canvasHeight: number;
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

/**
 * Creates the base dieline shape (Rect/Circle/Ellipse/Custom)
 */
function createBaseShape(options: GeometryOptions): paper.PathItem {
  const { shape, width, height, radius, x, y, pathData } = options;
  const center = new paper.Point(x, y);

  if (shape === "rect") {
    return new paper.Path.Rectangle({
      point: [x - width / 2, y - height / 2],
      size: [Math.max(0, width), Math.max(0, height)],
      radius: Math.max(0, radius),
    });
  } else if (shape === "circle") {
    const r = Math.min(width, height) / 2;
    return new paper.Path.Circle({
      center: center,
      radius: Math.max(0, r),
    });
  } else if (shape === "ellipse") {
    return new paper.Path.Ellipse({
      center: center,
      radius: [Math.max(0, width / 2), Math.max(0, height / 2)],
    });
  } else if (shape === "custom" && pathData) {
    const path = new paper.Path();
    path.pathData = pathData;
    // Align center
    path.position = center;
    if (
      width > 0 &&
      height > 0 &&
      path.bounds.width > 0 &&
      path.bounds.height > 0
    ) {
      path.scale(width / path.bounds.width, height / path.bounds.height);
    }
    return path;
  } else {
    return new paper.Path.Rectangle({
      point: [x - width / 2, y - height / 2],
      size: [Math.max(0, width), Math.max(0, height)],
    });
  }
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
          // 1. Create a full column up to the top of the main shape
          // Start slightly inside the feature to ensure overlap at the bottom
          const startY = bridgeBottom + 1; 
          const bridgeRect = new paper.Path.Rectangle({
            from: [itemBounds.left, bridgeTop],
            to: [itemBounds.right, startY],
            insert: false,
          });

          // 2. Subtract the main shape from this column
          // This leaves us with the parts of the column that are NOT inside the main shape (gaps)
          const gaps = bridgeRect.subtract(mainShape);
          bridgeRect.remove();

          // 3. Find the gap piece that connects to our feature
          // It should be the piece with the lowest bottom (highest Y) matching our feature top
          let bridgePart: paper.PathItem | null = null;

          // Helper to check if a part is the bottom one
          const isBottomPart = (part: paper.PathItem) => {
             // Check if bottom aligns with feature top (allow small tolerance)
             return Math.abs(part.bounds.bottom - startY) < 2; 
          };

          if (gaps instanceof paper.CompoundPath) {
             // Find the child that is at the bottom
             const children = gaps.children;
             let maxBottom = -Infinity;
             let bestChild = null;
             
             for (const child of children) {
                if (child.bounds.bottom > maxBottom) {
                   maxBottom = child.bounds.bottom;
                   bestChild = child;
                }
             }
             
             if (bestChild && isBottomPart(bestChild as paper.PathItem)) {
                bridgePart = (bestChild as paper.PathItem).clone();
             }
          } else if (gaps instanceof paper.Path) {
             if (isBottomPart(gaps)) {
                bridgePart = gaps.clone();
             }
          }
          
          gaps.remove();

          if (bridgePart) {
              // Overlap fix:
              // Scale the bridge up slightly from the bottom to ensure it overlaps with the main shape at the top.
              // This prevents hairline gaps due to perfect alignment from subtract().
              const bounds = bridgePart.bounds;
              if (bounds.height > 0) {
                 const overlap = 1; 
                 const scaleY = (bounds.height + overlap) / bounds.height;
                 // Scale around the bottom-center to keep the connection to the feature intact
                 bridgePart.scale(1, scaleY, new paper.Point(bounds.center.x, bounds.bottom));
              }

              // Unite the bridge with the feature
              const unitedItem = item.unite(bridgePart);
              item.remove();
              bridgePart.remove();
              
              if (f.operation === "add") {
                adds.push(unitedItem);
              } else {
                subtracts.push(unitedItem);
              }
           } else {
             // No bridge needed (feature touches or intersects main shape directly)
             // or calculation failed. Fallback to original item.
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
          mainShape = temp;
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
          mainShape = temp;
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
        result = temp;
      } else {
        const temp = result.subtract(item);
        result.remove();
        item.remove();
        result = temp;
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
 * Generates the path data for the Mask (Background Overlay).
 * Logic: Canvas SUBTRACT ProductShape
 */
export function generateMaskPath(options: MaskGeometryOptions): string {
  ensurePaper(options.canvasWidth, options.canvasHeight);
  paper.project.activeLayer.removeChildren();

  const { canvasWidth, canvasHeight } = options;

  const maskRect = new paper.Path.Rectangle({
    point: [0, 0],
    size: [canvasWidth, canvasHeight],
  });

  const perimeter = getPerimeterShape(options);
  const mainShape = applySurfaceFeatures(perimeter, options.features, options);

  const finalMask = maskRect.subtract(mainShape);

  maskRect.remove();
  mainShape.remove();

  const pathData = finalMask.pathData;
  finalMask.remove();

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
