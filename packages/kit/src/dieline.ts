import {
  Command,
  Editor,
  EditorState,
  Extension,
  OptionSchema,
  Rect,
  Circle,
  Ellipse,
  Path,
  PooderLayer,
  Pattern,
} from "@pooder/core";
import {
  generateDielinePath,
  generateMaskPath,
  generateBleedZonePath,
  HoleData,
} from "./geometry";

export interface DielineToolOptions {
  shape: "rect" | "circle" | "ellipse";
  width: number;
  height: number;
  radius: number; // corner radius for rect
  position?: { x: number; y: number };
  borderLength?: number;
  offset: number;
  style: "solid" | "dashed";
  insideColor: string;
  outsideColor: string;
  showBleedLines?: boolean;
}

// Alias for compatibility if needed, or just use DielineToolOptions
export type DielineConfig = DielineToolOptions;

export interface DielineGeometry {
  shape: "rect" | "circle" | "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export class DielineTool implements Extension<DielineToolOptions> {
  public name = "DielineTool";
  public options: DielineToolOptions = {
    shape: "rect",
    width: 300,
    height: 300,
    radius: 0,
    offset: 0,
    style: "solid",
    insideColor: "rgba(0,0,0,0)",
    outsideColor: "#ffffff",
    showBleedLines: true,
  };

  public schema: Record<keyof DielineToolOptions, OptionSchema> = {
    shape: {
      type: "select",
      options: ["rect", "circle", "ellipse"],
      label: "Shape",
    },
    width: { type: "number", min: 10, max: 2000, label: "Width" },
    height: { type: "number", min: 10, max: 2000, label: "Height" },
    radius: { type: "number", min: 0, max: 500, label: "Corner Radius" },
    position: { type: "string", label: "Position" }, // Complex object, simplified for now or need custom handler
    borderLength: { type: "number", min: 0, max: 500, label: "Margin" },
    offset: { type: "number", min: -100, max: 100, label: "Bleed Offset" },
    showBleedLines: { type: "boolean", label: "Show Bleed Lines" },
    style: {
      type: "select",
      options: ["solid", "dashed"],
      label: "Line Style",
    },
    insideColor: { type: "color", label: "Inside Color" },
    outsideColor: { type: "color", label: "Outside Color" },
  };

  onMount(editor: Editor) {
    this.createLayer(editor);
    this.updateDieline(editor);
  }

  onUnmount(editor: Editor) {
    this.destroyLayer(editor);
  }

  onUpdate(editor: Editor, state: EditorState) {
    this.updateDieline(editor);
  }

  onDestroy(editor: Editor) {
    this.destroyLayer(editor);
  }

  private getLayer(editor: Editor, id: string) {
    return editor.canvas
      .getObjects()
      .find((obj: any) => obj.data?.id === id) as PooderLayer | undefined;
  }

  private createLayer(editor: Editor) {
    let layer = this.getLayer(editor, "dieline-overlay");

    if (!layer) {
      const width = editor.canvas.width || 800;
      const height = editor.canvas.height || 600;

      layer = new PooderLayer([], {
        width,
        height,
        selectable: false,
        evented: false,
        data: { id: "dieline-overlay" },
      } as any);

      editor.canvas.add(layer);
    }

    editor.canvas.bringObjectToFront(layer);
  }

