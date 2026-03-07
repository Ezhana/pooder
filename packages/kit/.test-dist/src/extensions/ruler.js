"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RulerTool = void 0;
const core_1 = require("@pooder/core");
const sceneLayoutModel_1 = require("./sceneLayoutModel");
const RULER_LAYER_ID = "ruler-overlay";
const EXTENSION_LINE_LENGTH = 5;
const MIN_ARROW_SIZE = 4;
class RulerTool {
    constructor(options) {
        this.id = "pooder.kit.ruler";
        this.metadata = {
            name: "RulerTool",
        };
        this.thickness = 20;
        this.gap = 15;
        this.backgroundColor = "#f0f0f0";
        this.textColor = "#333333";
        this.lineColor = "#999999";
        this.fontSize = 10;
        this.renderSeq = 0;
        this.numericProps = new Set(["thickness", "gap", "fontSize"]);
        this.onCanvasResized = () => {
            this.updateRuler();
        };
        if (options) {
            Object.assign(this, options);
        }
    }
    activate(context) {
        this.context = context;
        this.canvasService = context.services.get("CanvasService");
        if (!this.canvasService) {
            console.warn("[RulerTool] CanvasService not found.");
            return;
        }
        const configService = context.services.get("ConfigurationService");
        if (configService) {
            this.syncConfig(configService);
            configService.onAnyChange((e) => {
                let shouldUpdate = false;
                if (e.key.startsWith("ruler.")) {
                    const prop = e.key.split(".")[1];
                    if (prop && prop in this) {
                        if (this.numericProps.has(prop)) {
                            this[prop] = this.toFiniteNumber(e.value, this[prop]);
                        }
                        else {
                            this[prop] = e.value;
                        }
                        shouldUpdate = true;
                        this.log("config:update", {
                            key: e.key,
                            raw: e.value,
                            normalized: this[prop],
                        });
                    }
                }
                else if (e.key.startsWith("size.")) {
                    shouldUpdate = true;
                    this.log("size:update", { key: e.key, value: e.value });
                }
                if (shouldUpdate) {
                    this.updateRuler();
                }
            });
        }
        this.createLayer();
        context.eventBus.on("canvas:resized", this.onCanvasResized);
        this.updateRuler();
    }
    deactivate(context) {
        context.eventBus.off("canvas:resized", this.onCanvasResized);
        if (this.canvasService) {
            void this.canvasService.applyObjectSpecsToLayer(RULER_LAYER_ID, []);
            void this.canvasService.applyObjectSpecsToRootLayer(RULER_LAYER_ID, []);
        }
        this.destroyLayer();
        this.canvasService = undefined;
        this.context = undefined;
        this.renderSeq = 0;
    }
    contribute() {
        return {
            [core_1.ContributionPointIds.CONFIGURATIONS]: [
                {
                    id: "ruler.thickness",
                    type: "number",
                    label: "Thickness",
                    min: 10,
                    max: 100,
                    default: 20,
                },
                {
                    id: "ruler.gap",
                    type: "number",
                    label: "Gap",
                    min: 0,
                    max: 100,
                    default: 15,
                },
                {
                    id: "ruler.backgroundColor",
                    type: "color",
                    label: "Background Color",
                    default: "#f0f0f0",
                },
                {
                    id: "ruler.textColor",
                    type: "color",
                    label: "Text Color",
                    default: "#333333",
                },
                {
                    id: "ruler.lineColor",
                    type: "color",
                    label: "Line Color",
                    default: "#999999",
                },
                {
                    id: "ruler.fontSize",
                    type: "number",
                    label: "Font Size",
                    min: 8,
                    max: 24,
                    default: 10,
                },
            ],
            [core_1.ContributionPointIds.COMMANDS]: [
                {
                    command: "setTheme",
                    title: "Set Ruler Theme",
                    handler: (theme) => {
                        const oldState = {
                            backgroundColor: this.backgroundColor,
                            textColor: this.textColor,
                            lineColor: this.lineColor,
                            fontSize: this.fontSize,
                            thickness: this.thickness,
                            gap: this.gap,
                        };
                        const newState = { ...oldState, ...theme };
                        if (JSON.stringify(newState) === JSON.stringify(oldState)) {
                            return true;
                        }
                        Object.assign(this, newState);
                        this.thickness = this.toFiniteNumber(this.thickness, 20);
                        this.gap = this.toFiniteNumber(this.gap, 15);
                        this.fontSize = this.toFiniteNumber(this.fontSize, 10);
                        this.updateRuler();
                        return true;
                    },
                },
            ],
        };
    }
    log(step, payload) {
        if (payload) {
            console.debug(`[RulerTool] ${step}`, payload);
            return;
        }
        console.debug(`[RulerTool] ${step}`);
    }
    syncConfig(configService) {
        this.thickness = this.toFiniteNumber(configService.get("ruler.thickness", this.thickness), 20);
        this.gap = Math.max(0, this.toFiniteNumber(configService.get("ruler.gap", this.gap), 15));
        this.backgroundColor = configService.get("ruler.backgroundColor", this.backgroundColor);
        this.textColor = configService.get("ruler.textColor", this.textColor);
        this.lineColor = configService.get("ruler.lineColor", this.lineColor);
        this.fontSize = this.toFiniteNumber(configService.get("ruler.fontSize", this.fontSize), 10);
        this.log("config:loaded", {
            thickness: this.thickness,
            gap: this.gap,
            fontSize: this.fontSize,
            backgroundColor: this.backgroundColor,
            textColor: this.textColor,
            lineColor: this.lineColor,
        });
    }
    getLayer() {
        return this.canvasService?.getLayer(RULER_LAYER_ID);
    }
    createLayer() {
        if (!this.canvasService)
            return;
        const canvas = this.canvasService.canvas;
        const width = canvas.width || 800;
        const height = canvas.height || 600;
        const layer = this.canvasService.createLayer(RULER_LAYER_ID, {
            width,
            height,
            selectable: false,
            evented: false,
            left: 0,
            top: 0,
            originX: "left",
            originY: "top",
        });
        layer.set({ selectable: false, evented: false });
        canvas.bringObjectToFront(layer);
        // Hard reset any legacy root-rendered ruler objects from previous implementations.
        void this.canvasService.applyObjectSpecsToRootLayer(RULER_LAYER_ID, []);
    }
    destroyLayer() {
        if (!this.canvasService)
            return;
        const layer = this.getLayer();
        if (layer) {
            this.canvasService.canvas.remove(layer);
        }
    }
    toFiniteNumber(value, fallback) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallback;
    }
    formatLengthMm(valueMm, unit) {
        const converted = (0, sceneLayoutModel_1.fromMm)(valueMm, unit);
        const fractionDigits = unit === "in" ? 3 : 2;
        return Number(converted.toFixed(fractionDigits)).toString();
    }
    buildLinePath(start, end) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        return `M 0 0 L ${dx} ${dy}`;
    }
    buildStartArrowPath(size) {
        return `M 0 0 L ${size} ${-size / 2} L ${size} ${size / 2} Z`;
    }
    buildEndArrowPath(size) {
        return `M 0 0 L ${-size} ${-size / 2} L ${-size} ${size / 2} Z`;
    }
    createPathSpec(id, pathData, position, options) {
        return {
            id,
            type: "path",
            data: {
                id,
                type: "ruler",
            },
            props: {
                pathData,
                left: position.x,
                top: position.y,
                originX: options.originX ?? "left",
                originY: options.originY ?? "top",
                angle: options.angle ?? 0,
                stroke: options.stroke ?? null,
                fill: options.fill ?? null,
                strokeWidth: options.strokeWidth ?? 1,
                strokeLineCap: options.strokeLineCap ?? "butt",
                selectable: false,
                evented: false,
                excludeFromExport: true,
            },
        };
    }
    createTextSpec(id, text, position, angle = 0) {
        return {
            id,
            type: "text",
            data: {
                id,
                type: "ruler",
            },
            props: {
                text,
                left: position.x,
                top: position.y,
                angle,
                fontSize: this.fontSize,
                fill: this.textColor,
                fontFamily: "Arial",
                originX: "center",
                originY: "center",
                backgroundColor: this.backgroundColor,
                selectable: false,
                evented: false,
                excludeFromExport: true,
            },
        };
    }
    buildRulerSpecs(input) {
        const { left, top, right, bottom, widthLabel, heightLabel } = input;
        const gap = Math.max(0, this.toFiniteNumber(this.gap, 15));
        const topY = top - gap;
        const leftX = left - gap;
        const arrowSize = Math.max(MIN_ARROW_SIZE, this.thickness * 0.3);
        const strokeWidth = Math.max(1, this.thickness / 20);
        const topLineAngleDeg = 0;
        const leftLineAngleDeg = 90;
        // Keep dimension line inside the arrow heads so it doesn't visually overflow.
        const topMidX = left + (right - left) / 2;
        const leftMidY = top + (bottom - top) / 2;
        const topLineStartX = Math.min(left + arrowSize, topMidX);
        const topLineEndX = Math.max(right - arrowSize, topMidX);
        const leftLineStartY = Math.min(top + arrowSize, leftMidY);
        const leftLineEndY = Math.max(bottom - arrowSize, leftMidY);
        const specs = [];
        specs.push(this.createPathSpec("ruler.top.line", this.buildLinePath({ x: topLineStartX, y: topY }, { x: topLineEndX, y: topY }), { x: topLineStartX, y: topY }, {
            stroke: this.lineColor,
            strokeWidth,
            strokeLineCap: "butt",
        }), this.createPathSpec("ruler.top.arrow.start", this.buildStartArrowPath(arrowSize), { x: left, y: topY }, {
            fill: this.lineColor,
            stroke: this.lineColor,
            strokeWidth: 1,
            originX: "left",
            originY: "center",
            angle: topLineAngleDeg,
        }), this.createPathSpec("ruler.top.arrow.end", this.buildEndArrowPath(arrowSize), { x: right, y: topY }, {
            fill: this.lineColor,
            stroke: this.lineColor,
            strokeWidth: 1,
            originX: "right",
            originY: "center",
            angle: topLineAngleDeg,
        }), this.createPathSpec("ruler.top.ext.start", this.buildLinePath({ x: left, y: topY - EXTENSION_LINE_LENGTH }, { x: left, y: topY + EXTENSION_LINE_LENGTH }), { x: left, y: topY - EXTENSION_LINE_LENGTH }, { stroke: this.lineColor, strokeWidth: 1 }), this.createPathSpec("ruler.top.ext.end", this.buildLinePath({ x: right, y: topY - EXTENSION_LINE_LENGTH }, { x: right, y: topY + EXTENSION_LINE_LENGTH }), { x: right, y: topY - EXTENSION_LINE_LENGTH }, { stroke: this.lineColor, strokeWidth: 1 }), this.createTextSpec("ruler.top.label", widthLabel, {
            x: left + (right - left) / 2,
            y: topY,
        }));
        specs.push(this.createPathSpec("ruler.left.line", this.buildLinePath({ x: leftX, y: leftLineStartY }, { x: leftX, y: leftLineEndY }), { x: leftX, y: leftLineStartY }, {
            stroke: this.lineColor,
            strokeWidth,
            strokeLineCap: "butt",
        }), this.createPathSpec("ruler.left.arrow.start", this.buildStartArrowPath(arrowSize), { x: leftX, y: top }, {
            fill: this.lineColor,
            stroke: this.lineColor,
            strokeWidth: 1,
            originX: "left",
            originY: "center",
            angle: leftLineAngleDeg,
        }), this.createPathSpec("ruler.left.arrow.end", this.buildEndArrowPath(arrowSize), { x: leftX, y: bottom }, {
            fill: this.lineColor,
            stroke: this.lineColor,
            strokeWidth: 1,
            originX: "right",
            originY: "center",
            angle: leftLineAngleDeg,
        }), this.createPathSpec("ruler.left.ext.start", this.buildLinePath({ x: leftX - EXTENSION_LINE_LENGTH, y: top }, { x: leftX + EXTENSION_LINE_LENGTH, y: top }), { x: leftX - EXTENSION_LINE_LENGTH, y: top }, { stroke: this.lineColor, strokeWidth: 1 }), this.createPathSpec("ruler.left.ext.end", this.buildLinePath({ x: leftX - EXTENSION_LINE_LENGTH, y: bottom }, { x: leftX + EXTENSION_LINE_LENGTH, y: bottom }), { x: leftX - EXTENSION_LINE_LENGTH, y: bottom }, { stroke: this.lineColor, strokeWidth: 1 }), this.createTextSpec("ruler.left.label", heightLabel, {
            x: leftX,
            y: top + (bottom - top) / 2,
        }, -90));
        return specs;
    }
    updateRuler() {
        void this.updateRulerAsync();
    }
    async updateRulerAsync() {
        if (!this.canvasService)
            return;
        const configService = this.context?.services.get("ConfigurationService");
        if (!configService)
            return;
        const seq = ++this.renderSeq;
        const sizeState = (0, sceneLayoutModel_1.readSizeState)(configService);
        const layout = (0, sceneLayoutModel_1.computeSceneLayout)(this.canvasService, sizeState);
        this.log("render:start", {
            seq,
            unit: sizeState.unit,
            gap: this.gap,
            thickness: this.thickness,
            fontSize: this.fontSize,
            hasLayout: !!layout,
            scale: layout?.scale ?? null,
        });
        if (!layout || layout.scale <= 0) {
            if (seq !== this.renderSeq)
                return;
            this.log("render:skip", { seq, reason: "invalid-layout" });
            await this.canvasService.applyObjectSpecsToLayer(RULER_LAYER_ID, []);
            await this.canvasService.applyObjectSpecsToRootLayer(RULER_LAYER_ID, []);
            return;
        }
        const geometry = (0, sceneLayoutModel_1.buildSceneGeometry)(configService, layout);
        if (geometry.unit !== "px") {
            console.warn("[RulerTool] Unexpected geometry unit.", geometry.unit);
        }
        const rulerLeft = geometry.x - geometry.width / 2;
        const rulerTop = geometry.y - geometry.height / 2;
        const rulerRight = rulerLeft + geometry.width;
        const rulerBottom = rulerTop + geometry.height;
        const widthMm = geometry.width / layout.scale;
        const heightMm = geometry.height / layout.scale;
        const unit = sizeState.unit;
        const widthLabel = `${this.formatLengthMm(widthMm, unit)} ${unit}`;
        const heightLabel = `${this.formatLengthMm(heightMm, unit)} ${unit}`;
        const specs = this.buildRulerSpecs({
            left: rulerLeft,
            top: rulerTop,
            right: rulerRight,
            bottom: rulerBottom,
            widthLabel,
            heightLabel,
        });
        this.log("render:geometry", {
            seq,
            left: rulerLeft,
            top: rulerTop,
            right: rulerRight,
            bottom: rulerBottom,
            widthPx: geometry.width,
            heightPx: geometry.height,
            widthMm,
            heightMm,
            specCount: specs.length,
        });
        if (seq !== this.renderSeq)
            return;
        // Clean stale root objects from old ruler implementations.
        await this.canvasService.applyObjectSpecsToRootLayer(RULER_LAYER_ID, []);
        if (seq !== this.renderSeq)
            return;
        await this.canvasService.applyObjectSpecsToLayer(RULER_LAYER_ID, specs);
        if (seq !== this.renderSeq)
            return;
        const layer = this.getLayer();
        if (layer) {
            this.canvasService.canvas.bringObjectToFront(layer);
        }
        this.canvasService.requestRenderAll();
        this.log("render:done", { seq });
    }
}
exports.RulerTool = RulerTool;
