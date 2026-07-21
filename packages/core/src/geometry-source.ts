import type Disposable from "./disposable";
import type { Service } from "./service";
import type { GeometryPoint, GeometryRect } from "./interaction";
import {
  coordinateMatrix,
  transformCoordinatePoint,
  type CoordinateSpace,
  type Matrix2D,
} from "./coordinate";

export type { CoordinateSpace } from "./coordinate";

export interface GeometryRef {
  sourceId: string;
  geometryId: string;
  /** Selects the geometry optimized for interactive preview or final output. */
  purpose?: "preview" | "export";
  variant?: string;
}

export type GeometrySnapshotKind =
  | "rect"
  | "path"
  | "polygon"
  | "pointSet"
  | "compound";

export interface GeometrySnapshotBase {
  kind: GeometrySnapshotKind;
  ref: GeometryRef;
  space: CoordinateSpace;
  bounds: GeometryRect;
  localToScene: Matrix2D<CoordinateSpace, "scene">;
  metadata?: Record<string, unknown>;
}

export interface GeometryRectSnapshot extends GeometrySnapshotBase {
  kind: "rect";
  rect: GeometryRect;
}

export interface GeometryPathSnapshot extends GeometrySnapshotBase {
  kind: "path";
  backendId: string;
  pathData: string;
}

export interface GeometryPolygonSnapshot extends GeometrySnapshotBase {
  kind: "polygon";
  points: GeometryPoint[];
}

export interface GeometryPointSetSnapshot extends GeometrySnapshotBase {
  kind: "pointSet";
  points: GeometryPoint[];
}

export interface GeometryCompoundSnapshot extends GeometrySnapshotBase {
  kind: "compound";
  children: GeometryRef[];
}

export type GeometrySnapshot =
  | GeometryRectSnapshot
  | GeometryPathSnapshot
  | GeometryPolygonSnapshot
  | GeometryPointSetSnapshot
  | GeometryCompoundSnapshot;

export interface GeometryDescriptor {
  ref: GeometryRef;
  kind: GeometrySnapshotKind;
  space: CoordinateSpace;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface GeometryProjectionRequest {
  ref: GeometryRef;
  to: CoordinateSpace;
}

export interface GeometrySource {
  sourceId: string;
  getSnapshot(ref: GeometryRef): GeometrySnapshot | null;
  listGeometries?(): GeometryDescriptor[];
}

/** @deprecated Use GeometrySource. */
export type GeometrySourceProvider = GeometrySource;

export interface GeometryBackend {
  backendId: string;
  nearestPoint?(
    snapshot: GeometryPathSnapshot,
    point: GeometryPoint,
  ): GeometryPoint | null;
  normalAt?(
    snapshot: GeometryPathSnapshot,
    point: GeometryPoint,
  ): GeometryPoint | null;
  contains?(snapshot: GeometryPathSnapshot, point: GeometryPoint): boolean;
  sample?(snapshot: GeometryPathSnapshot, ratio: number): GeometryPoint | null;
  project?(
    snapshot: GeometryPathSnapshot,
    to: CoordinateSpace,
  ): GeometryPathSnapshot | null;
}

export class GeometrySourceService implements Service {
  private readonly providers = new Map<string, GeometrySource>();
  private readonly backends = new Map<string, GeometryBackend>();

  init(): void {}

  registerSource(source: GeometrySource): Disposable {
    const sourceId = normalizeId(source.sourceId, "GeometrySource.sourceId");
    if (this.providers.has(sourceId)) {
      throw new Error(`Geometry source "${sourceId}" is already registered.`);
    }
    this.providers.set(sourceId, source);
    return {
      dispose: () => {
        if (this.providers.get(sourceId) === source) {
          this.providers.delete(sourceId);
        }
      },
    };
  }

  registerBackend(backend: GeometryBackend): Disposable {
    const backendId = normalizeId(
      backend.backendId,
      "GeometryBackend.backendId",
    );
    if (this.backends.has(backendId)) {
      throw new Error(`Geometry backend "${backendId}" is already registered.`);
    }
    this.backends.set(backendId, backend);
    return {
      dispose: () => {
        if (this.backends.get(backendId) === backend) {
          this.backends.delete(backendId);
        }
      },
    };
  }

  getSnapshot(ref: GeometryRef): GeometrySnapshot | null {
    const normalized = normalizeGeometryRef(ref);
    const snapshot =
      this.providers.get(normalized.sourceId)?.getSnapshot(normalized) ?? null;
    return snapshot ? normalizeGeometrySnapshot(snapshot, normalized) : null;
  }

