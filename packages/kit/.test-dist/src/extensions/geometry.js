"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveFeaturePosition = resolveFeaturePosition;
exports.generateDielinePath = generateDielinePath;
exports.generateMaskPath = generateMaskPath;
exports.generateBleedZonePath = generateBleedZonePath;
exports.getLowestPointOnDieline = getLowestPointOnDieline;
exports.getNearestPointOnDieline = getNearestPointOnDieline;
exports.getPathBounds = getPathBounds;
const paper_1 = __importDefault(require("paper"));
const bridgeSelection_1 = require("./bridgeSelection");
const wrappedOffsets_1 = require("./wrappedOffsets");
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
const isBridgeDebugEnabled = () => Boolean(globalThis.__POODER_BRIDGE_DEBUG__);
function normalizePathItem(shape) {
    let result = shape;
    if (typeof result.resolveCrossings === "function")
        result = result.resolveCrossings();
    if (typeof result.reduce === "function")
        result = result.reduce({});
    if (typeof result.reorient === "function")
        result = result.reorient(true, true);
    if (typeof result.reduce === "function")
        result = result.reduce({});
    return result;
}
function getBridgeDelta(itemBounds, overlap) {
    return Math.max(overlap, Math.min(5, Math.max(1, itemBounds.height * 0.02)));
}
function getExitHit(args) {
    const { mainShape, x, bridgeBottom, toY, eps, delta, overlap, op } = args;
    const ray = new paper_1.default.Path.Line({
        from: [x, bridgeBottom],
        to: [x, toY],
        insert: false,
    });
    const intersections = mainShape.getIntersections(ray) || [];
    ray.remove();
    const validHits = intersections.filter((i) => i.point.y < bridgeBottom - eps);
    if (validHits.length === 0)
        return null;
    validHits.sort((a, b) => b.point.y - a.point.y);
    const flags = validHits.map((h) => {
        const above = h.point.add(new paper_1.default.Point(0, -delta));
        const below = h.point.add(new paper_1.default.Point(0, delta));
        return {
            insideAbove: mainShape.contains(above),
            insideBelow: mainShape.contains(below),
        };
    });
    const idx = (0, bridgeSelection_1.pickExitIndex)(flags);
    if (idx < 0)
        return null;
    if (isBridgeDebugEnabled()) {
        console.debug("Geometry: Bridge ray", {
            x,
            validHits: validHits.length,
            idx,
            delta,
            overlap,
            op,
        });
    }
    const hit = validHits[idx];
    return { point: hit.point, location: hit };
}
function selectOuterChain(args) {
    const { mainShape, pointsA, pointsB, delta, overlap, op } = args;
    const scoreA = (0, bridgeSelection_1.scoreOutsideAbove)(pointsA.map((p) => ({
        outsideAbove: !mainShape.contains(p.add(new paper_1.default.Point(0, -delta))),
    })));
    const scoreB = (0, bridgeSelection_1.scoreOutsideAbove)(pointsB.map((p) => ({
        outsideAbove: !mainShape.contains(p.add(new paper_1.default.Point(0, -delta))),
    })));
    const ratioA = scoreA / pointsA.length;
    const ratioB = scoreB / pointsB.length;
    if (isBridgeDebugEnabled()) {
        console.debug("Geometry: Bridge chain", {
            scoreA,
            scoreB,
            lenA: pointsA.length,
            lenB: pointsB.length,
            ratioA,
            ratioB,
            delta,
            overlap,
            op,
        });
    }
    const ratioEps = 1e-6;
    if (Math.abs(ratioA - ratioB) > ratioEps) {
        return ratioA > ratioB ? pointsA : pointsB;
    }
    if (scoreA !== scoreB)
        return scoreA > scoreB ? pointsA : pointsB;
    return pointsA.length <= pointsB.length ? pointsA : pointsB;
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
        const hasMultipleSubPaths = ((pathData.match(/[Mm]/g) || []).length ?? 0) > 1;
        const path = hasMultipleSubPaths
            ? new paper_1.default.CompoundPath(pathData)
            : (() => {
                const single = new paper_1.default.Path();
                single.pathData = pathData;
                return single;
            })();
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
function resolveBridgeBasePath(shape, anchor) {
    if (shape instanceof paper_1.default.Path) {
        return shape;
    }
    if (shape instanceof paper_1.default.CompoundPath) {
        const children = (shape.children || []).filter((child) => child instanceof paper_1.default.Path);
        if (!children.length)
            return null;
        let best = children[0];
        let bestDistance = Infinity;
        for (const child of children) {
            const location = child.getNearestLocation(anchor);
            const point = location?.point;
            if (!point)
                continue;
            const distance = point.getDistance(anchor);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = child;
            }
        }
        return best;
    }
    return null;
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
        // Filter for Edge Features (Default is Edge, unless explicit 'surface')
        const edgeFeatures = features.filter((f) => !f.renderBehavior || f.renderBehavior === "edge");
        const adds = [];
        const subtracts = [];
        edgeFeatures.forEach((f) => {
            const pos = resolveFeaturePosition(f, options);
            const center = new paper_1.default.Point(pos.x, pos.y);
            const item = createFeatureItem(f, center);
            // Handle Bridge logic: Create a connection shape to the main body
            if (f.bridge && f.bridge.type === "vertical") {
                const itemBounds = item.bounds;
                const mainBounds = mainShape.bounds;
                const bridgeTop = mainBounds.top;
                const bridgeBottom = itemBounds.top;
                if (bridgeBottom > bridgeTop) {
                    const overlap = 2;
                    const rayPadding = 10;
                    const eps = 0.1;
                    const delta = getBridgeDelta(itemBounds, overlap);
                    const toY = bridgeTop - rayPadding;
                    const inset = Math.min(1, Math.max(0, itemBounds.width * 0.01));
                    const xLeft = itemBounds.left + inset;
                    const xRight = itemBounds.right - inset;
                    const bridgeBasePath = resolveBridgeBasePath(mainShape, center);
                    const canBridge = !!bridgeBasePath && xRight - xLeft > eps;
                    if (canBridge && bridgeBasePath) {
                        const leftHit = getExitHit({
                            mainShape: bridgeBasePath,
                            x: xLeft,
                            bridgeBottom,
                            toY,
                            eps,
                            delta,
                            overlap,
                            op: f.operation,
                        });
                        const rightHit = getExitHit({
                            mainShape: bridgeBasePath,
                            x: xRight,
                            bridgeBottom,
                            toY,
                            eps,
                            delta,
                            overlap,
                            op: f.operation,
                        });
                        if (leftHit && rightHit) {
                            const pathLength = bridgeBasePath.length;
                            const leftOffset = leftHit.location.offset;
                            const rightOffset = rightHit.location.offset;
                            const distanceA = (0, wrappedOffsets_1.wrappedDistance)(pathLength, leftOffset, rightOffset);
                            const distanceB = (0, wrappedOffsets_1.wrappedDistance)(pathLength, rightOffset, leftOffset);
                            const countFor = (d) => Math.max(8, Math.min(80, Math.ceil(d / 6)));
                            const offsetsA = (0, wrappedOffsets_1.sampleWrappedOffsets)(pathLength, leftOffset, rightOffset, countFor(distanceA));
                            const offsetsB = (0, wrappedOffsets_1.sampleWrappedOffsets)(pathLength, rightOffset, leftOffset, countFor(distanceB));
                            const pointsA = offsetsA
                                .map((o) => bridgeBasePath.getPointAt(o))
                                .filter((p) => Boolean(p));
                            const pointsB = offsetsB
                                .map((o) => bridgeBasePath.getPointAt(o))
                                .filter((p) => Boolean(p));
                            if (pointsA.length >= 2 && pointsB.length >= 2) {
                                let topBase = selectOuterChain({
                                    mainShape: bridgeBasePath,
                                    pointsA,
                                    pointsB,
                                    delta,
                                    overlap,
                                    op: f.operation,
                                });
                                const dist2 = (a, b) => {
                                    const dx = a.x - b.x;
                                    const dy = a.y - b.y;
                                    return dx * dx + dy * dy;
                                };
                                if (dist2(topBase[0], leftHit.point) >
                                    dist2(topBase[0], rightHit.point)) {
                                    topBase = topBase.slice().reverse();
                                }
                                topBase = topBase.slice();
                                topBase[0] = leftHit.point;
                                topBase[topBase.length - 1] = rightHit.point;
                                const capShiftY = f.operation === "subtract"
                                    ? -Math.max(overlap * 2, delta)
                                    : overlap;
                                const topPoints = topBase.map((p) => p.add(new paper_1.default.Point(0, capShiftY)));
                                const bridgeBottomY = bridgeBottom + overlap * 2;
                                const bridgePoly = new paper_1.default.Path({ insert: false });
                                for (const p of topPoints)
                                    bridgePoly.add(p);
                                bridgePoly.add(new paper_1.default.Point(xRight, bridgeBottomY));
                                bridgePoly.add(new paper_1.default.Point(xLeft, bridgeBottomY));
                                bridgePoly.closed = true;
                                const unitedItem = item.unite(bridgePoly);
                                item.remove();
                                bridgePoly.remove();
                                if (f.operation === "add") {
                                    adds.push(unitedItem);
                                }
                                else {
                                    subtracts.push(unitedItem);
                                }
                                return;
                            }
                        }
                    }
                    if (f.operation === "add") {
                        adds.push(item);
                    }
                    else {
                        subtracts.push(item);
                    }
                }
                else {
                    if (f.operation === "add") {
                        adds.push(item);
                    }
                    else {
                        subtracts.push(item);
                    }
                }
            }
            else {
                if (f.operation === "add") {
                    adds.push(item);
                }
                else {
                    subtracts.push(item);
                }
            }
        });
        // 2. Process Additions (Union)
        if (adds.length > 0) {
            for (const item of adds) {
                try {
                    const temp = mainShape.unite(item);
                    mainShape.remove();
                    item.remove();
                    mainShape = normalizePathItem(temp);
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
                    mainShape = normalizePathItem(temp);
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
    const surfaceFeatures = features.filter((f) => f.renderBehavior === "surface");
    if (surfaceFeatures.length === 0)
        return shape;
    let result = shape;
    // Internal features are usually subtractive (holes)
    // But we support 'add' too (islands? maybe just unite)
    for (const f of surfaceFeatures) {
        const pos = resolveFeaturePosition(f, options);
        const center = new paper_1.default.Point(pos.x, pos.y);
        const item = createFeatureItem(f, center);
        try {
            if (f.operation === "add") {
                const temp = result.unite(item);
                result.remove();
                item.remove();
                result = normalizePathItem(temp);
            }
            else {
                const temp = result.subtract(item);
                result.remove();
                item.remove();
                result = normalizePathItem(temp);
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
 * Finds the lowest point (Max Y) on the Dieline geometry (Base Shape ONLY).
 */
function getLowestPointOnDieline(options) {
    ensurePaper(options.width * 2, options.height * 2);
    paper_1.default.project.activeLayer.removeChildren();
    const shape = createBaseShape(options);
    const bounds = shape.bounds;
    const result = {
        x: bounds.center.x,
        y: bounds.bottom,
    };
    shape.remove();
    return result;
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
    const location = shape.getNearestLocation(p);
    const result = {
        x: location.point.x,
        y: location.point.y,
        normal: location.normal ? { x: location.normal.x, y: location.normal.y } : undefined
    };
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
