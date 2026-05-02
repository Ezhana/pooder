import {
  CONFIGURATION_SERVICE,
  ExtensionContributions,
  ExtensionDefinition,
  ExtensionContext,
  ConfigurationService,
} from "@pooder/core";
import { Pattern } from "fabric";
import {
  CANVAS_SERVICE,
  CanvasService,
  RenderEffectSpec,
  RenderObjectSpec,
} from "@pooder/platform-browser";
import { normalizeShapeStyle, normalizeDielineShape } from "../dielineShape";
import {
  buildSceneGeometry,
  computeSceneLayout,
  readSizeState,
} from "@pooder/platform-browser";
import {
  DIELINE_LAYER_ID,
  IMAGE_OBJECT_LAYER_ID,
} from "../../shared/constants/layers";
import { createDielineCommands } from "./commands";
import { createDielineConfigurations } from "./config";
import {
  createDefaultDielineState,
  DielineGeometry,
  DielineState,
  readDielineState,
} from "./model";
import { buildDielineRenderBundle } from "./renderBuilder";

export class DielineTool implements ExtensionDefinition {
  id = "pooder.kit.dieline";
  public metadata = {
    name: "DielineTool",
  };
  activation = {
    requiresServices: [CANVAS_SERVICE, CONFIGURATION_SERVICE],
  };

