"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseLengthToMm = parseLengthToMm;
exports.formatMm = formatMm;
const coordinate_1 = require("./coordinate");
function parseLengthToMm(input, defaultUnit) {
    if (typeof input === "number") {
        if (!Number.isFinite(input))
            return 0;
        return coordinate_1.Coordinate.convertUnit(input, defaultUnit, "mm");
    }
    const raw = input.trim();
    if (!raw)
        return 0;
    const match = raw.match(/^([+-]?\d+(?:\.\d+)?)\s*(px|mm|cm|in)?$/i);
    if (!match)
        return 0;
    const value = Number(match[1]);
    if (!Number.isFinite(value))
        return 0;
    const unit = match[2]?.toLowerCase() ?? defaultUnit;
    return coordinate_1.Coordinate.convertUnit(value, unit, "mm");
}
function formatMm(valueMm, displayUnit, fractionDigits = 2) {
    if (!Number.isFinite(valueMm))
        return "0";
    const value = coordinate_1.Coordinate.convertUnit(valueMm, "mm", displayUnit);
    const rounded = Number(value.toFixed(fractionDigits));
    return rounded.toString();
}
