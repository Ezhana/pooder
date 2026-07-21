import type { DocumentConstraintSpec } from "@pooder/document";
import type Disposable from "./disposable";
import type { Service, ServiceContext } from "./service";
import {
  computeDragInteraction,
  type GeometryPoint,
  type GeometryRect,
} from "./interaction";
import { GEOMETRY_SOURCE_SERVICE } from "./services/tokens";
import type {
  CoordinateSpace,
  GeometryRef,
  GeometrySnapshot,
  GeometrySourceService,
} from "./geometry-source";
import {
  containsGeometryPoint,
  findNearestGeometryPoint,
  getGeometryBounds,
} from "./geometry-source";

export interface TransformInput {
  position?: GeometryPoint;
  frame?: GeometryRect;
  size?: { width: number; height: number };
  rotation?: number;
  scale?: GeometryPoint | number;
  origin?: GeometryPoint;
  metadata?: Record<string, unknown>;
}

export interface TransformResult {
  position?: GeometryPoint;
  frame?: GeometryRect;
  size?: { width: number; height: number };
  rotation?: number;
  scale?: GeometryPoint | number;
  changed: boolean;
  diagnostics: ConstraintDiagnostic[];
  metadata?: Record<string, unknown>;
}

export type ConstraintSource = GeometryRef | GeometrySnapshot;

export type ConstraintSpec = Omit<DocumentConstraintSpec, "source"> & {
  source?: ConstraintSource;
};

export interface ConstraintDiagnostic {
  severity: "warning" | "error";
  code: string;
  message: string;
  constraintType?: string;
}

export interface ConstraintResolveInput {
  transform: TransformInput;
  constraints?: readonly ConstraintSpec[];
  coordinateSpace?: CoordinateSpace;
  geometrySource?: GeometrySourceService;
  target?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ConstraintResolveResult {
  input: TransformInput;
  result: TransformResult;
  constraints: readonly ConstraintSpec[];
}

export interface ConstraintHandlerContext {
  resolver: ConstraintResolverService;
  geometrySource?: GeometrySourceService;
  coordinateSpace?: CoordinateSpace;
  input: ConstraintResolveInput;
  diagnostics: ConstraintDiagnostic[];
}

export type ConstraintHandler = (
  result: TransformResult,
  constraint: ConstraintSpec,
  context: ConstraintHandlerContext,
) => TransformResult;

export class ConstraintResolverService implements Service {
  private readonly handlers = new Map<string, ConstraintHandler>();
  private geometrySource?: GeometrySourceService;

  constructor(geometrySource?: GeometrySourceService) {
    this.geometrySource = geometrySource;
    registerBuiltinConstraints(this);
  }

  init(context: ServiceContext): void {
    this.geometrySource = context.get(GEOMETRY_SOURCE_SERVICE);
  }

  registerConstraint(type: string, resolver: ConstraintHandler): Disposable {
    const normalized = normalizeType(type);
    if (this.handlers.has(normalized)) {
      throw new Error(`Constraint "${normalized}" is already registered.`);
    }
    this.handlers.set(normalized, resolver);
    return {
      dispose: () => {
        if (this.handlers.get(normalized) === resolver) {
          this.handlers.delete(normalized);
        }
      },
    };
  }

