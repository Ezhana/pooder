import {
  CONFIGURATION_SERVICE,
  ExtensionContributions,
  ExtensionDefinition,
  ExtensionContext,
  ConfigurationService,
} from "@pooder/core";
import {
  CANVAS_SERVICE,
  CanvasService,
  RenderObjectSpec,
} from "@pooder/core";
import {
  computeSceneLayout,
  readSizeState,
  type SceneLayoutSnapshot,
} from "../../shared/scene/scene-layout-model";
import { BACKGROUND_LAYER_ID } from "../../shared/constants/layers";
import {
  createSourceSizeCache,
  type SourceSize,
} from "../../shared/imaging/sourceSizeCache";
import { SubscriptionBag } from "../../shared/runtime/subscriptions";
import {
  BACKGROUND_CAPABILITY_ID,
  createBackgroundCapabilityDefinition,
  getBackgroundConfigKey,
  normalizeBackgroundConfigNamespace,
  normalizeBackgroundLayerId,
  type BackgroundCapabilityApi,
  type BackgroundCapabilityOptions,
} from "./capability";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type BackgroundLayerKind = "color" | "image";
export type BackgroundFitMode = "cover" | "contain" | "stretch";
export type BackgroundRegionUnit = "normalized" | "px";
export type BackgroundRegistrationFrame =
  | "trim"
  | "cut"
  | "bleed"
  | "focus"
  | "viewport";

export interface BackgroundRegistrationRegion {
  left: number;
  top: number;
  width: number;
  height: number;
  unit: BackgroundRegionUnit;
}

export interface BackgroundRegistration {
  sourceRegion?: BackgroundRegistrationRegion;
  targetFrame?: BackgroundRegistrationFrame;
  fit?: BackgroundFitMode;
}

export interface BackgroundLayer {
  id: string;
  kind: BackgroundLayerKind;
  anchor: string;
  fit: BackgroundFitMode;
  opacity: number;
  order: number;
  enabled: boolean;
  exportable: boolean;
  color?: string;
  src?: string;
  registration?: BackgroundRegistration;
}

export interface BackgroundConfig {
  version: number;
  layers: BackgroundLayer[];
}

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

export interface BackgroundToolOptions extends BackgroundCapabilityOptions {
  id?: string;
  initialConfig?: Partial<BackgroundConfig>;
  contributeTool?: boolean;
  contributeCommands?: boolean;
  contributeConfigurations?: boolean;
}

const DEFAULT_BACKGROUND_CONFIG: BackgroundConfig = {
  version: 1,
  layers: [
    {
      id: "base-color",
      kind: "color",
      anchor: "viewport",
      fit: "cover",
      opacity: 1,
      order: 0,
      enabled: true,
      exportable: false,
      color: "#eee",
    },
  ],
};

function clampOpacity(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.min(1, fallback));
  }
  return Math.max(0, Math.min(1, numeric));
}

function normalizeLayerKind(
  value: unknown,
  fallback: BackgroundLayerKind,
): BackgroundLayerKind {
  if (value === "color" || value === "image") {
    return value;
  }
  return fallback;
}

function normalizeFitMode(
  value: unknown,
  fallback: BackgroundFitMode,
): BackgroundFitMode {
  if (value === "contain" || value === "cover" || value === "stretch") {
    return value;
  }
  return fallback;
}

function normalizeRegionUnit(
  value: unknown,
  fallback: BackgroundRegionUnit,
): BackgroundRegionUnit {
  if (value === "px" || value === "normalized") {
    return value;
  }
  return fallback;
}

function normalizeRegistrationFrame(
  value: unknown,
  fallback: BackgroundRegistrationFrame,
): BackgroundRegistrationFrame {
  if (
    value === "trim" ||
    value === "cut" ||
    value === "bleed" ||
    value === "focus" ||
    value === "viewport"
  ) {
    return value;
  }
  return fallback;
}

function normalizeAnchor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeOrder(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric;
}