  private destroyLayer(editor: Editor) {
    const layer = this.getLayer(editor, "dieline-overlay");
    if (layer) {
      editor.canvas.remove(layer);
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

  public updateDieline(editor: Editor) {
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
    } = this.options;
    let { width, height } = this.options;

    const canvasW = editor.canvas.width || 800;
    const canvasH = editor.canvas.height || 600;

    // Handle borderLength (Margin)
    if (borderLength && borderLength > 0) {
      width = Math.max(0, canvasW - borderLength * 2);
      height = Math.max(0, canvasH - borderLength * 2);
    }

    // Handle Position
    const cx = position?.x ?? canvasW / 2;
    const cy = position?.y ?? canvasH / 2;

    const layer = this.getLayer(editor, "dieline-overlay");
    if (!layer) return;

    // Clear existing objects
    layer.remove(...layer.getObjects());

    // Get Hole Tool and Enforce Constraints
    const holeTool = editor.getExtension("HoleTool") as any;
    if (holeTool && typeof holeTool.enforceConstraints === "function") {
      holeTool.enforceConstraints(editor);
    }

    // Get Hole Data
    const holes = holeTool ? holeTool.options.holes || [] : [];
    const innerRadius = holeTool ? holeTool.options.innerRadius || 15 : 15;
    const outerRadius = holeTool ? holeTool.options.outerRadius || 25 : 25;

    const holeData: HoleData[] = holes.map((h: any) => ({
      x: h.x,
      y: h.y,
      innerRadius,
      outerRadius,
    }));

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
      holes: holeData,
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

    // 2. Draw Inside Fill (Dieline Shape itself, merged with holes if needed, or just the shape?)
    // The user wants "fusion effect" so holes should be part of the dieline visually.
    // If insideColor is transparent, it doesn't matter much.
    // If insideColor is opaque, we need to punch holes in it too.
    // Let's use Paper.js for this too if insideColor is not transparent.

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
        holes: holeData,
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
          holes: holeData,
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
        holes: holeData,
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
    // Paper.js `generateDielinePath` returns exactly this (Dieline - Holes).

    const borderPathData = generateDielinePath({
      shape,
      width: width,
      height: height,
      radius: radius,
      x: cx,
      y: cy,
      holes: holeData,
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

    editor.canvas.requestRenderAll();
  }

  commands: Record<string, Command> = {
    reset: {
      execute: (editor: Editor) => {
        this.options = {
          shape: "rect",
          width: 300,
          height: 300,
          radius: 0,
          offset: 0,
          style: "solid",
          insideColor: "rgba(0,0,0,0)",
          outsideColor: "#ffffff",
          showBleedLines: true,
        };
        this.updateDieline(editor);
        return true;
      },
    },
    destroy: {
      execute: (editor: Editor) => {
        this.destroyLayer(editor);
        return true;
      },
    },
    setDimensions: {
      execute: (editor: Editor, width: number, height: number) => {
        if (this.options.width === width && this.options.height === height)
          return true;
        this.options.width = width;
        this.options.height = height;
        this.updateDieline(editor);
        return true;
      },
      schema: {
        width: {
          type: "number",
          label: "Width",
          min: 10,
          max: 2000,
          required: true,
        },
        height: {
          type: "number",
          label: "Height",
          min: 10,
          max: 2000,
          required: true,
        },
      },
    },
    setShape: {
      execute: (editor: Editor, shape: "rect" | "circle" | "ellipse") => {
        if (this.options.shape === shape) return true;
        this.options.shape = shape;
        this.updateDieline(editor);
        return true;
      },
      schema: {
        shape: {
          type: "string",
          label: "Shape",
          options: ["rect", "circle", "ellipse"],
          required: true,
        },
      },
    },
    setBleed: {
      execute: (editor: Editor, bleed: number) => {
        if (this.options.offset === bleed) return true;
        this.options.offset = bleed;
        this.updateDieline(editor);
        return true;
      },
      schema: {
        bleed: {
          type: "number",
          label: "Bleed",
          min: -100,
          max: 100,
          required: true,
        },
      },
    },
    exportCutImage: {
      execute: (editor: Editor) => {
        // 1. Generate Path Data
        const { shape, width, height, radius, position } = this.options;
        const canvasW = editor.canvas.width || 800;
        const canvasH = editor.canvas.height || 600;
        const cx = position?.x ?? canvasW / 2;
        const cy = position?.y ?? canvasH / 2;

        const holeTool = editor.getExtension("HoleTool") as any;
        const holes = holeTool ? holeTool.options.holes || [] : [];
        const innerRadius = holeTool ? holeTool.options.innerRadius || 15 : 15;
        const outerRadius = holeTool ? holeTool.options.outerRadius || 25 : 25;
        const holeData = holes.map((h: any) => ({
          x: h.x,
          y: h.y,
          innerRadius,
          outerRadius,
        }));

        const pathData = generateDielinePath({
          shape,
          width,
          height,
          radius,
          x: cx,
          y: cy,
          holes: holeData,
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
        const layer = this.getLayer(editor, "dieline-overlay");
        const wasVisible = layer?.visible ?? true;
        if (layer) layer.visible = false;

        // Hide hole markers
        const holeMarkers = editor.canvas
          .getObjects()
          .filter((o: any) => o.data?.type === "hole-marker");
        holeMarkers.forEach((o) => (o.visible = false));

        // Hide Ruler Overlay
        const rulerLayer = editor.canvas
          .getObjects()
          .find((obj: any) => obj.data?.id === "ruler-overlay");
        const rulerWasVisible = rulerLayer?.visible ?? true;
        if (rulerLayer) rulerLayer.visible = false;

        // 4. Apply Clip & Export
        const originalClip = editor.canvas.clipPath;
        editor.canvas.clipPath = clipPath;

        const bbox = clipPath.getBoundingRect();
        // Adjust hole coordinates to be relative to the bounding box
        const holeDataRelative = holes.map((h: any) => ({
          x: h.x - bbox.left,
          y: h.y - bbox.top,
          innerRadius,
          outerRadius,
        }));

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
        editor.canvas.clipPath = clipPathCorrected;

        const exportBbox = clipPathCorrected.getBoundingRect();
        const dataURL = editor.canvas.toDataURL({
          format: "png",
          multiplier: 2,
          left: exportBbox.left,
          top: exportBbox.top,
          width: exportBbox.width,
          height: exportBbox.height,
        });

        // 5. Restore
        editor.canvas.clipPath = originalClip;
        if (layer) layer.visible = wasVisible;
        if (rulerLayer) rulerLayer.visible = rulerWasVisible;
        holeMarkers.forEach((o) => (o.visible = true));
        editor.canvas.requestRenderAll();

        return dataURL;
      },
    },
  };

  public getGeometry(editor: Editor): DielineGeometry | null {
    const { shape, width, height, radius, position, borderLength } =
      this.options;
    const canvasW = editor.canvas.width || 800;
    const canvasH = editor.canvas.height || 600;

    let visualWidth = width;
    let visualHeight = height;

    if (borderLength && borderLength > 0) {
      visualWidth = Math.max(0, canvasW - borderLength * 2);
      visualHeight = Math.max(0, canvasH - borderLength * 2);
    }

    const cx = position?.x ?? canvasW / 2;
    const cy = position?.y ?? canvasH / 2;

    return {
      shape,
      x: cx,
      y: cy,
      width: visualWidth,
      height: visualHeight,
      radius,
    };
  }
}
