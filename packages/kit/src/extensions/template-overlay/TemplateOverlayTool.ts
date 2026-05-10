import {
  CONFIGURATION_SERVICE,
  type ConfigurationService,
  type ExtensionContext,
  type ExtensionContributions,
  type ExtensionDefinition,
} from "@pooder/core";
import {
  CANVAS_SERVICE,
  type CanvasService,
  type RenderEffectSpec,
  type RenderObjectSpec,
  type RenderPassSpec,
} from "@pooder/platform-browser";
import { Image as FabricImage } from "fabric";
import { type FrameRect, resolveSurfaceFrameRect } from "../../shared/scene/frame";
import {
  createSourceSizeCache,
  type SourceSize,
} from "../../shared/imaging/sourceSizeCache";
import { SubscriptionBag } from "../../shared/runtime/subscriptions";
import {
  TEMPLATE_OVERLAY_FRAME_LAYER_ID,
  TEMPLATE_OVERLAY_NORMAL_LAYER_ID,
  TEMPLATE_OVERLAY_PROD_LAYER_ID,
  TEMPLATE_OVERLAY_RENDER_LAYER_ID,
  TEMPLATE_OVERLAY_SMALL_LAYER_ID,
  IMAGE_OBJECT_LAYER_ID,
} from "../../shared/constants/layers";
import { createTemplateOverlayCommands } from "./commands";
import { createTemplateOverlayConfigurations } from "./config";
import {
  createEmptyTemplateOverlayConfig,
  normalizeTemplateOverlayConfig,
  patchTemplateOverlayConfig,
  TEMPLATE_OVERLAY_CONFIG_KEY,
  type TemplateOverlayConfig,
  type TemplateOverlayConfigPatch,
  type TemplateOverlayPlacement,
  type TemplateOverlaySlotName,
} from "./model";

const TEMPLATE_OVERLAY_UNDERLAY_STACK = 100;
const TEMPLATE_OVERLAY_OVERLAY_STACK = 780;
const DEFAULT_CLIP_TARGET_LAYER_IDS = [IMAGE_OBJECT_LAYER_ID];

const RENDERED_OVERLAY_SLOTS: Array<{
  layerId: string;
  order: number;
  slot: Exclude<TemplateOverlaySlotName, "back" | "normal">;
}> = [
  { layerId: TEMPLATE_OVERLAY_FRAME_LAYER_ID, order: 0, slot: "frame" },
  { layerId: TEMPLATE_OVERLAY_PROD_LAYER_ID, order: 1, slot: "prod" },
  { layerId: TEMPLATE_OVERLAY_SMALL_LAYER_ID, order: 2, slot: "small" },
  { layerId: TEMPLATE_OVERLAY_RENDER_LAYER_ID, order: 3, slot: "render" },
];

export class TemplateOverlayTool implements ExtensionDefinition {
  id = "pooder.kit.template-overlay";

  metadata = {
    name: "TemplateOverlayTool",
  };

  activation = {
    requiresServices: [CANVAS_SERVICE, CONFIGURATION_SERVICE],
  };

  private config: TemplateOverlayConfig = createEmptyTemplateOverlayConfig();
  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private renderSeq = 0;
  private isUpdatingConfig = false;
  private normalSpecs: RenderObjectSpec[] = [];
  private overlaySpecsByLayerId: Record<string, RenderObjectSpec[]> = {};
  private renderProducerDisposable?: { dispose: () => void };
  private readonly subscriptions = new SubscriptionBag();
  private readonly sourceSizeCache = createSourceSizeCache((src) =>
    this.loadImageSize(src),
  );