  resolve(input: ConstraintResolveInput): ConstraintResolveResult {
    const constraints = Array.isArray(input.constraints)
      ? input.constraints
      : [];
    const diagnostics: ConstraintDiagnostic[] = [];
    const context: ConstraintHandlerContext = {
      resolver: this,
      geometrySource: input.geometrySource ?? this.geometrySource,
      coordinateSpace: input.coordinateSpace,
      input,
      diagnostics,
    };
    const initial = normalizeTransformResult(input.transform);
    const result = constraints.reduce((current, constraint) => {
      const type = normalizeType(constraint.type, false);
      const handler = type ? this.handlers.get(type) : undefined;
      if (!type || !handler) {
        diagnostics.push({
          severity: "warning",
          code: "constraint-handler-missing",
          message: `Constraint "${constraint.type}" is not registered.`,
          constraintType: constraint.type,
        });
        return current;
      }
      return normalizeTransformResult(
        handler(current, constraint, context),
        initial,
      );
    }, initial);

    return {
      input: cloneTransformInput(input.transform),
      result: {
        ...result,
        changed: hasTransformChanged(initial, result),
        diagnostics: diagnostics.slice(),
      },
      constraints,
    };
  }
}

export function registerBuiltinConstraints(
  resolver: ConstraintResolverService,
): void {
  registerIfMissing(resolver, "rect.contain", resolveRectContain);
  registerIfMissing(resolver, "rect.clamp-center", resolveRectClampCenter);
  registerIfMissing(resolver, "path.nearest-point", resolvePathNearestPoint);
  registerIfMissing(resolver, "path.follow", resolvePathNearestPoint);
  registerIfMissing(resolver, "object-frame.contain", resolveRectContain);
  registerIfMissing(resolver, "rect.snap", resolveRectSnap);
  registerIfMissing(resolver, "snap.points", resolveSnapPoints);
  registerIfMissing(resolver, "axis.lock", resolveAxisLock);
  registerIfMissing(resolver, "grid.snap", resolveGridSnap);
}

function registerIfMissing(
  resolver: ConstraintResolverService,
  type: string,
  handler: ConstraintHandler,
) {
  try {
    resolver.registerConstraint(type, handler);
  } catch (error) {
    if (
      !String((error as Error).message || "").includes("already registered")
    ) {
      throw error;
    }
  }
}

function resolveRectContain(
  result: TransformResult,
  constraint: ConstraintSpec,
  context: ConstraintHandlerContext,
): TransformResult {
  const rect = resolveConstraintRect(constraint, context);
  if (!rect) return result;
  const target = constraint.params?.target ?? constraint.mode;
  if (target === "center") {
    return clampCenter(result, rect);
  }
  const frame = result.frame;
  if (frame) return { ...result, frame: projectFrameIntoRect(frame, rect) };
  if (result.position) {
    return { ...result, position: clampPointToRect(result.position, rect) };
  }
  return result;
}

function resolveRectClampCenter(
  result: TransformResult,
  constraint: ConstraintSpec,
  context: ConstraintHandlerContext,
): TransformResult {
  const rect = resolveConstraintRect(constraint, context);
  return rect ? clampCenter(result, rect) : result;
}

function resolvePathNearestPoint(
  result: TransformResult,
  constraint: ConstraintSpec,
  context: ConstraintHandlerContext,
): TransformResult {
  const geometry = resolveConstraintGeometry(constraint, context);
  const position = getResultPosition(result);
  if (!geometry || !position) return result;
  const nearest = findNearestGeometryPoint(geometry, position);
  if (!nearest) return result;
  const next = moveResultToPosition(result, nearest);
  if (
    constraint.type === "path.follow" &&
    constraint.params?.contain === true
  ) {
    return containsGeometryPoint(geometry, nearest) ? next : result;
  }
  return next;
}

function resolveSnapPoints(
  result: TransformResult,
  constraint: ConstraintSpec,
  context: ConstraintHandlerContext,
): TransformResult {
  const position = getResultPosition(result);
  if (!position) return result;
  const threshold = finiteNumber(
    constraint.params?.threshold ?? constraint.params?.thresholdPx,
    Number.POSITIVE_INFINITY,
  );
  const points = collectSnapPoints(constraint, context);
  let best: GeometryPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point) => {
    const distance = Math.hypot(point.x - position.x, point.y - position.y);
    if (distance <= threshold && distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  });
  return best ? moveResultToPosition(result, best) : result;
}

function resolveRectSnap(
  result: TransformResult,
  constraint: ConstraintSpec,
  context: ConstraintHandlerContext,
): TransformResult {
  const frame = result.frame;
  const rect = resolveConstraintRect(constraint, context);
  if (!frame || !rect) return result;
  const snap = computeDragInteraction({
    frame,
    proposedFrame: frame,
    snapTargets: [
      {
        id: String(constraint.params?.id || "rect"),
        rect,
      },
    ],
    options: {
      thresholdPx: finiteNumber(constraint.params?.thresholdPx, 6),
      viewportScale: finitePositiveNumber(
        constraint.params?.viewportScale ??
          context.input.metadata?.viewportScale,
        1,
      ),
      includeEdges: constraint.params?.includeEdges !== false,
      includeCenters: constraint.params?.includeCenters !== false,
    },
  });
  const moved = moveResultToPosition(result, {
    x: snap.frame.left,
    y: snap.frame.top,
  });
  return {
    ...moved,
    metadata: {
      ...result.metadata,
      rectSnap: {
        guides: snap.guides,
        matches: snap.matches,
      },
    },
  };
}

function resolveAxisLock(
  result: TransformResult,
  constraint: ConstraintSpec,
): TransformResult {
  const position = getResultPosition(result);
  if (!position) return result;
  const axis = constraint.params?.axis ?? constraint.mode;
  const origin =
    normalizeOptionalPoint(constraint.params?.origin) ??
    normalizeOptionalPoint(result.metadata?.origin) ??
    position;
  if (axis === "x") {
    return moveResultToPosition(result, { x: position.x, y: origin.y });
  }
  if (axis === "y") {
    return moveResultToPosition(result, { x: origin.x, y: position.y });
  }
  return result;
}

