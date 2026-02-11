"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeDetectEdgeSize = computeDetectEdgeSize;
function computeDetectEdgeSize(currentMax, baseBounds, expandedBounds) {
    const baseMax = Math.max(baseBounds.width, baseBounds.height);
    const scale = baseMax > 0 ? currentMax / baseMax : 1;
    return {
        scale,
        width: expandedBounds.width * scale,
        height: expandedBounds.height * scale,
    };
}
