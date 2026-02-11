"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViewportSystem = void 0;
const coordinate_1 = require("./coordinate");
class ViewportSystem {
    constructor(containerSize = { width: 0, height: 0 }, physicalSize = { width: 0, height: 0 }, padding = 40) {
        this._containerSize = { width: 0, height: 0 };
        this._physicalSize = { width: 0, height: 0 };
        this._padding = 0;
        this._layout = {
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            width: 0,
            height: 0,
        };
        this._containerSize = containerSize;
        this._physicalSize = physicalSize;
        this._padding = padding;
        this.updateLayout();
    }
    get layout() {
        return this._layout;
    }
    get scale() {
        return this._layout.scale;
    }
    get offset() {
        return { x: this._layout.offsetX, y: this._layout.offsetY };
    }
    updateContainer(width, height) {
        if (this._containerSize.width === width &&
            this._containerSize.height === height)
            return;
        this._containerSize = { width, height };
        this.updateLayout();
    }
    updatePhysical(width, height) {
        if (this._physicalSize.width === width && this._physicalSize.height === height)
            return;
        this._physicalSize = { width, height };
        this.updateLayout();
    }
    setPadding(padding) {
        if (this._padding === padding)
            return;
        this._padding = padding;
        this.updateLayout();
    }
    updateLayout() {
        this._layout = coordinate_1.Coordinate.calculateLayout(this._containerSize, this._physicalSize, this._padding);
    }
    toPixel(value) {
        return value * this._layout.scale;
    }
    toPhysical(value) {
        return this._layout.scale === 0 ? 0 : value / this._layout.scale;
    }
    toPixelPoint(point) {
        return {
            x: point.x * this._layout.scale + this._layout.offsetX,
            y: point.y * this._layout.scale + this._layout.offsetY,
        };
    }
    // Convert screen coordinate (e.g. mouse event) to physical coordinate (relative to content origin)
    toPhysicalPoint(point) {
        if (this._layout.scale === 0)
            return { x: 0, y: 0 };
        return {
            x: (point.x - this._layout.offsetX) / this._layout.scale,
            y: (point.y - this._layout.offsetY) / this._layout.scale,
        };
    }
}
exports.ViewportSystem = ViewportSystem;
