import {
  CONFIGURATION_SERVICE,
  SCENE_SERVICE,
  ExtensionContributions,
  ExtensionDefinition,
  ExtensionContext,
  ConfigurationService,
  SceneService,
} from "@pooder/core";
import { Pattern } from "fabric";
import {
  CANVAS_SERVICE,
  CanvasService,
  RenderEffectSpec,
  RenderObjectSpec,
} from "@pooder/platform-browser";
import { normalizeShapeStyle, normalizeDielineShape } from "../dielineShape";
import { computeSceneLayout, readSizeState } from "@pooder/platform-browser";
import {
  DIELINE_LAYER_ID,
  IMAGE_OBJECT_LAYER_ID,
} from "../../shared/constants/layers";
import { createDielineCommands } from "./commands";
import { createDielineConfigurations } from "./config";
import {
  DIELINE_GEOMETRY_CAPABILITY_ID,
  createDielineGeometryCapabilityDefinition,
  normalizeDielineGeometryLayerId,
  upsertScenePathElement,
  type ApplyDetectedDielineOptions,
  type DielineGeometryCapabilityApi,
  type DielineGeometryCapabilityOptions,
  type UpsertDielinePathElementOptions,
} from "./capability";
import {
  createDefaultDielineState,
  DielineGeometry,
  DielineState,
  getDielineConfigKey,
  normalizeDielineConfigNamespace,
  readDielineState,
} from "./model";
import { buildDielineRenderBundle } from "./renderBuilder";
import { detectImageEdge, type DetectEdgeOptions } from "../edge-detection";

export interface DielineToolOptions
  extends Partial<DielineState>, DielineGeometryCapabilityOptions {
  id?: string;
  contributeTool?: boolean;
  contributeCommands?: boolean;
  contributeConfigurations?: boolean;
  toolName?: string;
  legacyVisibility?: boolean;
}

/**
 * @deprecated Compatibility wrapper for DielineGeometryCapability. Use
 * createDielineGeometryCapability().
 */
export class DielineTool implements ExtensionDefinition {
  id: string;
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
  private readonly capabilityId: string;
  private readonly configNamespace: string;
  private readonly targetLayerId: string;
  private readonly imageClipLayerIds: string[];
  private readonly contributeLegacyTool: boolean;
  private readonly contributeLegacyCommands: boolean;
  private readonly contributeConfigDefinitions: boolean;
  private readonly toolName: string;
  private readonly legacyVisibility: boolean;
  private onCanvasResized = () => {
    this.updateDieline();
  };

