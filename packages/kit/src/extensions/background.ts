import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
  ConfigurationService,
} from "@pooder/core";
import { FabricImage } from "fabric";
import { CanvasService, RenderObjectSpec } from "../services";

interface SourceSize {
  width: number;
  height: number;
}

const BACKGROUND_LAYER_ID = "background";
const BACKGROUND_RECT_ID = "background-color-rect";
const BACKGROUND_IMAGE_ID = "background-image";
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

export class BackgroundTool implements Extension {
  id = "pooder.kit.background";
  public metadata = {
    name: "BackgroundTool",
  };

  private color: string = "";
  private url: string = "";

  private canvasService?: CanvasService;
  private specs: RenderObjectSpec[] = [];
  private renderProducerDisposable?: { dispose: () => void };
  private renderSeq = 0;
  private renderImageUrl = "";
  private sourceSizeBySrc: Map<string, SourceSize> = new Map();
  private pendingSizeBySrc: Map<string, Promise<SourceSize | null>> = new Map();
  private onCanvasResized = () => {
    this.updateBackground();
  };

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

    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = this.canvasService.registerRenderProducer(
      this.id,
      () => ({
        layerSpecs: {
          [BACKGROUND_LAYER_ID]: this.specs,
        },
      }),
      { priority: 0 },
    );

    const configService = context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
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

    context.eventBus.on("canvas:resized", this.onCanvasResized);
    this.updateBackground();
  }

  deactivate(context: ExtensionContext) {
    context.eventBus.off("canvas:resized", this.onCanvasResized);
    this.renderSeq += 1;
    this.specs = [];
    this.renderImageUrl = "";
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = undefined;
    if (!this.canvasService) return;
    const layer = this.canvasService.getLayer(BACKGROUND_LAYER_ID);
    if (layer) {
      this.canvasService.canvas.remove(layer);
    }
    void this.canvasService.flushRenderFromProducers();
    this.canvasService.requestRenderAll();
    this.canvasService = undefined;
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

  private getViewportSize(): { width: number; height: number } {
    const width = Number(this.canvasService?.canvas.width || 0);
    const height = Number(this.canvasService?.canvas.height || 0);
    return {
      width: width > 0 ? width : DEFAULT_WIDTH,
      height: height > 0 ? height : DEFAULT_HEIGHT,
    };
  }

  private buildBackgroundSpecs(
    color: string,
    imageUrl: string,
  ): RenderObjectSpec[] {
    const { width, height } = this.getViewportSize();
    const specs: RenderObjectSpec[] = [
      {
        id: BACKGROUND_RECT_ID,
        type: "rect",
        space: "screen",
        data: {
          id: BACKGROUND_RECT_ID,
          layerId: BACKGROUND_LAYER_ID,
          type: "background-color",
        },
        props: {
          left: 0,
          top: 0,
          width,
          height,
          originX: "left",
          originY: "top",
          fill: color,
          selectable: false,
          evented: false,
          excludeFromExport: true,
        },
      },
    ];

    if (!imageUrl) {
      return specs;
    }

    const sourceSize = this.sourceSizeBySrc.get(imageUrl);
    const sourceWidth = Math.max(1, Number(sourceSize?.width || width));
    const sourceHeight = Math.max(1, Number(sourceSize?.height || height));
    const coverScale = Math.max(width / sourceWidth, height / sourceHeight);
    specs.push({
      id: BACKGROUND_IMAGE_ID,
      type: "image",
      src: imageUrl,
      space: "screen",
      data: {
        id: BACKGROUND_IMAGE_ID,
        layerId: BACKGROUND_LAYER_ID,
        type: "background-image",
      },
      props: {
        left: 0,
        top: 0,
        originX: "left",
        originY: "top",
        scaleX: coverScale,
        scaleY: coverScale,
        selectable: false,
        evented: false,
        excludeFromExport: true,
      },
    });

    return specs;
  }

  private async ensureImageSize(src: string): Promise<SourceSize | null> {
    if (!src) return null;
    const cached = this.sourceSizeBySrc.get(src);
    if (cached) return cached;

    const pending = this.pendingSizeBySrc.get(src);
    if (pending) {
      return pending;
    }

    const task = this.loadImageSize(src);
    this.pendingSizeBySrc.set(src, task);
    try {
      return await task;
    } finally {
      if (this.pendingSizeBySrc.get(src) === task) {
        this.pendingSizeBySrc.delete(src);
      }
    }
  }

  private async loadImageSize(src: string): Promise<SourceSize | null> {
    try {
      const image = await FabricImage.fromURL(src, {
        crossOrigin: "anonymous",
      });
      const width = Number(image?.width || 0);
      const height = Number(image?.height || 0);
      if (width > 0 && height > 0) {
        const size = { width, height };
        this.sourceSizeBySrc.set(src, size);
        return size;
      }
    } catch (error) {
      console.error("[BackgroundTool] Failed to load image", src, error);
    }
    return null;
  }

  private updateBackground() {
    void this.updateBackgroundAsync();
  }

  private async updateBackgroundAsync() {
    if (!this.canvasService) return;
    const seq = ++this.renderSeq;
    const color = this.color;
    const nextUrl = String(this.url || "").trim();

    if (!nextUrl) {
      this.renderImageUrl = "";
    } else if (nextUrl !== this.renderImageUrl) {
      const loaded = await this.ensureImageSize(nextUrl);
      if (seq !== this.renderSeq) return;
      if (loaded) {
        this.renderImageUrl = nextUrl;
      }
    }

    this.specs = this.buildBackgroundSpecs(color, this.renderImageUrl);
    await this.canvasService.flushRenderFromProducers();
    if (seq !== this.renderSeq) return;
    const layer = this.canvasService.getLayer(BACKGROUND_LAYER_ID);
    if (layer) {
      this.canvasService.canvas.sendObjectToBack(layer);
    }
    this.canvasService.requestRenderAll();
  }
}