  listGeometries(sourceId?: string): GeometryDescriptor[] {
    const sourceIds = sourceId
      ? [normalizeId(sourceId, "GeometryRef.sourceId")]
      : Array.from(this.providers.keys()).sort();
    return sourceIds.flatMap((id) =>
      (this.providers.get(id)?.listGeometries?.() ?? []).map(cloneDescriptor),
    );
  }

  getBounds(ref: GeometryRef, space?: CoordinateSpace): GeometryRect | null {
    return this.resolveSnapshot(ref, space)?.bounds ?? null;
  }

  nearestPoint(
    ref: GeometryRef,
    point: GeometryPoint,
    space?: CoordinateSpace,
  ): GeometryPoint | null {
    const snapshot = this.resolveSnapshot(ref, space);
    return snapshot ? findNearestGeometryPoint(snapshot, point, this) : null;
  }

  normalAt(
    ref: GeometryRef,
    point: GeometryPoint,
    space?: CoordinateSpace,
  ): GeometryPoint | null {
    const snapshot = this.resolveSnapshot(ref, space);
    return snapshot ? getGeometryNormalAt(snapshot, point, this) : null;
  }

  contains(
    ref: GeometryRef,
    point: GeometryPoint,
    space?: CoordinateSpace,
  ): boolean {
    const snapshot = this.resolveSnapshot(ref, space);
    return snapshot ? containsGeometryPoint(snapshot, point, this) : false;
  }

  sample(
    ref: GeometryRef,
    ratio: number,
    space?: CoordinateSpace,
  ): GeometryPoint | null {
    const snapshot = this.resolveSnapshot(ref, space);
    return snapshot ? sampleGeometryPoint(snapshot, ratio, this) : null;
  }

  project(request: GeometryProjectionRequest): GeometrySnapshot | null {
    const normalized = normalizeGeometryRef(request.ref);
    const snapshot = this.getSnapshot(normalized);
    if (!snapshot) return null;
    if (snapshot.space === request.to) return snapshot;
    const projected = this.projectSnapshot(snapshot, request.to);
    if (!projected) return null;
    if (projected.space !== request.to) {
      throw new Error(
        `Geometry provider "${normalized.sourceId}" returned ${projected.space} ` +
          `space while projecting to ${request.to}.`,
      );
    }
    return normalizeGeometrySnapshot(projected, normalized);
  }

  private resolveSnapshot(
    ref: GeometryRef,
    space?: CoordinateSpace,
  ): GeometrySnapshot | null {
    const snapshot = this.getSnapshot(ref);
    if (!snapshot || !space || snapshot.space === space) return snapshot;
    return this.project({ ref, to: space });
  }

  private projectSnapshot(
    snapshot: GeometrySnapshot,
    to: CoordinateSpace,
  ): GeometrySnapshot | null {
    if (snapshot.kind === "path") {
      return (
        this.backends.get(snapshot.backendId)?.project?.(snapshot, to) ?? null
      );
    }
    if (to !== "scene") return null;
    return projectCoreSnapshotToScene(snapshot);
  }