function resolveGridSnap(
  result: TransformResult,
  constraint: ConstraintSpec,
): TransformResult {
  const position = getResultPosition(result);
  if (!position) return result;
  const size = finitePositiveNumber(constraint.params?.size, 0);
  const sizeX = finitePositiveNumber(constraint.params?.sizeX, size || 1);
  const sizeY = finitePositiveNumber(constraint.params?.sizeY, size || 1);
  const origin = normalizeOptionalPoint(constraint.params?.origin) ?? {
    x: 0,
    y: 0,
  };
  return moveResultToPosition(result, {
    x: origin.x + Math.round((position.x - origin.x) / sizeX) * sizeX,
    y: origin.y + Math.round((position.y - origin.y) / sizeY) * sizeY,
  });
}

function resolveConstraintRect(
  constraint: ConstraintSpec,
  context: ConstraintHandlerContext,
): GeometryRect | null {
  const paramsRect = normalizeOptionalRect(constraint.params?.rect);
  if (paramsRect) return paramsRect;
  const geometry = resolveConstraintGeometry(constraint, context);
  if (!geometry) return null;
  if (geometry.kind === "rect") return normalizeRectLike(geometry.rect);
  return getGeometryBounds(geometry);
}

function resolveConstraintGeometry(
  constraint: ConstraintSpec,
  context: ConstraintHandlerContext,
): GeometrySnapshot | null {
  const source = constraint.source;
  if (!source) return null;
  if (isGeometrySnapshot(source)) return source;
  const geometrySource = context.geometrySource;
  if (!geometrySource) return null;
  return context.coordinateSpace
    ? geometrySource.projectGeometry(source, context.coordinateSpace)
    : geometrySource.getGeometry(source);
}

function collectSnapPoints(
  constraint: ConstraintSpec,
  context: ConstraintHandlerContext,
): GeometryPoint[] {
  const explicit = Array.isArray(constraint.params?.points)
    ? constraint.params.points
        .map(normalizeOptionalPoint)
        .filter((point): point is GeometryPoint => Boolean(point))
    : [];
  const geometry = resolveConstraintGeometry(constraint, context);
  if (!geometry) return explicit;
  if (geometry.kind === "pointSet" || geometry.kind === "polygon") {
    return [...explicit, ...geometry.points.map(normalizePoint)];
  }
  if (geometry.kind === "rect") {
    const rect = normalizeRectLike(geometry.rect);
    return [
      ...explicit,
      { x: rect.left, y: rect.top },
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { x: rect.left + rect.width, y: rect.top + rect.height },
    ];
  }
  if (geometry.kind === "compound") {
    return [
      ...explicit,
      ...geometry.children.flatMap((child) =>
        collectSnapPoints({ ...constraint, source: child }, context),
      ),
    ];
  }
  return explicit;
}

function normalizeTransformResult(
  input: TransformInput | TransformResult,
  fallback?: TransformResult,
): TransformResult {
  const frame = normalizeOptionalRect((input as TransformResult).frame);
  const size = normalizeOptionalSize(input.size);
  const position =
    normalizeOptionalPoint(input.position) ??
    (frame ? { x: frame.left, y: frame.top } : undefined);
  return {
    ...(position ? { position } : {}),
    ...(frame ? { frame } : {}),
    ...(size ? { size } : {}),
    ...(Number.isFinite(input.rotation)
      ? { rotation: Number(input.rotation) }
      : {}),
    ...(input.scale !== undefined
      ? { scale: normalizeScale(input.scale) }
      : {}),
    changed: (input as TransformResult).changed ?? fallback?.changed ?? false,
    diagnostics: (
      (input as TransformResult).diagnostics ??
      fallback?.diagnostics ??
      []
    ).slice(),
    metadata: input.metadata ? { ...input.metadata } : fallback?.metadata,
  };
}

