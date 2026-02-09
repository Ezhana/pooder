"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveFeaturePosition = resolveFeaturePosition;
exports.generateDielinePath = generateDielinePath;
exports.generateMaskPath = generateMaskPath;
exports.generateBleedZonePath = generateBleedZonePath;
exports.getNearestPointOnDieline = getNearestPointOnDieline;
exports.getPathBounds = getPathBounds;
const paper_1 = __importDefault(require("paper"));
/**
 * Resolves the absolute position of a feature based on normalized coordinates.
 */
function resolveFeaturePosition(feature, geometry) {
    const { x, y, width, height } = geometry;
    // geometry.x/y is the Center.
    const left = x - width / 2;
    const top = y - height / 2;
    return {
        x: left + feature.x * width,
        y: top + feature.y * height,
    };
}
/**
 * Initializes paper.js project if not already initialized.
 */
function ensurePaper(width, height) {
    if (!paper_1.default.project) {
        paper_1.default.setup(new paper_1.default.Size(width, height));
    }
    else {
        paper_1.default.view.viewSize = new paper_1.default.Size(width, height);
    }
}
/**
 * Creates the base dieline shape (Rect/Circle/Ellipse/Custom)
 */
function createBaseShape(options) {
    const { shape, width, height, radius, x, y, pathData } = options;
    const center = new paper_1.default.Point(x, y);
    if (shape === "rect") {
        return new paper_1.default.Path.Rectangle({
            point: [x - width / 2, y - height / 2],
            size: [Math.max(0, width), Math.max(0, height)],
            radius: Math.max(0, radius),
        });
    }
    else if (shape === "circle") {
        const r = Math.min(width, height) / 2;
        return new paper_1.default.Path.Circle({
            center: center,
            radius: Math.max(0, r),
        });
    }
    else if (shape === "ellipse") {
        return new paper_1.default.Path.Ellipse({
            center: center,
            radius: [Math.max(0, width / 2), Math.max(0, height / 2)],
        });
    }
    else if (shape === "custom" && pathData) {
        const path = new paper_1.default.Path();
        path.pathData = pathData;
        // Align center
        path.position = center;
        if (width > 0 &&
            height > 0 &&
            path.bounds.width > 0 &&
            path.bounds.height > 0) {
            path.scale(width / path.bounds.width, height / path.bounds.height);
        }
        return path;
    }
    else {
        return new paper_1.default.Path.Rectangle({
            point: [x - width / 2, y - height / 2],
            size: [Math.max(0, width), Math.max(0, height)],
        });
    }
}
/**
 * Creates a Paper.js Item for a single feature.
 */
function createFeatureItem(feature, center) {
    let item;
    if (feature.shape === "rect") {
        const w = feature.width || 10;
        const h = feature.height || 10;
        const r = feature.radius || 0;
        item = new paper_1.default.Path.Rectangle({
            point: [center.x - w / 2, center.y - h / 2],
            size: [w, h],
            radius: r,
        });
    }
    else {
        // Circle
        const r = feature.radius || 5;
        item = new paper_1.default.Path.Circle({
            center: center,
            radius: r,
        });
    }
    if (feature.rotation) {
        item.rotate(feature.rotation, center);
    }
    return item;
}
/**
 * Internal helper to generate the Perimeter Shape (Base + Edge Features).
 */
function getPerimeterShape(options) {
    // 1. Create Base Shape
    let mainShape = createBaseShape(options);
    const { features } = options;
    if (features && features.length > 0) {
        // Filter for Edge Features (Default or explicit 'edge')
        const edgeFeatures = features.filter((f) => !f.placement || f.placement === "edge");
        const adds = [];
        const subtracts = [];
        edgeFeatures.forEach((f) => {
            const pos = resolveFeaturePosition(f, options);
            const center = new paper_1.default.Point(pos.x, pos.y);
            const item = createFeatureItem(f, center);
            if (f.operation === "add") {
                adds.push(item);
            }
            else {
                subtracts.push(item);
            }
        });
        // 2. Process Additions (Union)
        if (adds.length > 0) {
            for (const item of adds) {
                try {
                    const temp = mainShape.unite(item);
                    mainShape.remove();
                    item.remove();
                    mainShape = temp;
                }
                catch (e) {
                    console.error("Geometry: Failed to unite feature", e);
                    item.remove();
                }
            }
        }
        // 3. Process Subtractions (Difference)
        if (subtracts.length > 0) {
            for (const item of subtracts) {
                try {
                    const temp = mainShape.subtract(item);
                    mainShape.remove();
                    item.remove();
                    mainShape = temp;
                }
                catch (e) {
                    console.error("Geometry: Failed to subtract feature", e);
                    item.remove();
                }
            }
        }
    }
    return mainShape;
}
/**
 * Applies Internal/Surface features to a shape.
 */
