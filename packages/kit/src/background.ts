import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
} from "@pooder/core";
import { Rect, FabricImage as Image } from "fabric";
import CanvasService from "./CanvasService";

export class BackgroundTool implements Extension {
  id = "pooder.kit.background";
  public metadata = {
    name: "BackgroundTool",
  };

  private color: string = "";
  private url: string = "";

  private canvasService?: CanvasService;

  constructor(
    options?: Partial<{
      color: string;
      url: string;
    }>,
  ) {
    if (options) {
      Object.assign(this, options);
    }
  }

  activate(context: ExtensionContext) {
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    if (!this.canvasService) {
      console.warn("CanvasService not found for BackgroundTool");
      return;
    }

    const configService = context.services.get<any>("ConfigurationService");
    if (configService) {
      // Load initial config
      this.color = configService.get("background.color", this.color);
      this.url = configService.get("background.url", this.url);

      // Listen for changes
      configService.onAnyChange((e: { key: string; value: any }) => {
        if (e.key.startsWith("background.")) {
          const prop = e.key.split(".")[1];
          console.log(
            `[BackgroundTool] Config change detected: ${e.key} -> ${e.value}, prop: ${prop}`,
          );
          if (prop && prop in this) {
            console.log(
              `[BackgroundTool] Updating option ${prop} to ${e.value}`,
            );
            (this as any)[prop] = e.value;
            this.updateBackground();
          } else {
            console.warn(
              `[BackgroundTool] Property ${prop} not found in options`,
            );
          }
        }
      });
    }

    this.initLayer();
    this.updateBackground();
  }

  deactivate(context: ExtensionContext) {
    if (this.canvasService) {
      const layer = this.canvasService.getLayer("background");
      if (layer) {
        this.canvasService.canvas.remove(layer);
      }
      this.canvasService = undefined;
    }
  }

  contribute() {
    return {
      [ContributionPointIds.CONFIGURATIONS]: [
        {
          id: "background.color",
          type: "color",
          label: "Background Color",
          default: "",
        },
        {
          id: "background.url",
          type: "string",
          label: "Image URL",
          default: "",
        },
      ] as ConfigurationContribution[],
      [ContributionPointIds.COMMANDS]: [
        {
          command: "reset",
          title: "Reset Background",
          handler: () => {
            this.updateBackground();
            return true;
          },
        },
        {
          command: "clear",
          title: "Clear Background",
          handler: () => {
            this.color = "transparent";
            this.url = "";
            this.updateBackground();
            return true;
          },
        },
        {
          command: "setBackgroundColor",
          title: "Set Background Color",
          handler: (color: string) => {
            if (this.color === color) return true;
            this.color = color;
            this.updateBackground();
            return true;
          },
        },
        {
          command: "setBackgroundImage",
          title: "Set Background Image",
          handler: (url: string) => {
            if (this.url === url) return true;
            this.url = url;
            this.updateBackground();
            return true;
          },
        },
      ] as CommandContribution[],
    };
  }

  private initLayer() {
    if (!this.canvasService) return;
    let backgroundLayer = this.canvasService.getLayer("background");
    if (!backgroundLayer) {
      backgroundLayer = this.canvasService.createLayer("background", {
        width: this.canvasService.canvas.width,
        height: this.canvasService.canvas.height,
        selectable: false,
        evented: false,
      });
      this.canvasService.canvas.sendObjectToBack(backgroundLayer);
    }
  }

  private async updateBackground() {
    if (!this.canvasService) return;
    const layer = this.canvasService.getLayer("background");
    if (!layer) {
      console.warn("[BackgroundTool] Background layer not found");
      return;
    }

    const { color, url } = this;

    const width = this.canvasService.canvas.width || 800;
    const height = this.canvasService.canvas.height || 600;

    let rect = this.canvasService.getObject(
      "background-color-rect",
      "background",
    ) as Rect;
    if (rect) {
      rect.set({
        fill: color,
      });
    } else {
      rect = new Rect({
        width,
        height,
        fill: color,
        selectable: false,
        evented: false,
        data: {
          id: "background-color-rect",
        },
      });
      layer.add(rect);
      layer.sendObjectToBack(rect);
    }

    let img = this.canvasService.getObject(
      "background-image",
      "background",
    ) as Image;
    try {
      if (img) {
        if (img.getSrc() !== url) {
          if (url) {
            await img.setSrc(url);
          } else {
            layer.remove(img);
          }
        }
      } else {
        if (url) {
          img = await Image.fromURL(url, { crossOrigin: "anonymous" });
          img.set({
            originX: "left",
            originY: "top",
            left: 0,
            top: 0,
            selectable: false,
            evented: false,
            data: {
              id: "background-image",
            },
          });
          img.scaleToWidth(width);
          if (img.getScaledHeight() < height) img.scaleToHeight(height);
          layer.add(img);
        }
      }
      this.canvasService.requestRenderAll();
    } catch (e) {
      console.error("[BackgroundTool] Failed to load image", e);
    }
    layer.dirty = true;
    this.canvasService.requestRenderAll();
  }
}
