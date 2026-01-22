import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
} from "@pooder/core";
import { Rect, Line, Text } from "fabric";
import CanvasService from "./CanvasService";

export class RulerTool implements Extension {
  id = "pooder.kit.ruler";

  public metadata = {
    name: "RulerTool",
  };

  private unit: "px" | "mm" | "cm" | "in" = "px";
  private thickness: number = 20;
  private backgroundColor: string = "#f0f0f0";
  private textColor: string = "#333333";
  private lineColor: string = "#999999";
  private fontSize: number = 10;

  private canvasService?: CanvasService;

  constructor(
    options?: Partial<{
      unit: "px" | "mm" | "cm" | "in";
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
      this.backgroundColor = configService.get(
        "ruler.backgroundColor",
        this.backgroundColor,
      );
      this.textColor = configService.get("ruler.textColor", this.textColor);
      this.lineColor = configService.get("ruler.lineColor", this.lineColor);
      this.fontSize = configService.get("ruler.fontSize", this.fontSize);

      // Listen for changes
      configService.onAnyChange((e: { key: string; value: any }) => {
        if (e.key.startsWith("ruler.")) {
          const prop = e.key.split(".")[1];
          if (prop && prop in this) {
            (this as any)[prop] = e.value;
            this.updateRuler();
          }
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

  private updateRuler() {
    if (!this.canvasService) return;
    const layer = this.getLayer();
    if (!layer) return;

    layer.remove(...layer.getObjects());

    const { thickness, backgroundColor, lineColor, textColor, fontSize } = this;
    const width = this.canvasService.canvas.width || 800;
    const height = this.canvasService.canvas.height || 600;


    // Backgrounds
    const topBg = new Rect({
      left: 0,
      top: 0,
      width: width,
      height: thickness,
      fill: backgroundColor,
      selectable: false,
      evented: false,
    });

    const leftBg = new Rect({
      left: 0,
      top: 0,
      width: thickness,
      height: height,
      fill: backgroundColor,
      selectable: false,
      evented: false,
    });

    const cornerBg = new Rect({
      left: 0,
      top: 0,
      width: thickness,
      height: thickness,
      fill: backgroundColor,
      stroke: lineColor,
      strokeWidth: 1,
      selectable: false,
      evented: false,
    });

    layer.add(topBg);
    layer.add(leftBg);
    layer.add(cornerBg);

    // Drawing Constants (Pixel based for now)
    const step = 100; // Major tick
    const subStep = 10; // Minor tick
    const midStep = 50; // Medium tick

    // Top Ruler
    for (let x = 0; x <= width; x += subStep) {
      if (x < thickness) continue; // Skip corner

      let len = thickness * 0.25;
      if (x % step === 0) len = thickness * 0.8;
      else if (x % midStep === 0) len = thickness * 0.5;

      const line = new Line([x, thickness - len, x, thickness], {
        stroke: lineColor,
        strokeWidth: 1,
        selectable: false,
        evented: false,
      });
      layer.add(line);

      if (x % step === 0) {
        const text = new Text(x.toString(), {
          left: x + 2,
          top: 2,
          fontSize: fontSize,
          fill: textColor,
          fontFamily: "Arial",
          selectable: false,
          evented: false,
        });
        layer.add(text);
      }
    }

    // Left Ruler
    for (let y = 0; y <= height; y += subStep) {
      if (y < thickness) continue; // Skip corner

      let len = thickness * 0.25;
      if (y % step === 0) len = thickness * 0.8;
      else if (y % midStep === 0) len = thickness * 0.5;

      const line = new Line([thickness - len, y, thickness, y], {
        stroke: lineColor,
        strokeWidth: 1,
        selectable: false,
        evented: false,
      });
      layer.add(line);

      if (y % step === 0) {
        const text = new Text(y.toString(), {
          angle: -90,
          left: thickness / 2 - fontSize / 3, // approximate centering
          top: y + fontSize,
          fontSize: fontSize,
          fill: textColor,
          fontFamily: "Arial",
          originX: "center",
          originY: "center",
          selectable: false,
          evented: false,
        });

        layer.add(text);
      }
    }

    // Always bring ruler to front
    this.canvasService.canvas.bringObjectToFront(layer);
    this.canvasService.canvas.requestRenderAll();
  }
}
