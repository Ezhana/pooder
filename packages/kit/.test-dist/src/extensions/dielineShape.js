"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DIELINE_SHAPE_STYLE = exports.DEFAULT_DIELINE_SHAPE = exports.DIELINE_SHAPES = exports.BUILTIN_DIELINE_SHAPES = void 0;
exports.isDielineShape = isDielineShape;
exports.normalizeDielineShape = normalizeDielineShape;
exports.normalizeShapeStyle = normalizeShapeStyle;
exports.getShapeFitMode = getShapeFitMode;
exports.getHeartShapeParams = getHeartShapeParams;
exports.BUILTIN_DIELINE_SHAPES = [
    "rect",
    "circle",
    "ellipse",
    "heart",
];
exports.DIELINE_SHAPES = [...exports.BUILTIN_DIELINE_SHAPES, "custom"];
exports.DEFAULT_DIELINE_SHAPE = "rect";
const DEFAULT_HEART_SHAPE_PARAMS = {
    lobeSpread: 0.46,
    notchDepth: 0.24,
    tipSharpness: 0,
};
exports.DEFAULT_DIELINE_SHAPE_STYLE = {
    fitMode: "contain",
    ...DEFAULT_HEART_SHAPE_PARAMS,
};
function isDielineShape(value) {
    return (typeof value === "string" &&
        exports.DIELINE_SHAPES.includes(value));
}
function normalizeFitMode(value, fallback) {
    if (value === "contain" || value === "stretch")
        return value;
    return fallback;
}
function normalizeUnitInterval(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num))
        return fallback;
    return Math.max(0, Math.min(1, num));
}
function normalizeDielineShape(value, fallback = exports.DEFAULT_DIELINE_SHAPE) {
    return isDielineShape(value) ? value : fallback;
}
function normalizeShapeStyle(value, fallback = exports.DEFAULT_DIELINE_SHAPE_STYLE) {
    const raw = value && typeof value === "object"
        ? value
        : {};
    return {
        ...fallback,
        fitMode: normalizeFitMode(raw.fitMode, fallback.fitMode),
        lobeSpread: normalizeUnitInterval(raw.lobeSpread, Number(fallback.lobeSpread ?? DEFAULT_HEART_SHAPE_PARAMS.lobeSpread)),
        notchDepth: normalizeUnitInterval(raw.notchDepth, Number(fallback.notchDepth ?? DEFAULT_HEART_SHAPE_PARAMS.notchDepth)),
        tipSharpness: normalizeUnitInterval(raw.tipSharpness, Number(fallback.tipSharpness ?? DEFAULT_HEART_SHAPE_PARAMS.tipSharpness)),
    };
}
function getShapeFitMode(style) {
    return normalizeShapeStyle(style).fitMode;
}
function getHeartShapeParams(style) {
    const normalized = normalizeShapeStyle(style);
    return {
        lobeSpread: Number(normalized.lobeSpread),
        notchDepth: Number(normalized.notchDepth),
        tipSharpness: Number(normalized.tipSharpness),
    };
}
