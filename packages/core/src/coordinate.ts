export interface Point {
  x: number;
  y: number;
}

/**
 * The four coordinate spaces used by the editor. Spatial values crossing a
 * package/service boundary must carry one of these tags.
 */
export type CoordinateSpace =
  | "object-local"
  | "parent-local"
  | "scene"
  | "screen";

export interface CoordinatePoint<
  TSpace extends CoordinateSpace = CoordinateSpace,
> extends Point {
  readonly space: TSpace;
}

export interface CoordinateDelta<
  TSpace extends CoordinateSpace = CoordinateSpace,
> extends Point {
  readonly space: TSpace;
}

export interface CoordinateRect<
  TSpace extends CoordinateSpace = CoordinateSpace,
> {
  readonly space: TSpace;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Affine matrix mapping values from `from` into `to`. */
export interface CoordinateMatrix<
  TFrom extends CoordinateSpace = CoordinateSpace,
  TTo extends CoordinateSpace = CoordinateSpace,
> {
  readonly from: TFrom;
  readonly to: TTo;
  readonly values: readonly [number, number, number, number, number, number];
}

export type Matrix2D<
  TFrom extends CoordinateSpace = CoordinateSpace,
  TTo extends CoordinateSpace = CoordinateSpace,
> = CoordinateMatrix<TFrom, TTo>;

/** Canonical placement for every visual rendered into the scene. */
export interface AffinePlacement {
  readonly localBounds: CoordinateRect<"object-local">;
  readonly localToScene: Matrix2D<"object-local", "scene">;
  /** Editing pivot expressed in object-local coordinates. */
  readonly pivot: CoordinatePoint<"object-local">;
}

export type ObjectLocalCoordinatePoint = CoordinatePoint<"object-local">;
export type ParentLocalCoordinatePoint = CoordinatePoint<"parent-local">;
export type SceneCoordinatePoint = CoordinatePoint<"scene">;
export type ScreenCoordinatePoint = CoordinatePoint<"screen">;
export type SceneCoordinateDelta = CoordinateDelta<"scene">;
export type SceneCoordinateRect = CoordinateRect<"scene">;
export type ScreenCoordinateRect = CoordinateRect<"screen">;
export type SceneCoordinateMatrix = CoordinateMatrix<"scene", "scene">;

export function coordinatePoint<TSpace extends CoordinateSpace>(
  space: TSpace,
  x: number,
  y: number,
): CoordinatePoint<TSpace> {
  return { space, x: finiteCoordinate(x), y: finiteCoordinate(y) };
}

export function coordinateDelta<TSpace extends CoordinateSpace>(
  space: TSpace,
  x: number,
  y: number,
): CoordinateDelta<TSpace> {
  return { space, x: finiteCoordinate(x), y: finiteCoordinate(y) };
}

export function coordinateRect<TSpace extends CoordinateSpace>(
  space: TSpace,
  rect: Omit<CoordinateRect<TSpace>, "space">,
): CoordinateRect<TSpace> {
  return {
    space,
    left: finiteCoordinate(rect.left),
    top: finiteCoordinate(rect.top),
    width: Math.max(0, finiteCoordinate(rect.width)),
    height: Math.max(0, finiteCoordinate(rect.height)),
  };
}

export function coordinateMatrix<
  TFrom extends CoordinateSpace,
  TTo extends CoordinateSpace,
>(
  from: TFrom,
  to: TTo,
  values: readonly [number, number, number, number, number, number],
): CoordinateMatrix<TFrom, TTo> {
  return {
    from,
    to,
    values: values.map(finiteCoordinate) as unknown as CoordinateMatrix<
      TFrom,
      TTo
    >["values"],
  };
}

export function identityCoordinateMatrix<TSpace extends CoordinateSpace>(
  space: TSpace,
): Matrix2D<TSpace, TSpace> {
  return coordinateMatrix(space, space, [1, 0, 0, 1, 0, 0]);
}

/** Returns `outer(inner(point))`. */
export function multiplyCoordinateMatrices<
  TFrom extends CoordinateSpace,
  TMiddle extends CoordinateSpace,
  TTo extends CoordinateSpace,
>(
  outer: Matrix2D<TMiddle, TTo>,
  inner: Matrix2D<TFrom, TMiddle>,
): Matrix2D<TFrom, TTo> {
  const [a1, b1, c1, d1, e1, f1] = outer.values;
  const [a2, b2, c2, d2, e2, f2] = inner.values;
  return coordinateMatrix(inner.from, outer.to, [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]);
}

export function invertCoordinateMatrix<
  TFrom extends CoordinateSpace,
  TTo extends CoordinateSpace,
>(matrix: Matrix2D<TFrom, TTo>): Matrix2D<TTo, TFrom> {
  const [a, b, c, d, e, f] = matrix.values;
  const determinant = a * d - b * c;
  if (
    !Number.isFinite(determinant) ||
    Math.abs(determinant) <= Number.EPSILON
  ) {
    throw new Error(
      `Cannot invert singular ${matrix.from} -> ${matrix.to} coordinate matrix.`,
    );
  }
  return coordinateMatrix(matrix.to, matrix.from, [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ]);
}

export function transformCoordinatePoint<
  TFrom extends CoordinateSpace,
  TTo extends CoordinateSpace,
>(
  matrix: Matrix2D<TFrom, TTo>,
  point: CoordinatePoint<TFrom>,
): CoordinatePoint<TTo> {
  assertCoordinateSpace(point, matrix.from, "matrix input point");
  const [a, b, c, d, e, f] = matrix.values;
  return coordinatePoint(
    matrix.to,
    a * point.x + c * point.y + e,
    b * point.x + d * point.y + f,
  );
}

export function transformCoordinateRect<
  TFrom extends CoordinateSpace,
  TTo extends CoordinateSpace,
>(
  matrix: Matrix2D<TFrom, TTo>,
  rect: CoordinateRect<TFrom>,
): CoordinateRect<TTo> {
  assertCoordinateSpace(rect, matrix.from, "matrix input rect");
  const points = [
    coordinatePoint(matrix.from, rect.left, rect.top),
    coordinatePoint(matrix.from, rect.left + rect.width, rect.top),
    coordinatePoint(matrix.from, rect.left, rect.top + rect.height),
    coordinatePoint(
      matrix.from,
      rect.left + rect.width,
      rect.top + rect.height,
    ),
  ].map((point) => transformCoordinatePoint(matrix, point));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return coordinateRect(matrix.to, {
    left,
    top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  });
}

export function createAffinePlacement(options: {
  localBounds: Omit<CoordinateRect<"object-local">, "space">;
  localToScene: Matrix2D<"object-local", "scene">;
  pivot?: Omit<CoordinatePoint<"object-local">, "space">;
}): AffinePlacement {
  const localBounds = coordinateRect("object-local", options.localBounds);
  return {
    localBounds,
    localToScene: coordinateMatrix(
      "object-local",
      "scene",
      options.localToScene.values,
    ),
    pivot: coordinatePoint(
      "object-local",
      options.pivot?.x ?? localBounds.left + localBounds.width / 2,
      options.pivot?.y ?? localBounds.top + localBounds.height / 2,
    ),
  };
}

export function createLocalToSceneMatrix(options: {
  position: Omit<CoordinatePoint<"scene">, "space">;
  pivot: Omit<CoordinatePoint<"object-local">, "space">;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  skewX?: number;
  skewY?: number;
}): Matrix2D<"object-local", "scene"> {
  const scaleX = finiteCoordinate(options.scaleX ?? 1);
  const scaleY = finiteCoordinate(options.scaleY ?? 1);
  const rotation = (finiteCoordinate(options.rotation ?? 0) * Math.PI) / 180;
  const skewX = Math.tan(
    (finiteCoordinate(options.skewX ?? 0) * Math.PI) / 180,
  );
  const skewY = Math.tan(
    (finiteCoordinate(options.skewY ?? 0) * Math.PI) / 180,
  );
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const a = scaleX * (cosine - sine * skewY);
  const b = scaleX * (sine + cosine * skewY);
  const c = scaleY * (cosine * skewX - sine);
  const d = scaleY * (sine * skewX + cosine);
  return coordinateMatrix("object-local", "scene", [
    a,
    b,
    c,
    d,
    finiteCoordinate(options.position.x) -
      a * options.pivot.x -
      c * options.pivot.y,
    finiteCoordinate(options.position.y) -
      b * options.pivot.x -
      d * options.pivot.y,
  ]);
}

export function assertCoordinateSpace<TSpace extends CoordinateSpace>(
  value: { readonly space: CoordinateSpace },
  expected: TSpace,
  label = "coordinate value",
): asserts value is { readonly space: TSpace } {
  if (value.space !== expected) {
    throw new Error(
      `${label} must be in ${expected} space; received ${value.space}.`,
    );
  }
}

function finiteCoordinate(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export interface Size {
  width: number;
  height: number;
}

export type Unit = "px" | "mm" | "cm" | "in";

export interface Layout {
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export class Coordinate {
  static calculateLayout(container: Size, content: Size, padding = 0): Layout {
    const availableWidth = Math.max(0, container.width - padding * 2);
    const availableHeight = Math.max(0, container.height - padding * 2);

    if (content.width === 0 || content.height === 0) {
      return { scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 };
    }

    const scaleX = availableWidth / content.width;
    const scaleY = availableHeight / content.height;
    const scale = Math.min(scaleX, scaleY);

    const width = content.width * scale;
    const height = content.height * scale;

    const offsetX = (container.width - width) / 2;
    const offsetY = (container.height - height) / 2;

    return { scale, offsetX, offsetY, width, height };
  }

  static toNormalized(value: number, total: number): number {
    return total === 0 ? 0 : value / total;
  }

  static toAbsolute(normalized: number, total: number): number {
    return normalized * total;
  }

  static normalizePoint(point: Point, size: Size): Point {
    return {
      x: this.toNormalized(point.x, size.width),
      y: this.toNormalized(point.y, size.height),
    };
  }

  static denormalizePoint(point: Point, size: Size): Point {
    return {
      x: this.toAbsolute(point.x, size.width),
      y: this.toAbsolute(point.y, size.height),
    };
  }

  static convertUnit(value: number, from: Unit, to: Unit): number {
    if (from === to) return value;

    const toMm: Record<Unit, number> = {
      px: 0.264583,
      mm: 1,
      cm: 10,
      in: 25.4,
    };

    const mmValue = value * (from === "px" ? toMm.px : toMm[from] || 1);

    if (to === "px") {
      return mmValue / toMm.px;
    }
    return mmValue / (toMm[to] || 1);
  }
}
