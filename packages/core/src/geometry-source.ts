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
  format: string;
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

export type GeometryBooleanOperator =
  | "union"
  | "intersect"
  | "subtract"
  | "exclude";

export interface GeometryBooleanRequest {
  refs: readonly [GeometryRef, GeometryRef, ...GeometryRef[]];
  operator: GeometryBooleanOperator;
  resultRef: GeometryRef;
  space?: CoordinateSpace;
}

export interface GeometrySource {
  sourceId: string;
  getSnapshot(ref: GeometryRef): GeometrySnapshot | null;
  listGeometries?(): GeometryDescriptor[];
}

export interface GeometryBackend {
  backendId: string;
  supports(snapshot: GeometryPathSnapshot): boolean;
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
  boolean?(
    operator: GeometryBooleanOperator,
    snapshots: readonly [
      GeometryPathSnapshot,
      GeometryPathSnapshot,
      ...GeometryPathSnapshot[],
    ],
    resultRef: GeometryRef,
  ): GeometryPathSnapshot | null;
  project?(
    snapshot: GeometryPathSnapshot,
    to: CoordinateSpace,
  ): GeometryPathSnapshot | null;
}

export type GeometryOperation =
  | "snapshot"
  | "bounds"
  | "nearestPoint"
  | "normalAt"
  | "contains"
  | "sample"
  | "boolean"
  | "project";

export interface GeometryDiagnostic {
  code:
    | "geometry-source-missing"
    | "geometry-snapshot-missing"
    | "geometry-backend-missing"
    | "geometry-operation-unsupported"
    | "geometry-projection-unsupported";
  message: string;
  operation: GeometryOperation;
  ref: GeometryRef;
  backendId?: string;
}

export interface GeometryOperationResult<T> {
  value: T;
  diagnostics: GeometryDiagnostic[];
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

  hasBackend(backendId: string): boolean {
    return this.backends.has(
      normalizeId(backendId, "GeometryBackend.backendId"),
    );
  }

  getSnapshot(
    ref: GeometryRef,
  ): GeometryOperationResult<GeometrySnapshot | null> {
    const normalized = normalizeGeometryRef(ref);
    const source = this.providers.get(normalized.sourceId);
    if (!source) {
      return geometryFailure(
        null,
        "geometry-source-missing",
        "snapshot",
        normalized,
        `Geometry source "${normalized.sourceId}" is not registered.`,
      );
    }
    const snapshot = source.getSnapshot(normalized);
    return snapshot
      ? geometrySuccess(normalizeGeometrySnapshot(snapshot, normalized))
      : geometryFailure(
          null,
          "geometry-snapshot-missing",
          "snapshot",
          normalized,
          `Geometry "${formatGeometryRef(normalized)}" was not found.`,
        );
  }

  listGeometries(sourceId?: string): GeometryDescriptor[] {
    const sourceIds = sourceId
      ? [normalizeId(sourceId, "GeometryRef.sourceId")]
      : Array.from(this.providers.keys()).sort();
    return sourceIds.flatMap((id) =>
      (this.providers.get(id)?.listGeometries?.() ?? []).map(cloneDescriptor),
    );
  }

  getBounds(
    ref: GeometryRef,
    space?: CoordinateSpace,
  ): GeometryOperationResult<GeometryRect | null> {
    const resolved = this.resolveSnapshot(ref, space, "bounds");
    return resolved.value
      ? { value: resolved.value.bounds, diagnostics: resolved.diagnostics }
      : { value: null, diagnostics: resolved.diagnostics };
  }

  nearestPoint(
    ref: GeometryRef,
    point: GeometryPoint,
    space?: CoordinateSpace,
  ): GeometryOperationResult<GeometryPoint | null> {
    const resolved = this.resolveSnapshot(ref, space, "nearestPoint");
    if (!resolved.value) {
      return { value: null, diagnostics: resolved.diagnostics };
    }
    const backendCheck = this.requireBackend(resolved.value, "nearestPoint");
    if (backendCheck) return backendCheck;
    return geometrySuccess(
      findNearestGeometryPoint(resolved.value, point, this),
    );
  }

