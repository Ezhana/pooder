import {
  Command,
  Editor,
  EditorState,
  Extension,
  Image,
  OptionSchema,
  PooderLayer,
} from "@pooder/core";

interface FilmToolOptions {
  url: string;
  opacity: number;
}

export class FilmTool implements Extension<FilmToolOptions> {
  public name = "FilmTool";
  public options: FilmToolOptions = {
    url: "",
    opacity: 0.5,
  };

  public schema: Record<keyof FilmToolOptions, OptionSchema> = {
    url: {
      type: "string",
      label: "Film Image URL",
    },
    opacity: {
      type: "number",
      min: 0,
      max: 1,
      step: 0.1,
      label: "Opacity",
    },
  };

  onMount(editor: Editor) {
    this.initLayer(editor);
    this.updateFilm(editor, this.options);
  }

  onUnmount(editor: Editor) {
    const layer = editor.getLayer("overlay");
    if (layer) {
      const img = editor.getObject("film-image", "overlay");
      if (img) {
        layer.remove(img);
        editor.canvas.requestRenderAll();
      }
    }
  }

  onUpdate(editor: Editor, state: EditorState) {
    this.updateFilm(editor, this.options);
  }

  private initLayer(editor: Editor) {
    let overlayLayer = editor.getLayer("overlay");
    if (!overlayLayer) {
      const width = editor.state.width;
      const height = editor.state.height;

      const layer = new PooderLayer([], {
        width,
        height,
        left: 0,
        top: 0,
        originX: "left",
        originY: "top",
        selectable: false,
        evented: false,
        subTargetCheck: false,
        interactive: false,
        data: {
          id: "overlay",
        },
      });

      editor.canvas.add(layer);
      editor.canvas.bringObjectToFront(layer);
    }
  }

  private async updateFilm(editor: Editor, options: FilmToolOptions) {
    const layer = editor.getLayer("overlay");
    if (!layer) {
      console.warn("[FilmTool] Overlay layer not found");
      return;
    }

    const { url, opacity } = options;

    if (!url) {
      const img = editor.getObject("film-image", "overlay");
      if (img) {
        layer.remove(img);
        editor.canvas.requestRenderAll();
      }
      return;
    }

    const width = editor.state.width;
    const height = editor.state.height;

    let img = editor.getObject("film-image", "overlay") as Image;
    try {
      if (img) {
        if (img.getSrc() !== url) {
          await img.setSrc(url);
        }
        img.set({ opacity });
      } else {
        img = await Image.fromURL(url, { crossOrigin: "anonymous" });
        img.scaleToWidth(width);
        if (img.getScaledHeight() < height) img.scaleToHeight(height);
        img.set({
          originX: "left",
          originY: "top",
          left: 0,
          top: 0,
          opacity,
          selectable: false,
          evented: false,
          data: { id: "film-image" },
        });
        layer.add(img);
      }
      editor.canvas.requestRenderAll();
    } catch (error) {
      console.error("[FilmTool] Failed to load film image", url, error);
    }
  }

  commands: Record<string, Command> = {
    setFilmImage: {
      execute: (editor: Editor, url: string, opacity: number) => {
        if (this.options.url === url && this.options.opacity === opacity)
          return true;

        this.options.url = url;
        this.options.opacity = opacity;

        this.updateFilm(editor, this.options);

        return true;
      },
      schema: {
        url: {
          type: "string",
          label: "Image URL",
          required: true,
        },
        opacity: {
          type: "number",
          label: "Opacity",
          min: 0,
          max: 1,
          required: true,
        },
      },
    },
  };
}
