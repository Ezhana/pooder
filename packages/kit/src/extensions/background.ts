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
import {
  computeSceneLayout,
  readSizeState,
  type SceneLayoutSnapshot,
} from "./sceneLayoutModel";

interface SourceSize {
  width: number;
  height: number;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type BackgroundLayerKind = "color" | "image";
export type BackgroundFitMode = "cover" | "contain" | "stretch";

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
}

export interface BackgroundConfig {
  version: number;
  layers: BackgroundLayer[];
}

const BACKGROUND_LAYER_ID = "background";
const BACKGROUND_CONFIG_KEY = "background.config";

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

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
      color: "#aaa",
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
    return { ...fallbackLayer };
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
    layers: (config.layers || []).map((layer) => ({ ...layer })),
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

export class BackgroundTool implements Extension {
  id = "pooder.kit.background";

  public metadata = {
    name: "BackgroundTool",
  };

  private config: BackgroundConfig = cloneConfig(DEFAULT_BACKGROUND_CONFIG);

  private canvasService?: CanvasService;
  private configService?: ConfigurationService;

  private specs: RenderObjectSpec[] = [];
  private renderProducerDisposable?: { dispose: () => void };
  private configChangeDisposable?: { dispose: () => void };

  private renderSeq = 0;
  private latestSceneLayout: SceneLayoutSnapshot | null = null;

  private sourceSizeBySrc: Map<string, SourceSize> = new Map();
  private pendingSizeBySrc: Map<string, Promise<SourceSize | null>> = new Map();

  private onCanvasResized = () => {
    this.latestSceneLayout = null;
    this.updateBackground();
  };

  private onSceneLayoutChanged = (layout: SceneLayoutSnapshot) => {
    this.latestSceneLayout = layout;
    this.updateBackground();
  };

  constructor(options?: Partial<BackgroundConfig>) {
    if (options && typeof options === "object") {
      this.config = mergeConfig(this.config, options);
    }
  }

  activate(context: ExtensionContext) {
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    if (!this.canvasService) {
      console.warn("CanvasService not found for BackgroundTool");
      return;
    }

    this.configService = context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (this.configService) {
      this.config = normalizeConfig(
        this.configService.get(
          BACKGROUND_CONFIG_KEY,
          DEFAULT_BACKGROUND_CONFIG,
        ),
      );
      this.configChangeDisposable?.dispose();
      this.configChangeDisposable = this.configService.onAnyChange(
        (e: { key: string; value: any }) => {
          if (e.key === BACKGROUND_CONFIG_KEY) {
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
    }

    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = this.canvasService.registerRenderProducer(
      this.id,
      () => ({
        passes: [
          {
            id: BACKGROUND_LAYER_ID,
            stack: 0,
            order: 0,
            objects: this.specs,
          },
        ],
      }),
      { priority: 0 },
    );

    context.eventBus.on("canvas:resized", this.onCanvasResized);
    context.eventBus.on("scene:layout:change", this.onSceneLayoutChanged);
    this.updateBackground();
  }

  deactivate(context: ExtensionContext) {
    context.eventBus.off("canvas:resized", this.onCanvasResized);
    context.eventBus.off("scene:layout:change", this.onSceneLayoutChanged);

    this.renderSeq += 1;
    this.specs = [];
    this.latestSceneLayout = null;

    this.configChangeDisposable?.dispose();
    this.configChangeDisposable = undefined;

    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = undefined;

    if (!this.canvasService) return;

    void this.canvasService.flushRenderFromProducers();
    this.canvasService.requestRenderAll();

    this.canvasService = undefined;
    this.configService = undefined;
  }

  contribute() {
    return {
      [ContributionPointIds.CONFIGURATIONS]: [
        {
          id: BACKGROUND_CONFIG_KEY,
          type: "json",
          label: "Background Config",
          default: cloneConfig(DEFAULT_BACKGROUND_CONFIG),
        },
      ] as ConfigurationContribution[],
      [ContributionPointIds.COMMANDS]: [
        {
          command: "background.getConfig",
          title: "Get Background Config",
          handler: () => cloneConfig(this.config),
        },
        {
          command: "background.resetConfig",
          title: "Reset Background Config",
          handler: () => {
            this.commitConfig(cloneConfig(DEFAULT_BACKGROUND_CONFIG));
            return true;
          },
        },
        {
          command: "background.replaceConfig",
          title: "Replace Background Config",
          handler: (config: BackgroundConfig) => {
            this.commitConfig(normalizeConfig(config));
            return true;
          },
        },
        {
          command: "background.patchConfig",
          title: "Patch Background Config",
          handler: (patch: Partial<BackgroundConfig>) => {
            this.commitConfig(mergeConfig(this.config, patch || {}));
            return true;
          },
        },
        {
          command: "background.upsertLayer",
          title: "Upsert Background Layer",
          handler: (layer: Partial<BackgroundLayer> & { id: string }) => {
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
          },
        },
        {
          command: "background.removeLayer",
          title: "Remove Background Layer",
          handler: (id: string) => {
            const nextLayers = this.config.layers.filter(
              (layer) => layer.id !== id,
            );
            this.commitConfig(
              normalizeConfig({
                ...this.config,
                layers: nextLayers,
              }),
            );
            return true;
          },
        },
      ] as CommandContribution[],
    };
  }

  private commitConfig(next: BackgroundConfig) {
    const normalized = normalizeConfig(next);
    if (configSignature(normalized) === configSignature(this.config)) {
      return;
    }

    if (this.configService) {
      this.configService.update(BACKGROUND_CONFIG_KEY, cloneConfig(normalized));
      return;
    }

    this.config = normalized;
    this.updateBackground();
  }

  private getViewportRect(): Rect {
    const width = Number(this.canvasService?.canvas.width || 0);
    const height = Number(this.canvasService?.canvas.height || 0);

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

  private buildColorLayerSpec(layer: BackgroundLayer): RenderObjectSpec {
    const rect = this.resolveAnchorRect(layer.anchor);

    return {
      id: `background.layer.${layer.id}.color`,
      type: "rect",
      space: "screen",
      data: {
        id: `background.layer.${layer.id}.color`,
        layerId: BACKGROUND_LAYER_ID,
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

    const sourceSize = this.sourceSizeBySrc.get(src);
    if (!sourceSize) return [];

    const rect = this.resolveAnchorRect(layer.anchor);
    const placement = this.resolveImagePlacement(rect, sourceSize, layer.fit);

    return [
      {
        id: `background.layer.${layer.id}.image`,
        type: "image",
        src,
        space: "screen",
        data: {
          id: `background.layer.${layer.id}.image`,
          layerId: BACKGROUND_LAYER_ID,
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
    const currentConfig = cloneConfig(this.config);
    const activeUrls = this.collectActiveImageUrls(currentConfig);

    if (activeUrls.length > 0) {
      await Promise.all(activeUrls.map((url) => this.ensureImageSize(url)));
      if (seq !== this.renderSeq) return;
    }

    this.specs = this.buildBackgroundSpecs(currentConfig);

    await this.canvasService.flushRenderFromProducers();
    if (seq !== this.renderSeq) return;

    this.canvasService.requestRenderAll();
  }
}
