import { Coordinate, Layout, Point, Size } from "./coordinate";

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
}