  constructor(options: DielineToolOptions = {}) {
    this.id = normalizeDielineGeometryLayerId(options.id, "pooder.kit.dieline");
    this.capabilityId = options.capabilityId || DIELINE_GEOMETRY_CAPABILITY_ID;
    this.configNamespace = normalizeDielineConfigNamespace(
      options.configNamespace,
    );
    this.targetLayerId = normalizeDielineGeometryLayerId(
      options.layers?.targetLayerId,
      DIELINE_LAYER_ID,
    );
    this.imageClipLayerIds = options.layers?.imageClipLayerIds?.map((id) =>
      normalizeDielineGeometryLayerId(id, IMAGE_OBJECT_LAYER_ID),
    ) || [IMAGE_OBJECT_LAYER_ID];
    this.contributeLegacyTool = options.contributeTool !== false;
    this.contributeLegacyCommands = options.contributeCommands !== false;
    this.contributeConfigDefinitions =
      options.contributeConfigurations !== false;
    this.toolName = options.toolName || "Dieline";
    this.legacyVisibility =
      options.legacyVisibility ?? this.contributeLegacyTool;

    if (options) {
      const stateOptions: Partial<DielineState> = { ...options };
      // Deep merge for styles to avoid overwriting defaults with partial objects
      if (stateOptions.mainLine) {
        Object.assign(this.state.mainLine, stateOptions.mainLine);
        delete stateOptions.mainLine;
      }
      if (stateOptions.offsetLine) {
        Object.assign(this.state.offsetLine, stateOptions.offsetLine);
        delete stateOptions.offsetLine;
      }
      if (stateOptions.shapeStyle) {
        this.state.shapeStyle = normalizeShapeStyle(
          stateOptions.shapeStyle,
          this.state.shapeStyle,
        );
        delete stateOptions.shapeStyle;
      }
      delete (stateOptions as any).id;
      delete (stateOptions as any).capabilityId;
      delete (stateOptions as any).configNamespace;
      delete (stateOptions as any).layers;
      delete (stateOptions as any).contributeTool;
      delete (stateOptions as any).contributeCommands;
      delete (stateOptions as any).contributeConfigurations;
      delete (stateOptions as any).toolName;
      delete (stateOptions as any).legacyVisibility;
      Object.assign(this.state, stateOptions);
      this.state.shape = normalizeDielineShape(
        stateOptions.shape,
        this.state.shape,
      );
    }
  }

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService =
      context.services.getOrThrow<CanvasService>(CANVAS_SERVICE);
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = this.canvasService.registerRenderProducer(
      this.id,
      () => ({
        passes: [
          {
            id: DIELINE_LAYER_ID,
            targetLayerId: this.targetLayerId,
            stack: 700,
            order: 0,
            replace: true,
            visibility: this.legacyVisibility
              ? {
                  op: "not",
                  expr: {
                    op: "activeToolIn",
                    ids: ["pooder.kit.image", "pooder.kit.white-ink"],
                  },
                }
              : undefined,
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
    Object.assign(
      this.state,
      readDielineState(configService, this.state, this.configNamespace),
    );

    // Listen for changes
    configService.onAnyChange((e: { key: string; value: any }) => {
      if (
        e.key.startsWith("size.") ||
        e.key.startsWith(`${this.configNamespace}.`)
      ) {
        Object.assign(
          this.state,
          readDielineState(configService, this.state, this.configNamespace),
        );
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
    const contributions: ExtensionContributions = {
      capabilities: [
        createDielineGeometryCapabilityDefinition(this.getDielineFacade(), {
          capabilityId: this.capabilityId,
          configNamespace: this.configNamespace,
          layers: {
            targetLayerId: this.targetLayerId,
            imageClipLayerIds: this.imageClipLayerIds,
          },
        }),
      ],
    };

    if (this.contributeLegacyTool) {
      contributions.tools = [
        {
          id: this.id,
          name: this.toolName,
          interaction: "session",
          session: {
            autoBegin: false,
            leavePolicy: "block",
          },
        },
      ];
    }

    if (this.contributeConfigDefinitions) {
      contributions.configurations = createDielineConfigurations(
        this.state,
        this.configNamespace,
      );
    }

    if (this.contributeLegacyCommands) {
      contributions.commands = createDielineCommands(this, this.state);
    }

    return contributions;
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
    return this.context?.services.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
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
    const features = configService.get(this.getConfigKey("features")) || [];

    let changed = false;
    const nextFeatures = features.map((feature: any) => {
      if (feature.groupId === groupId && (feature.x !== x || feature.y !== y)) {
        changed = true;
        return { ...feature, x, y };
      }
      return feature;
    });

    if (changed) {
      configService.update(this.getConfigKey("features"), nextFeatures);
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
      canvasWidth:
        sceneLayout.canvasWidth || this.canvasService?.canvas.width || 800,
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
      canvasWidth:
        sceneLayout.canvasWidth || this.canvasService?.canvas.width || 800,
      canvasHeight:
        sceneLayout.canvasHeight || this.canvasService?.canvas.height || 600,
      hasImages: this.hasImageItems(),
      includeImageClipEffect: true,
      clipTargetPassIds: this.imageClipLayerIds,
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

    Object.assign(
      this.state,
      readDielineState(configService, this.state, this.configNamespace),
    );
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
    return {
      shape: this.state.shape,
      shapeStyle: this.state.shapeStyle,
      unit: "px",
      x: sceneLayout.trimRect.centerX,
      y: sceneLayout.trimRect.centerY,
      width: sceneLayout.trimRect.width,
      height: sceneLayout.trimRect.height,
      radius: this.state.radius * sceneLayout.scale,
      offset: (sceneLayout.cutRect.width - sceneLayout.trimRect.width) / 2,
      scale: sceneLayout.scale,
      strokeWidth: this.state.mainLine.width,
      pathData: this.state.pathData,
      customSourceWidthPx: this.state.customSourceWidthPx,
      customSourceHeightPx: this.state.customSourceHeightPx,
    } as DielineGeometry;
  }

  public getState(): DielineState {
    return {
      ...this.state,
      mainLine: { ...this.state.mainLine },
      offsetLine: { ...this.state.offsetLine },
      shapeStyle: { ...this.state.shapeStyle },
      features: this.state.features.map((feature) => ({ ...feature })),
    };
  }

  public applyDetectedPath(
    result: { pathData: string; imageWidth?: number; imageHeight?: number },
    options: ApplyDetectedDielineOptions = {},
  ) {
    const configService = this.getConfigServiceOrThrow();
    configService.update(this.getConfigKey("shape"), "custom");
    configService.update(this.getConfigKey("pathData"), result.pathData);

    const sourceWidth = Number(
      result.imageWidth ?? options.sourceImage?.width ?? 0,
    );
    const sourceHeight = Number(
      result.imageHeight ?? options.sourceImage?.height ?? 0,
    );
    configService.update(
      this.getConfigKey("customSourceWidthPx"),
      Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : undefined,
    );
    configService.update(
      this.getConfigKey("customSourceHeightPx"),
      Number.isFinite(sourceHeight) && sourceHeight > 0
        ? sourceHeight
        : undefined,
    );

    if (options.normalizeCutMode !== false) {
      configService.update("size.cutMode", "trim");
      configService.update("size.cutMarginMm", 0);
    }
  }

  public async detectEdge(imageUrl: string, options?: DetectEdgeOptions) {
    return await detectImageEdge(imageUrl, options);
  }

  public upsertPathElement(options: UpsertDielinePathElementOptions = {}) {
    const pathData =
      options.pathData || this.getGeometry()?.pathData || this.state.pathData;
    if (!pathData) {
      return null;
    }
    const sceneService =
      this.context?.services.get<SceneService>(SCENE_SERVICE);
    if (!sceneService) {
      throw new Error("[DielineTool] SceneService is required.");
    }

    return upsertScenePathElement(sceneService, {
      layerId: options.layerId || this.targetLayerId,
      elementId: options.elementId || `${this.targetLayerId}.path`,
      pathData,
      order: options.order,
      style: options.style || {
        fill: "transparent",
        stroke: this.state.mainLine.color,
        strokeWidth: this.state.mainLine.width,
      },
      metadata: options.metadata,
    });
  }

  private getDielineFacade(): DielineGeometryCapabilityApi {
    return {
      applyDetectedPath: (result, options) =>
        this.applyDetectedPath(result, options),
      getGeometry: () => this.getGeometry(),
      getState: () => this.getState(),
      refresh: () => this.updateDieline(),
      updateFeaturePosition: (groupId, x, y) =>
        this.updateFeaturePosition(groupId, x, y),
      upsertPathElement: (options) => this.upsertPathElement(options),
    };
  }

  private getConfigKey(path: string): string {
    return getDielineConfigKey(this.configNamespace, path);
  }
}