  getBackend(snapshot: GeometryPathSnapshot): GeometryBackend | undefined {
    return this.backends.get(snapshot.backendId);
  }
}

export function createStaticGeometrySource(options: {
  sourceId: string;
  geometries: readonly GeometrySnapshot[];
}): GeometrySource {
  const sourceId = normalizeId(options.sourceId, "GeometrySource.sourceId");
  const snapshots = new Map<string, GeometrySnapshot>();
  options.geometries.forEach((snapshot, index) => {
    const geometryId =
      snapshot.ref?.geometryId || String(snapshot.metadata?.id || index);
    const ref = {
      sourceId,
      geometryId,
      purpose: snapshot.ref?.purpose,
      variant: snapshot.ref?.variant,
    };
    snapshots.set(geometryRefKey(ref), {
      ...cloneGeometrySnapshot(snapshot),
      ref,
    });
  });
  return {
    sourceId,
    getSnapshot(ref) {
      return cloneGeometrySnapshot(snapshots.get(geometryRefKey(ref)) ?? null);
    },
    listGeometries() {
      return Array.from(snapshots.values()).map((snapshot) => ({
        ref: snapshot.ref ?? { sourceId, geometryId: "" },
        kind: snapshot.kind,
        space: snapshot.space,
        metadata: cloneRecord(snapshot.metadata),
      }));
    },
  };
}

/** @deprecated Use createStaticGeometrySource. */
export const createStaticGeometrySourceProvider = createStaticGeometrySource;

function containsGeometryPoint(
  snapshot: GeometrySnapshot,
  point: GeometryPoint,
  service: GeometrySourceService,
): boolean {
  const normalizedPoint = normalizeGeometryPoint(point);
  switch (snapshot.kind) {
    case "rect":
      return rectContainsPoint(snapshot.rect, normalizedPoint);
    case "path":
      return Boolean(
        service.getBackend(snapshot)?.contains?.(snapshot, normalizedPoint),
      );
    case "polygon":
      return polygonContainsPoint(snapshot.points, normalizedPoint);
    case "pointSet":
      return snapshot.points.some((candidate) =>
        pointsEqual(candidate, normalizedPoint),
      );
    case "compound":
      return snapshot.children.some((child) =>
        service.contains(child, normalizedPoint, snapshot.space),
      );
    default:
      return false;
  }
}

function findNearestGeometryPoint(
  snapshot: GeometrySnapshot,
  point: GeometryPoint,
  service: GeometrySourceService,
): GeometryPoint | null {
  const normalizedPoint = normalizeGeometryPoint(point);
  switch (snapshot.kind) {
    case "rect":
      return clampPointToRect(normalizedPoint, snapshot.rect);
    case "path":
      return normalizeOptionalPoint(
        service.getBackend(snapshot)?.nearestPoint?.(snapshot, normalizedPoint),
      );
    case "polygon":
      return nearestPointOnPolyline(snapshot.points, normalizedPoint, true);
    case "pointSet":
      return nearestPointInSet(snapshot.points, normalizedPoint);
    case "compound":
      return nearestFromCandidates(
        snapshot.children
          .map((child) =>
            service.nearestPoint(child, normalizedPoint, snapshot.space),
          )
          .filter((item): item is GeometryPoint => Boolean(item)),
        normalizedPoint,
      );
    default:
      return null;
  }
}

function sampleGeometryPoint(
  snapshot: GeometrySnapshot,
  ratio: number,
  service: GeometrySourceService,
): GeometryPoint | null {
  const normalizedRatio = clamp01(Number.isFinite(ratio) ? ratio : 0);
  switch (snapshot.kind) {
    case "rect":
      return sampleRect(snapshot.rect, normalizedRatio);
    case "path":
      return normalizeOptionalPoint(
        service.getBackend(snapshot)?.sample?.(snapshot, normalizedRatio),
      );
    case "polygon":
      return samplePolyline(snapshot.points, normalizedRatio, true);
    case "pointSet":
      if (!snapshot.points.length) return null;
      return normalizeGeometryPoint(
        snapshot.points[
          Math.min(
            snapshot.points.length - 1,
            Math.floor(normalizedRatio * snapshot.points.length),
          )
        ],
      );
    case "compound":
      if (!snapshot.children.length) return null;
      return service.sample(
        snapshot.children[
          Math.min(
            snapshot.children.length - 1,
            Math.floor(normalizedRatio * snapshot.children.length),
          )
        ],
        normalizedRatio,
        snapshot.space,
      );
    default:
      return null;
  }
}

function getGeometryNormalAt(
  snapshot: GeometrySnapshot,
  point: GeometryPoint,
  service: GeometrySourceService,
): GeometryPoint | null {
  const normalizedPoint = normalizeGeometryPoint(point);
  if (snapshot.kind === "path") {
    return normalizeOptionalPoint(
      service.getBackend(snapshot)?.normalAt?.(snapshot, normalizedPoint),
    );
  }
  const nearest = findNearestGeometryPoint(snapshot, normalizedPoint, service);
  if (!nearest) return null;
  const dx = normalizedPoint.x - nearest.x;
  const dy = normalizedPoint.y - nearest.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return null;
  return { x: dx / length, y: dy / length };
}

function normalizeGeometryRef(ref: GeometryRef): GeometryRef {
  const purpose = ref.purpose;
  if (purpose !== undefined && purpose !== "preview" && purpose !== "export") {
    throw new Error(`Unknown GeometryRef purpose "${String(purpose)}".`);
  }
  return {
    sourceId: normalizeId(ref.sourceId, "GeometryRef.sourceId"),
    geometryId: normalizeId(ref.geometryId, "GeometryRef.geometryId"),
    ...(purpose ? { purpose } : {}),
    ...(ref.variant ? { variant: String(ref.variant) } : {}),
  };
}

function geometryRefKey(ref: GeometryRef): string {
  return `${ref.geometryId}\u0000${ref.purpose ?? ""}\u0000${ref.variant ?? ""}`;
}

function normalizeGeometrySnapshot(
  snapshot: GeometrySnapshot,
  ref: GeometryRef,
): GeometrySnapshot {
  const cloned = cloneGeometrySnapshot(snapshot);
  if (cloned.kind === "path") {
    cloned.backendId = normalizeId(
      cloned.backendId,
      `Geometry "${ref.sourceId}/${ref.geometryId}" backendId`,
    );
  }
  if (cloned.space !== cloned.localToScene.from) {
    throw new Error(
      `Geometry "${ref.sourceId}/${ref.geometryId}" declares ${cloned.space} ` +
        `space but localToScene starts in ${cloned.localToScene.from}.`,
    );
  }
  if (cloned.localToScene.to !== "scene") {
    throw new Error(
      `Geometry "${ref.sourceId}/${ref.geometryId}" localToScene must end in scene.`,
    );
  }
  return { ...cloned, ref };
}

function cloneDescriptor(descriptor: GeometryDescriptor): GeometryDescriptor {
  return {
    ...descriptor,
    ref: { ...descriptor.ref },
    metadata: cloneRecord(descriptor.metadata),
  };
}

function projectCoreSnapshotToScene(
  snapshot: Exclude<GeometrySnapshot, GeometryPathSnapshot>,
): GeometrySnapshot {
  const projectPoint = (point: GeometryPoint): GeometryPoint => {
    const projected = transformCoordinatePoint(snapshot.localToScene, {
      ...normalizeGeometryPoint(point),
      space: snapshot.space,
    });
    return { x: projected.x, y: projected.y };
  };
  const localToScene = coordinateMatrix("scene", "scene", [1, 0, 0, 1, 0, 0]);
  const projectedBoundsPoints = rectCorners(snapshot.bounds).map(projectPoint);
  const bounds = boundsForPoints(projectedBoundsPoints) ?? {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  };
  const base = {
    ref: snapshot.ref,
    space: "scene" as const,
    bounds,
    localToScene,
    metadata: cloneRecord(snapshot.metadata),
  };
  switch (snapshot.kind) {
    case "rect":
    case "polygon":
      return {
        ...base,
        kind: "polygon",
        points:
          snapshot.kind === "rect"
            ? rectCorners(snapshot.rect).map(projectPoint)
            : snapshot.points.map(projectPoint),
      };
    case "pointSet":
      return {
        ...base,
        kind: "pointSet",
        points: snapshot.points.map(projectPoint),
      };
    case "compound":
      return {
        ...base,
        kind: "compound",
        children: snapshot.children.map((child) => ({ ...child })),
      };
  }
}

function rectCorners(rect: GeometryRect): GeometryPoint[] {
  const normalized = normalizeGeometryRect(rect);
  const right = normalized.left + normalized.width;
  const bottom = normalized.top + normalized.height;
  return [
    { x: normalized.left, y: normalized.top },
    { x: right, y: normalized.top },
    { x: right, y: bottom },
    { x: normalized.left, y: bottom },
  ];
}

function cloneGeometrySnapshot<T extends GeometrySnapshot | null | undefined>(
  snapshot: T,
): T {
  if (!snapshot) return snapshot;
  const base = {
    ...snapshot,
    ref: { ...snapshot.ref },
    bounds: normalizeGeometryRect(snapshot.bounds),
    localToScene: coordinateMatrix(
      snapshot.localToScene.from,
      "scene",
      snapshot.localToScene.values,
    ),
    metadata: cloneRecord(snapshot.metadata),
  };
  switch (snapshot.kind) {
    case "rect":
      return { ...base, rect: normalizeGeometryRect(snapshot.rect) } as T;
    case "path":
      return base as T;
    case "polygon":
    case "pointSet":
      return {
        ...base,
        points: snapshot.points.map(normalizeGeometryPoint),
      } as T;
    case "compound":
      return {
        ...base,
        children: snapshot.children.map((child) => ({ ...child })),
      } as T;
    default:
      return base as T;
  }
}

function cloneRecord<T extends Record<string, unknown> | undefined>(
  value: T,
): T {
  return value ? ({ ...value } as T) : value;
}

function normalizeId(value: unknown, label: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeGeometryPoint(point: GeometryPoint): GeometryPoint {
  return {
    x: finiteNumber(point.x, 0),
    y: finiteNumber(point.y, 0),
  };
}

function normalizeOptionalPoint(
  point: GeometryPoint | null | undefined,
): GeometryPoint | null {
  return point ? normalizeGeometryPoint(point) : null;
}

function normalizeGeometryRect(rect: GeometryRect): GeometryRect {
  return {
    left: finiteNumber(rect.left, 0),
    top: finiteNumber(rect.top, 0),
    width: Math.max(0, finiteNumber(rect.width, 0)),
    height: Math.max(0, finiteNumber(rect.height, 0)),
  };
}

function boundsForPoints(
  points: readonly GeometryPoint[],
): GeometryRect | null {
  if (!points.length) return null;
  const normalized = points.map(normalizeGeometryPoint);
  const xs = normalized.map((point) => point.x);
  const ys = normalized.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    left,
    top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

function rectContainsPoint(rect: GeometryRect, point: GeometryPoint): boolean {
  const box = normalizeGeometryRect(rect);
  return (
    point.x >= box.left &&
    point.x <= box.left + box.width &&
    point.y >= box.top &&
    point.y <= box.top + box.height
  );
}

function polygonContainsPoint(
  points: readonly GeometryPoint[],
  point: GeometryPoint,
): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = normalizeGeometryPoint(points[i]);
    const b = normalizeGeometryPoint(points[j]);
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function clampPointToRect(
  point: GeometryPoint,
  rect: GeometryRect,
): GeometryPoint {
  const box = normalizeGeometryRect(rect);
  return {
    x: clamp(point.x, box.left, box.left + box.width),
    y: clamp(point.y, box.top, box.top + box.height),
  };
}

function nearestPointOnPolyline(
  points: readonly GeometryPoint[],
  point: GeometryPoint,
  closed: boolean,
): GeometryPoint | null {
  if (!points.length) return null;
  if (points.length === 1) return normalizeGeometryPoint(points[0]);
  const segments = closed
    ? points.map(
        (start, index) => [start, points[(index + 1) % points.length]] as const,
      )
    : points
        .slice(0, -1)
        .map((start, index) => [start, points[index + 1]] as const);
  return nearestFromCandidates(
    segments.map(([start, end]) =>
      nearestPointOnSegment(
        normalizeGeometryPoint(start),
        normalizeGeometryPoint(end),
        point,
      ),
    ),
    point,
  );
}

function nearestPointInSet(
  points: readonly GeometryPoint[],
  point: GeometryPoint,
): GeometryPoint | null {
  return nearestFromCandidates(points.map(normalizeGeometryPoint), point);
}

function nearestFromCandidates(
  candidates: readonly GeometryPoint[],
  point: GeometryPoint,
): GeometryPoint | null {
  let best: GeometryPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate) => {
    const distance = squaredDistance(candidate, point);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  });
  return best;
}

function nearestPointOnSegment(
  start: GeometryPoint,
  end: GeometryPoint,
  point: GeometryPoint,
): GeometryPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return start;
  const ratio = clamp01(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
  );
  return { x: start.x + dx * ratio, y: start.y + dy * ratio };
}

