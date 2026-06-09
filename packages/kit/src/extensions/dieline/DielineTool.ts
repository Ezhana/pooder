import {
  CAPABILITY_REGISTRY_SERVICE,
  CONFIGURATION_SERVICE,
  GEOMETRY_SOURCE_SERVICE,
  SCENE_LAYOUT_SERVICE,
  SURFACE_FRAME_SERVICE,
  SCENE_SERVICE,
  ExtensionContributions,
  ExtensionDefinition,
  ExtensionContext,
  ConfigurationService,
  SceneService,
  type RenderIntentCompilerContribution,
  type RenderIntentCompilerContext,
  type RenderIntentPatch,
  type RenderPatternSpec,
  type RuntimeConditionExpr,
  type GeometryRef,
  type CapabilityRegistryService,
  type DefaultGeometrySourceCapability,
  type GeometrySourceProvider,
  type SceneLayoutService,
  type SurfaceFrameService,
} from "@pooder/core";
import type { EditorDocument, EditorEffect } from "@pooder/document/kit";
import {
  CANVAS_SERVICE,
  CanvasService,
  RENDER_INTENT_SERVICE,
  RenderIntentService,
  RenderObjectSpec,
} from "@pooder/core";
import { normalizeShapeStyle, normalizeDielineShape } from "../dielineShape";
import {
  DIELINE_LAYER_ID,
  IMAGE_OBJECT_LAYER_ID,
  KIT_LEGACY_LAYER_PRESET,
} from "../../shared/constants/layers";
import {
  IMAGE_PLACEMENT_CAPABILITY_ID,
  type ImagePlacementCapabilityApi,
  type ImageSessionOverlayContext,
} from "../image/capability";
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
import { buildDielineGuideRenderSpecs } from "./renderBuilder";
import { detectImageEdge, type DetectEdgeOptions } from "../edge-detection";
import { generateDielinePath } from "../geometry";
import {
  clearRenderIntentSource,
  patchRenderObjectSpecs,
} from "../../shared/runtime/renderIntentPatches";

const IMAGE_SESSION_CHANNEL = "image-placement";
const IMAGE_SESSION_DIELINE_OVERLAY_ID = "dieline.image-session-overlay";
const IMAGE_SESSION_SHAPE_HATCH_ID = "image.cropShapeHatch";
const IMAGE_SESSION_SHAPE_OUTLINE_ID = "image.cropShapeOutline";
const EPSILON = 0.0001;
const SHAPE_OUTLINE_COLOR = "rgba(255, 0, 0, 0.9)";
const DEFAULT_IMAGE_SESSION_HATCH_COLOR = "rgba(255, 0, 0, 0.35)";

