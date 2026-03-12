import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
  ConfigurationService,
} from "@pooder/core";
import { FabricImage } from "fabric";
import { CanvasService, RenderObjectSpec } from "../../services";
import { FILM_LAYER_ID } from "../../shared/constants/layers";
import {
  createSourceSizeCache,
  getCoverScale,
  type SourceSize,
} from "../../shared/imaging/sourceSizeCache";
import { SubscriptionBag } from "../../shared/runtime/subscriptions";

const FILM_IMAGE_ID = "film-image";
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

export class FilmTool implements Extension {
  id = "pooder.kit.film";

  public metadata = {
    name: "FilmTool",
  };

  private url: string = "";
  private opacity: number = 0.5;

  private canvasService?: CanvasService;
  private specs: RenderObjectSpec[] = [];
  private renderProducerDisposable?: { dispose: () => void };
  private renderSeq = 0;
  private renderImageUrl = "";
  private sourceSizeCache = createSourceSizeCache((src) =>
    this.loadImageSize(src),
  );
  private readonly subscriptions = new SubscriptionBag();
  private onCanvasResized = () => {
    this.updateFilm();
  };

  constructor(
    options?: Partial<{
      url: string;
      opacity: number;
    }>,
  ) {
    if (options) {
      Object.assign(this, options);
    }
  }

  activate(context: ExtensionContext) {
    this.subscriptions.disposeAll();
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    if (!this.canvasService) {
      console.warn("CanvasService not found for FilmTool");
      return;
    }

    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = this.canvasService.registerRenderProducer(
      this.id,
      () => ({
        passes: [
          {
            id: FILM_LAYER_ID,
            stack: 1000,
            order: 0,
            objects: this.specs,
          },
        ],
      }),
      { priority: 500 },
    );

    const configService = context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (configService) {
      // Load initial config
      this.url = configService.get("film.url", this.url);
      this.opacity = configService.get("film.opacity", this.opacity);

      // Listen for changes
      this.subscriptions.onConfigChange(
        configService,
        (e: { key: string; value: any }) => {
          if (e.key.startsWith("film.")) {
            const prop = e.key.split(".")[1];
            console.log(
              `[FilmTool] Config change detected: ${e.key} -> ${e.value}`,
            );
            if (prop && prop in this) {
              (this as any)[prop] = e.value;
              this.updateFilm();
            }
          }
        }
      );
    }

    this.subscriptions.on(context.eventBus, "canvas:resized", this.onCanvasResized);
    this.updateFilm();
  }

  deactivate(context: ExtensionContext) {
    this.subscriptions.disposeAll();
    this.renderSeq += 1;
    this.specs = [];
    this.renderImageUrl = "";
    this.sourceSizeCache.clear();
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = undefined;
    if (!this.canvasService) return;
    void this.canvasService.flushRenderFromProducers();
    this.canvasService.requestRenderAll();
    this.canvasService = undefined;
  }

  contribute() {
    return {
      [ContributionPointIds.CONFIGURATIONS]: [
        {
          id: "film.url",
          type: "string",
          label: "Film Image URL",
          default: "",
        },
        {
          id: "film.opacity",
          type: "number",
          label: "Opacity",
          min: 0,
          max: 1,
          step: 0.1,
          default: 0.5,
        },
      ] as ConfigurationContribution[],
      [ContributionPointIds.COMMANDS]: [
        {
          command: "setFilmImage",
          title: "Set Film Image",
          handler: (url: string, opacity: number) => {
            if (this.url === url && this.opacity === opacity) return true;

            this.url = url;
            this.opacity = opacity;

            this.updateFilm();

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

  private clampOpacity(value: number): number {
    return Math.max(0, Math.min(1, Number(value)));
  }

  private buildFilmSpecs(
    imageUrl: string,
    opacity: number,
  ): RenderObjectSpec[] {
    if (!imageUrl) {
      return [];
    }
    const { width, height } = this.getViewportSize();
    const sourceSize = this.sourceSizeCache.getSourceSize(imageUrl);
    const sourceWidth = Math.max(1, Number(sourceSize?.width || width));
    const sourceHeight = Math.max(1, Number(sourceSize?.height || height));
    const coverScale = getCoverScale(
      { width, height },
      { width: sourceWidth, height: sourceHeight },
    );
    return [
      {
        id: FILM_IMAGE_ID,
        type: "image",
        src: imageUrl,
        space: "screen",
        data: {
          id: FILM_IMAGE_ID,
          layerId: FILM_LAYER_ID,
          type: "film-image",
        },
        props: {
          left: 0,
          top: 0,
          originX: "left",
          originY: "top",
          opacity: this.clampOpacity(opacity),
          scaleX: coverScale,
          scaleY: coverScale,
          selectable: false,
          evented: false,
          excludeFromExport: true,
        },
      },
    ];
  }

  private async loadImageSize(src: string): Promise<SourceSize | null> {
    try {
      const image = await FabricImage.fromURL(src, {
        crossOrigin: "anonymous",
      });
      const width = Number(image?.width || 0);
      const height = Number(image?.height || 0);
      if (width > 0 && height > 0) {
        return { width, height };
      }
    } catch (error) {
      console.error("[FilmTool] Failed to load film image", src, error);
    }
    return null;
  }

  private updateFilm() {
    void this.updateFilmAsync();
  }

  private async updateFilmAsync() {
    if (!this.canvasService) return;
    const seq = ++this.renderSeq;
    const nextUrl = String(this.url || "").trim();

    if (!nextUrl) {
      this.renderImageUrl = "";
    } else if (nextUrl !== this.renderImageUrl) {
      const loaded = await this.sourceSizeCache.ensureImageSize(nextUrl);
      if (seq !== this.renderSeq) return;
      if (loaded) {
        this.renderImageUrl = nextUrl;
      }
    }

    this.specs = this.buildFilmSpecs(this.renderImageUrl, this.opacity);
    await this.canvasService.flushRenderFromProducers();
    if (seq !== this.renderSeq) return;
    this.canvasService.requestRenderAll();
  }
}