function sampleRect(rect: GeometryRect, ratio: number): GeometryPoint {
  const box = normalizeGeometryRect(rect);
  const perimeter = Math.max(0, box.width * 2 + box.height * 2);
  if (perimeter <= 0) return { x: box.left, y: box.top };
  let distance = ratio * perimeter;
  if (distance <= box.width) return { x: box.left + distance, y: box.top };
  distance -= box.width;
  if (distance <= box.height) {
    return { x: box.left + box.width, y: box.top + distance };
  }
  distance -= box.height;
  if (distance <= box.width) {
    return { x: box.left + box.width - distance, y: box.top + box.height };
  }
  distance -= box.width;
  return { x: box.left, y: box.top + distance };
}

function samplePolyline(
  points: readonly GeometryPoint[],
  ratio: number,
  closed: boolean,
): GeometryPoint | null {
  if (!points.length) return null;
  if (points.length === 1) return normalizeGeometryPoint(points[0]);
  const normalized = points.map(normalizeGeometryPoint);
  const segments = closed
    ? normalized.map(
        (start, index) =>
          [start, normalized[(index + 1) % normalized.length]] as const,
      )
    : normalized
        .slice(0, -1)
        .map((start, index) => [start, normalized[index + 1]] as const);
  const lengths = segments.map(([start, end]) =>
    Math.sqrt(squaredDistance(start, end)),
  );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) return normalized[0];
  let distance = ratio * total;
  for (let index = 0; index < segments.length; index += 1) {
    const length = lengths[index] ?? 0;
    if (distance <= length || index === segments.length - 1) {
      const [start, end] = segments[index];
      const segmentRatio = length > 0 ? distance / length : 0;
      return {
        x: start.x + (end.x - start.x) * segmentRatio,
        y: start.y + (end.y - start.y) * segmentRatio,
      };
    }
    distance -= length;
  }
  return normalized[normalized.length - 1];
}

function pointsEqual(left: GeometryPoint, right: GeometryPoint): boolean {
  return squaredDistance(normalizeGeometryPoint(left), right) <= 0.000001;
}

function squaredDistance(left: GeometryPoint, right: GeometryPoint): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
