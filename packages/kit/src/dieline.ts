import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
} from "@pooder/core";
import { Path, Pattern } from "fabric";
import CanvasService from "./CanvasService";
import { ImageTracer } from "./tracer";
import { Coordinate } from "./coordinate";
import {
  generateDielinePath,
  generateMaskPath,
  generateBleedZonePath,
  getPathBounds,
  HoleData,
  resolveHolePosition,
} from "./geometry";

export interface DielineGeometry {
  shape: "rect" | "circle" | "ellipse" | "custom";
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  offset: number;
  borderLength?: number;
  pathData?: string;
}

export class DielineTool implements Extension {
  id = "pooder.kit.dieline";
  public metadata = {
    name: "DielineTool",
  };

  private shape: "rect" | "circle" | "ellipse" | "custom" = "rect";
  private width: number = 500;
  private height: number = 500;
  private radius: number = 0;
  private offset: number = 0;
  private style: "solid" | "dashed" = "solid";
  private insideColor: string = "rgba(0,0,0,0)";
  private outsideColor: string = "#ffffff";
  private showBleedLines: boolean = true;
  private holes: HoleData[] = [];
  // Position is stored as normalized coordinates (0-1)
  private position?: { x: number; y: number };
  private borderLength?: number;
  private pathData?: string;

  private canvasService?: CanvasService;
  private context?: ExtensionContext;

  constructor(
    options?: Partial<{
      shape: "rect" | "circle" | "ellipse" | "custom";
      width: number;
      height: number;
      radius: number;
      // Position is normalized (0-1)
      position: { x: number; y: number };
      borderLength: number;
      offset: number;
      style: "solid" | "dashed";
      insideColor: string;
      outsideColor: string;
      showBleedLines: boolean;
      holes: HoleData[];
      pathData: string;
    }>,
  ) {
    if (options) {
      Object.assign(this, options);
    }
  }

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    if (!this.canvasService) {
      console.warn("CanvasService not found for DielineTool");
      return;
    }

    const configService = context.services.get<any>("ConfigurationService");
    if (configService) {
      // Load initial config
      this.shape = configService.get("dieline.shape", this.shape);
      this.width = configService.get("dieline.width", this.width);
      this.height = configService.get("dieline.height", this.height);
      this.radius = configService.get("dieline.radius", this.radius);
      this.borderLength = configService.get(
        "dieline.borderLength",
        this.borderLength,
      );
      this.offset = configService.get("dieline.offset", this.offset);
      this.style = configService.get("dieline.style", this.style);
      this.insideColor = configService.get(
        "dieline.insideColor",
        this.insideColor,
      );
      this.outsideColor = configService.get(
        "dieline.outsideColor",
        this.outsideColor,
      );
      this.showBleedLines = configService.get(
        "dieline.showBleedLines",
        this.showBleedLines,
      );
      this.holes = configService.get("dieline.holes", this.holes);
      this.pathData = configService.get("dieline.pathData", this.pathData);

      // Listen for changes
      configService.onAnyChange((e: { key: string; value: any }) => {
        if (e.key.startsWith("dieline.")) {
          const prop = e.key.split(".")[1];
          console.log(
            `[DielineTool] Config change detected: ${e.key} -> ${e.value}`,
          );
          if (prop && prop in this) {
            (this as any)[prop] = e.value;
            this.updateDieline();
          }
        }
      });
    }