function applySurfaceFeatures(shape, features, options) {
    const internalFeatures = features.filter((f) => f.placement === "internal");
    if (internalFeatures.length === 0)
        return shape;
    let result = shape;
    // Internal features are usually subtractive (holes)
    // But we support 'add' too (islands? maybe just unite)
    for (const f of internalFeatures) {
        const pos = resolveFeaturePosition(f, options);
        const center = new paper_1.default.Point(pos.x, pos.y);
        const item = createFeatureItem(f, center);
        try {
            if (f.operation === "add") {
                const temp = result.unite(item);
                result.remove();
                item.remove();
                result = temp;
            }
            else {
                const temp = result.subtract(item);
                result.remove();
                item.remove();
                result = temp;
            }
        }
        catch (e) {
            console.error("Geometry: Failed to apply surface feature", e);
            item.remove();
        }
    }
    return result;
}
/**
 * Generates the path data for the Dieline (Product Shape).
 */
function generateDielinePath(options) {
    const paperWidth = options.canvasWidth || options.width * 2 || 2000;
    const paperHeight = options.canvasHeight || options.height * 2 || 2000;
    ensurePaper(paperWidth, paperHeight);
    paper_1.default.project.activeLayer.removeChildren();
    const perimeter = getPerimeterShape(options);
    const finalShape = applySurfaceFeatures(perimeter, options.features, options);
    const pathData = finalShape.pathData;
    finalShape.remove();
    return pathData;
}
/**
 * Generates the path data for the Mask (Background Overlay).
 * Logic: Canvas SUBTRACT ProductShape
 */
function generateMaskPath(options) {
    ensurePaper(options.canvasWidth, options.canvasHeight);
    paper_1.default.project.activeLayer.removeChildren();
    const { canvasWidth, canvasHeight } = options;
    const maskRect = new paper_1.default.Path.Rectangle({
        point: [0, 0],
        size: [canvasWidth, canvasHeight],
    });
    const perimeter = getPerimeterShape(options);
    const mainShape = applySurfaceFeatures(perimeter, options.features, options);
    const finalMask = maskRect.subtract(mainShape);
    maskRect.remove();
    mainShape.remove();
    const pathData = finalMask.pathData;
    finalMask.remove();
    return pathData;
}
/**
 * Generates the path data for the Bleed Zone.
 */
function generateBleedZonePath(originalOptions, offsetOptions, offset) {
    const paperWidth = originalOptions.canvasWidth || originalOptions.width * 2 || 2000;
    const paperHeight = originalOptions.canvasHeight || originalOptions.height * 2 || 2000;
    ensurePaper(paperWidth, paperHeight);
    paper_1.default.project.activeLayer.removeChildren();
    // 1. Generate Original Shape
    const pOriginal = getPerimeterShape(originalOptions);
    const shapeOriginal = applySurfaceFeatures(pOriginal, originalOptions.features, originalOptions);
    // 2. Generate Offset Shape
    const pOffset = getPerimeterShape(offsetOptions);
    const shapeOffset = applySurfaceFeatures(pOffset, offsetOptions.features, offsetOptions);
    // 3. Calculate Difference
    let bleedZone;
    if (offset > 0) {
        bleedZone = shapeOffset.subtract(shapeOriginal);
    }
    else {
        bleedZone = shapeOriginal.subtract(shapeOffset);
    }
    const pathData = bleedZone.pathData;
    shapeOriginal.remove();
    shapeOffset.remove();
    bleedZone.remove();
    return pathData;
}
/**
 * Finds the nearest point on the Dieline geometry (Base Shape ONLY) for a given target point.
 * Used for constraining feature movement.
 */
function getNearestPointOnDieline(point, options) {
    ensurePaper(options.width * 2, options.height * 2);
    paper_1.default.project.activeLayer.removeChildren();
    // We constrain to the BASE shape, not including other features,
    // because usually you want to snap to the main edge.
    const shape = createBaseShape(options);
    const p = new paper_1.default.Point(point.x, point.y);
    const nearest = shape.getNearestPoint(p);
    const result = { x: nearest.x, y: nearest.y };
    shape.remove();
    return result;
}
function getPathBounds(pathData) {
    const path = new paper_1.default.Path();
    path.pathData = pathData;
    const bounds = path.bounds;
    path.remove();
    return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
    };
}