  private state: DielineState = createDefaultDielineState();

  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private specs: RenderObjectSpec[] = [];
  private effects: RenderEffectSpec[] = [];
  private renderSeq = 0;
  private renderProducerDisposable?: { dispose: () => void };
  private onCanvasResized = () => {
    this.updateDieline();
  };

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
      if (options.shapeStyle) {
        this.state.shapeStyle = normalizeShapeStyle(
          options.shapeStyle,
          this.state.shapeStyle,
        );
        delete options.shapeStyle;
      }
      Object.assign(this.state, options);
      this.state.shape = normalizeDielineShape(options.shape, this.state.shape);
    }
  }

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService = context.services.getOrThrow<CanvasService>(
      CANVAS_SERVICE,
    );
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = this.canvasService.registerRenderProducer(
      this.id,
      () => ({
        passes: [
          {
            id: DIELINE_LAYER_ID,
            stack: 700,
            order: 0,
            replace: true,
            visibility: {
              op: "not",
              expr: {
                op: "activeToolIn",
                ids: ["pooder.kit.image", "pooder.kit.white-ink"],
              },
            },
            effects: this.effects,
            objects: this.specs,
          },
        ],
      }),
      { priority: 250 },
    );

    const configService = context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    Object.assign(this.state, readDielineState(configService, this.state));

    // Listen for changes
    configService.onAnyChange((e: { key: string; value: any }) => {
      if (e.key.startsWith("size.") || e.key.startsWith("dieline.")) {
        Object.assign(this.state, readDielineState(configService, this.state));
        this.updateDieline();
      }
    });

    context.eventBus.on("canvas:resized", this.onCanvasResized);
    this.updateDieline();
  }

  deactivate(context: ExtensionContext) {
    context.eventBus.off("canvas:resized", this.onCanvasResized);
    this.renderSeq += 1;
    this.specs = [];
    this.effects = [];
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = undefined;
    if (this.canvasService) {
      void this.canvasService.flushRenderFromProducers();
    }
    this.canvasService = undefined;
    this.context = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      tools: [
        {
          id: this.id,
          name: "Dieline",
          interaction: "session",
          session: {
            autoBegin: false,
            leavePolicy: "block",
          },
        },
      ],
      configurations: createDielineConfigurations(this.state),
      commands: createDielineCommands(this, this.state),
    };
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

  private getConfigService(): ConfigurationService | undefined {
    return this.context?.services.get<ConfigurationService>(CONFIGURATION_SERVICE);
  }

  private getConfigServiceOrThrow(): ConfigurationService {
    if (!this.context) {
      throw new Error("[DielineTool] Extension context is not available.");
    }
    return this.context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
  }

  public updateFeaturePosition(groupId: string, x: number, y: number) {
    const configService = this.getConfigServiceOrThrow();
    const features = configService.get("dieline.features") || [];

    let changed = false;
    const nextFeatures = features.map((feature: any) => {
      if (feature.groupId === groupId && (feature.x !== x || feature.y !== y)) {
        changed = true;
        return { ...feature, x, y };
      }
      return feature;
    });

    if (changed) {
      configService.update("dieline.features", nextFeatures);
    }
  }

  private hasImageItems(): boolean {
    const configService = this.getConfigService();
    if (!configService) return false;
    const items = configService.get("image.items", []) as unknown;
    return Array.isArray(items) && items.length > 0;
  }

  private buildDielineSpecs(
    sceneLayout: NonNullable<ReturnType<typeof computeSceneLayout>>,
  ): RenderObjectSpec[] {
    const hasImages = this.hasImageItems();
    return buildDielineRenderBundle({
      state: this.state,
      sceneLayout,
      canvasWidth: sceneLayout.canvasWidth || this.canvasService?.canvas.width || 800,
      canvasHeight:
        sceneLayout.canvasHeight || this.canvasService?.canvas.height || 600,
      hasImages,
      createHatchPattern: (color) => this.createHatchPattern(color),
      includeImageClipEffect: false,
    }).specs;
  }

  private buildImageClipEffects(
    sceneLayout: NonNullable<ReturnType<typeof computeSceneLayout>>,
  ): RenderEffectSpec[] {
    return buildDielineRenderBundle({
      state: this.state,
      sceneLayout,
      canvasWidth: sceneLayout.canvasWidth || this.canvasService?.canvas.width || 800,
      canvasHeight:
        sceneLayout.canvasHeight || this.canvasService?.canvas.height || 600,
      hasImages: this.hasImageItems(),
      includeImageClipEffect: true,
      clipTargetPassIds: [IMAGE_OBJECT_LAYER_ID],
      clipVisibility: {
        op: "not",
        expr: { op: "anySessionActive" },
      },
    }).effects;
  }

  public updateDieline(_emitEvent: boolean = true) {
    void this.updateDielineAsync();
  }

  private async updateDielineAsync() {
    if (!this.canvasService) return;
    const configService = this.getConfigService();
    if (!configService) return;
    const seq = ++this.renderSeq;

    Object.assign(this.state, readDielineState(configService, this.state));
    const sceneLayout = computeSceneLayout(
      this.canvasService,
      readSizeState(configService),
    );
    if (!sceneLayout) {
      if (seq !== this.renderSeq) return;
      this.specs = [];
      this.effects = [];
      await this.canvasService.flushRenderFromProducers();
      return;
    }

    const nextSpecs = this.buildDielineSpecs(sceneLayout);
    const nextEffects = this.buildImageClipEffects(sceneLayout);
    if (seq !== this.renderSeq) return;
    this.specs = nextSpecs;
    this.effects = nextEffects;
    await this.canvasService.flushRenderFromProducers();
    if (seq !== this.renderSeq) return;
    this.canvasService.requestRenderAll();
  }

  public getGeometry(): DielineGeometry | null {
    if (!this.canvasService) return null;
    const configService = this.getConfigService();
    if (!configService) return null;
    const sceneLayout = computeSceneLayout(
      this.canvasService,
      readSizeState(configService),
    );
    if (!sceneLayout) return null;
    const sceneGeometry = buildSceneGeometry(configService, sceneLayout);
    return {
      ...sceneGeometry,
      strokeWidth: this.state.mainLine.width,
      pathData: this.state.pathData,
      customSourceWidthPx: this.state.customSourceWidthPx,
      customSourceHeightPx: this.state.customSourceHeightPx,
    } as DielineGeometry;
  }
}
