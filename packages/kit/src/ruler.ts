import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
} from "@pooder/core";
import { Rect, Line, Text, Group, Polygon } from "fabric";
import CanvasService from "./CanvasService";
import { Coordinate, Unit } from "./coordinate";

export class RulerTool implements Extension {
  id = "pooder.kit.ruler";

  public metadata = {
    name: "RulerTool",
  };

  private unit: Unit = "mm";
  private thickness: number = 20;
  private gap: number = 15;
  private backgroundColor: string = "#f0f0f0";
  private textColor: string = "#333333";
  private lineColor: string = "#999999";
  private fontSize: number = 10;

  // Dieline context for sync
  private dielineWidth: number = 500;
  private dielineHeight: number = 500;
  private dielineUnit: Unit = "mm";
  private dielinePadding: number = 40;
  private dielineOffset: number = 0;

  private canvasService?: CanvasService;

  constructor(
    options?: Partial<{
      unit: Unit;
      thickness: number;
      backgroundColor: string;
      textColor: string;
      lineColor: string;
      fontSize: number;
    }>,
  ) {
    if (options) {
      Object.assign(this, options);
    }
  }

  activate(context: ExtensionContext) {
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    if (!this.canvasService) {
      console.warn("CanvasService not found for RulerTool");
      return;
    }

    const configService = context.services.get<any>("ConfigurationService");
    if (configService) {
      // Load initial config
      this.unit = configService.get("ruler.unit", this.unit);
      this.thickness = configService.get("ruler.thickness", this.thickness);
      this.gap = configService.get("ruler.gap", this.gap);
      this.backgroundColor = configService.get(
        "ruler.backgroundColor",
        this.backgroundColor,
      );
      this.textColor = configService.get("ruler.textColor", this.textColor);
      this.lineColor = configService.get("ruler.lineColor", this.lineColor);
      this.fontSize = configService.get("ruler.fontSize", this.fontSize);

      // Load Dieline Config
      this.dielineUnit = configService.get("dieline.unit", this.dielineUnit);
      this.dielineWidth = configService.get("dieline.width", this.dielineWidth);
      this.dielineHeight = configService.get(
        "dieline.height",
        this.dielineHeight,
      );
      this.dielinePadding = configService.get(
        "dieline.padding",
        this.dielinePadding,
      );
      this.dielineOffset = configService.get(
        "dieline.offset",
        this.dielineOffset,
      );

      // Listen for changes
      configService.onAnyChange((e: { key: string; value: any }) => {
        let shouldUpdate = false;
        if (e.key.startsWith("ruler.")) {
          const prop = e.key.split(".")[1];
          if (prop && prop in this) {
            (this as any)[prop] = e.value;
            shouldUpdate = true;
          }
        } else if (e.key.startsWith("dieline.")) {
          if (e.key === "dieline.unit") this.dielineUnit = e.value;
          if (e.key === "dieline.width") this.dielineWidth = e.value;
          if (e.key === "dieline.height") this.dielineHeight = e.value;
          if (e.key === "dieline.padding") this.dielinePadding = e.value;
          if (e.key === "dieline.offset") this.dielineOffset = e.value;
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

  deactivate(context: ExtensionContext) {
    this.destroyLayer();
    this.canvasService = undefined;
  }

  contribute() {
    return {
      [ContributionPointIds.CONFIGURATIONS]: [
        {
          id: "ruler.unit",
          type: "select",
          label: "Unit",
          options: ["px", "mm", "cm", "in"],
          default: "px",
        },
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
      ] as ConfigurationContribution[],
      [ContributionPointIds.COMMANDS]: [
        {
          command: "setUnit",
          title: "Set Ruler Unit",
          handler: (unit: "px" | "mm" | "cm" | "in") => {
            if (this.unit === unit) return true;
            this.unit = unit;
            this.updateRuler();
            return true;
          },
        },
        {
          command: "setTheme",
          title: "Set Ruler Theme",
          handler: (
            theme: Partial<{
              backgroundColor: string;
              textColor: string;
              lineColor: string;
              fontSize: number;
              thickness: number;
            }>,
          ) => {
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
      ] as CommandContribution[],
    };
  }

  private getLayer() {
    return this.canvasService?.getLayer("ruler-overlay");
  }

  private createLayer() {
    if (!this.canvasService) return;

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

  private destroyLayer() {
    if (!this.canvasService) return;
    const layer = this.getLayer();
    if (layer) {
      this.canvasService.canvas.remove(layer);
    }
  }

  private createArrowLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
  ): Group {
    const line = new Line([x1, y1, x2, y2], {
      stroke: color,
      strokeWidth: this.thickness / 20, // Scale stroke width relative to thickness (default 1)
      selectable: false,
      evented: false,
    });

    // Arrow size proportional to thickness
    const arrowSize = Math.max(4, this.thickness * 0.3);
    const angle = Math.atan2(y2 - y1, x2 - x1);

    // End Arrow (at x2, y2)
    const endArrow = new Polygon(
      [
        { x: 0, y: 0 },
        { x: -arrowSize, y: -arrowSize / 2 },
        { x: -arrowSize, y: arrowSize / 2 },
      ],
      {
        fill: color,
        left: x2,
        top: y2,
        originX: "right",
        originY: "center",
        angle: (angle * 180) / Math.PI,
        selectable: false,
        evented: false,
      },
    );

    // Start Arrow (at x1, y1)
    const startArrow = new Polygon(
      [
        { x: 0, y: 0 },
        { x: arrowSize, y: -arrowSize / 2 },
        { x: arrowSize, y: arrowSize / 2 },
      ],
      {
        fill: color,
        left: x1,
        top: y1,
        originX: "left",
        originY: "center",
        angle: (angle * 180) / Math.PI,
        selectable: false,
        evented: false,
      },
    );

    return new Group([line, startArrow, endArrow], {
      selectable: false,
      evented: false,
    });
  }

  private updateRuler() {
    if (!this.canvasService) return;
    const layer = this.getLayer();
    if (!layer) return;

    layer.remove(...layer.getObjects());

    const { thickness, backgroundColor, lineColor, textColor, fontSize } = this;
    const width = this.canvasService.canvas.width || 800;
    const height = this.canvasService.canvas.height || 600;

    // Calculate Layout using Dieline properties
    // Add padding to match DielineTool
    const layout = Coordinate.calculateLayout(
      { width, height },
      { width: this.dielineWidth, height: this.dielineHeight },
      this.dielinePadding || 0,
    );

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

    const rawOffset = this.dielineOffset || 0;
    // Effective offset for ruler calculations (only positive offset expands the ruler)
    const effectiveOffset = rawOffset > 0 ? rawOffset : 0;

    // Pixel expansion based on effective offset
    const expandPixels = effectiveOffset * scale;
    // Use gap configuration
    const gap = this.gap || 15;

    // New Bounding Box for Ruler
    const rulerLeft = offsetX - expandPixels;
    const rulerTop = offsetY - expandPixels;
    const rulerRight = offsetX + visualWidth + expandPixels;
    const rulerBottom = offsetY + visualHeight + expandPixels;

    // Display Dimensions (Physical)
    const displayWidth = this.dielineWidth + effectiveOffset * 2;
    const displayHeight = this.dielineHeight + effectiveOffset * 2;

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
    const topDimLine = this.createArrowLine(
      topRulerXStart,
      topRulerY,
      topRulerXEnd,
      topRulerY,
      lineColor,
    );
    layer.add(topDimLine);

    // Top Extension Lines
    const extLen = 5;
    layer.add(
      new Line(
        [
          topRulerXStart,
          topRulerY - extLen,
          topRulerXStart,
          topRulerY + extLen,
        ],
        {
          stroke: lineColor,
          strokeWidth: 1,
          selectable: false,
          evented: false,
        },
      ),
    );
    layer.add(
      new Line(
        [topRulerXEnd, topRulerY - extLen, topRulerXEnd, topRulerY + extLen],
        {
          stroke: lineColor,
          strokeWidth: 1,
          selectable: false,
          evented: false,
        },
      ),
    );

    // Top Text (Centered)
    // Format to max 2 decimal places if needed
    const widthStr = parseFloat(displayWidth.toFixed(2)).toString();
    const topTextContent = `${widthStr} ${this.dielineUnit}`;
    const topText = new Text(topTextContent, {
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
    const leftDimLine = this.createArrowLine(
      leftRulerX,
      leftRulerYStart,
      leftRulerX,
      leftRulerYEnd,
      lineColor,
    );
    layer.add(leftDimLine);

    // Left Extension Lines
    layer.add(
      new Line(
        [
          leftRulerX - extLen,
          leftRulerYStart,
          leftRulerX + extLen,
          leftRulerYStart,
        ],
        {
          stroke: lineColor,
          strokeWidth: 1,
          selectable: false,
          evented: false,
        },
      ),
    );
    layer.add(
      new Line(
        [
          leftRulerX - extLen,
          leftRulerYEnd,
          leftRulerX + extLen,
          leftRulerYEnd,
        ],
        {
          stroke: lineColor,
          strokeWidth: 1,
          selectable: false,
          evented: false,
        },
      ),
    );

    // Left Text (Centered, Rotated)
    const heightStr = parseFloat(displayHeight.toFixed(2)).toString();
    const leftTextContent = `${heightStr} ${this.dielineUnit}`;
    const leftText = new Text(leftTextContent, {
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
