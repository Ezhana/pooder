import type Disposable from "./disposable";
import type { CapabilityDefinition } from "./capability";
import type { Service } from "./service";
import type { GeometryPoint, GeometryRect } from "./interaction";

export const GEOMETRY_SOURCE_CAPABILITY_ID = "pooder.geometry-source";

export type CoordinateSpace = "document" | "scene" | "screen";

export interface GeometryRef {
  sourceId: string;
  geometryId: string;
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
  ref?: GeometryRef;
  space?: CoordinateSpace;
  metadata?: Record<string, unknown>;
}

export interface GeometryRectSnapshot extends GeometrySnapshotBase {
  kind: "rect";
  rect: GeometryRect;
}

export interface GeometryPathUtilityContext {
  snapshot: GeometryPathSnapshot;
}

export interface GeometryPathUtilities {
  bounds?(context: GeometryPathUtilityContext): GeometryRect | null;
  nearestPoint?(
    point: GeometryPoint,
    context: GeometryPathUtilityContext,
  ): GeometryPoint | null;
  contains?(
    point: GeometryPoint,
    context: GeometryPathUtilityContext,
  ): boolean;
  sample?(
    ratio: number,
    context: GeometryPathUtilityContext,
  ): GeometryPoint | null;
  normalAt?(
    point: GeometryPoint,
    context: GeometryPathUtilityContext,
  ): GeometryPoint | null;
}