  activate(context: ExtensionContext) {
    this.subscriptions.disposeAll();
    this.context = context;
    this.canvasService = context.services.getOrThrow<CanvasService>(
      CANVAS_SERVICE,
    );
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = this.canvasService.registerRenderProducer(
      this.id,
      () => ({
        passes: this.buildRenderPasses(),
      }),
      { priority: 240 },
    );

    const configService = context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    this.config = normalizeTemplateOverlayConfig(
      configService.get(TEMPLATE_OVERLAY_CONFIG_KEY),
    );

    this.subscriptions.onConfigChange(
      configService,
      (event: { key: string; value: unknown }) => {
        if (this.isUpdatingConfig) return;
        if (event.key === TEMPLATE_OVERLAY_CONFIG_KEY) {
          this.config = normalizeTemplateOverlayConfig(event.value);
          this.updateOverlays();
        } else if (event.key.startsWith("size.")) {
          this.updateOverlays();
        }
      },
    );
    this.subscriptions.on(
      context.eventBus,
      "scene:layout:change",
      this.onSceneLayoutChanged,
    );
    this.subscriptions.on(
      context.eventBus,
      "canvas:resized",
      this.onSceneLayoutChanged,
    );

    this.updateOverlays();
  }

  deactivate(context: ExtensionContext) {
    this.subscriptions.disposeAll();
    context.eventBus.off("scene:layout:change", this.onSceneLayoutChanged);
    context.eventBus.off("canvas:resized", this.onSceneLayoutChanged);
    this.renderSeq += 1;
    this.normalSpecs = [];
    this.overlaySpecsByLayerId = {};
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
      configurations: createTemplateOverlayConfigurations(),
      commands: createTemplateOverlayCommands(this),
    };
  }

  getConfig(): TemplateOverlayConfig {
    return normalizeTemplateOverlayConfig(this.config);
  }

  async replaceConfig(config: unknown): Promise<TemplateOverlayConfig> {
    const next = normalizeTemplateOverlayConfig(config);
    await this.writeConfig(next);
    return this.getConfig();
  }

  async patchConfig(patch: TemplateOverlayConfigPatch): Promise<TemplateOverlayConfig> {
    const next = patchTemplateOverlayConfig(this.config, patch);
    await this.writeConfig(next);
    return this.getConfig();
  }

  async clearConfig(): Promise<TemplateOverlayConfig> {
    const next = createEmptyTemplateOverlayConfig();
    await this.writeConfig(next);
    return this.getConfig();
  }

  private onSceneLayoutChanged = () => {
    this.updateOverlays();
  };

  private async writeConfig(next: TemplateOverlayConfig) {
    this.config = normalizeTemplateOverlayConfig(next);
    this.isUpdatingConfig = true;
    try {
      this.getConfigService()?.update(TEMPLATE_OVERLAY_CONFIG_KEY, this.config);
    } finally {
      this.isUpdatingConfig = false;
    }
    await this.updateOverlaysAsync();
  }

  private getConfigService(): ConfigurationService | undefined {
    return this.context?.services.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
  }

  private getSurfaceFrameRect(): FrameRect {
    return resolveSurfaceFrameRect(this.canvasService, this.getConfigService());
  }

  private buildRenderPasses(): RenderPassSpec[] {
    const clipEffects = this.buildClipEffects();

    return [
      {
        id: TEMPLATE_OVERLAY_NORMAL_LAYER_ID,
        stack: TEMPLATE_OVERLAY_UNDERLAY_STACK,
        order: 0,
        effects: clipEffects,
        objects: this.normalSpecs,
      },
      ...RENDERED_OVERLAY_SLOTS.map(({ layerId, order }) => ({
        id: layerId,
        stack: TEMPLATE_OVERLAY_OVERLAY_STACK,
        order,
        objects: this.overlaySpecsByLayerId[layerId] || [],
      })),
    ];
  }

  private buildClipEffects(): RenderEffectSpec[] {
    const clip = this.config.clip;
    if (!this.canvasService || !clip || clip.enabled === false) {
      return [];
    }

    const frame = this.getSurfaceFrameRect();
    if (frame.width <= 0 || frame.height <= 0) {
      return [];
    }

    const clipFrame = this.canvasService.toScreenRect(
      this.resolveSlotFrame(frame, clip.placement),
    );
    if (clipFrame.width <= 0 || clipFrame.height <= 0) {
      return [];
    }

    const targetPassIds =
      Array.isArray(clip.targetLayerIds) && clip.targetLayerIds.length > 0
        ? clip.targetLayerIds
        : DEFAULT_CLIP_TARGET_LAYER_IDS;

    return [
      {
        id: "template-overlay.clip.user-surface",
        type: "clipPath",
        source: {
          id: "template-overlay.clip.user-surface.source",
          type: "path",
          space: "screen",
          layout: {
            reference: "custom",
            referenceRect: {
              left: clipFrame.left,
              top: clipFrame.top,
              width: clipFrame.width,
              height: clipFrame.height,
              space: "screen",
            },
            alignX: "start",
            alignY: "start",
          },
          data: {
            id: "template-overlay.clip.user-surface.source",
            type: "template-overlay-clip",
          },
          props: {
            fill: "#000000",
            pathData: `M 0 0 H ${clipFrame.width} V ${clipFrame.height} H 0 Z`,
            originX: "left",
            originY: "top",
            selectable: false,
            evented: false,
            stroke: null,
          },
        },
        targetPassIds,
      },
    ];
  }

  private updateOverlays() {
    void this.updateOverlaysAsync();
  }

  private async updateOverlaysAsync() {
    if (!this.canvasService) return;
    const seq = ++this.renderSeq;
    const frame = this.getSurfaceFrameRect();
    if (frame.width <= 0 || frame.height <= 0) {
      this.normalSpecs = [];
      this.overlaySpecsByLayerId = {};
      await this.canvasService.flushRenderFromProducers();
      return;
    }

    const normalSpec = await this.buildSlotSpec(
      "normal",
      TEMPLATE_OVERLAY_NORMAL_LAYER_ID,
      frame,
    );
    const overlayEntries = await Promise.all(
      RENDERED_OVERLAY_SLOTS.map(async ({ layerId, slot }) => ({
        layerId,
        spec: await this.buildSlotSpec(slot, layerId, frame),
      })),
    );
    if (seq !== this.renderSeq) return;

    this.normalSpecs = normalSpec ? [normalSpec] : [];
    this.overlaySpecsByLayerId = Object.fromEntries(
      overlayEntries.map(({ layerId, spec }) => [layerId, spec ? [spec] : []]),
    );
    await this.canvasService.flushRenderFromProducers();
    if (seq !== this.renderSeq) return;
    this.canvasService.requestRenderAll();
  }

  private async buildSlotSpec(
    slot: TemplateOverlaySlotName,
    layerId: string,
    frame: FrameRect,
  ): Promise<RenderObjectSpec | null> {
    const slotConfig = this.config.slots[slot];
    if (!slotConfig || slotConfig.enabled === false) return null;

    const src = slotConfig.src.trim();
    if (!src) return null;

    const size = await this.sourceSizeCache.ensureImageSize(src);
    if (!size) {
      console.error("[TemplateOverlayTool] Overlay image failed to load.", {
        slot,
        src,
      });
      return null;
    }

    return this.createStretchImageSpec({
      frame: this.resolveSlotFrame(frame, slotConfig.placement),
      layerId,
      opacity:
        typeof slotConfig.opacity === "number" ? slotConfig.opacity : 1,
      size,
      slot,
      src,
    });
  }

  private resolveSlotFrame(
    frame: FrameRect,
    placement: TemplateOverlayPlacement | undefined,
  ): FrameRect {
    if (!placement || placement.space !== "surfaceFrameRatio") {
      return frame;
    }

    return {
      left: frame.left + placement.x * frame.width,
      top: frame.top + placement.y * frame.height,
      width: placement.width * frame.width,
      height: placement.height * frame.height,
    };
  }

  private createStretchImageSpec(options: {
    frame: FrameRect;
    layerId: string;
    opacity: number;
    size: SourceSize;
    slot: TemplateOverlaySlotName;
    src: string;
  }): RenderObjectSpec {
    const { frame, layerId, opacity, size, slot, src } = options;
    const width = Math.max(1, Number(size.width) || 1);
    const height = Math.max(1, Number(size.height) || 1);
    return {
      id: `template-overlay.${slot}`,
      type: "image",
      src,
      data: {
        id: `template-overlay.${slot}`,
        layerId,
        slot,
        type: "template-overlay",
      },
      props: {
        left: frame.left,
        top: frame.top,
        originX: "left",
        originY: "top",
        scaleX: frame.width / width,
        scaleY: frame.height / height,
        opacity: Math.max(0, Math.min(1, opacity)),
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        excludeFromExport: true,
      },
    };
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
      console.error("[TemplateOverlayTool] Overlay image failed to load.", {
        src,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return null;
  }
}
