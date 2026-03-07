"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeMmValue = sanitizeMmValue;
exports.normalizeUnit = normalizeUnit;
exports.normalizeConstraintMode = normalizeConstraintMode;
exports.normalizeCutMode = normalizeCutMode;
exports.toMm = toMm;
exports.fromMm = fromMm;
exports.resolvePaddingPx = resolvePaddingPx;
exports.readSizeState = readSizeState;
exports.computeSceneLayout = computeSceneLayout;
exports.buildSceneGeometry = buildSceneGeometry;
const coordinate_1 = require("../coordinate");
const units_1 = require("../units");
const dielineShape_1 = require("./dielineShape");
const DEFAULT_SIZE_STATE = {
    unit: "mm",
    actualWidthMm: 500,
    actualHeightMm: 500,
    constraintMode: "free",
    aspectRatio: 1,
    cutMode: "trim",
    cutMarginMm: 0,
    viewPadding: 140,
    minMm: 10,
    maxMm: 2000,
    stepMm: 0.1,
};
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function roundToStep(value, step) {
    if (!Number.isFinite(step) || step <= 0)
        return value;
    return Math.round(value / step) * step;
}
function sanitizeMmValue(valueMm, limits) {
    if (!Number.isFinite(valueMm))
        return limits.minMm;
    const rounded = roundToStep(valueMm, limits.stepMm);
    return clamp(rounded, limits.minMm, limits.maxMm);
}
function normalizeUnit(value) {
    if (value === "cm" || value === "in")
        return value;
    return "mm";
}
function normalizeConstraintMode(value) {
    if (value === "lockAspect" || value === "equal")
        return value;
    return "free";
}
function normalizeCutMode(value) {
    if (value === "outset" || value === "inset")
        return value;
    return "trim";
}
function toMm(value, fromUnit) {
    return coordinate_1.Coordinate.convertUnit(value, fromUnit, "mm");
}
function fromMm(valueMm, toUnit) {
    return coordinate_1.Coordinate.convertUnit(valueMm, "mm", toUnit);
}
function resolvePaddingPx(raw, containerWidth, containerHeight) {
    if (typeof raw === "number")
        return Math.max(0, raw);
    if (typeof raw === "string") {
        if (raw.endsWith("%")) {
            const percent = parseFloat(raw) / 100;
            if (!Number.isFinite(percent))
                return 0;
            return Math.max(0, Math.min(containerWidth, containerHeight) * percent);
        }
        const fixed = parseFloat(raw);
        return Number.isFinite(fixed) ? Math.max(0, fixed) : 0;
    }
    return 0;
}
function readSizeState(configService) {
    const unit = normalizeUnit(configService.get("size.unit", DEFAULT_SIZE_STATE.unit));
    const minMm = Math.max(0.1, Number(configService.get("size.minMm", DEFAULT_SIZE_STATE.minMm)));
    const maxMm = Math.max(minMm, Number(configService.get("size.maxMm", DEFAULT_SIZE_STATE.maxMm)));
    const stepMm = Math.max(0.001, Number(configService.get("size.stepMm", DEFAULT_SIZE_STATE.stepMm)));
    const actualWidthMm = sanitizeMmValue((0, units_1.parseLengthToMm)(configService.get("size.actualWidthMm", DEFAULT_SIZE_STATE.actualWidthMm), "mm"), { minMm, maxMm, stepMm });
    const actualHeightMm = sanitizeMmValue((0, units_1.parseLengthToMm)(configService.get("size.actualHeightMm", DEFAULT_SIZE_STATE.actualHeightMm), "mm"), { minMm, maxMm, stepMm });
    const aspectRaw = Number(configService.get("size.aspectRatio", DEFAULT_SIZE_STATE.aspectRatio));
    const aspectRatio = Number.isFinite(aspectRaw) && aspectRaw > 0
        ? aspectRaw
        : actualWidthMm / Math.max(0.001, actualHeightMm);
    const cutMarginMm = Math.max(0, (0, units_1.parseLengthToMm)(configService.get("size.cutMarginMm", DEFAULT_SIZE_STATE.cutMarginMm), "mm"));
    const viewPadding = configService.get("size.viewPadding", DEFAULT_SIZE_STATE.viewPadding);
    return {
        unit,
        actualWidthMm,
        actualHeightMm,
        constraintMode: normalizeConstraintMode(configService.get("size.constraintMode", DEFAULT_SIZE_STATE.constraintMode)),
        aspectRatio,
        cutMode: normalizeCutMode(configService.get("size.cutMode", DEFAULT_SIZE_STATE.cutMode)),
        cutMarginMm,
        viewPadding,
        minMm,
        maxMm,
        stepMm,
    };
}
function rectByCenter(centerX, centerY, width, height) {
    return {
        left: centerX - width / 2,
        top: centerY - height / 2,
        width,
        height,
        centerX,
        centerY,
    };
}
function getCutSizeMm(size) {
    if (size.cutMode === "trim") {
        return { widthMm: size.actualWidthMm, heightMm: size.actualHeightMm };
    }
    const delta = size.cutMarginMm * 2;
    if (size.cutMode === "outset") {
        return {
            widthMm: size.actualWidthMm + delta,
            heightMm: size.actualHeightMm + delta,
        };
    }
    return {
        widthMm: Math.max(size.minMm, size.actualWidthMm - delta),
        heightMm: Math.max(size.minMm, size.actualHeightMm - delta),
    };
}
function computeSceneLayout(canvasService, size) {
    const canvasWidth = canvasService.canvas.width || 0;
    const canvasHeight = canvasService.canvas.height || 0;
    if (canvasWidth <= 0 || canvasHeight <= 0)
        return null;
    const { widthMm: cutWidthMm, heightMm: cutHeightMm } = getCutSizeMm(size);
    const viewWidthMm = Math.max(size.actualWidthMm, cutWidthMm);
    const viewHeightMm = Math.max(size.actualHeightMm, cutHeightMm);
    if (!Number.isFinite(viewWidthMm) ||
        !Number.isFinite(viewHeightMm) ||
        viewWidthMm <= 0 ||
        viewHeightMm <= 0) {
        return null;
    }
    const paddingPx = resolvePaddingPx(size.viewPadding, canvasWidth, canvasHeight);
    canvasService.viewport.updateContainer(canvasWidth, canvasHeight);
    canvasService.viewport.setPadding(paddingPx);
    canvasService.viewport.updatePhysical(viewWidthMm, viewHeightMm);
    const layout = canvasService.viewport.layout;
    if (!Number.isFinite(layout.scale) ||
        !Number.isFinite(layout.offsetX) ||
        !Number.isFinite(layout.offsetY) ||
        layout.scale <= 0) {
        return null;
    }
    const centerX = layout.offsetX + layout.width / 2;
    const centerY = layout.offsetY + layout.height / 2;
    const trimWidthPx = size.actualWidthMm * layout.scale;
    const trimHeightPx = size.actualHeightMm * layout.scale;
    const cutWidthPx = cutWidthMm * layout.scale;
    const cutHeightPx = cutHeightMm * layout.scale;
    const trimRect = rectByCenter(centerX, centerY, trimWidthPx, trimHeightPx);
    const cutRect = rectByCenter(centerX, centerY, cutWidthPx, cutHeightPx);
    const bleedRect = rectByCenter(centerX, centerY, Math.max(trimWidthPx, cutWidthPx), Math.max(trimHeightPx, cutHeightPx));
    return {
        scale: layout.scale,
        canvasWidth,
        canvasHeight,
        trimRect,
        cutRect,
        bleedRect,
        trimWidthMm: size.actualWidthMm,
        trimHeightMm: size.actualHeightMm,
        cutWidthMm,
        cutHeightMm,
        cutMode: size.cutMode,
        cutMarginMm: size.cutMarginMm,
    };
}
function buildSceneGeometry(configService, layout) {
    const radiusMm = (0, units_1.parseLengthToMm)(configService.get("dieline.radius", 0), "mm");
    const offset = (layout.cutRect.width - layout.trimRect.width) / 2;
    const sourceWidth = Number(configService.get("dieline.customSourceWidthPx", 0));
    const sourceHeight = Number(configService.get("dieline.customSourceHeightPx", 0));
    const shapeStyle = (0, dielineShape_1.normalizeShapeStyle)(configService.get("dieline.shapeStyle", dielineShape_1.DEFAULT_DIELINE_SHAPE_STYLE));
    return {
        shape: (0, dielineShape_1.normalizeDielineShape)(configService.get("dieline.shape", dielineShape_1.DEFAULT_DIELINE_SHAPE)),
        shapeStyle,
        unit: "px",
        x: layout.trimRect.centerX,
        y: layout.trimRect.centerY,
        width: layout.trimRect.width,
        height: layout.trimRect.height,
        radius: radiusMm * layout.scale,
        offset,
        scale: layout.scale,
        pathData: configService.get("dieline.pathData"),
        customSourceWidthPx: Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : undefined,
        customSourceHeightPx: Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : undefined,
    };
}