function cloneTransformInput(input: TransformInput): TransformInput {
  return {
    ...input,
    position: input.position ? normalizePoint(input.position) : undefined,
    frame: input.frame ? normalizeRectLike(input.frame) : undefined,
    size: input.size ? normalizeSize(input.size) : undefined,
    origin: input.origin ? normalizePoint(input.origin) : undefined,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

function getResultPosition(result: TransformResult): GeometryPoint | null {
  if (result.position) return result.position;
  if (result.frame) {
    return { x: result.frame.left, y: result.frame.top };
  }
  return null;
}

function moveResultToPosition(
  result: TransformResult,
  position: GeometryPoint,
): TransformResult {
  const normalized = normalizePoint(position);
  if (!result.frame) return { ...result, position: normalized };
  const current = getResultPosition(result);
  const dx = normalized.x - (current?.x ?? result.frame.left);
  const dy = normalized.y - (current?.y ?? result.frame.top);
  return {
    ...result,
    position: normalized,
    frame: {
      ...result.frame,
      left: result.frame.left + dx,
      top: result.frame.top + dy,
    },
  };
}

function clampCenter(
  result: TransformResult,
  rect: GeometryRect,
): TransformResult {
  const frame = result.frame;
  if (frame) {
    const center = clampPointToRect(
      {
        x: frame.left + frame.width / 2,
        y: frame.top + frame.height / 2,
      },
      rect,
    );
    return {
      ...result,
      position: {
        x: center.x - frame.width / 2,
        y: center.y - frame.height / 2,
      },
      frame: {
        ...frame,
        left: center.x - frame.width / 2,
        top: center.y - frame.height / 2,
      },
    };
  }
  return result.position
    ? { ...result, position: clampPointToRect(result.position, rect) }
    : result;
}

function projectFrameIntoRect(
  frame: GeometryRect,
  rect: GeometryRect,
): GeometryRect {
  const subject = normalizeRectLike(frame);
  const container = normalizeRectLike(rect);
  const minLeft = container.left;
  const maxLeft = container.left + container.width - subject.width;
  const minTop = container.top;
  const maxTop = container.top + container.height - subject.height;
  return {
    ...subject,
    left:
      minLeft <= maxLeft
        ? clamp(subject.left, minLeft, maxLeft)
        : container.left + (container.width - subject.width) / 2,
    top:
      minTop <= maxTop
        ? clamp(subject.top, minTop, maxTop)
        : container.top + (container.height - subject.height) / 2,
  };
}

function clampPointToRect(
  point: GeometryPoint,
  rect: GeometryRect,
): GeometryPoint {
  const box = normalizeRectLike(rect);
  return {
    x: clamp(point.x, box.left, box.left + box.width),
    y: clamp(point.y, box.top, box.top + box.height),
  };
}

function hasTransformChanged(
  initial: TransformResult,
  result: TransformResult,
): boolean {
  return (
    JSON.stringify(toComparableTransform(initial)) !==
    JSON.stringify(toComparableTransform(result))
  );
}

function toComparableTransform(result: TransformResult) {
  return {
    position: result.position,
    frame: result.frame,
    size: result.size,
    rotation: result.rotation,
    scale: result.scale,
  };
}

function isGeometrySnapshot(
  value: ConstraintSource,
): value is GeometrySnapshot {
  return typeof (value as GeometrySnapshot).kind === "string";
}

function normalizeType(type: unknown, throwIfEmpty = true): string {
  const normalized = String(type || "").trim();
  if (!normalized && throwIfEmpty) {
    throw new Error("Constraint type is required.");
  }
  return normalized;
}

function normalizeOptionalPoint(value: unknown): GeometryPoint | undefined {
  if (!isRecord(value)) return undefined;
  return normalizePoint(value);
}

function normalizePoint(value: { x?: unknown; y?: unknown }): GeometryPoint {
  return {
    x: finiteNumber(value.x, 0),
    y: finiteNumber(value.y, 0),
  };
}

function normalizeOptionalRect(value: unknown): GeometryRect | null {
  if (!isRecord(value)) return null;
  return normalizeRectLike(value);
}

function normalizeRectLike(value: {
  left?: unknown;
  top?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
}): GeometryRect {
  return {
    left: finiteNumber(value.left ?? value.x, 0),
    top: finiteNumber(value.top ?? value.y, 0),
    width: Math.max(0, finiteNumber(value.width, 0)),
    height: Math.max(0, finiteNumber(value.height, 0)),
  };
}

function normalizeOptionalSize(
  value: TransformInput["size"],
): TransformInput["size"] | undefined {
  return value ? normalizeSize(value) : undefined;
}

function normalizeSize(value: { width?: unknown; height?: unknown }) {
  return {
    width: Math.max(0, finiteNumber(value.width, 0)),
    height: Math.max(0, finiteNumber(value.height, 0)),
  };
}

function normalizeScale(value: GeometryPoint | number): GeometryPoint | number {
  if (typeof value === "number") return finiteNumber(value, 1);
  return normalizePoint(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function finitePositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