  normalAt(
    ref: GeometryRef,
    point: GeometryPoint,
    space?: CoordinateSpace,
  ): GeometryOperationResult<GeometryPoint | null> {
    const resolved = this.resolveSnapshot(ref, space, "normalAt");
    if (!resolved.value) {
      return { value: null, diagnostics: resolved.diagnostics };
    }
    const backendCheck = this.requireBackend(resolved.value, "normalAt");
    if (backendCheck) return backendCheck;
    return geometrySuccess(getGeometryNormalAt(resolved.value, point, this));
  }

  contains(
    ref: GeometryRef,
    point: GeometryPoint,
    space?: CoordinateSpace,
  ): GeometryOperationResult<boolean | null> {
    const resolved = this.resolveSnapshot(ref, space, "contains");
    if (!resolved.value) {
      return { value: null, diagnostics: resolved.diagnostics };
    }
    const backendCheck = this.requireBackend(resolved.value, "contains");
    if (backendCheck) return backendCheck;
    return geometrySuccess(containsGeometryPoint(resolved.value, point, this));
  }

  sample(
    ref: GeometryRef,
    ratio: number,
    space?: CoordinateSpace,
  ): GeometryOperationResult<GeometryPoint | null> {
    const resolved = this.resolveSnapshot(ref, space, "sample");
    if (!resolved.value) {
      return { value: null, diagnostics: resolved.diagnostics };
    }
    const backendCheck = this.requireBackend(resolved.value, "sample");
    if (backendCheck) return backendCheck;
    return geometrySuccess(sampleGeometryPoint(resolved.value, ratio, this));
  }

  boolean(
    request: GeometryBooleanRequest,
  ): GeometryOperationResult<GeometryPathSnapshot | null> {
    const normalizedResultRef = normalizeGeometryRef(request.resultRef);
    const resolved = request.refs.map((ref) =>
      this.resolveSnapshot(ref, request.space, "boolean"),
    );
    const failed = resolved.find((result) => !result.value);
    if (failed) return { value: null, diagnostics: failed.diagnostics };
    const snapshots = resolved.map((result) => result.value!);
    if (snapshots.some((snapshot) => snapshot.kind !== "path")) {
      return geometryFailure(
        null,
        "geometry-operation-unsupported",
        "boolean",
        normalizedResultRef,
        "Boolean geometry operations require path snapshots.",
      );
    }
    const paths = snapshots as [
      GeometryPathSnapshot,
      GeometryPathSnapshot,
      ...GeometryPathSnapshot[],
    ];
    const backend = this.getBackend(paths[0]);
    if (!backend || paths.some((path) => !backend.supports(path))) {
      return geometryFailure(
        null,
        "geometry-backend-missing",
        "boolean",
        normalizedResultRef,
        `No single geometry backend supports every path in the ${request.operator} operation.`,
      );
    }
    if (!backend.boolean) {
      return geometryFailure(
        null,
        "geometry-operation-unsupported",
        "boolean",
        normalizedResultRef,
        `Geometry backend "${backend.backendId}" does not implement boolean operations.`,
        backend.backendId,
      );
    }
    const value = backend.boolean(request.operator, paths, normalizedResultRef);
    return value
      ? geometrySuccess(
          normalizeGeometrySnapshot(
            value,
            normalizedResultRef,
          ) as GeometryPathSnapshot,
        )
      : geometryFailure(
          null,
          "geometry-operation-unsupported",
          "boolean",
          normalizedResultRef,
          `Geometry backend "${backend.backendId}" could not complete the ${request.operator} operation.`,
          backend.backendId,
        );
  }

  project(
    request: GeometryProjectionRequest,
  ): GeometryOperationResult<GeometrySnapshot | null> {
    const normalized = normalizeGeometryRef(request.ref);
    const resolved = this.getSnapshot(normalized);
    const snapshot = resolved.value;
    if (!snapshot) return resolved;
    if (snapshot.space === request.to) return resolved;
    const projected = this.projectSnapshot(snapshot, request.to);
    if (!projected) {
      const backend =
        snapshot.kind === "path" ? this.getBackend(snapshot) : null;
      const missingBackend = snapshot.kind === "path" && !backend;
      return geometryFailure(
        null,
        missingBackend
          ? "geometry-backend-missing"
          : "geometry-projection-unsupported",
        "project",
        normalized,
        missingBackend
          ? `No geometry backend supports ${describeGeometry(snapshot)}.`
          : backend
            ? `Geometry backend "${backend.backendId}" cannot project "${formatGeometryRef(normalized)}" to ${request.to}.`
            : `Core geometry "${formatGeometryRef(normalized)}" cannot be projected to ${request.to}.`,
        backend?.backendId,
      );
    }
    if (projected.space !== request.to) {
      throw new Error(
        `Geometry provider "${normalized.sourceId}" returned ${projected.space} ` +
          `space while projecting to ${request.to}.`,
      );
    }
    return geometrySuccess(normalizeGeometrySnapshot(projected, normalized));
  }