    this.createLayer();
    this.updateDieline();
  }

  deactivate(context: ExtensionContext) {
    this.destroyLayer();
    this.canvasService = undefined;
    this.context = undefined;
  }

  contribute() {
    return {
      [ContributionPointIds.CONFIGURATIONS]: [
        {
          id: "dieline.shape",
          type: "select",
          label: "Shape",
          options: ["rect", "circle", "ellipse", "custom"],
          default: this.shape,
        },
        {
          id: "dieline.width",
          type: "number",
          label: "Width",
          min: 10,
          max: 2000,
          default: this.width,
        },
        {
          id: "dieline.height",
          type: "number",
          label: "Height",
          min: 10,
          max: 2000,
          default: this.height,
        },
        {
          id: "dieline.radius",
          type: "number",
          label: "Corner Radius",
          min: 0,
          max: 500,
          default: this.radius,
        },
        {
          id: "dieline.position",
          type: "json",
          label: "Position (Normalized)",
          default: this.position,
        },
        {
          id: "dieline.borderLength",
          type: "number",
          label: "Margin",
          min: 0,
          max: 500,
          default: this.borderLength,
        },
        {
          id: "dieline.offset",
          type: "number",
          label: "Bleed Offset",
          min: -100,
          max: 100,
          default: this.offset,
        },
        {
          id: "dieline.showBleedLines",
          type: "boolean",
          label: "Show Bleed Lines",
          default: this.showBleedLines,
        },
        {
          id: "dieline.style",
          type: "select",
          label: "Line Style",
          options: ["solid", "dashed"],
          default: this.style,
        },
        {
          id: "dieline.insideColor",
          type: "color",
          label: "Inside Color",
          default: this.insideColor,
        },
        {
          id: "dieline.outsideColor",
          type: "color",
          label: "Outside Color",
          default: this.outsideColor,
        },
        {
          id: "dieline.holes",
          type: "json",
          label: "Holes",
          default: this.holes,
        },
      ] as ConfigurationContribution[],
      [ContributionPointIds.COMMANDS]: [
        {
          command: "getGeometry",
          title: "Get Geometry",
          handler: () => {
            return this.getGeometry();
          },
        },
        {
          command: "exportCutImage",
          title: "Export Cut Image",
          handler: () => {
            return this.exportCutImage();
          },
        },
        {
          command: "detectEdge",
          title: "Detect Edge from Image",
          handler: async (imageUrl: string, options?: any) => {
            try {
              const pathData = await ImageTracer.trace(imageUrl, options);
              const bounds = getPathBounds(pathData);

              const currentMax = Math.max(this.width, this.height);
              const scale = currentMax / Math.max(bounds.width, bounds.height);

              const newWidth = bounds.width * scale;
              const newHeight = bounds.height * scale;

              const configService =
                this.context?.services.get<any>("ConfigurationService");
              if (configService) {
                configService.update("dieline.width", newWidth);
                configService.update("dieline.height", newHeight);
                configService.update("dieline.shape", "custom");
                configService.update("dieline.pathData", pathData);
              }

              return pathData;
            } catch (e) {
              console.error("Edge detection failed", e);
              throw e;
            }
          },
        },
      ] as CommandContribution[],
    };
  }

  private getLayer() {
    return this.canvasService?.getLayer("dieline-overlay");
  }

  private createLayer() {
    if (!this.canvasService) return;
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

  private destroyLayer() {
    if (!this.canvasService) return;
    const layer = this.getLayer();
    if (layer) {
      this.canvasService.canvas.remove(layer);
    }
  }

  private createHatchPattern(color: string = "rgba(0, 0, 0, 0.3)") {
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
    return new Pattern({ source: canvas, repetition: "repeat" });
  }

  public updateDieline(emitEvent: boolean = true) {
    if (!this.canvasService) return;
    const layer = this.getLayer();
    if (!layer) return;

    const {
      shape,
      radius,
      offset,
      style,
      insideColor,
      outsideColor,
      position,
      borderLength,
      showBleedLines,
      holes,
    } = this;
    let { width, height } = this;

    const canvasW = this.canvasService.canvas.width || 800;
    const canvasH = this.canvasService.canvas.height || 600;

    let visualWidth = width;
    let visualHeight = height;

    if (borderLength && borderLength > 0) {
      visualWidth = Math.max(0, canvasW - borderLength * 2);
      visualHeight = Math.max(0, canvasH - borderLength * 2);
    }

    const cx = Coordinate.toAbsolute(position?.x ?? 0.5, canvasW);
    const cy = Coordinate.toAbsolute(position?.y ?? 0.5, canvasH);

    // Clear existing objects
    layer.remove(...layer.getObjects());

    // Resolve Holes for Geometry Generation
    const geometryForHoles = {
      x: cx,
      y: cy,
      width: visualWidth,
      height: visualHeight,
    };

    const absoluteHoles = (holes || []).map((h) => {
      const pos = resolveHolePosition(
        h,
        geometryForHoles,
        { width: canvasW, height: canvasH }
      );
      return {
        ...h,
        x: pos.x,
        y: pos.y,
      };
    });

    // 1. Draw Mask (Outside)
    const cutW = Math.max(0, width + offset * 2);
    const cutH = Math.max(0, height + offset * 2);
    const cutR = radius === 0 ? 0 : Math.max(0, radius + offset);

    // Use Paper.js to generate the complex mask path
    const maskPathData = generateMaskPath({
      canvasWidth: canvasW,
      canvasHeight: canvasH,
      shape,
      width: cutW,
      height: cutH,
      radius: cutR,
      x: cx,
      y: cy,
      holes: absoluteHoles,
      pathData: this.pathData,
    });

    const mask = new Path(maskPathData, {
      fill: outsideColor,
      stroke: null,
      selectable: false,
      evented: false,
      originX: "left" as const,
      originY: "top" as const,
      left: 0,
      top: 0,
    });
    layer.add(mask);

    // 2. Draw Inside Fill (Dieline Shape itself, merged with holes if needed)
    if (
      insideColor &&
      insideColor !== "transparent" &&
      insideColor !== "rgba(0,0,0,0)"
    ) {
      // Generate path for the product shape (Paper) = Dieline - Holes
      const productPathData = generateDielinePath({
        shape,
        width: cutW,
        height: cutH,
        radius: cutR,
        x: cx,
        y: cy,
        holes: absoluteHoles,
        pathData: this.pathData,
      });

      const insideObj = new Path(productPathData, {
        fill: insideColor,
        stroke: null,
        selectable: false,
        evented: false,
        originX: "left", // paper.js paths are absolute
        originY: "top",
      });
      layer.add(insideObj);
    }

    // 3. Draw Bleed Zone (Hatch Fill) and Offset Border
    if (offset !== 0) {
      const bleedPathData = generateBleedZonePath(
        {
          shape,
          width,
          height,
          radius,
          x: cx,
          y: cy,
          holes: absoluteHoles,
          pathData: this.pathData,
        },
        offset,
      );

      // Use solid red for hatch lines to match dieline, background is transparent
      if (showBleedLines !== false) {
        const pattern = this.createHatchPattern("red");
        if (pattern) {
          const bleedObj = new Path(bleedPathData, {
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

      // Offset Dieline Border
      const offsetPathData = generateDielinePath({
        shape,
        width: cutW,
        height: cutH,
        radius: cutR,
        x: cx,
        y: cy,
        holes: absoluteHoles,
        pathData: this.pathData,
      });

      const offsetBorderObj = new Path(offsetPathData, {
        fill: null,
        stroke: "#666", // Grey
        strokeWidth: 1,
        strokeDashArray: [4, 4], // Dashed
        selectable: false,
        evented: false,
        originX: "left",
        originY: "top",
      });
      layer.add(offsetBorderObj);
    }

    // 4. Draw Dieline (Visual Border)
    // This should outline the product shape AND the holes.
    // NOTE: We need to use absoluteHoles (denormalized) here, NOT holes (normalized 0-1)
    // generateDielinePath expects holes to be in absolute coordinates (matching width/height scale)
    const borderPathData = generateDielinePath({
      shape,
      width: width,
      height: height,
      radius: radius,
      x: cx,
      y: cy,
      holes: absoluteHoles, // FIX: Use absoluteHoles instead of holes
      pathData: this.pathData,
    });

    const borderObj = new Path(borderPathData, {
      fill: "transparent",
      stroke: "red",
      strokeWidth: 1,
      strokeDashArray: style === "dashed" ? [5, 5] : undefined,
      selectable: false,
      evented: false,
      originX: "left",
      originY: "top",
    });

    layer.add(borderObj);

    // Enforce z-index: Dieline > User
    const userLayer = this.canvasService.getLayer("user");
    if (layer && userLayer) {
      const layerIndex = this.canvasService.canvas.getObjects().indexOf(layer);
      const userIndex = this.canvasService.canvas
        .getObjects()
        .indexOf(userLayer);
      if (layerIndex < userIndex) {
        this.canvasService.canvas.moveObjectTo(layer, userIndex + 1);
      }
    } else {
      // If no user layer, just bring to front (safe default)
      this.canvasService.canvas.bringObjectToFront(layer);
    }

    // Ensure Ruler is above Dieline if it exists
    const rulerLayer = this.canvasService.getLayer("ruler-overlay");
    if (rulerLayer) {
      this.canvasService.canvas.bringObjectToFront(rulerLayer);
    }

    layer.dirty = true;
    this.canvasService.requestRenderAll();

    // Emit change event so other tools (like HoleTool) can react
    // Only emit if requested (to avoid loops when updating non-geometry props like holes)
    if (emitEvent && this.context) {
      const geometry = this.getGeometry();
      if (geometry) {
        this.context.eventBus.emit("dieline:geometry:change", geometry);
      }
    }
  }

  public getGeometry(): DielineGeometry | null {
    if (!this.canvasService) return null;
    const { shape, width, height, radius, position, borderLength, offset } =
      this;
    const canvasW = this.canvasService.canvas.width || 800;
    const canvasH = this.canvasService.canvas.height || 600;

    let visualWidth = width;
    let visualHeight = height;

    if (borderLength && borderLength > 0) {
      visualWidth = Math.max(0, canvasW - borderLength * 2);
      visualHeight = Math.max(0, canvasH - borderLength * 2);
    }

    const cx = Coordinate.toAbsolute(position?.x ?? 0.5, canvasW);
    const cy = Coordinate.toAbsolute(position?.y ?? 0.5, canvasH);

    return {
      shape,
      x: cx,
      y: cy,
      width: visualWidth,
      height: visualHeight,
      radius,
      offset,
      borderLength,
      pathData: this.pathData,
    };
  }

  public exportCutImage() {
    if (!this.canvasService) return null;
    const canvas = this.canvasService.canvas;

    // 1. Generate Path Data
    const { shape, width, height, radius, position, holes } = this;
    const canvasW = canvas.width || 800;
    const canvasH = canvas.height || 600;
    const cx = Coordinate.toAbsolute(position?.x ?? 0.5, canvasW);
    const cy = Coordinate.toAbsolute(position?.y ?? 0.5, canvasH);

    // Denormalize Holes for Export
    const absoluteHoles = (holes || []).map((h) => {
      const pos = resolveHolePosition(
        h,
        { x: cx, y: cy, width, height },
        { width: canvasW, height: canvasH }
      );
      return {
        ...h,
        x: pos.x,
        y: pos.y,
      };
    });

    const pathData = generateDielinePath({
      shape,
      width,
      height,
      radius,
      x: cx,
      y: cy,
      holes: absoluteHoles,
      pathData: this.pathData,
    });

    // 2. Create Clip Path
    // @ts-ignore
    const clipPath = new Path(pathData, {
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      absolutePositioned: true,
    });

    // 3. Hide UI Layers
    const layer = this.getLayer();
    const wasVisible = layer?.visible ?? true;
    if (layer) layer.visible = false;

    // Hide hole markers
    const holeMarkers = canvas
      .getObjects()
      .filter((o: any) => o.data?.type === "hole-marker");
    holeMarkers.forEach((o) => (o.visible = false));

    // Hide Ruler Overlay
    const rulerLayer = canvas
      .getObjects()
      .find((obj: any) => obj.data?.id === "ruler-overlay");
    const rulerWasVisible = rulerLayer?.visible ?? true;
    if (rulerLayer) rulerLayer.visible = false;

    // 4. Apply Clip & Export
    const originalClip = canvas.clipPath;
    canvas.clipPath = clipPath;

    const bbox = clipPath.getBoundingRect();

    const clipPathCorrected = new Path(pathData, {
      absolutePositioned: true,
      left: 0,
      top: 0,
    });

    const tempPath = new Path(pathData);
    const tempBounds = tempPath.getBoundingRect();

    clipPathCorrected.set({
      left: tempBounds.left,
      top: tempBounds.top,
      originX: "left",
      originY: "top",
    });

    // 4. Apply Clip & Export
    canvas.clipPath = clipPathCorrected;

    const exportBbox = clipPathCorrected.getBoundingRect();
    const dataURL = canvas.toDataURL({
      format: "png",
      multiplier: 2,
      left: exportBbox.left,
      top: exportBbox.top,
      width: exportBbox.width,
      height: exportBbox.height,
    });

    // 5. Restore
    canvas.clipPath = originalClip;
    if (layer) layer.visible = wasVisible;
    if (rulerLayer) rulerLayer.visible = rulerWasVisible;
    holeMarkers.forEach((o) => (o.visible = true));
    canvas.requestRenderAll();

    return dataURL;
  }
}