function normalizeRegionValue(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeRegistrationRegion(
  raw: unknown,
  fallback?: BackgroundRegistrationRegion,
): BackgroundRegistrationRegion | undefined {
  if (!raw || typeof raw !== "object") {
    return fallback ? { ...fallback } : undefined;
  }

  const input = raw as Partial<BackgroundRegistrationRegion>;
  const base = fallback || {
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    unit: "normalized" as BackgroundRegionUnit,
  };

  return {
    left: normalizeRegionValue(input.left, base.left),
    top: normalizeRegionValue(input.top, base.top),
    width: normalizeRegionValue(input.width, base.width),
    height: normalizeRegionValue(input.height, base.height),
    unit: normalizeRegionUnit(input.unit, base.unit),
  };
}

function normalizeRegistration(
  raw: unknown,
  fallback?: BackgroundRegistration,
): BackgroundRegistration | undefined {
  if (!raw || typeof raw !== "object") {
    return fallback
      ? {
          sourceRegion: fallback.sourceRegion
            ? { ...fallback.sourceRegion }
            : undefined,
          targetFrame: fallback.targetFrame,
          fit: fallback.fit,
        }
      : undefined;
  }

  const input = raw as Partial<BackgroundRegistration>;
  const normalized: BackgroundRegistration = {
    sourceRegion: normalizeRegistrationRegion(
      input.sourceRegion,
      fallback?.sourceRegion,
    ),
    targetFrame: normalizeRegistrationFrame(
      input.targetFrame,
      fallback?.targetFrame || "trim",
    ),
    fit: normalizeFitMode(input.fit, fallback?.fit || "stretch"),
  };

  if (!normalized.sourceRegion) {
    return undefined;
  }

  return normalized;
}

function cloneRegistration(
  registration?: BackgroundRegistration,
): BackgroundRegistration | undefined {
  if (!registration) return undefined;
  return {
    sourceRegion: registration.sourceRegion
      ? { ...registration.sourceRegion }
      : undefined,
    targetFrame: registration.targetFrame,
    fit: registration.fit,
  };
}

function normalizeLayer(
  raw: unknown,
  index: number,
  fallback?: BackgroundLayer,
): BackgroundLayer {
  const fallbackLayer: BackgroundLayer = fallback || {
    id: `layer-${index + 1}`,
    kind: "image",
    anchor: "viewport",
    fit: "contain",
    opacity: 1,
    order: index,
    enabled: true,
    exportable: false,
    src: "",
  };

  if (!raw || typeof raw !== "object") {
    return {
      ...fallbackLayer,
      registration: cloneRegistration(fallbackLayer.registration),
    };
  }

  const input = raw as Partial<BackgroundLayer>;
  const kind = normalizeLayerKind(input.kind, fallbackLayer.kind);
  return {
    id:
      typeof input.id === "string" && input.id.trim().length > 0
        ? input.id.trim()
        : fallbackLayer.id,
    kind,
    anchor: normalizeAnchor(input.anchor, fallbackLayer.anchor),
    fit: normalizeFitMode(input.fit, fallbackLayer.fit),
    opacity: clampOpacity(input.opacity, fallbackLayer.opacity),
    order: normalizeOrder(input.order, fallbackLayer.order),
    enabled:
      typeof input.enabled === "boolean"
        ? input.enabled
        : fallbackLayer.enabled,
    exportable:
      typeof input.exportable === "boolean"
        ? input.exportable
        : fallbackLayer.exportable,
    color:
      kind === "color"
        ? typeof input.color === "string"
          ? input.color
          : typeof fallbackLayer.color === "string"
            ? fallbackLayer.color
            : "#ffffff"
        : undefined,
    src:
      kind === "image"
        ? typeof input.src === "string"
          ? input.src.trim()
          : typeof fallbackLayer.src === "string"
            ? fallbackLayer.src
            : ""
        : undefined,
    registration:
      kind === "image"
        ? normalizeRegistration(input.registration, fallbackLayer.registration)
        : undefined,
  };
}

function normalizeConfig(raw: unknown): BackgroundConfig {
  if (!raw || typeof raw !== "object") {
    return cloneConfig(DEFAULT_BACKGROUND_CONFIG);
  }

  const input = raw as Partial<BackgroundConfig>;
  const version = Number.isFinite(Number(input.version))
    ? Number(input.version)
    : DEFAULT_BACKGROUND_CONFIG.version;

  const baseLayers = Array.isArray(input.layers)
    ? input.layers.map((layer, index) => normalizeLayer(layer, index))
    : cloneConfig(DEFAULT_BACKGROUND_CONFIG).layers;

  const uniqueLayers: BackgroundLayer[] = [];
  const seen = new Set<string>();

  baseLayers.forEach((layer, index) => {
    let nextId = layer.id || `layer-${index + 1}`;
    let serial = 1;
    while (seen.has(nextId)) {
      serial += 1;
      nextId = `${layer.id || `layer-${index + 1}`}-${serial}`;
    }
    seen.add(nextId);
    uniqueLayers.push({ ...layer, id: nextId });
  });

  return {
    version,
    layers: uniqueLayers,
  };
}

function cloneConfig(config: BackgroundConfig): BackgroundConfig {
  return {
    version: config.version,
    layers: (config.layers || []).map((layer) => ({
      ...layer,
      registration: cloneRegistration(layer.registration),
    })),
  };
}

function mergeConfig(base: BackgroundConfig, patch: Partial<BackgroundConfig>) {
  const merged: BackgroundConfig = {
    version:
      patch.version === undefined
        ? base.version
        : Number.isFinite(Number(patch.version))
          ? Number(patch.version)
          : base.version,
    layers: Array.isArray(patch.layers)
      ? patch.layers.map((layer, index) => normalizeLayer(layer, index))
      : base.layers.map((layer) => ({ ...layer })),
  };

  return normalizeConfig(merged);
}

function configSignature(config: BackgroundConfig): string {
  return JSON.stringify(config);
}

export class BackgroundTool implements ExtensionDefinition {
  id: string;

  public metadata = {
    name: "BackgroundTool",
  };
  activation = {
    requiresServices: [CANVAS_SERVICE, CONFIGURATION_SERVICE],
  };

  private config: BackgroundConfig = cloneConfig(DEFAULT_BACKGROUND_CONFIG);

  private canvasService?: CanvasService;
  private configService?: ConfigurationService;

  private specs: RenderObjectSpec[] = [];
  private renderProducerDisposable?: { dispose: () => void };
  private readonly subscriptions = new SubscriptionBag();

  private renderSeq = 0;
  private latestSceneLayout: SceneLayoutSnapshot | null = null;
  private sourceSizeCache = createSourceSizeCache((src) =>
    this.loadImageSize(src),
  );
  private readonly capabilityId: string;
  private readonly configNamespace: string;
  private readonly configKey: string;
  private readonly backgroundLayerId: string;
  private readonly contributeLegacyCommands: boolean;
  private readonly contributeConfigDefinitions: boolean;

  private onCanvasResized = () => {
    this.latestSceneLayout = null;
    this.updateBackground();
  };

  private onSceneLayoutChanged = (layout: SceneLayoutSnapshot) => {
    this.latestSceneLayout = layout;
    this.updateBackground();
  };

  constructor(options: BackgroundToolOptions | Partial<BackgroundConfig> = {}) {
    const capabilityOptions = options as BackgroundToolOptions;
    this.id =
      String(capabilityOptions.id || "pooder.kit.background").trim() ||
      "pooder.kit.background";
    this.capabilityId =
      capabilityOptions.capabilityId || BACKGROUND_CAPABILITY_ID;
    this.configNamespace = normalizeBackgroundConfigNamespace(
      capabilityOptions.configNamespace,
    );
    this.configKey = getBackgroundConfigKey(this.configNamespace, "config");
    this.backgroundLayerId = normalizeBackgroundLayerId(
      Array.isArray((capabilityOptions as any).layers)
        ? undefined
        : capabilityOptions.layers?.backgroundLayerId,
      BACKGROUND_LAYER_ID,
    );
    this.contributeLegacyCommands =
      capabilityOptions.contributeCommands !== false;
    this.contributeConfigDefinitions =
      capabilityOptions.contributeConfigurations !== false;

    const legacyConfig = options as Partial<BackgroundConfig>;
    const initialConfig =
      capabilityOptions.initialConfig ||
      (Array.isArray(legacyConfig.layers) || legacyConfig.version !== undefined
        ? legacyConfig
        : undefined);
    if (initialConfig && typeof initialConfig === "object") {
      this.config = mergeConfig(this.config, initialConfig);
    }
  }

  activate(context: ExtensionContext) {
    this.subscriptions.disposeAll();
    this.canvasService =
      context.services.getOrThrow<CanvasService>(CANVAS_SERVICE);

    this.configService = context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    this.config = normalizeConfig(
      this.configService.get(this.configKey, DEFAULT_BACKGROUND_CONFIG),
    );
    this.subscriptions.onConfigChange(
      this.configService,
      (e: { key: string; value: any }) => {
        if (e.key === this.configKey) {
          this.config = normalizeConfig(e.value);
          this.updateBackground();
          return;
        }

        if (e.key.startsWith("size.")) {
          this.latestSceneLayout = null;
          this.updateBackground();
        }
      },
    );

    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = this.canvasService.registerRenderProducer(
      this.id,
      () => ({
        passes: [
          {
            id: BACKGROUND_LAYER_ID,
            targetLayerId: this.backgroundLayerId,
            stack: 0,
            order: 0,
            objects: this.specs,
          },
        ],
      }),
      { priority: 0 },
    );

    this.subscriptions.on(
      context.eventBus,
      "canvas:resized",
      this.onCanvasResized,
    );
    this.subscriptions.on(
      context.eventBus,
      "scene:layout:change",
      this.onSceneLayoutChanged,
    );
    this.updateBackground();
  }

  deactivate(context: ExtensionContext) {
    this.subscriptions.disposeAll();

    this.renderSeq += 1;
    this.specs = [];
    this.latestSceneLayout = null;
    this.sourceSizeCache.clear();

    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = undefined;

    if (!this.canvasService) return;

    void this.canvasService.flushRenderFromProducers();
    this.canvasService.requestRenderAll();

    this.canvasService = undefined;
    this.configService = undefined;
  }

  contribute(): ExtensionContributions {
    const contributions: ExtensionContributions = {
      capabilities: [
        createBackgroundCapabilityDefinition(this.getBackgroundFacade(), {
          capabilityId: this.capabilityId,
          configNamespace: this.configNamespace,
          layers: {
            backgroundLayerId: this.backgroundLayerId,
          },
        }),
      ],
    };

    if (this.contributeConfigDefinitions) {
      contributions.configurations = [
        {
          id: this.configKey,
          type: "json",
          label: "Background Config",
          default: cloneConfig(DEFAULT_BACKGROUND_CONFIG),
        },
      ];
    }

    if (this.contributeLegacyCommands) {
      contributions.commands = [
        {
          id: "background.getConfig",
          command: "background.getConfig",
          title: "Get Background Config",
          handler: () => this.getConfig(),
        },
        {
          id: "background.resetConfig",
          command: "background.resetConfig",
          title: "Reset Background Config",
          handler: () => this.resetConfig(),
        },
        {
          id: "background.replaceConfig",
          command: "background.replaceConfig",
          title: "Replace Background Config",
          handler: (config: BackgroundConfig) => this.replaceConfig(config),
        },
        {
          id: "background.patchConfig",
          command: "background.patchConfig",
          title: "Patch Background Config",
          handler: (patch: Partial<BackgroundConfig>) =>
            this.patchConfig(patch),
        },
        {
          id: "background.upsertLayer",
          command: "background.upsertLayer",
          title: "Upsert Background Layer",
          handler: (layer: Partial<BackgroundLayer> & { id: string }) =>
            this.upsertLayer(layer),
        },
        {
          id: "background.removeLayer",
          command: "background.removeLayer",
          title: "Remove Background Layer",
          handler: (id: string) => this.removeLayer(id),
        },
      ];
    }

    return contributions;
  }

  getConfig(): BackgroundConfig {
    return cloneConfig(this.config);
  }

  resetConfig(): boolean {
    this.commitConfig(cloneConfig(DEFAULT_BACKGROUND_CONFIG));
    return true;
  }

  replaceConfig(config: BackgroundConfig): boolean {
    this.commitConfig(normalizeConfig(config));
    return true;
  }

  patchConfig(patch: Partial<BackgroundConfig>): boolean {
    this.commitConfig(mergeConfig(this.config, patch || {}));
    return true;
  }

  upsertLayer(layer: Partial<BackgroundLayer> & { id: string }): boolean {
    const normalized = normalizeLayer(layer, 0);
    const existingIndex = this.config.layers.findIndex(
      (item) => item.id === normalized.id,
    );
    const nextLayers = [...this.config.layers];
    if (existingIndex >= 0) {
      nextLayers[existingIndex] = normalizeLayer(
        { ...nextLayers[existingIndex], ...layer },
        existingIndex,
        nextLayers[existingIndex],
      );
    } else {
      nextLayers.push(
        normalizeLayer(
          {
            ...normalized,
            order: Number.isFinite(Number(layer.order))
              ? Number(layer.order)
              : nextLayers.length,
          },
          nextLayers.length,
        ),
      );
    }
    this.commitConfig(
      normalizeConfig({
        ...this.config,
        layers: nextLayers,
      }),
    );
    return true;
  }

  removeLayer(id: string): boolean {
    const nextLayers = this.config.layers.filter((layer) => layer.id !== id);
    this.commitConfig(
      normalizeConfig({
        ...this.config,
        layers: nextLayers,
      }),
    );
    return true;
  }

  refresh(): void {
    this.updateBackground();
  }

  private getBackgroundFacade(): BackgroundCapabilityApi {
    return {
      getConfig: () => this.getConfig(),
      patchConfig: (patch) => this.patchConfig(patch),
      refresh: () => this.refresh(),
      removeLayer: (id) => this.removeLayer(id),
      replaceConfig: (config) => this.replaceConfig(config),
      resetConfig: () => this.resetConfig(),
      upsertLayer: (layer) => this.upsertLayer(layer),
    };
  }

  private commitConfig(next: BackgroundConfig) {
    const normalized = normalizeConfig(next);
    if (configSignature(normalized) === configSignature(this.config)) {
      return;
    }

    if (this.configService) {
      this.configService.update(this.configKey, cloneConfig(normalized));
      return;
    }

    this.config = normalized;
    this.updateBackground();
  }

  private getViewportRect(): Rect {
    const size = this.canvasService?.getViewportSize();
    const width = Number(size?.width || 0);
    const height = Number(size?.height || 0);

    return {
      left: 0,
      top: 0,
      width: width > 0 ? width : DEFAULT_WIDTH,
      height: height > 0 ? height : DEFAULT_HEIGHT,
    };
  }

  private resolveSceneLayout(): SceneLayoutSnapshot | null {
    if (this.latestSceneLayout) return this.latestSceneLayout;
    if (!this.canvasService || !this.configService) return null;

    const layout = computeSceneLayout(
      this.canvasService,
      readSizeState(this.configService),
    );
    this.latestSceneLayout = layout;
    return layout;
  }

  private resolveFocusRect(): Rect | null {
    const layout = this.resolveSceneLayout();
    if (!layout) return null;

    return {
      left: layout.trimRect.left,
      top: layout.trimRect.top,
      width: layout.trimRect.width,
      height: layout.trimRect.height,
    };
  }

  private resolveTargetFrameRect(
    frame: BackgroundRegistrationFrame,
  ): Rect | null {
    if (frame === "viewport") {
      return this.getViewportRect();
    }

    const layout = this.resolveSceneLayout();
    if (!layout) {
      return frame === "focus" ? this.getViewportRect() : null;
    }

    switch (frame) {
      case "trim":
      case "focus":
        return {
          left: layout.trimRect.left,
          top: layout.trimRect.top,
          width: layout.trimRect.width,
          height: layout.trimRect.height,
        };
      case "cut":
        return {
          left: layout.cutRect.left,
          top: layout.cutRect.top,
          width: layout.cutRect.width,
          height: layout.cutRect.height,
        };
      case "bleed":
        return {
          left: layout.bleedRect.left,
          top: layout.bleedRect.top,
          width: layout.bleedRect.width,
          height: layout.bleedRect.height,
        };
      default:
        return null;
    }
  }

  private resolveAnchorRect(anchor: string): Rect {
    if (anchor === "focus") {
      return this.resolveFocusRect() || this.getViewportRect();
    }

    if (anchor !== "viewport") {
      return this.getViewportRect();
    }

    return this.getViewportRect();
  }

  private resolveImagePlacement(
    target: Rect,
    sourceSize: SourceSize,
    fit: BackgroundFitMode,
  ): { left: number; top: number; scaleX: number; scaleY: number } {
    const targetWidth = Math.max(1, Number(target.width || 0));
    const targetHeight = Math.max(1, Number(target.height || 0));
    const sourceWidth = Math.max(1, Number(sourceSize.width || 0));
    const sourceHeight = Math.max(1, Number(sourceSize.height || 0));

    if (fit === "stretch") {
      return {
        left: target.left,
        top: target.top,
        scaleX: targetWidth / sourceWidth,
        scaleY: targetHeight / sourceHeight,
      };
    }

    const scale =
      fit === "contain"
        ? Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
        : Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);

    const renderWidth = sourceWidth * scale;
    const renderHeight = sourceHeight * scale;

    return {
      left: target.left + (targetWidth - renderWidth) / 2,
      top: target.top + (targetHeight - renderHeight) / 2,
      scaleX: scale,
      scaleY: scale,
    };
  }

  private resolveRegistrationRegion(
    region: BackgroundRegistrationRegion,
    sourceSize: SourceSize,
  ): Rect | null {
    const sourceWidth = Math.max(1, Number(sourceSize.width || 0));
    const sourceHeight = Math.max(1, Number(sourceSize.height || 0));
    const width =
      region.unit === "normalized" ? region.width * sourceWidth : region.width;
    const height =
      region.unit === "normalized"
        ? region.height * sourceHeight
        : region.height;
    const left =
      region.unit === "normalized" ? region.left * sourceWidth : region.left;
    const top =
      region.unit === "normalized" ? region.top * sourceHeight : region.top;

    if (
      !Number.isFinite(left) ||
      !Number.isFinite(top) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return null;
    }

    return { left, top, width, height };
  }

  private resolveRegistrationPlacement(
    layer: BackgroundLayer,
    sourceSize: SourceSize,
  ): { left: number; top: number; scaleX: number; scaleY: number } | null {
    const registration = layer.registration;
    if (!registration?.sourceRegion) return null;

    const targetRect = this.resolveTargetFrameRect(
      registration.targetFrame || "trim",
    );
    if (!targetRect) return null;

    const sourceRegion = this.resolveRegistrationRegion(
      registration.sourceRegion,
      sourceSize,
    );
    if (!sourceRegion) return null;

    const fit = registration.fit || "stretch";
    const baseScaleX = targetRect.width / sourceRegion.width;
    const baseScaleY = targetRect.height / sourceRegion.height;

    if (fit === "stretch") {
      return {
        left: targetRect.left - sourceRegion.left * baseScaleX,
        top: targetRect.top - sourceRegion.top * baseScaleY,
        scaleX: baseScaleX,
        scaleY: baseScaleY,
      };
    }

    const uniformScale =
      fit === "contain"
        ? Math.min(baseScaleX, baseScaleY)
        : Math.max(baseScaleX, baseScaleY);
    const alignedWidth = sourceRegion.width * uniformScale;
    const alignedHeight = sourceRegion.height * uniformScale;
    const offsetLeft = targetRect.left + (targetRect.width - alignedWidth) / 2;
    const offsetTop = targetRect.top + (targetRect.height - alignedHeight) / 2;

    return {
      left: offsetLeft - sourceRegion.left * uniformScale,
      top: offsetTop - sourceRegion.top * uniformScale,
      scaleX: uniformScale,
      scaleY: uniformScale,
    };
  }

  private buildColorLayerSpec(layer: BackgroundLayer): RenderObjectSpec {
    const rect = this.resolveAnchorRect(layer.anchor);

    return {
      id: `background.layer.${layer.id}.color`,
      type: "rect",
      space: "screen",
      data: {
        id: `background.layer.${layer.id}.color`,
        layerId: this.backgroundLayerId,
        type: "background-layer",
        layerRef: layer.id,
        layerKind: layer.kind,
      },
      props: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        originX: "left",
        originY: "top",
        fill: layer.color || "transparent",
        opacity: layer.opacity,
        selectable: false,
        evented: false,
        excludeFromExport: !layer.exportable,
      },
    };
  }

  private buildImageLayerSpec(layer: BackgroundLayer): RenderObjectSpec[] {
    const src = String(layer.src || "").trim();
    if (!src) return [];

    const sourceSize = this.sourceSizeCache.getSourceSize(src);
    if (!sourceSize) return [];

    const placement =
      this.resolveRegistrationPlacement(layer, sourceSize) ||
      this.resolveImagePlacement(
        this.resolveAnchorRect(layer.anchor),
        sourceSize,
        layer.fit,
      );

    return [
      {
        id: `background.layer.${layer.id}.image`,
        type: "image",
        src,
        space: "screen",
        data: {
          id: `background.layer.${layer.id}.image`,
          layerId: this.backgroundLayerId,
          type: "background-layer",
          layerRef: layer.id,
          layerKind: layer.kind,
        },
        props: {
          left: placement.left,
          top: placement.top,
          originX: "left",
          originY: "top",
          scaleX: placement.scaleX,
          scaleY: placement.scaleY,
          opacity: layer.opacity,
          selectable: false,
          evented: false,
          excludeFromExport: !layer.exportable,
        },
      },
    ];
  }

  private buildBackgroundSpecs(config: BackgroundConfig): RenderObjectSpec[] {
    const activeLayers = (config.layers || [])
      .filter((layer) => layer.enabled)
      .map((layer, index) => ({ layer, index }))
      .sort((a, b) => {
        if (a.layer.order !== b.layer.order) {
          return a.layer.order - b.layer.order;
        }
        return a.index - b.index;
      });

    const specs: RenderObjectSpec[] = [];

    activeLayers.forEach(({ layer }) => {
      if (layer.kind === "color") {
        specs.push(this.buildColorLayerSpec(layer));
        return;
      }
      specs.push(...this.buildImageLayerSpec(layer));
    });

    return specs;
  }

  private collectActiveImageUrls(config: BackgroundConfig): string[] {
    const urls = new Set<string>();

    (config.layers || []).forEach((layer) => {
      if (!layer.enabled || layer.kind !== "image") return;
      const src = String(layer.src || "").trim();
      if (!src) return;
      urls.add(src);
    });

    return Array.from(urls);
  }

  private async loadImageSize(src: string): Promise<SourceSize | null> {
    return this.canvasService?.loadImageSize(src) ?? null;
  }

  private updateBackground() {
    void this.updateBackgroundAsync();
  }

  private async updateBackgroundAsync() {
    if (!this.canvasService) return;

    const seq = ++this.renderSeq;
    const currentConfig = cloneConfig(this.config);
    const activeUrls = this.collectActiveImageUrls(currentConfig);

    if (activeUrls.length > 0) {
      await Promise.all(
        activeUrls.map((url) => this.sourceSizeCache.ensureImageSize(url)),
      );
      if (seq !== this.renderSeq) return;
    }

    this.specs = this.buildBackgroundSpecs(currentConfig);

    await this.canvasService.flushRenderFromProducers();
    if (seq !== this.renderSeq) return;

    this.canvasService.requestRenderAll();
  }
}
