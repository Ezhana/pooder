import {
  Command,
  Editor,
  EditorState,
  Extension,
  OptionSchema,
  PooderLayer,
  Rect,
  Line,
  Text,
} from "@pooder/core";

export interface RulerToolOptions {
  unit: "px" | "mm" | "cm" | "in";
  thickness: number;
  backgroundColor: string;
  textColor: string;
  lineColor: string;
  fontSize: number;
}

export class RulerTool implements Extension<RulerToolOptions> {
  public name = "RulerTool";
  public options: RulerToolOptions = {
    unit: "px",
    thickness: 20,
    backgroundColor: "#f0f0f0",
    textColor: "#333333",
    lineColor: "#999999",
    fontSize: 10,
  };

  public schema: Record<keyof RulerToolOptions, OptionSchema> = {
    unit: {
      type: "select",
      options: ["px", "mm", "cm", "in"],
      label: "Unit",
    },
    thickness: { type: "number", min: 10, max: 100, label: "Thickness" },
    backgroundColor: { type: "color", label: "Background Color" },
    textColor: { type: "color", label: "Text Color" },
    lineColor: { type: "color", label: "Line Color" },
    fontSize: { type: "number", min: 8, max: 24, label: "Font Size" },
  };

  onMount(editor: Editor) {
    this.createLayer(editor);
    this.updateRuler(editor);
  }

  onUnmount(editor: Editor) {
    this.destroyLayer(editor);
  }

  onUpdate(editor: Editor, state: EditorState) {
    this.updateRuler(editor);
  }

  onDestroy(editor: Editor) {
    this.destroyLayer(editor);
  }

  private getLayer(editor: Editor) {
    return editor.canvas
      .getObjects()
      .find((obj: any) => obj.data?.id === "ruler-overlay") as
      | PooderLayer
      | undefined;
  }

  private createLayer(editor: Editor) {
    let layer = this.getLayer(editor);

    if (!layer) {
      const width = editor.canvas.width || 800;
      const height = editor.canvas.height || 600;

      layer = new PooderLayer([], {
        width,
        height,
        selectable: false,
        evented: false,
        data: { id: "ruler-overlay" },
      } as any);

      editor.canvas.add(layer);
    }

    editor.canvas.bringObjectToFront(layer);
  }

  private destroyLayer(editor: Editor) {
    const layer = this.getLayer(editor);
    if (layer) {
      editor.canvas.remove(layer);
    }
  }

  private updateRuler(editor: Editor) {
    const layer = this.getLayer(editor);
    if (!layer) return;

    layer.remove(...layer.getObjects());

    const { thickness, backgroundColor, lineColor, textColor, fontSize } =
      this.options;
    const width = editor.canvas.width || 800;
    const height = editor.canvas.height || 600;

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

    layer.add(topBg, leftBg, cornerBg);

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
    editor.canvas.bringObjectToFront(layer);
    editor.canvas.requestRenderAll();
  }

  commands: Record<string, Command> = {
    setUnit: {
      execute: (editor: Editor, unit: "px" | "mm" | "cm" | "in") => {
        if (this.options.unit === unit) return true;
        this.options.unit = unit;
        this.updateRuler(editor);
        return true;
      },
      schema: {
        unit: {
          type: "string",
          label: "Unit",
          options: ["px", "mm", "cm", "in"],
          required: true,
        },
      },
    },
    setTheme: {
      execute: (editor: Editor, theme: Partial<RulerToolOptions>) => {
        const newOptions = { ...this.options, ...theme };
        if (JSON.stringify(newOptions) === JSON.stringify(this.options))
          return true;

        this.options = newOptions;
        this.updateRuler(editor);
        return true;
      },
      schema: {
        theme: {
          type: "object",
          label: "Theme",
          required: true,
        },
      },
    },
  };
}