export interface GeometryPathSnapshot extends GeometrySnapshotBase {
  kind: "path";
  pathData: string;
  bounds?: GeometryRect;
  utilities?: GeometryPathUtilities;
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
  children: GeometrySnapshot[];
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
  space?: CoordinateSpace;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface GeometrySourceProvider {
  sourceId: string;
  getGeometry(ref: GeometryRef): GeometrySnapshot | null;
  listGeometries?(): GeometryDescriptor[];
  projectGeometry?(
    ref: GeometryRef,
    space: CoordinateSpace,
  ): GeometrySnapshot | null;
}

export interface GeometrySourceCapability {
  registerSource(source: GeometrySourceProvider): Disposable;
  getGeometry(ref: GeometryRef): GeometrySnapshot | null;
  listGeometries(sourceId?: string): GeometryDescriptor[];
  projectGeometry(
    ref: GeometryRef,
    space: CoordinateSpace,
  ): GeometrySnapshot | null;
}

export function createGeometrySourceCapabilityDefinition(
  facade: GeometrySourceCapability,
): CapabilityDefinition<GeometrySourceCapability> {
  return {
    id: GEOMETRY_SOURCE_CAPABILITY_ID,
    metadata: {
      name: "Geometry Source",
      description: "Register, query, and project generic geometry sources.",
      tags: ["core", "geometry"],
    },
    facade,
  };
}

export class DefaultGeometrySourceCapability
  implements Service, GeometrySourceCapability
{
  private readonly providers = new Map<string, GeometrySourceProvider>();

  init(): void {}

  registerSource(source: GeometrySourceProvider): Disposable {
    const sourceId = normalizeId(source.sourceId, "GeometrySourceProvider.sourceId");
    if (this.providers.has(sourceId)) {
      throw new Error(`Geometry source "${sourceId}" is already registered.`);
    }
    const provider = { ...source, sourceId };
    this.providers.set(sourceId, provider);
    return {
      dispose: () => {
        if (this.providers.get(sourceId) === provider) {
          this.providers.delete(sourceId);
        }
      },
    };
  }

  getGeometry(ref: GeometryRef): GeometrySnapshot | null {
    const normalized = normalizeGeometryRef(ref);
    const snapshot =
      this.providers.get(normalized.sourceId)?.getGeometry(normalized) ?? null;
    return snapshot ? cloneGeometrySnapshot(snapshot) : null;
  }

  listGeometries(sourceId?: string): GeometryDescriptor[] {
    const sourceIds = sourceId
      ? [normalizeId(sourceId, "GeometryRef.sourceId")]
      : Array.from(this.providers.keys()).sort();
    return sourceIds.flatMap((id) =>
      (this.providers.get(id)?.listGeometries?.() ?? []).map(cloneDescriptor),
    );
  }

  projectGeometry(
    ref: GeometryRef,
    space: CoordinateSpace,
  ): GeometrySnapshot | null {
    const normalized = normalizeGeometryRef(ref);
    const provider = this.providers.get(normalized.sourceId);
    const projected = provider?.projectGeometry?.(normalized, space);
    if (projected) return cloneGeometrySnapshot(projected);
    const snapshot = provider?.getGeometry(normalized) ?? null;
    if (!snapshot) return null;
    return cloneGeometrySnapshot({ ...snapshot, space });
  }
}

export function createStaticGeometrySourceProvider(options: {
  sourceId: string;
  geometries: readonly GeometrySnapshot[];
}): GeometrySourceProvider {
  const sourceId = normalizeId(options.sourceId, "GeometrySourceProvider.sourceId");
  const snapshots = new Map<string, GeometrySnapshot>();
  options.geometries.forEach((snapshot, index) => {
    const geometryId =
      snapshot.ref?.geometryId || String(snapshot.metadata?.id || index);
    snapshots.set(geometryId, {
      ...cloneGeometrySnapshot(snapshot),
      ref: { sourceId, geometryId, variant: snapshot.ref?.variant },
    });
  });
  return {
    sourceId,
    getGeometry(ref) {
      return cloneGeometrySnapshot(snapshots.get(ref.geometryId) ?? null);
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

export function getGeometryBounds(
  snapshot: GeometrySnapshot,
): GeometryRect | null {
  switch (snapshot.kind) {
    case "rect":
      return normalizeGeometryRect(snapshot.rect);
    case "path":
      return normalizeOptionalRect(
        snapshot.utilities?.bounds?.({ snapshot }) ?? snapshot.bounds,
      );
    case "polygon":
    case "pointSet":
      return boundsForPoints(snapshot.points);
    case "compound":
      return unionRects(snapshot.children.map(getGeometryBounds));
    default:
      return null;
  }
}

export function containsGeometryPoint(
  snapshot: GeometrySnapshot,
  point: GeometryPoint,
): boolean {
  const normalizedPoint = normalizeGeometryPoint(point);
  switch (snapshot.kind) {
    case "rect":
      return rectContainsPoint(snapshot.rect, normalizedPoint);
    case "path":
      return Boolean(snapshot.utilities?.contains?.(normalizedPoint, { snapshot }));
    case "polygon":
      return polygonContainsPoint(snapshot.points, normalizedPoint);
    case "pointSet":
      return snapshot.points.some((candidate) =>
        pointsEqual(candidate, normalizedPoint),
      );
    case "compound":
      return snapshot.children.some((child) =>
        containsGeometryPoint(child, normalizedPoint),
      );
    default:
      return false;
  }
}

export function findNearestGeometryPoint(
  snapshot: GeometrySnapshot,
  point: GeometryPoint,
): GeometryPoint | null {
  const normalizedPoint = normalizeGeometryPoint(point);
  switch (snapshot.kind) {
    case "rect":
      return clampPointToRect(normalizedPoint, snapshot.rect);
    case "path":
      return normalizeOptionalPoint(
        snapshot.utilities?.nearestPoint?.(normalizedPoint, { snapshot }),
      );
    case "polygon":
      return nearestPointOnPolyline(snapshot.points, normalizedPoint, true);
    case "pointSet":
      return nearestPointInSet(snapshot.points, normalizedPoint);
    case "compound":
      return nearestFromCandidates(
        snapshot.children
          .map((child) => findNearestGeometryPoint(child, normalizedPoint))
          .filter((item): item is GeometryPoint => Boolean(item)),
        normalizedPoint,
      );
    default:
      return null;
  }
}

export function sampleGeometryPoint(
  snapshot: GeometrySnapshot,
  ratio: number,
): GeometryPoint | null {
  const normalizedRatio = clamp01(Number.isFinite(ratio) ? ratio : 0);
  switch (snapshot.kind) {
    case "rect":
      return sampleRect(snapshot.rect, normalizedRatio);
    case "path":
      return normalizeOptionalPoint(
        snapshot.utilities?.sample?.(normalizedRatio, { snapshot }),
      );
    case "polygon":
      return samplePolyline(snapshot.points, normalizedRatio, true);
    case "pointSet":
      if (!snapshot.points.length) return null;
      return normalizeGeometryPoint(
        snapshot.points[
          Math.min(snapshot.points.length - 1, Math.floor(normalizedRatio * snapshot.points.length))
        ],
      );
    case "compound":
      return snapshot.children.length
        ? sampleGeometryPoint(
            snapshot.children[
              Math.min(
                snapshot.children.length - 1,
                Math.floor(normalizedRatio * snapshot.children.length),
              )
            ],
            normalizedRatio,
          )
        : null;
    default:
      return null;
  }
}

export function getGeometryNormalAt(
  snapshot: GeometrySnapshot,
  point: GeometryPoint,
): GeometryPoint | null {
  const normalizedPoint = normalizeGeometryPoint(point);
  if (snapshot.kind === "path") {
    return normalizeOptionalPoint(
      snapshot.utilities?.normalAt?.(normalizedPoint, { snapshot }),
    );
  }
  const nearest = findNearestGeometryPoint(snapshot, normalizedPoint);
  if (!nearest) return null;
  const dx = normalizedPoint.x - nearest.x;
  const dy = normalizedPoint.y - nearest.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return null;
  return { x: dx / length, y: dy / length };
}

function normalizeGeometryRef(ref: GeometryRef): GeometryRef {
  return {
    sourceId: normalizeId(ref.sourceId, "GeometryRef.sourceId"),
    geometryId: normalizeId(ref.geometryId, "GeometryRef.geometryId"),
    ...(ref.variant ? { variant: String(ref.variant) } : {}),
  };
}

function cloneDescriptor(descriptor: GeometryDescriptor): GeometryDescriptor {
  return {
    ...descriptor,
    ref: { ...descriptor.ref },
    metadata: cloneRecord(descriptor.metadata),
  };
}

function cloneGeometrySnapshot<T extends GeometrySnapshot | null | undefined>(
  snapshot: T,
): T {
  if (!snapshot) return snapshot;
  const base = {
    ...snapshot,
    ref: snapshot.ref ? { ...snapshot.ref } : undefined,
    metadata: cloneRecord(snapshot.metadata),
  };
  switch (snapshot.kind) {
    case "rect":
      return { ...base, rect: normalizeGeometryRect(snapshot.rect) } as T;
    case "path":
      return {
        ...base,
        bounds: normalizeOptionalRect(snapshot.bounds) ?? undefined,
      } as T;
    case "polygon":
    case "pointSet":
      return {
        ...base,
        points: snapshot.points.map(normalizeGeometryPoint),
      } as T;
    case "compound":
      return {
        ...base,
        children: snapshot.children.map(cloneGeometrySnapshot),
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

function normalizeOptionalRect(
  rect: GeometryRect | null | undefined,
): GeometryRect | null {
  return rect ? normalizeGeometryRect(rect) : null;
}

function boundsForPoints(points: readonly GeometryPoint[]): GeometryRect | null {
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

function unionRects(rects: Array<GeometryRect | null>): GeometryRect | null {
  const values = rects.filter((rect): rect is GeometryRect => Boolean(rect));
  if (!values.length) return null;
  const left = Math.min(...values.map((rect) => rect.left));
  const top = Math.min(...values.map((rect) => rect.top));
  const right = Math.max(...values.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...values.map((rect) => rect.top + rect.height));
  return { left, top, width: right - left, height: bottom - top };
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
    ? points.map((start, index) => [start, points[(index + 1) % points.length]] as const)
    : points.slice(0, -1).map((start, index) => [start, points[index + 1]] as const);
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
    ? normalized.map((start, index) => [start, normalized[(index + 1) % normalized.length]] as const)
    : normalized.slice(0, -1).map((start, index) => [start, normalized[index + 1]] as const);
  const lengths = segments.map(([start, end]) => Math.sqrt(squaredDistance(start, end)));
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