  private resolveSnapshot(
    ref: GeometryRef,
    space?: CoordinateSpace,
    operation: GeometryOperation = "snapshot",
  ): GeometryOperationResult<GeometrySnapshot | null> {
    const raw = this.getSnapshot(ref);
    const resolved =
      operation === "snapshot"
        ? raw
        : {
            ...raw,
            diagnostics: raw.diagnostics.map((diagnostic) => ({
              ...diagnostic,
              operation,
            })),
          };
    const snapshot = resolved.value;
    if (!snapshot || !space || snapshot.space === space) return resolved;
    const projected = this.project({ ref, to: space });
    return projected.diagnostics.length
      ? projected
      : { ...projected, diagnostics: resolved.diagnostics };
  }

  private projectSnapshot(
    snapshot: GeometrySnapshot,
    to: CoordinateSpace,
  ): GeometrySnapshot | null {
    if (snapshot.kind === "path") {
      return this.getBackend(snapshot)?.project?.(snapshot, to) ?? null;
    }
    if (to !== "scene") return null;
    return projectCoreSnapshotToScene(snapshot);
  }

  getBackend(snapshot: GeometryPathSnapshot): GeometryBackend | undefined {
    return Array.from(this.backends.values()).find((backend) => {
      try {
        return backend.supports(snapshot);
      } catch {
        return false;
      }
    });
  }

  private requireBackend(
    snapshot: GeometrySnapshot,
    operation: Exclude<
      GeometryOperation,
      "snapshot" | "bounds" | "boolean" | "project"
    >,
  ): GeometryOperationResult<null> | null {
    if (snapshot.kind !== "path") return null;
    const backend = this.getBackend(snapshot);
    if (!backend) {
      return geometryFailure(
        null,
        "geometry-backend-missing",
        operation,
        snapshot.ref,
        `No geometry backend supports ${describeGeometry(snapshot)}.`,
      );
    }
    if (typeof backend[operation] !== "function") {
      return geometryFailure(
        null,
        "geometry-operation-unsupported",
        operation,
        snapshot.ref,
        `Geometry backend "${backend.backendId}" does not implement ${operation}.`,
        backend.backendId,
      );
    }
    return null;
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
        Boolean(service.contains(child, normalizedPoint, snapshot.space).value),
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
          .map(
            (child) =>
              service.nearestPoint(child, normalizedPoint, snapshot.space)
                .value,
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
      ).value;
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

function geometrySuccess<T>(value: T): GeometryOperationResult<T> {
  return { value, diagnostics: [] };
}

function geometryFailure<T>(
  value: T,
  code: GeometryDiagnostic["code"],
  operation: GeometryOperation,
  ref: GeometryRef,
  message: string,
  backendId?: string,
): GeometryOperationResult<T> {
  return {
    value,
    diagnostics: [
      {
        code,
        operation,
        ref: { ...ref },
        message,
        ...(backendId ? { backendId } : {}),
      },
    ],
  };
}

function formatGeometryRef(ref: GeometryRef): string {
  const suffix = [ref.purpose, ref.variant].filter(Boolean).join(":");
  return `${ref.sourceId}/${ref.geometryId}${suffix ? `:${suffix}` : ""}`;
}

function describeGeometry(snapshot: GeometrySnapshot): string {
  const format = snapshot.kind === "path" ? `${snapshot.format} ` : "";
  return `${format}${snapshot.kind} geometry "${formatGeometryRef(snapshot.ref)}"`;
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
    cloned.format = normalizeId(
      cloned.format,
      `Geometry "${ref.sourceId}/${ref.geometryId}" format`,
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
