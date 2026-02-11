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
import { computeDetectEdgeSize } from "./edgeScale";
import { Unit } from "./coordinate";
import { parseLengthToMm } from "./units";
import {
  generateDielinePath,
  generateMaskPath,
  generateBleedZonePath,
  DielineFeature,
} from "./geometry";

export interface DielineGeometry {
  shape: "rect" | "circle" | "ellipse" | "custom";
  unit: "mm";
  displayUnit: Unit;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  offset: number;
  borderLength?: number;
  scale?: number;
  strokeWidth?: number;
  pathData?: string;
}

export interface LineStyle {
  width: number;
  color: string;
  dashLength: number;
  style: "solid" | "dashed" | "hidden";
}

export interface DielineState {
  displayUnit: Unit;
  shape: "rect" | "circle" | "ellipse" | "custom";
  width: number;
  height: number;
  radius: number;
  offset: number;
  padding: number | string;
  mainLine: LineStyle;
  offsetLine: LineStyle;
  insideColor: string;
  outsideColor: string;
  showBleedLines: boolean;
  features: DielineFeature[];
  pathData?: string;
}

export class DielineTool implements Extension {
  id = "pooder.kit.dieline";
  public metadata = {
    name: "DielineTool",
  };

  private state: DielineState = {
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

  private canvasService?: CanvasService;
  private context?: ExtensionContext;

  constructor(options?: Partial<DielineState>) {
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
      const s = this.state;
      s.displayUnit = configService.get("dieline.displayUnit", s.displayUnit);
      s.shape = configService.get("dieline.shape", s.shape);
      s.width = parseLengthToMm(
        configService.get("dieline.width", s.width),
        "mm",
      );
      s.height = parseLengthToMm(
        configService.get("dieline.height", s.height),
        "mm",
      );
      s.radius = parseLengthToMm(
        configService.get("dieline.radius", s.radius),
        "mm",
      );
      s.padding = configService.get("dieline.padding", s.padding);
      s.offset = parseLengthToMm(
        configService.get("dieline.offset", s.offset),
        "mm",
      );

      // Main Line
      s.mainLine.width = configService.get(
        "dieline.strokeWidth",
        s.mainLine.width,
      );
      s.mainLine.color = configService.get(
        "dieline.strokeColor",
        s.mainLine.color,
      );
      s.mainLine.dashLength = configService.get(
        "dieline.dashLength",
        s.mainLine.dashLength,
      );
      s.mainLine.style = configService.get("dieline.style", s.mainLine.style);

      // Offset Line
      s.offsetLine.width = configService.get(
        "dieline.offsetStrokeWidth",
        s.offsetLine.width,
      );
      s.offsetLine.color = configService.get(
        "dieline.offsetStrokeColor",
        s.offsetLine.color,
      );
      s.offsetLine.dashLength = configService.get(
        "dieline.offsetDashLength",
        s.offsetLine.dashLength,
      );
      s.offsetLine.style = configService.get(
        "dieline.offsetStyle",
        s.offsetLine.style,
      );

      s.insideColor = configService.get("dieline.insideColor", s.insideColor);
      s.outsideColor = configService.get(
        "dieline.outsideColor",
        s.outsideColor,
      );
      s.showBleedLines = configService.get(
        "dieline.showBleedLines",
        s.showBleedLines,
      );
      s.features = configService.get("dieline.features", s.features);
      s.pathData = configService.get("dieline.pathData", s.pathData);

      // Listen for changes
      configService.onAnyChange((e: { key: string; value: any }) => {
        if (e.key.startsWith("dieline.")) {
          switch (e.key) {
            case "dieline.displayUnit":
              s.displayUnit = e.value;
              break;
            case "dieline.shape":
              s.shape = e.value;
              break;
            case "dieline.width":
              s.width = parseLengthToMm(e.value, "mm");
              break;
            case "dieline.height":
              s.height = parseLengthToMm(e.value, "mm");
              break;
            case "dieline.radius":
              s.radius = parseLengthToMm(e.value, "mm");
              break;
            case "dieline.padding":
              s.padding = e.value;
              break;
            case "dieline.offset":
              s.offset = parseLengthToMm(e.value, "mm");
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

    this.createLayer();
    this.updateDieline();
  }

  deactivate(context: ExtensionContext) {
    this.destroyLayer();
    this.canvasService = undefined;
    this.context = undefined;
  }

  contribute() {
    const s = this.state;
    return {
      [ContributionPointIds.CONFIGURATIONS]: [
        {
          id: "dieline.displayUnit",
          type: "select",
          label: "Display Unit",
          options: ["mm", "cm", "in"],
          default: s.displayUnit,
        },
        {
          id: "dieline.shape",
          type: "select",
          label: "Shape",
          options: ["rect", "circle", "ellipse", "custom"],
          default: s.shape,
        },
        {
          id: "dieline.width",
          type: "number",
          label: "Width (mm)",
          min: 10,
          max: 2000,
          default: s.width,
        },
        {
          id: "dieline.height",
          type: "number",
          label: "Height (mm)",
          min: 10,
          max: 2000,
          default: s.height,
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
          id: "dieline.padding",
          type: "select",
          label: "View Padding",
          options: [0, 10, 20, 40, 60, 100, "2%", "5%", "10%", "15%", "20%"],
          default: s.padding,
        },
        {
          id: "dieline.offset",
          type: "number",
          label: "Bleed Offset (mm)",
          min: -100,
          max: 100,
          default: s.offset,
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
      ] as ConfigurationContribution[],
      [ContributionPointIds.COMMANDS]: [
        {
          command: "updateFeaturePosition",
          title: "Update Feature Position",
          handler: (groupId: string, x: number, y: number) => {
            const configService = this.context?.services.get<any>(
              "ConfigurationService",
            );
            if (!configService) return;

            const features = configService.get("dieline.features") || [];

            let changed = false;
            const newFeatures = features.map((f: any) => {
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
              // Helper to get image dimensions
              const loadImage = (url: string): Promise<HTMLImageElement> => {
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
                ImageTracer.traceWithBounds(imageUrl, options),
              ]);
              const { pathData, baseBounds, bounds } = traced;

              const currentMax = Math.max(s.width, s.height);
              const { width: newWidth, height: newHeight } = computeDetectEdgeSize(
                currentMax,
                baseBounds,
                bounds,
              );

              return {
                pathData,
                width: newWidth,
                height: newHeight,
                rawBounds: bounds,
                baseBounds,
                imageWidth: img.width,
                imageHeight: img.height,
              };
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

  private resolvePadding(
    containerWidth: number,
    containerHeight: number,
  ): number {
    if (typeof this.state.padding === "number") {
      return this.state.padding;
    }
    if (typeof this.state.padding === "string") {
      if (this.state.padding.endsWith("%")) {
        const percent = parseFloat(this.state.padding) / 100;
        return Math.min(containerWidth, containerHeight) * percent;
      }
      return parseFloat(this.state.padding) || 0;
    }
    return 0;
  }

  public updateDieline(emitEvent: boolean = true) {
    if (!this.canvasService) return;
    const layer = this.getLayer();
    if (!layer) return;

    const {
      displayUnit,
      shape,
      radius,
      offset,
      mainLine,
      offsetLine,
      insideColor,
      outsideColor,
      showBleedLines,
      features,
    } = this.state;
    const { width, height } = this.state;

    const canvasW = this.canvasService.canvas.width || 800;
    const canvasH = this.canvasService.canvas.height || 600;

    // Calculate Layout based on Physical Dimensions and Canvas Size
    // Add padding to avoid edge hugging
    const paddingPx = this.resolvePadding(canvasW, canvasH);

    // Update Viewport System
    this.canvasService.viewport.setPadding(paddingPx);
    this.canvasService.viewport.updatePhysical(width, height);

    const layout = this.canvasService.viewport.layout;

    const scale = layout.scale;
    const cx = layout.offsetX + layout.width / 2;
    const cy = layout.offsetY + layout.height / 2;

    // Scaled dimensions for rendering (Pixels)
    const visualWidth = layout.width;
    const visualHeight = layout.height;
    const visualRadius = radius * scale;
    const visualOffset = offset * scale;

    // Clear existing objects
    layer.remove(...layer.getObjects());

    // Scale Features for Geometry Generation
    const absoluteFeatures = (features || []).map((f) => {
      const featureScale = scale;

      return {
        ...f,
        x: f.x,
        y: f.y,
        width: (f.width || 0) * featureScale,
        height: (f.height || 0) * featureScale,
        radius: (f.radius || 0) * featureScale,
      };
    });

    // Split features into Cut (Physical) and Visual (All)
    const cutFeatures = absoluteFeatures.filter((f) => !f.skipCut);

    // 1. Draw Mask (Outside)
    const cutW = Math.max(0, visualWidth + visualOffset * 2);
    const cutH = Math.max(0, visualHeight + visualOffset * 2);
    const cutR =
      visualRadius === 0 ? 0 : Math.max(0, visualRadius + visualOffset);

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
      features: cutFeatures,
      pathData: this.state.pathData,
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

    // 2. Draw Inside Fill (Dieline Shape itself, merged with features if needed)
    if (
      insideColor &&
      insideColor !== "transparent" &&
      insideColor !== "rgba(0,0,0,0)"
    ) {
      // Generate path for the product shape (Paper) = Dieline +/- Features
      const productPathData = generateDielinePath({
        shape,
        width: cutW,
        height: cutH,
        radius: cutR,
        x: cx,
        y: cy,
        features: cutFeatures, // Use same features as mask for consistency
        pathData: this.state.pathData,
        canvasWidth: canvasW,
        canvasHeight: canvasH,
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
          width: visualWidth,
          height: visualHeight,
          radius: visualRadius,
          x: cx,
          y: cy,
          features: cutFeatures,
          pathData: this.state.pathData,
          canvasWidth: canvasW,
          canvasHeight: canvasH,
        },
        {
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
        },
        visualOffset,
      );

      // Use solid red for hatch lines to match dieline, background is transparent
      if (showBleedLines !== false) {
        const pattern = this.createHatchPattern(mainLine.color);
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
        features: cutFeatures,
        pathData: this.state.pathData,
        canvasWidth: canvasW,
        canvasHeight: canvasH,
      });

      const offsetBorderObj = new Path(offsetPathData, {
        fill: null,
        stroke: offsetLine.style === "hidden" ? null : offsetLine.color,
        strokeWidth: offsetLine.width,
        strokeDashArray:
          offsetLine.style === "dashed"
            ? [offsetLine.dashLength, offsetLine.dashLength]
            : undefined,
        selectable: false,
        evented: false,
        originX: "left",
        originY: "top",
      });
      layer.add(offsetBorderObj);
    }

    // 4. Draw Dieline (Visual Border)
    const borderPathData = generateDielinePath({
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

    const borderObj = new Path(borderPathData, {
      fill: "transparent",
      stroke: mainLine.style === "hidden" ? null : mainLine.color,
      strokeWidth: mainLine.width,
      strokeDashArray:
        mainLine.style === "dashed"
          ? [mainLine.dashLength, mainLine.dashLength]
          : undefined,
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

    // Emit change event so other tools (like FeatureTool) can react
    if (emitEvent && this.context) {
      const geometry = this.getGeometry();
      if (geometry) {
        this.context.eventBus.emit("dieline:geometry:change", geometry);
      }
    }
  }

  public getGeometry(): DielineGeometry | null {
    if (!this.canvasService) return null;
    const {
      displayUnit,
      shape,
      width,
      height,
      radius,
      offset,
      mainLine,
      pathData,
    } = this.state;
    const canvasW = this.canvasService.canvas.width || 800;
    const canvasH = this.canvasService.canvas.height || 600;

    const paddingPx = this.resolvePadding(canvasW, canvasH);

    // Update Viewport System (Ensure it's up to date)
    this.canvasService.viewport.setPadding(paddingPx);
    this.canvasService.viewport.updatePhysical(width, height);

    const layout = this.canvasService.viewport.layout;

    const scale = layout.scale;
    const cx = layout.offsetX + layout.width / 2;
    const cy = layout.offsetY + layout.height / 2;

    const visualWidth = layout.width;
    const visualHeight = layout.height;

    return {
      shape,
      unit: "mm",
      displayUnit,
      x: cx,
      y: cy,
      width: visualWidth,
      height: visualHeight,
      radius: radius * scale,
      offset: offset * scale,
      scale,
      strokeWidth: mainLine.width,
      pathData,
    } as DielineGeometry;
  }

  public async exportCutImage() {
    if (!this.canvasService) return null;
    const userLayer = this.canvasService.getLayer("user");

    if (!userLayer) return null;

    // 1. Generate Path Data
    const { shape, width, height, radius, features, pathData } = this.state;
    const canvasW = this.canvasService.canvas.width || 800;
    const canvasH = this.canvasService.canvas.height || 600;

    const paddingPx = this.resolvePadding(canvasW, canvasH);

    // Update Viewport System
    this.canvasService.viewport.setPadding(paddingPx);
    this.canvasService.viewport.updatePhysical(width, height);

    const layout = this.canvasService.viewport.layout;
    const scale = layout.scale;
    const cx = layout.offsetX + layout.width / 2;
    const cy = layout.offsetY + layout.height / 2;
    const visualWidth = layout.width;
    const visualHeight = layout.height;
    const visualRadius = radius * scale;

    // Scale Features
    const absoluteFeatures = (features || []).map((f) => {
      const featureScale = scale;

      return {
        ...f,
        x: f.x,
        y: f.y,
        width: (f.width || 0) * featureScale,
        height: (f.height || 0) * featureScale,
        radius: (f.radius || 0) * featureScale,
      };
    });

    const cutFeatures = absoluteFeatures.filter((f) => !f.skipCut);

    const generatedPathData = generateDielinePath({
      shape,
      width: visualWidth,
      height: visualHeight,
      radius: visualRadius,
      x: cx,
      y: cy,
      features: cutFeatures,
      pathData,
      canvasWidth: canvasW,
      canvasHeight: canvasH,
    });

    // 2. Prepare for Export
    const clonedLayer = await userLayer.clone();

    const clipPath = new Path(generatedPathData, {
      originX: "left",
      originY: "top",
      left: 0,
      top: 0,
      absolutePositioned: true,
    });

    clonedLayer.clipPath = clipPath;

    // 3. Calculate Crop Area (The Dieline Bounds)
    const bounds = clipPath.getBoundingRect();

    // 4. Export
    const dataUrl = clonedLayer.toDataURL({
      format: "png",
      multiplier: 2,
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    });

    return dataUrl;
  }
}