export interface DielineToolOptions
  extends Partial<DielineState>, DielineGeometryCapabilityOptions {
  id?: string;
  contributeCommands?: boolean;
  contributeConfigurations?: boolean;
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
    requiresServices: [CANVAS_SERVICE, CONFIGURATION_SERVICE, RENDER_INTENT_SERVICE],
    after: [IMAGE_PLACEMENT_CAPABILITY_ID],
  };

  private state: DielineState = createDefaultDielineState();

  private canvasService?: CanvasService;
  private renderIntentService?: RenderIntentService;
  private sceneLayoutService?: SceneLayoutService;
  private surfaceFrameService?: SurfaceFrameService;
  private geometrySource?: DefaultGeometrySourceCapability;
  private geometrySourceDisposable?: { dispose(): void };
  private imageSessionOverlayDisposable?: { dispose(): void };
  private context?: ExtensionContext;
  private specs: RenderObjectSpec[] = [];
  private renderSeq = 0;
  private readonly capabilityId: string;
  private readonly configNamespace: string;
  private readonly targetLayerId: string;
  private readonly imageClipLayerIds: string[];
  private readonly contributeLegacyCommands: boolean;
  private readonly contributeConfigDefinitions: boolean;
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
      KIT_LEGACY_LAYER_PRESET.dieline,
    );
    this.imageClipLayerIds = options.layers?.imageClipLayerIds?.map((id) =>
      normalizeDielineGeometryLayerId(id, KIT_LEGACY_LAYER_PRESET.imageObject),
    ) || [KIT_LEGACY_LAYER_PRESET.imageObject];
    this.contributeLegacyCommands = options.contributeCommands !== false;
    this.contributeConfigDefinitions =
      options.contributeConfigurations !== false;

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
      delete (stateOptions as any).contributeCommands;
      delete (stateOptions as any).contributeConfigurations;
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
    this.renderIntentService = context.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    this.sceneLayoutService = context.services.get<SceneLayoutService>(
      SCENE_LAYOUT_SERVICE,
    );
    this.surfaceFrameService = context.services.get<SurfaceFrameService>(
      SURFACE_FRAME_SERVICE,
    );
    this.geometrySource = context.services.get<DefaultGeometrySourceCapability>(
      GEOMETRY_SOURCE_SERVICE,
    );
    this.geometrySourceDisposable?.dispose();
    this.geometrySourceDisposable = this.geometrySource?.registerSource(
      this.createGeometrySourceProvider(),
    );
    this.imageSessionOverlayDisposable?.dispose();
    this.imageSessionOverlayDisposable =
      context.services
        .get<CapabilityRegistryService>(CAPABILITY_REGISTRY_SERVICE)
        ?.getFacade<ImagePlacementCapabilityApi>(IMAGE_PLACEMENT_CAPABILITY_ID)
        ?.registerSessionOverlayProvider(
          this.createImageSessionOverlayProvider(),
        );

    const configService = context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    Object.assign(
      this.state,
      readDielineState(
        configService,
        this.state,
        this.configNamespace,
        this.getSurfaceFrames(),
      ),
    );

    // Listen for changes
    configService.onAnyChange((e: { key: string; value: any }) => {
      if (
        e.key.startsWith(`${this.configNamespace}.`)
      ) {
        Object.assign(
          this.state,
          readDielineState(
            configService,
            this.state,
            this.configNamespace,
            this.getSurfaceFrames(),
          ),
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
    clearRenderIntentSource(this.renderIntentService, this.id);
    this.geometrySourceDisposable?.dispose();
    this.geometrySourceDisposable = undefined;
    this.imageSessionOverlayDisposable?.dispose();
    this.imageSessionOverlayDisposable = undefined;
    this.canvasService = undefined;
    this.renderIntentService = undefined;
    this.sceneLayoutService = undefined;
    this.surfaceFrameService = undefined;
    this.geometrySource = undefined;
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
      renderIntentCompilers: [this.createRenderIntentCompiler()],
    };

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

  private createRenderIntentCompiler(): RenderIntentCompilerContribution<
    EditorEffect,
    EditorDocument
  > {
    return {
      capabilityId: this.capabilityId,
      effectType: "dieline",
      compile: (context) => this.compileDocumentDielineEffect(context),
    };
  }

  private compileDocumentDielineEffect(
    context: RenderIntentCompilerContext<EditorEffect, EditorDocument>,
  ): RenderIntentPatch {
    const payload =
      context.effect.payload && typeof context.effect.payload === "object"
        ? context.effect.payload
        : {};
    const layerId = context.target.layerId || this.targetLayerId;
    const id =
      typeof payload.id === "string" && payload.id.trim()
        ? payload.id.trim()
        : `${layerId}.dieline`;
    const pathData =
      typeof payload.pathData === "string" && payload.pathData.trim()
        ? payload.pathData.trim()
        : undefined;
    return {
      id,
      subject: {
        kind: pathData ? "object" : "layer",
        surfaceId: context.target.surfaceId,
        layerId,
        objectId: pathData ? id : undefined,
        objectType: pathData ? "path" : undefined,
      },
      ordering: {
        layerId,
        layerOrder: 0,
        objectOrder: 0,
        channel: "overlay",
        stack: 700,
      },
      ...(pathData
        ? {
            visual: { type: "path" as const },
            props: {
              pathData,
              stroke: typeof payload.stroke === "string" ? payload.stroke : "#ff00ff",
              fill: null,
              selectable: false,
              evented: false,
              excludeFromExport: true,
            },
          }
        : {}),
      export: {
        visible: true,
        visibleWhen: this.resolveDielinePassVisibleWhen(),
      },
      data: {
        type: "dieline",
        dieline: { ...payload },
      },
    };
  }

  private createHatchPattern(
    color: string = "rgba(0, 0, 0, 0.3)",
  ): RenderPatternSpec {
    return {
      type: "pattern",
      kind: "diagonalHatch",
      color,
      size: 20,
      repetition: "repeat",
    };
  }

  private getConfigService(): ConfigurationService | undefined {
    return this.context?.services.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
  }

  private getSurfaceId(surfaceId?: string): string {
    const normalized = String(surfaceId || "").trim();
    if (normalized) return normalized;
    return this.surfaceFrameService?.listSurfaceIds()[0] ?? "legacy";
  }

  private getSurfaceFrames(surfaceId?: string) {
    return this.surfaceFrameService?.getFrames(this.getSurfaceId(surfaceId)) ?? null;
  }

  private getSurfaceLayout(surfaceId?: string) {
    return this.sceneLayoutService?.getLayout(this.getSurfaceId(surfaceId)) ?? null;
  }

  private createImageSessionOverlayProvider() {
    return {
      id: IMAGE_SESSION_DIELINE_OVERLAY_ID,
      order: 100,
      getOverlaySpecs: (context: ImageSessionOverlayContext) => {
        const surfaceId = this.getSurfaceId(context.surfaceId ?? undefined);
        const geometry = this.getGeometryForSurface(surfaceId);
        if (!geometry || geometry.shape === "custom") return [];
        const radius = this.resolveImageSessionShapeRadius(geometry);
        if (geometry.shape === "rect" && radius <= EPSILON) return [];

        const shapePathData = generateDielinePath({
          shape: geometry.shape,
          shapeStyle: geometry.shapeStyle,
          width: Math.max(1, geometry.width),
          height: Math.max(1, geometry.height),
          radius,
          x: geometry.x,
          y: geometry.y,
          features: [],
          canvasWidth: context.viewport.width,
          canvasHeight: context.viewport.height,
        });
        if (!shapePathData) return [];

        const hatchPathData = `${this.buildAbsoluteRectPath(
          context.layout.cutRect,
        )} ${shapePathData}`;
        return [
          {
            layer: "controls" as const,
            spec: {
              id: IMAGE_SESSION_SHAPE_HATCH_ID,
              type: "path" as const,
              space: "screen" as const,
              data: { id: IMAGE_SESSION_SHAPE_HATCH_ID, zIndex: 5 },
              props: {
                pathData: hatchPathData,
                originX: "left",
                originY: "top",
                fill: this.createHatchPattern(DEFAULT_IMAGE_SESSION_HATCH_COLOR),
                opacity: 1,
                stroke: null,
                fillRule: "evenodd",
                selectable: false,
                evented: false,
                excludeFromExport: true,
                objectCaching: false,
              },
            },
          },
          {
            layer: "controls" as const,
            spec: {
              id: IMAGE_SESSION_SHAPE_OUTLINE_ID,
              type: "path" as const,
              space: "screen" as const,
              data: { id: IMAGE_SESSION_SHAPE_OUTLINE_ID, zIndex: 6 },
              props: {
                pathData: shapePathData,
                originX: "left",
                originY: "top",
                fill: "transparent",
                stroke: SHAPE_OUTLINE_COLOR,
                strokeWidth: 1,
                selectable: false,
                evented: false,
                excludeFromExport: true,
                objectCaching: false,
              },
            },
          },
        ];
      },
    };
  }

  private resolveImageSessionShapeRadius(geometry: DielineGeometry): number {
    const visualRadius = Number.isFinite(geometry.radius)
      ? Math.max(0, geometry.radius)
      : 0;
    const maxRadius = Math.max(0, Math.min(geometry.width, geometry.height) / 2);
    return Math.max(0, Math.min(maxRadius, visualRadius));
  }

  private buildAbsoluteRectPath(rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  }): string {
    return `M ${rect.left} ${rect.top} L ${rect.left + rect.width} ${rect.top} L ${
      rect.left + rect.width
    } ${rect.top + rect.height} L ${rect.left} ${rect.top + rect.height} Z`;
  }

  private createGeometrySourceProvider(): GeometrySourceProvider {
    return {
      sourceId: "dieline",
      getGeometry: (ref) => this.getGeometrySnapshot(ref),
      listGeometries: () =>
        (this.surfaceFrameService?.listSurfaceIds() ?? []).map((surfaceId) => ({
          ref: {
            sourceId: "dieline",
            geometryId: "production",
            variant: surfaceId,
          },
          kind: "rect" as const,
          space: "screen" as const,
          metadata: { surfaceId },
        })),
    };
  }

  private getGeometrySnapshot(ref: GeometryRef) {
    const surfaceId = ref.variant || this.getSurfaceId();
    const geometry = this.getGeometryForSurface(surfaceId);
    return geometry
      ? {
          kind: "rect" as const,
          ref,
          space: "screen" as const,
          rect: {
            left: geometry.x - geometry.width / 2,
            top: geometry.y - geometry.height / 2,
            width: geometry.width,
            height: geometry.height,
          },
          metadata: { surfaceId, geometry },
        }
      : null;
  }

  private getGeometryForSurface(surfaceId: string): DielineGeometry | null {
    const layout = this.getSurfaceLayout(surfaceId);
    if (!layout) return null;
    return {
      shape: this.state.shape,
      shapeStyle: this.state.shapeStyle,
      unit: "px",
      x: layout.trimRect.centerX,
      y: layout.trimRect.centerY,
      width: layout.trimRect.width,
      height: layout.trimRect.height,
      radius: this.state.radius * layout.scale,
      offset: (layout.cutRect.width - layout.trimRect.width) / 2,
      scale: layout.scale,
      strokeWidth: this.state.mainLine.width,
      pathData: this.state.pathData,
      customSourceWidthPx: this.state.customSourceWidthPx,
      customSourceHeightPx: this.state.customSourceHeightPx,
    };
  }

  private resolveDielinePassVisibleWhen(): RuntimeConditionExpr {
    const sessionCondition: RuntimeConditionExpr = {
      op: "not",
      expr: {
        op: "any",
        exprs: [
          {
            op: "truthy",
            ref: {
              source: "workflowSession",
              field: "anyActive",
              scope: { channel: IMAGE_SESSION_CHANNEL },
            },
          },
        ],
      },
    };

    return sessionCondition;
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
    let changed = false;
    const nextFeatures = this.state.features.map((feature: any) => {
      if (feature.groupId === groupId && (feature.x !== x || feature.y !== y)) {
        changed = true;
        return { ...feature, x, y };
      }
      return feature;
    });

    if (changed) {
      this.state = { ...this.state, features: nextFeatures };
      this.updateDieline();
    }
  }

  private hasImageItems(): boolean {
    if (!this.canvasService) return false;
    return this.imageClipLayerIds.some(
      (layerId) =>
        this.canvasService!.selectObjects({ layerIds: [layerId] }).length > 0,
    );
  }

  private buildDielineSpecs(sceneLayout: NonNullable<ReturnType<SceneLayoutService["getLayout"]>>): RenderObjectSpec[] {
    const hasImages = this.hasImageItems();
    const viewportSize = this.canvasService?.getViewportSize() ?? {
      width: 800,
      height: 600,
    };
    return buildDielineGuideRenderSpecs({
      state: this.state,
      sceneLayout,
      canvasWidth: viewportSize.width || 800,
      canvasHeight: viewportSize.height || 600,
      hasImages,
      createHatchPattern: (color) => this.createHatchPattern(color),
    });
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
      readDielineState(
        configService,
        this.state,
        this.configNamespace,
        this.getSurfaceFrames(),
      ),
    );
    const sceneLayout = this.getSurfaceLayout();
    if (!sceneLayout) {
      if (seq !== this.renderSeq) return;
      this.specs = [];
      clearRenderIntentSource(this.renderIntentService, this.id);
      return;
    }

    const nextSpecs = this.buildDielineSpecs(sceneLayout);
    if (seq !== this.renderSeq) return;
    this.specs = nextSpecs;
    patchRenderObjectSpecs(this.renderIntentService, this.specs, {
      sourceId: this.id,
      layerId: this.targetLayerId,
      stack: 700,
      layerOrder: 0,
      channel: "overlay",
      visibleWhen: this.resolveDielinePassVisibleWhen(),
    });
    if (seq !== this.renderSeq) return;
    this.canvasService.requestRenderAll();
  }

  public getGeometry(): DielineGeometry | null {
    return this.getGeometryForSurface(this.getSurfaceId());
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
      const surfaceId = this.getSurfaceId();
      const frames = this.getSurfaceFrames(surfaceId);
      if (surfaceId && frames) {
        this.surfaceFrameService?.setFrames(surfaceId, {
          ...frames,
          exportFrame: { ...frames.productionFrame },
        });
      }
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
