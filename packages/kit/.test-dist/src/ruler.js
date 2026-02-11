"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RulerTool = void 0;
const core_1 = require("@pooder/core");
const fabric_1 = require("fabric");
const units_1 = require("./units");
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
        // Dieline context for sync
        this.dielineWidth = 500;
        this.dielineHeight = 500;
        this.dielineDisplayUnit = "mm";
        this.dielinePadding = 40;
        this.dielineOffset = 0;
        if (options) {
            Object.assign(this, options);
        }
    }
    activate(context) {
        this.canvasService = context.services.get("CanvasService");
        if (!this.canvasService) {
            console.warn("CanvasService not found for RulerTool");
            return;
        }
        const configService = context.services.get("ConfigurationService");
        if (configService) {
            // Load initial config
            this.thickness = configService.get("ruler.thickness", this.thickness);
            this.gap = configService.get("ruler.gap", this.gap);
            this.backgroundColor = configService.get("ruler.backgroundColor", this.backgroundColor);
            this.textColor = configService.get("ruler.textColor", this.textColor);
            this.lineColor = configService.get("ruler.lineColor", this.lineColor);
            this.fontSize = configService.get("ruler.fontSize", this.fontSize);
            // Load Dieline Config
            this.dielineDisplayUnit = configService.get("dieline.displayUnit", this.dielineDisplayUnit);
            this.dielineWidth = configService.get("dieline.width", this.dielineWidth);
            this.dielineHeight = configService.get("dieline.height", this.dielineHeight);
            this.dielinePadding = configService.get("dieline.padding", this.dielinePadding);
            this.dielineOffset = configService.get("dieline.offset", this.dielineOffset);
            // Listen for changes
            configService.onAnyChange((e) => {
                let shouldUpdate = false;
                if (e.key.startsWith("ruler.")) {
                    const prop = e.key.split(".")[1];
                    if (prop && prop in this) {
                        this[prop] = e.value;
                        shouldUpdate = true;
                    }
                }
                else if (e.key.startsWith("dieline.")) {
                    if (e.key === "dieline.displayUnit")
                        this.dielineDisplayUnit = e.value;
                    if (e.key === "dieline.width")
                        this.dielineWidth = e.value;
                    if (e.key === "dieline.height")
                        this.dielineHeight = e.value;
                    if (e.key === "dieline.padding")
                        this.dielinePadding = e.value;
                    if (e.key === "dieline.offset")
                        this.dielineOffset = e.value;
                    shouldUpdate = true;
                }
                if (shouldUpdate) {
                    this.updateRuler();
                }
            });
        }
        this.createLayer();
        this.updateRuler();
    }
    deactivate(context) {
        this.destroyLayer();
        this.canvasService = undefined;
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
                        };
                        const newState = { ...oldState, ...theme };
                        if (JSON.stringify(newState) === JSON.stringify(oldState))
                            return true;
                        Object.assign(this, newState);
                        this.updateRuler();
                        return true;
                    },
                },
            ],
        };
    }
    getLayer() {
        return this.canvasService?.getLayer("ruler-overlay");
    }
    createLayer() {
        if (!this.canvasService)
            return;
        const canvas = this.canvasService.canvas;
        const width = canvas.width || 800;
        const height = canvas.height || 600;
        const layer = this.canvasService.createLayer("ruler-overlay", {
            width,
            height,
            selectable: false,
            evented: false,
            left: 0,
            top: 0,
            originX: "left",
            originY: "top",
        });
        canvas.bringObjectToFront(layer);
    }
    destroyLayer() {
        if (!this.canvasService)
            return;
        const layer = this.getLayer();
        if (layer) {
            this.canvasService.canvas.remove(layer);
        }
    }
    createArrowLine(x1, y1, x2, y2, color) {
        const line = new fabric_1.Line([x1, y1, x2, y2], {
            stroke: color,
            strokeWidth: this.thickness / 20, // Scale stroke width relative to thickness (default 1)
            selectable: false,
            evented: false,
        });
        // Arrow size proportional to thickness
        const arrowSize = Math.max(4, this.thickness * 0.3);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        // End Arrow (at x2, y2)
        const endArrow = new fabric_1.Polygon([
            { x: 0, y: 0 },
            { x: -arrowSize, y: -arrowSize / 2 },
            { x: -arrowSize, y: arrowSize / 2 },
        ], {
            fill: color,
            left: x2,
            top: y2,
            originX: "right",
            originY: "center",
            angle: (angle * 180) / Math.PI,
            selectable: false,
            evented: false,
        });
        // Start Arrow (at x1, y1)
        const startArrow = new fabric_1.Polygon([
            { x: 0, y: 0 },
            { x: arrowSize, y: -arrowSize / 2 },
            { x: arrowSize, y: arrowSize / 2 },
        ], {
            fill: color,
            left: x1,
            top: y1,
            originX: "left",
            originY: "center",
            angle: (angle * 180) / Math.PI,
            selectable: false,
            evented: false,
        });
        return new fabric_1.Group([line, startArrow, endArrow], {
            selectable: false,
            evented: false,
        });
    }
    resolvePadding(containerWidth, containerHeight) {
        if (typeof this.dielinePadding === "number") {
            return this.dielinePadding;
        }
        if (typeof this.dielinePadding === "string") {
            if (this.dielinePadding.endsWith("%")) {
                const percent = parseFloat(this.dielinePadding) / 100;
                return Math.min(containerWidth, containerHeight) * percent;
            }
            return parseFloat(this.dielinePadding) || 0;
        }
        return 0;
    }
    updateRuler() {
        if (!this.canvasService)
            return;
        const layer = this.getLayer();
        if (!layer)
            return;
        layer.remove(...layer.getObjects());
        const { thickness, backgroundColor, lineColor, textColor, fontSize } = this;
        const width = this.canvasService.canvas.width || 800;
        const height = this.canvasService.canvas.height || 600;
        // Calculate Layout using Dieline properties
        // Add padding to match DielineTool
        const paddingPx = this.resolvePadding(width, height);
        // Sync Viewport (in case DielineTool hasn't updated it yet, or purely for consistency)
        this.canvasService.viewport.setPadding(paddingPx);
        this.canvasService.viewport.updatePhysical(this.dielineWidth, this.dielineHeight);
        const layout = this.canvasService.viewport.layout;
        const scale = layout.scale;
        const offsetX = layout.offsetX;
        const offsetY = layout.offsetY;
        const visualWidth = layout.width;
        const visualHeight = layout.height;
        // Logic for Bleed Offset:
        // 1. If offset > 0 (Expand):
        //    - Ruler expands to cover the bleed area.
        //    - Dimensions show expanded size.
        // 2. If offset < 0 (Shrink/Cut):
        //    - Ruler stays at original Dieline boundary (does not shrink).
        //    - Dimensions show original size.
        //    - Bleed area is internal, so we ignore it for ruler placement.
        const rawOffsetMm = this.dielineOffset || 0;
        // Effective offset for ruler calculations (only positive offset expands the ruler)
        const effectiveOffsetMm = rawOffsetMm > 0 ? rawOffsetMm : 0;
        // Pixel expansion based on effective offset
        const expandPixels = effectiveOffsetMm * scale;
        // Use gap configuration
        const gap = this.gap || 15;
        // New Bounding Box for Ruler
        const rulerLeft = offsetX - expandPixels;
        const rulerTop = offsetY - expandPixels;
        const rulerRight = offsetX + visualWidth + expandPixels;
        const rulerBottom = offsetY + visualHeight + expandPixels;
        // Display Dimensions (Physical)
        const displayWidthMm = this.dielineWidth + effectiveOffsetMm * 2;
        const displayHeightMm = this.dielineHeight + effectiveOffsetMm * 2;
        // Ruler Placement Coordinates
        // Top Ruler: Above the top boundary
        const topRulerY = rulerTop - gap;
        const topRulerXStart = rulerLeft;
        const topRulerXEnd = rulerRight;
        // Left Ruler: Left of the left boundary
        const leftRulerX = rulerLeft - gap;
        const leftRulerYStart = rulerTop;
        const leftRulerYEnd = rulerBottom;
        // 1. Top Dimension Line (X-Axis)
        const topDimLine = this.createArrowLine(topRulerXStart, topRulerY, topRulerXEnd, topRulerY, lineColor);
        layer.add(topDimLine);
        // Top Extension Lines
        const extLen = 5;
        layer.add(new fabric_1.Line([
            topRulerXStart,
            topRulerY - extLen,
            topRulerXStart,
            topRulerY + extLen,
        ], {
            stroke: lineColor,
            strokeWidth: 1,
            selectable: false,
            evented: false,
        }));
        layer.add(new fabric_1.Line([topRulerXEnd, topRulerY - extLen, topRulerXEnd, topRulerY + extLen], {
            stroke: lineColor,
            strokeWidth: 1,
            selectable: false,
            evented: false,
        }));
        // Top Text (Centered)
        const widthStr = (0, units_1.formatMm)(displayWidthMm, this.dielineDisplayUnit);
        const topTextContent = `${widthStr} ${this.dielineDisplayUnit}`;
        const topText = new fabric_1.Text(topTextContent, {
            left: topRulerXStart + (rulerRight - rulerLeft) / 2,
            top: topRulerY,
            fontSize: fontSize,
            fill: textColor,
            fontFamily: "Arial",
            originX: "center",
            originY: "center",
            backgroundColor: backgroundColor, // Background mask for readability
            selectable: false,
            evented: false,
        });
        // Add small padding to text background if Fabric supports it directly or via separate rect
        // Fabric Text backgroundColor is tight.
        layer.add(topText);
        // 2. Left Dimension Line (Y-Axis)
        const leftDimLine = this.createArrowLine(leftRulerX, leftRulerYStart, leftRulerX, leftRulerYEnd, lineColor);
        layer.add(leftDimLine);
        // Left Extension Lines
        layer.add(new fabric_1.Line([
            leftRulerX - extLen,
            leftRulerYStart,
            leftRulerX + extLen,
            leftRulerYStart,
        ], {
            stroke: lineColor,
            strokeWidth: 1,
            selectable: false,
            evented: false,
        }));
        layer.add(new fabric_1.Line([
            leftRulerX - extLen,
            leftRulerYEnd,
            leftRulerX + extLen,
            leftRulerYEnd,
        ], {
            stroke: lineColor,
            strokeWidth: 1,
            selectable: false,
            evented: false,
        }));
        // Left Text (Centered, Rotated)
        const heightStr = (0, units_1.formatMm)(displayHeightMm, this.dielineDisplayUnit);
        const leftTextContent = `${heightStr} ${this.dielineDisplayUnit}`;
        const leftText = new fabric_1.Text(leftTextContent, {
            left: leftRulerX,
            top: leftRulerYStart + (rulerBottom - rulerTop) / 2,
            angle: -90,
            fontSize: fontSize,
            fill: textColor,
            fontFamily: "Arial",
            originX: "center",
            originY: "center",
            backgroundColor: backgroundColor,
            selectable: false,
            evented: false,
        });
        layer.add(leftText);
        // Always bring ruler to front
        this.canvasService.canvas.bringObjectToFront(layer);
        this.canvasService.canvas.requestRenderAll();
    }
}
exports.RulerTool = RulerTool;
