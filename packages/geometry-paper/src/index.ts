import {
  coordinateMatrix,
  type GeometryBackend,
  type GeometryBooleanOperator,
  type GeometryPathSnapshot,
  type GeometryPoint,
  type GeometrySourceService,
} from "@pooder/core";
import type paperType = require("paper");

export const SVG_PATH_GEOMETRY_FORMAT = "svg-path";
export const PAPER_GEOMETRY_BACKEND_ID = "paper.svg-path";

export type PaperScope = typeof paperType;
type PaperPathItem =
  | InstanceType<PaperScope["Path"]>
  | InstanceType<PaperScope["CompoundPath"]>;

let registeredPaperScope: PaperScope | undefined;

export function registerPaperScope(scope: PaperScope): void {
  registeredPaperScope = scope;
}

export function getPaperScope(): PaperScope {
  if (!registeredPaperScope) {
    throw new Error(
      "Paper.js has not been loaded. Call loadPaperGeometryBackend() in a browser entry before using Paper geometry utilities.",
    );
  }
  return registeredPaperScope;
}

/**
 * Lazy namespace used by legacy synchronous geometry helpers. Accessing the
 * proxy is safe during import; Paper.js is required only when a helper runs.
 */
export const paper = new Proxy({} as PaperScope, {
  get: (_target, property) => Reflect.get(getPaperScope(), property),
});

export function createPaperGeometryBackend(
  scope: PaperScope = getPaperScope(),
): GeometryBackend {
  return {
    backendId: PAPER_GEOMETRY_BACKEND_ID,
    supports: (snapshot) => snapshot.format === SVG_PATH_GEOMETRY_FORMAT,
    nearestPoint: (snapshot, point) =>
      getNearestPoint(scope, snapshot.pathData, point)?.point ?? null,
    normalAt: (snapshot, point) =>
      getNearestPoint(scope, snapshot.pathData, point)?.normal ?? null,
    contains: (snapshot, point) =>
      withPath(scope, snapshot.pathData, (path) =>
        path.contains(new scope.Point(point.x, point.y)),
      ) ?? false,
    sample: (snapshot, ratio) =>
      withPath(scope, snapshot.pathData, (path) => {
        const sampleable = path as PaperPathItem & {
          getPointAt(offset: number): { x: number; y: number } | null;
          length: number;
        };
        const length = Math.max(0, sampleable.length || 0);
        const point =
          length > 0
            ? sampleable.getPointAt(Math.max(0, Math.min(1, ratio)) * length)
            : null;
        return point ? { x: point.x, y: point.y } : null;
      }),
    boolean: (operator, snapshots, resultRef) =>
      booleanPaths(scope, operator, snapshots, resultRef),
    project: (snapshot, to) => projectPath(scope, snapshot, to),
  };
}

export async function loadPaperGeometryBackend(
  geometrySource: GeometrySourceService,
): Promise<{ dispose(): void }> {
  if (geometrySource.hasBackend(PAPER_GEOMETRY_BACKEND_ID)) {
    return { dispose() {} };
  }
  const module = await import("paper");
  const scope = (module.default ?? module) as PaperScope;
  registerPaperScope(scope);
  return geometrySource.registerBackend(createPaperGeometryBackend(scope));
}

function ensurePaper(scope: PaperScope): void {
  if (!scope.project) {
    scope.setup(new scope.Size(1000, 1000));
  }
}

function withPath<T>(
  scope: PaperScope,
  pathData: string,
  read: (path: PaperPathItem) => T,
): T | null {
  if (!pathData.trim()) return null;
  ensurePaper(scope);
  const path: PaperPathItem =
    (pathData.match(/[Mm]/g) ?? []).length > 1
      ? new scope.CompoundPath(pathData)
      : (() => {
          const item = new scope.Path();
          item.pathData = pathData;
          return item;
        })();
  try {
    return read(path);
  } finally {
    path.remove();
  }
}

function getNearestPoint(
  scope: PaperScope,
  pathData: string,
  point: GeometryPoint,
): { point: GeometryPoint; normal?: GeometryPoint } | null {
  return withPath(scope, pathData, (path) => {
    const location = path.getNearestLocation(new scope.Point(point.x, point.y));
    if (!location?.point) return null;
    return {
      point: { x: location.point.x, y: location.point.y },
      normal: location.normal
        ? { x: location.normal.x, y: location.normal.y }
        : undefined,
    };
  });
}

function booleanPaths(
  scope: PaperScope,
  operator: GeometryBooleanOperator,
  snapshots: readonly [
    GeometryPathSnapshot,
    GeometryPathSnapshot,
    ...GeometryPathSnapshot[],
  ],
  resultRef: GeometryPathSnapshot["ref"],
): GeometryPathSnapshot | null {
  ensurePaper(scope);
  const paths = snapshots.map((snapshot) =>
    createPath(scope, snapshot.pathData),
  );
  if (paths.some((path) => !path)) return null;
  const livePaths = paths as PaperPathItem[];
  let result = livePaths[0];
  try {
    for (const next of livePaths.slice(1)) {
      const previous = result;
      result = applyBoolean(previous, next, operator);
      if (previous !== livePaths[0]) previous.remove();
    }
    const first = snapshots[0];
    return {
      ...first,
      ref: resultRef,
      pathData: result.pathData,
      bounds: {
        left: result.bounds.x,
        top: result.bounds.y,
        width: result.bounds.width,
        height: result.bounds.height,
      },
    };
  } finally {
    livePaths.forEach((path) => path.remove());
    if (!livePaths.includes(result)) result.remove();
  }
}

function applyBoolean(
  left: PaperPathItem,
  right: PaperPathItem,
  operator: GeometryBooleanOperator,
): PaperPathItem {
  const method = operator === "union" ? "unite" : operator;
  return (
    left as unknown as Record<string, (path: PaperPathItem) => PaperPathItem>
  )[method](right);
}

function projectPath(
  scope: PaperScope,
  snapshot: GeometryPathSnapshot,
  to: GeometryPathSnapshot["space"],
): GeometryPathSnapshot | null {
  if (to === snapshot.space) return snapshot;
  if (to !== "scene") return null;
  return withPath(scope, snapshot.pathData, (path) => {
    const [a, b, c, d, tx, ty] = snapshot.localToScene.values;
    path.transform(new scope.Matrix(a, c, b, d, tx, ty));
    return {
      ...snapshot,
      pathData: path.pathData,
      space: "scene",
      bounds: {
        left: path.bounds.x,
        top: path.bounds.y,
        width: path.bounds.width,
        height: path.bounds.height,
      },
      localToScene: coordinateMatrix("scene", "scene", [1, 0, 0, 1, 0, 0]),
    };
  });
}

function createPath(scope: PaperScope, pathData: string): PaperPathItem | null {
  if (!pathData.trim()) return null;
  return (pathData.match(/[Mm]/g) ?? []).length > 1
    ? new scope.CompoundPath(pathData)
    : (() => {
        const item = new scope.Path();
        item.pathData = pathData;
        return item;
      })();
}
