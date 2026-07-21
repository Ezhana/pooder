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
