import {
  Coordinate,
  coordinateMatrix,
  multiplyCoordinateMatrices,
  type CoordinateSpace,
  type CoordinatePoint,
  type CoordinateRect,
  type Layout,
  type Matrix2D,
  type Point,
  type Size,
} from "@pooder/core";

export class ViewportSystem {
  private _containerSize: Size = { width: 0, height: 0 };
  private _physicalSize: Size = { width: 0, height: 0 };
  private _padding: number = 0;
  private _layout: Layout = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    width: 0,
    height: 0,
  };

  constructor(
    containerSize: Size = { width: 0, height: 0 },
    physicalSize: Size = { width: 0, height: 0 },
    padding: number = 40,
  ) {
    this._containerSize = containerSize;
    this._physicalSize = physicalSize;
    this._padding = padding;
    this.updateLayout();
  }

  get layout(): Layout {
    return this._layout;
  }

  get scale(): number {
    return this._layout.scale;
  }

  get offset(): Point {
    return { x: this._layout.offsetX, y: this._layout.offsetY };
  }

  updateContainer(width: number, height: number) {
    if (
      this._containerSize.width === width &&
      this._containerSize.height === height
    )
      return;
    this._containerSize = { width, height };
    this.updateLayout();
  }

  updatePhysical(width: number, height: number) {
    if (
      this._physicalSize.width === width &&
      this._physicalSize.height === height
    )
      return;
    this._physicalSize = { width, height };
    this.updateLayout();
  }

  setPadding(padding: number) {
    if (this._padding === padding) return;
    this._padding = padding;
    this.updateLayout();
  }

  setOffset(offsetX: number, offsetY: number) {
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return;
    this._layout = {
      ...this._layout,
      offsetX,
      offsetY,
    };
  }

  setLayout(layout: Layout) {
    if (
      !Number.isFinite(layout.scale) ||
      !Number.isFinite(layout.offsetX) ||
      !Number.isFinite(layout.offsetY) ||
      !Number.isFinite(layout.width) ||
      !Number.isFinite(layout.height) ||
      layout.scale <= 0 ||
      layout.width < 0 ||
      layout.height < 0
    ) {
      return;
    }
    this._layout = { ...layout };
  }

  private updateLayout() {
    this._layout = Coordinate.calculateLayout(
      this._containerSize,
      this._physicalSize,
      this._padding,
    );
  }

  toPixel(value: number): number {
    return value * this._layout.scale;
  }

  toPhysical(value: number): number {
    return this._layout.scale === 0 ? 0 : value / this._layout.scale;
  }

  toPixelPoint(point: Point): Point {
    return {
      x: point.x * this._layout.scale + this._layout.offsetX,
      y: point.y * this._layout.scale + this._layout.offsetY,
    };
  }

  // Convert screen coordinate (e.g. mouse event) to physical coordinate (relative to content origin)
  toPhysicalPoint(point: Point): Point {
    if (this._layout.scale === 0) return { x: 0, y: 0 };
    return {
      x: (point.x - this._layout.offsetX) / this._layout.scale,
      y: (point.y - this._layout.offsetY) / this._layout.scale,
    };
  }

  sceneToScreenPoint(
    point: CoordinatePoint<"scene">,
  ): CoordinatePoint<"screen"> {
    const projected = this.toPixelPoint(point);
    return { ...projected, space: "screen" };
  }

  screenToScenePoint(
    point: CoordinatePoint<"screen">,
  ): CoordinatePoint<"scene"> {
    const projected = this.toPhysicalPoint(point);
    return { ...projected, space: "scene" };
  }

  sceneToScreenLength(value: number): number {
    return this.toPixel(value);
  }

  screenToSceneLength(value: number): number {
    return this.toPhysical(value);
  }

  sceneToScreenMatrix<TFrom extends CoordinateSpace>(
    matrix: Matrix2D<TFrom, "scene">,
  ): Matrix2D<TFrom, "screen"> {
    const sceneToScreen = coordinateMatrix("scene", "screen", [
      this._layout.scale,
      0,
      0,
      this._layout.scale,
      this._layout.offsetX,
      this._layout.offsetY,
    ]);
    return multiplyCoordinateMatrices(sceneToScreen, matrix);
  }

  screenToSceneMatrix<TFrom extends CoordinateSpace>(
    matrix: Matrix2D<TFrom, "screen">,
  ): Matrix2D<TFrom, "scene"> {
    const scale = this._layout.scale || 1;
    const screenToScene = coordinateMatrix("screen", "scene", [
      1 / scale,
      0,
      0,
      1 / scale,
      -this._layout.offsetX / scale,
      -this._layout.offsetY / scale,
    ]);
    return multiplyCoordinateMatrices(screenToScene, matrix);
  }

  sceneToScreenRect(rect: CoordinateRect<"scene">): CoordinateRect<"screen"> {
    const origin = this.sceneToScreenPoint({
      space: "scene",
      x: rect.left,
      y: rect.top,
    });
    return {
      space: "screen",
      left: origin.x,
      top: origin.y,
      width: this.sceneToScreenLength(rect.width),
      height: this.sceneToScreenLength(rect.height),
    };
  }

  screenToSceneRect(rect: CoordinateRect<"screen">): CoordinateRect<"scene"> {
    const origin = this.screenToScenePoint({
      space: "screen",
      x: rect.left,
      y: rect.top,
    });
    return {
      space: "scene",
      left: origin.x,
      top: origin.y,
      width: this.screenToSceneLength(rect.width),
      height: this.screenToSceneLength(rect.height),
    };
  }
}
