"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DielineTool = void 0;
const core_1 = require("@pooder/core");
const fabric_1 = require("fabric");
const tracer_1 = require("./tracer");
const units_1 = require("../units");
const geometry_1 = require("./geometry");
const sceneLayoutModel_1 = require("./sceneLayoutModel");
const IMAGE_OBJECT_LAYER_ID = "image.user";
class DielineTool {
    constructor(options) {
        this.id = "pooder.kit.dieline";
        this.metadata = {
            name: "DielineTool",
        };
        this.state = {
            displayUnit: "mm",
            shape: "rect",
            width: 500,
            height: 500,
            radius: 0,
            offset: 0,
            padding: 140,
            mainLine: {
                width: 2.7,
                color: "#FF0000",
                dashLength: 5,
                style: "solid",
            },
            offsetLine: {
                width: 2.7,
                color: "#FF0000",
                dashLength: 5,
                style: "solid",
            },
            insideColor: "rgba(0,0,0,0)",
            outsideColor: "#ffffff",
            showBleedLines: true,
            features: [],
        };
        this.onCanvasResized = () => {
            this.updateDieline();
        };
        if (options) {
            // Deep merge for styles to avoid overwriting defaults with partial objects
            if (options.mainLine) {
                Object.assign(this.state.mainLine, options.mainLine);
                delete options.mainLine;
            }
            if (options.offsetLine) {
                Object.assign(this.state.offsetLine, options.offsetLine);
                delete options.offsetLine;
            }
            Object.assign(this.state, options);
        }
    }
    activate(context) {
        this.context = context;
        this.canvasService = context.services.get("CanvasService");
        if (!this.canvasService) {
            console.warn("CanvasService not found for DielineTool");
            return;
        }
        const configService = context.services.get("ConfigurationService");
        if (configService) {
            // Load initial config
            const s = this.state;
            const sizeState = (0, sceneLayoutModel_1.readSizeState)(configService);
            s.displayUnit = sizeState.unit;
            s.shape = configService.get("dieline.shape", s.shape);
            s.width = sizeState.actualWidthMm;
            s.height = sizeState.actualHeightMm;
            s.radius = (0, units_1.parseLengthToMm)(configService.get("dieline.radius", s.radius), "mm");
            s.padding = sizeState.viewPadding;
            s.offset =
                sizeState.cutMode === "outset"
                    ? sizeState.cutMarginMm
                    : sizeState.cutMode === "inset"
                        ? -sizeState.cutMarginMm
                        : 0;
            // Main Line
            s.mainLine.width = configService.get("dieline.strokeWidth", s.mainLine.width);
            s.mainLine.color = configService.get("dieline.strokeColor", s.mainLine.color);
            s.mainLine.dashLength = configService.get("dieline.dashLength", s.mainLine.dashLength);
            s.mainLine.style = configService.get("dieline.style", s.mainLine.style);
            // Offset Line
            s.offsetLine.width = configService.get("dieline.offsetStrokeWidth", s.offsetLine.width);
            s.offsetLine.color = configService.get("dieline.offsetStrokeColor", s.offsetLine.color);
            s.offsetLine.dashLength = configService.get("dieline.offsetDashLength", s.offsetLine.dashLength);
            s.offsetLine.style = configService.get("dieline.offsetStyle", s.offsetLine.style);
            s.insideColor = configService.get("dieline.insideColor", s.insideColor);
            s.outsideColor = configService.get("dieline.outsideColor", s.outsideColor);
            s.showBleedLines = configService.get("dieline.showBleedLines", s.showBleedLines);
            s.features = configService.get("dieline.features", s.features);
            s.pathData = configService.get("dieline.pathData", s.pathData);
            // Listen for changes
            configService.onAnyChange((e) => {
                if (e.key.startsWith("size.")) {
                    const nextSize = (0, sceneLayoutModel_1.readSizeState)(configService);
                    s.displayUnit = nextSize.unit;
                    s.width = nextSize.actualWidthMm;
                    s.height = nextSize.actualHeightMm;
                    s.padding = nextSize.viewPadding;
                    s.offset =
                        nextSize.cutMode === "outset"
                            ? nextSize.cutMarginMm
                            : nextSize.cutMode === "inset"
                                ? -nextSize.cutMarginMm
                                : 0;
                    this.updateDieline();
                    return;
                }
                if (e.key.startsWith("dieline.")) {
                    switch (e.key) {
                        case "dieline.shape":
                            s.shape = e.value;
                            break;
                        case "dieline.radius":
                            s.radius = (0, units_1.parseLengthToMm)(e.value, "mm");
                            break;
                        case "dieline.strokeWidth":
                            s.mainLine.width = e.value;
                            break;
                        case "dieline.strokeColor":
                            s.mainLine.color = e.value;
                            break;
                        case "dieline.dashLength":
                            s.mainLine.dashLength = e.value;
                            break;
                        case "dieline.style":
                            s.mainLine.style = e.value;
                            break;
                        case "dieline.offsetStrokeWidth":
                            s.offsetLine.width = e.value;
                            break;
                        case "dieline.offsetStrokeColor":
                            s.offsetLine.color = e.value;
                            break;
                        case "dieline.offsetDashLength":
                            s.offsetLine.dashLength = e.value;
                            break;
                        case "dieline.offsetStyle":
                            s.offsetLine.style = e.value;
                            break;
                        case "dieline.insideColor":
                            s.insideColor = e.value;
                            break;
                        case "dieline.outsideColor":
                            s.outsideColor = e.value;
                            break;
                        case "dieline.showBleedLines":
                            s.showBleedLines = e.value;
                            break;
                        case "dieline.features":
                            s.features = e.value;
                            break;
                        case "dieline.pathData":
                            s.pathData = e.value;
                            break;
                    }
                    this.updateDieline();
                }
            });
        }
        context.eventBus.on("canvas:resized", this.onCanvasResized);
        this.createLayer();
        this.updateDieline();
    }
    deactivate(context) {
        context.eventBus.off("canvas:resized", this.onCanvasResized);
        this.destroyLayer();
        this.canvasService = undefined;
        this.context = undefined;
    }
    contribute() {
        const s = this.state;
        return {
            [core_1.ContributionPointIds.TOOLS]: [
                {
                    id: this.id,
                    name: "Dieline",
                    interaction: "session",
                    session: {
                        autoBegin: false,
                        leavePolicy: "block",
                    },
                },
            ],
            [core_1.ContributionPointIds.CONFIGURATIONS]: [
                {
                    id: "dieline.shape",
                    type: "select",
                    label: "Shape",
                    options: ["rect", "circle", "ellipse", "custom"],
                    default: s.shape,
                },
                {
                    id: "dieline.radius",
                    type: "number",
                    label: "Corner Radius (mm)",
                    min: 0,
                    max: 500,
                    default: s.radius,
                },
                {
                    id: "dieline.showBleedLines",
                    type: "boolean",
                    label: "Show Bleed Lines",
                    default: s.showBleedLines,
                },
                {
                    id: "dieline.strokeWidth",
                    type: "number",
                    label: "Line Width",
                    min: 0.1,
                    max: 10,
                    step: 0.1,
                    default: s.mainLine.width,
                },
                {
                    id: "dieline.strokeColor",
                    type: "color",
                    label: "Line Color",
                    default: s.mainLine.color,
                },
                {
                    id: "dieline.dashLength",
                    type: "number",
                    label: "Dash Length",
                    min: 1,
                    max: 50,
                    default: s.mainLine.dashLength,
                },
                {
                    id: "dieline.style",
                    type: "select",
                    label: "Line Style",
                    options: ["solid", "dashed", "hidden"],
                    default: s.mainLine.style,
                },
                {
                    id: "dieline.offsetStrokeWidth",
                    type: "number",
                    label: "Offset Line Width",
                    min: 0.1,
                    max: 10,
                    step: 0.1,
                    default: s.offsetLine.width,
                },
                {
                    id: "dieline.offsetStrokeColor",
                    type: "color",
                    label: "Offset Line Color",
                    default: s.offsetLine.color,
                },
                {
                    id: "dieline.offsetDashLength",
                    type: "number",
                    label: "Offset Dash Length",
                    min: 1,
                    max: 50,
                    default: s.offsetLine.dashLength,
                },
                {
                    id: "dieline.offsetStyle",
                    type: "select",
                    label: "Offset Line Style",
                    options: ["solid", "dashed", "hidden"],
                    default: s.offsetLine.style,
                },
                {
                    id: "dieline.insideColor",
                    type: "color",
                    label: "Inside Color",
                    default: s.insideColor,
                },
                {
                    id: "dieline.outsideColor",
                    type: "color",
                    label: "Outside Color",
                    default: s.outsideColor,
                },
                {
                    id: "dieline.features",
                    type: "json",
                    label: "Edge Features",
                    default: s.features,
                },
            ],
            [core_1.ContributionPointIds.COMMANDS]: [
                {
                    command: "updateFeaturePosition",
                    title: "Update Feature Position",
                    handler: (groupId, x, y) => {
                        const configService = this.context?.services.get("ConfigurationService");
                        if (!configService)
                            return;
                        const features = configService.get("dieline.features") || [];
                        let changed = false;
                        const newFeatures = features.map((f) => {
                            if (f.groupId === groupId) {
                                if (f.x !== x || f.y !== y) {
                                    changed = true;
                                    return { ...f, x, y };
                                }
                            }
                            return f;
                        });
                        if (changed) {
                            configService.update("dieline.features", newFeatures);
                        }
                    },
                },
                {
                    command: "exportCutImage",
                    title: "Export Cut Image",
                    handler: (options) => {
                        return this.exportCutImage(options);
                    },
                },
                {
                    command: "detectEdge",
                    title: "Detect Edge from Image",
                    handler: async (imageUrl, options) => {
                        try {
                            const detectOptions = options || {};
                            const debug = detectOptions.debug === true;
                            // Helper to get image dimensions
                            const loadImage = (url) => {
                                return new Promise((resolve, reject) => {
                                    const img = new Image();
                                    img.crossOrigin = "Anonymous";
                                    img.onload = () => resolve(img);
                                    img.onerror = (e) => reject(e);
                                    img.src = url;
                                });
                            };
                            const [img, traced] = await Promise.all([
                                loadImage(imageUrl),
                                tracer_1.ImageTracer.traceWithBounds(imageUrl, detectOptions),
                            ]);
                            const { pathData, baseBounds, bounds } = traced;
                            if (debug) {
                                console.info("[DielineTool] detectEdge", {
                                    imageWidth: img.width,
                                    imageHeight: img.height,
                                    baseBounds,
                                    expandedBounds: bounds,
                                    currentDielineWidth: s.width,
                                    currentDielineHeight: s.height,
                                    options: {
                                        expand: detectOptions.expand ?? 0,
                                        morphologyRadius: detectOptions.morphologyRadius,
                                        connectRadiusMax: detectOptions.connectRadiusMax,
                                        smoothing: detectOptions.smoothing,
                                        simplifyTolerance: detectOptions.simplifyTolerance,
                                        threshold: detectOptions.threshold,
                                        maskMode: detectOptions.maskMode,
                                        whiteThreshold: detectOptions.whiteThreshold,
                                        alphaOpaqueCutoff: detectOptions.alphaOpaqueCutoff,
                                        noChannels: detectOptions.noChannels,
                                        componentMode: detectOptions.componentMode,
                                        minComponentArea: detectOptions.minComponentArea,
                                        forceConnected: detectOptions.forceConnected,
                                    },
                                });
                            }
                            return {
                                pathData,
                                rawBounds: bounds,
                                baseBounds,
                                imageWidth: img.width,
                                imageHeight: img.height,
                            };
                        }
                        catch (e) {
                            console.error("Edge detection failed", e);
                            throw e;
                        }
                    },
                },
            ],
        };
    }
    getLayer() {
        return this.canvasService?.getLayer("dieline-overlay");
    }
    createLayer() {
        if (!this.canvasService)
            return;
        const width = this.canvasService.canvas.width || 800;
        const height = this.canvasService.canvas.height || 600;
        const layer = this.canvasService.createLayer("dieline-overlay", {
            width,
            height,
            selectable: false,
            evented: false,
        });
        this.canvasService.canvas.bringObjectToFront(layer);
        // Ensure above user layer
        const userLayer = this.canvasService.getLayer("user");
        if (userLayer) {
            const userIndex = this.canvasService.canvas
                .getObjects()
                .indexOf(userLayer);
            this.canvasService.canvas.moveObjectTo(layer, userIndex + 1);
        }
    }
    destroyLayer() {
        if (!this.canvasService)
            return;
        const layer = this.getLayer();
        if (layer) {
            this.canvasService.canvas.remove(layer);
        }
    }
    createHatchPattern(color = "rgba(0, 0, 0, 0.3)") {
        if (typeof document === "undefined") {
            return undefined;
        }
        const size = 20;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            // Transparent background
            ctx.clearRect(0, 0, size, size);
            // Draw diagonal /
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, size);
            ctx.lineTo(size, 0);
            ctx.stroke();
        }
        // @ts-ignore
        return new fabric_1.Pattern({ source: canvas, repetition: "repeat" });
    }
    getConfigService() {
        return this.context?.services.get("ConfigurationService");
    }
    syncSizeState(configService) {
        const sizeState = (0, sceneLayoutModel_1.readSizeState)(configService);
        this.state.displayUnit = sizeState.unit;
        this.state.width = sizeState.actualWidthMm;
        this.state.height = sizeState.actualHeightMm;
        this.state.padding = sizeState.viewPadding;
        this.state.offset =
            sizeState.cutMode === "outset"
                ? sizeState.cutMarginMm
                : sizeState.cutMode === "inset"
                    ? -sizeState.cutMarginMm
                    : 0;
    }
    bringFeatureMarkersToFront() {
        if (!this.canvasService)
            return;
        const canvas = this.canvasService.canvas;
        canvas
            .getObjects()
            .filter((obj) => obj?.data?.type === "feature-marker")
            .forEach((obj) => canvas.bringObjectToFront(obj));
    }
    updateDieline(_emitEvent = true) {
        if (!this.canvasService)
            return;
        const layer = this.getLayer();
        if (!layer)
            return;
        const configService = this.getConfigService();
        if (!configService)
            return;
        this.syncSizeState(configService);
        const sceneLayout = (0, sceneLayoutModel_1.computeSceneLayout)(this.canvasService, (0, sceneLayoutModel_1.readSizeState)(configService));
        if (!sceneLayout)
            return;
        const { shape, radius, mainLine, offsetLine, insideColor, outsideColor, showBleedLines, features, } = this.state;
        const canvasW = sceneLayout.canvasWidth || this.canvasService.canvas.width || 800;
        const canvasH = sceneLayout.canvasHeight || this.canvasService.canvas.height || 600;
        const scale = sceneLayout.scale;
        const cx = sceneLayout.trimRect.centerX;
        const cy = sceneLayout.trimRect.centerY;
        const visualWidth = sceneLayout.trimRect.width;
        const visualHeight = sceneLayout.trimRect.height;
        const visualRadius = radius * scale;
        const cutW = sceneLayout.cutRect.width;
        const cutH = sceneLayout.cutRect.height;
        const visualOffset = (cutW - visualWidth) / 2;
        const cutR = visualRadius === 0 ? 0 : Math.max(0, visualRadius + visualOffset);
        layer.remove(...layer.getObjects());
        const absoluteFeatures = (features || []).map((f) => ({
            ...f,
            x: f.x,
            y: f.y,
            width: (f.width || 0) * scale,
            height: (f.height || 0) * scale,
            radius: (f.radius || 0) * scale,
        }));
        const cutFeatures = absoluteFeatures.filter((f) => !f.skipCut);
        const maskPathData = (0, geometry_1.generateMaskPath)({
            canvasWidth: canvasW,
            canvasHeight: canvasH,
            shape,
            width: cutW,
            height: cutH,
            radius: cutR,
            x: cx,
            y: cy,
            features: cutFeatures,
            pathData: this.state.pathData,
        });
        const mask = new fabric_1.Path(maskPathData, {
            fill: outsideColor,
            stroke: null,
            selectable: false,
            evented: false,
            originX: "left",
            originY: "top",
            left: 0,
            top: 0,
        });
        layer.add(mask);
        if (insideColor &&
            insideColor !== "transparent" &&
            insideColor !== "rgba(0,0,0,0)") {
            const productPathData = (0, geometry_1.generateDielinePath)({
                shape,
                width: cutW,
                height: cutH,
                radius: cutR,
                x: cx,
                y: cy,
                features: cutFeatures,
                pathData: this.state.pathData,
                canvasWidth: canvasW,
                canvasHeight: canvasH,
            });
            const insideObj = new fabric_1.Path(productPathData, {
                fill: insideColor,
                stroke: null,
                selectable: false,
                evented: false,
                originX: "left",
                originY: "top",
            });
            layer.add(insideObj);
        }
        if (Math.abs(visualOffset) > 0.0001) {
            const bleedPathData = (0, geometry_1.generateBleedZonePath)({
                shape,
                width: visualWidth,
                height: visualHeight,
                radius: visualRadius,
                x: cx,
                y: cy,
                features: cutFeatures,
                pathData: this.state.pathData,
                canvasWidth: canvasW,
                canvasHeight: canvasH,
            }, {
                shape,
                width: cutW,
                height: cutH,
                radius: cutR,
                x: cx,
                y: cy,
                features: cutFeatures,
                pathData: this.state.pathData,
                canvasWidth: canvasW,
                canvasHeight: canvasH,
            }, visualOffset);
            if (showBleedLines !== false) {
                const pattern = this.createHatchPattern(mainLine.color);
                if (pattern) {
                    const bleedObj = new fabric_1.Path(bleedPathData, {
                        fill: pattern,
                        stroke: null,
                        selectable: false,
                        evented: false,
                        objectCaching: false,
                        originX: "left",
                        originY: "top",
                    });
                    layer.add(bleedObj);
                }
            }
            const offsetPathData = (0, geometry_1.generateDielinePath)({
                shape,
                width: cutW,
                height: cutH,
                radius: cutR,
                x: cx,
                y: cy,
                features: cutFeatures,
                pathData: this.state.pathData,
                canvasWidth: canvasW,
                canvasHeight: canvasH,
            });
            const offsetBorderObj = new fabric_1.Path(offsetPathData, {
                fill: null,
                stroke: offsetLine.style === "hidden" ? null : offsetLine.color,
                strokeWidth: offsetLine.width,
                strokeDashArray: offsetLine.style === "dashed"
                    ? [offsetLine.dashLength, offsetLine.dashLength]
                    : undefined,
                selectable: false,
                evented: false,
                originX: "left",
                originY: "top",
            });
            layer.add(offsetBorderObj);
        }
        const borderPathData = (0, geometry_1.generateDielinePath)({
            shape,
            width: visualWidth,
            height: visualHeight,
            radius: visualRadius,
            x: cx,
            y: cy,
            features: absoluteFeatures,
            pathData: this.state.pathData,
            canvasWidth: canvasW,
            canvasHeight: canvasH,
        });
        const borderObj = new fabric_1.Path(borderPathData, {
            fill: "transparent",
            stroke: mainLine.style === "hidden" ? null : mainLine.color,
            strokeWidth: mainLine.width,
            strokeDashArray: mainLine.style === "dashed"
                ? [mainLine.dashLength, mainLine.dashLength]
                : undefined,
            selectable: false,
            evented: false,
            originX: "left",
            originY: "top",
        });
        layer.add(borderObj);
        const userLayer = this.canvasService.getLayer("user");
        if (layer && userLayer) {
            const layerIndex = this.canvasService.canvas.getObjects().indexOf(layer);
            const userIndex = this.canvasService.canvas
                .getObjects()
                .indexOf(userLayer);
            if (layerIndex < userIndex) {
                this.canvasService.canvas.moveObjectTo(layer, userIndex + 1);
            }
        }
        else {
            this.canvasService.canvas.bringObjectToFront(layer);
        }
        // Feature tool markers can extend outside trim. Keep them above dieline mask.
        this.bringFeatureMarkersToFront();
        const rulerLayer = this.canvasService.getLayer("ruler-overlay");
        if (rulerLayer) {
            this.canvasService.canvas.bringObjectToFront(rulerLayer);
        }
        layer.dirty = true;
        this.canvasService.requestRenderAll();
    }
    getGeometry() {
        if (!this.canvasService)
            return null;
        const configService = this.getConfigService();
        if (!configService)
            return null;
        const sceneLayout = (0, sceneLayoutModel_1.computeSceneLayout)(this.canvasService, (0, sceneLayoutModel_1.readSizeState)(configService));
        if (!sceneLayout)
            return null;
        const sceneGeometry = (0, sceneLayoutModel_1.buildSceneGeometry)(configService, sceneLayout);
        return {
            ...sceneGeometry,
            strokeWidth: this.state.mainLine.width,
            pathData: this.state.pathData,
        };
    }
    async exportCutImage(options) {
        const debug = options?.debug === true;
        if (!this.canvasService) {
            console.warn("[DielineTool] exportCutImage returned null: canvas-not-ready");
            return null;
        }
        const configService = this.getConfigService();
        if (!configService) {
            console.warn("[DielineTool] exportCutImage returned null: config-service-not-ready");
            return null;
        }
        this.syncSizeState(configService);
        const sceneLayout = (0, sceneLayoutModel_1.computeSceneLayout)(this.canvasService, (0, sceneLayoutModel_1.readSizeState)(configService));
        if (!sceneLayout) {
            console.warn("[DielineTool] exportCutImage returned null: scene-layout-null");
            return null;
        }
        const { shape, radius, features, pathData } = this.state;
        const canvasW = sceneLayout.canvasWidth || this.canvasService.canvas.width || 800;
        const canvasH = sceneLayout.canvasHeight || this.canvasService.canvas.height || 600;
        const scale = sceneLayout.scale;
        const cx = sceneLayout.trimRect.centerX;
        const cy = sceneLayout.trimRect.centerY;
        const cutW = sceneLayout.cutRect.width;
        const cutH = sceneLayout.cutRect.height;
        const visualRadius = radius * scale;
        const visualOffset = (cutW - sceneLayout.trimRect.width) / 2;
        const cutR = visualRadius === 0 ? 0 : Math.max(0, visualRadius + visualOffset);
        const absoluteFeatures = (features || []).map((f) => ({
            ...f,
            x: f.x,
            y: f.y,
            width: (f.width || 0) * scale,
            height: (f.height || 0) * scale,
            radius: (f.radius || 0) * scale,
        }));
        const cutFeatures = absoluteFeatures.filter((f) => !f.skipCut);
        const generatedPathData = (0, geometry_1.generateDielinePath)({
            shape,
            width: cutW,
            height: cutH,
            radius: cutR,
            x: cx,
            y: cy,
            features: cutFeatures,
            pathData,
            canvasWidth: canvasW,
            canvasHeight: canvasH,
        });
        const clipPath = new fabric_1.Path(generatedPathData, {
            originX: "center",
            originY: "center",
            left: cx,
            top: cy,
            absolutePositioned: true,
        });
        const pathOffsetX = Number(clipPath?.pathOffset?.x);
        const pathOffsetY = Number(clipPath?.pathOffset?.y);
        const centerX = Number.isFinite(pathOffsetX) ? pathOffsetX : cx;
        const centerY = Number.isFinite(pathOffsetY) ? pathOffsetY : cy;
        clipPath.set({
            originX: "center",
            originY: "center",
            left: centerX,
            top: centerY,
            absolutePositioned: true,
        });
        clipPath.setCoords();
        const pathBounds = clipPath.getBoundingRect();
        if (!Number.isFinite(pathBounds.left) ||
            !Number.isFinite(pathBounds.top) ||
            !Number.isFinite(pathBounds.width) ||
            !Number.isFinite(pathBounds.height) ||
            pathBounds.width <= 0 ||
            pathBounds.height <= 0) {
            console.warn("[DielineTool] exportCutImage returned null: invalid-cut-bounds", {
                bounds: pathBounds,
            });
            return null;
        }
        const exportBounds = pathBounds;
        const sourceImages = this.canvasService.canvas
            .getObjects()
            .filter((obj) => {
            return obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID;
        });
        if (!sourceImages.length) {
            console.warn("[DielineTool] exportCutImage returned null: no-image-objects-on-canvas");
            return null;
        }
        const sourceCanvasWidth = Number(this.canvasService.canvas.width || sceneLayout.canvasWidth || canvasW);
        const sourceCanvasHeight = Number(this.canvasService.canvas.height || sceneLayout.canvasHeight || canvasH);
        const el = document.createElement("canvas");
        const exportCanvas = new fabric_1.Canvas(el, {
            renderOnAddRemove: false,
            selection: false,
            enableRetinaScaling: false,
            preserveObjectStacking: true,
        });
        exportCanvas.setDimensions({
            width: Math.max(1, sourceCanvasWidth),
            height: Math.max(1, sourceCanvasHeight),
        });
        try {
            for (const source of sourceImages) {
                const clone = await source.clone();
                clone.set({
                    selectable: false,
                    evented: false,
                });
                clone.setCoords();
                exportCanvas.add(clone);
            }
            exportCanvas.clipPath = clipPath;
            exportCanvas.renderAll();
            const dataUrl = exportCanvas.toDataURL({
                format: "png",
                multiplier: 2,
                left: exportBounds.left,
                top: exportBounds.top,
                width: exportBounds.width,
                height: exportBounds.height,
            });
            if (debug) {
                console.info("[DielineTool] exportCutImage success", {
                    sourceCount: sourceImages.length,
                    bounds: exportBounds,
                    rawPathBounds: pathBounds,
                    pathOffset: {
                        x: Number.isFinite(pathOffsetX) ? pathOffsetX : null,
                        y: Number.isFinite(pathOffsetY) ? pathOffsetY : null,
                    },
                    clipPathCenter: {
                        x: centerX,
                        y: centerY,
                    },
                    cutRect: sceneLayout.cutRect,
                    canvasSize: {
                        width: Math.max(1, sourceCanvasWidth),
                        height: Math.max(1, sourceCanvasHeight),
                    },
                });
            }
            return dataUrl;
        }
        finally {
            exportCanvas.dispose();
        }
    }
}
exports.DielineTool = DielineTool;
