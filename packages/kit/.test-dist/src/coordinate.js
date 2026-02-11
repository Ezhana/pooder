"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Coordinate = void 0;
class Coordinate {
    /**
     * Calculate layout to fit content within container while preserving aspect ratio.
     */
    static calculateLayout(container, content, padding = 0) {
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
    /**
     * Convert an absolute value to a normalized value (0-1).
     * @param value Absolute value (e.g., pixels)
     * @param total Total dimension size (e.g., canvas width)
     */
    static toNormalized(value, total) {
        return total === 0 ? 0 : value / total;
    }
    /**
     * Convert a normalized value (0-1) to an absolute value.
     * @param normalized Normalized value (0-1)
     * @param total Total dimension size (e.g., canvas width)
     */
    static toAbsolute(normalized, total) {
        return normalized * total;
    }
    /**
     * Normalize a point's coordinates.
     */
    static normalizePoint(point, size) {
        return {
            x: this.toNormalized(point.x, size.width),
            y: this.toNormalized(point.y, size.height),
        };
    }
    /**
     * Denormalize a point's coordinates to absolute pixels.
     */
    static denormalizePoint(point, size) {
        return {
            x: this.toAbsolute(point.x, size.width),
            y: this.toAbsolute(point.y, size.height),
        };
    }
    static convertUnit(value, from, to) {
        if (from === to)
            return value;
        // Base unit: mm
        const toMM = {
            px: 0.264583, // 1px = 0.264583mm (96 DPI)
            mm: 1,
            cm: 10,
            in: 25.4
        };
        const mmValue = value * (from === 'px' ? toMM.px : toMM[from] || 1);
        if (to === 'px') {
            return mmValue / toMM.px;
        }
        return mmValue / (toMM[to] || 1);
    }
}
exports.Coordinate = Coordinate;
