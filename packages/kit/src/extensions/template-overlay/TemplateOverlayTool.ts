import {
  CANVAS_SERVICE,
  CONFIGURATION_SERVICE,
  RENDER_INTENT_SERVICE,
  type CanvasService,
  type ConfigurationService,
  type ExtensionContext,
  type ExtensionContributions,
  type ExtensionDefinition,
  type RenderIntentCompilerContribution,
  type RenderIntentCompilerContext,
  type RenderIntentPatch,
  type RenderIntentService,
} from "@pooder/core";
import type {
  EditorDocument,
  EditorEffect,
} from "@pooder/document/kit";
import {
  type FrameRect,
  resolveSurfaceFrameRect,
} from "../../shared/scene/frame";
import { SubscriptionBag } from "../../shared/runtime/subscriptions";
import { IMAGE_OBJECT_LAYER_ID } from "../../shared/constants/layers";
import { createTemplateOverlayCommands } from "./commands";
import { createTemplateOverlayConfigurations } from "./config";
import {
  createTemplateOverlayCapabilityDefinition,
  getTemplateOverlayConfigKey,
  normalizeTemplateOverlayConfigNamespace,
  normalizeTemplateOverlayLayerId,
  TEMPLATE_OVERLAY_CAPABILITY_ID,
  type TemplateOverlayCapabilityApi,
  type TemplateOverlayCapabilityOptions,
} from "./capability";
import {
  createEmptyTemplateOverlayConfig,
  normalizeTemplateOverlayConfig,
  patchTemplateOverlayConfig,
  TEMPLATE_OVERLAY_SLOT_NAMES,
  type TemplateOverlayConfig,
  type TemplateOverlayConfigPatch,
  type TemplateOverlayPlacement,
  type TemplateOverlaySlotName,
} from "./model";

const DEFAULT_CLIP_TARGET_LAYER_IDS = [IMAGE_OBJECT_LAYER_ID];
const TEMPLATE_OVERLAY_RENDER_SCOPE = "pooder.kit.template-overlay";

export interface TemplateOverlayToolOptions extends TemplateOverlayCapabilityOptions {
  id?: string;
  contributeCommands?: boolean;
  contributeConfigurations?: boolean;
}

interface TemplateOverlayEffectPayload {
  role?: unknown;
  slot?: unknown;
}

function readTemplateOverlaySlot(value: unknown): TemplateOverlaySlotName | null {
  const slot = String(value || "").trim();
  return (TEMPLATE_OVERLAY_SLOT_NAMES as readonly string[]).includes(slot)
    ? (slot as TemplateOverlaySlotName)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class TemplateOverlayTool implements ExtensionDefinition {
  id: string;

  metadata = {
    name: "TemplateOverlayTool",
  };

  activation = {
    requiresServices: [CANVAS_SERVICE, CONFIGURATION_SERVICE, RENDER_INTENT_SERVICE],
  };

  private config: TemplateOverlayConfig = createEmptyTemplateOverlayConfig();
  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private renderIntentService?: RenderIntentService;
  private isUpdatingConfig = false;
  private readonly subscriptions = new SubscriptionBag();
  private readonly capabilityId: string;
  private readonly configNamespace: string;
  private readonly configKey: string;
  private readonly clipTargetLayerIds: string[];
  private readonly contributeLegacyCommands: boolean;
  private readonly contributeConfigDefinitions: boolean;

  constructor(options: TemplateOverlayToolOptions = {}) {
    this.id =
      String(options.id || TEMPLATE_OVERLAY_RENDER_SCOPE).trim() ||
      TEMPLATE_OVERLAY_RENDER_SCOPE;
    this.capabilityId = options.capabilityId || TEMPLATE_OVERLAY_CAPABILITY_ID;
    this.configNamespace = normalizeTemplateOverlayConfigNamespace(
      options.configNamespace,
    );
    this.configKey = getTemplateOverlayConfigKey(
      this.configNamespace,
      "config",
    );
    this.clipTargetLayerIds =
      options.layers?.clipTargetLayerIds?.map((id) =>
        normalizeTemplateOverlayLayerId(id, IMAGE_OBJECT_LAYER_ID),
      ) || DEFAULT_CLIP_TARGET_LAYER_IDS;
    this.contributeLegacyCommands = options.contributeCommands !== false;
    this.contributeConfigDefinitions =
      options.contributeConfigurations !== false;
  }

  activate(context: ExtensionContext) {
    this.subscriptions.disposeAll();
    this.context = context;
    this.canvasService =
      context.services.getOrThrow<CanvasService>(CANVAS_SERVICE);
    this.renderIntentService = context.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );

    const configService = context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    this.config = normalizeTemplateOverlayConfig(
      configService.get(this.configKey),
    );

    this.subscriptions.onConfigChange(
      configService,
      (event: { key: string; value: unknown }) => {
        if (this.isUpdatingConfig) return;
        if (event.key === this.configKey) {
          this.config = normalizeTemplateOverlayConfig(event.value);
          this.refresh();
        } else if (event.key.startsWith("size.")) {
          this.refresh();
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

    this.refresh();
  }

  deactivate(context: ExtensionContext) {
    this.subscriptions.disposeAll();
    context.eventBus.off("scene:layout:change", this.onSceneLayoutChanged);
    context.eventBus.off("canvas:resized", this.onSceneLayoutChanged);
    this.renderIntentService?.clearRuntimePatches(TEMPLATE_OVERLAY_RENDER_SCOPE);
    this.canvasService = undefined;
    this.renderIntentService = undefined;
    this.context = undefined;
  }

  contribute(): ExtensionContributions {
    const contributions: ExtensionContributions = {
      capabilities: [
        createTemplateOverlayCapabilityDefinition(this.getTemplateFacade(), {
          capabilityId: this.capabilityId,
          configNamespace: this.configNamespace,
          layers: {
            clipTargetLayerIds: this.clipTargetLayerIds,
          },
        }),
      ],
      renderIntentCompilers: [this.createRenderIntentCompiler()],
    };

    if (this.contributeConfigDefinitions) {
      contributions.configurations = createTemplateOverlayConfigurations(
        this.configNamespace,
      );
    }

    if (this.contributeLegacyCommands) {
      contributions.commands = createTemplateOverlayCommands(this);
    }

    return contributions;
  }

  private createRenderIntentCompiler(): RenderIntentCompilerContribution<
    EditorEffect<TemplateOverlayEffectPayload>,
    EditorDocument
  > {
    return {
      capabilityId: this.capabilityId,
      effectType: "template-overlay",
      compile: (context) => this.compileDocumentTemplateOverlayEffect(context),
    };
  }

  private compileDocumentTemplateOverlayEffect(
    context: RenderIntentCompilerContext<
      EditorEffect<TemplateOverlayEffectPayload>,
      EditorDocument
    >,
  ): RenderIntentPatch | void {
    if (context.target.kind !== "object" || !context.target.objectId) return;

    const { role, slot } = this.readTemplateOverlayPayload(context.effect);
    return {
      id: context.target.objectId,
      overlay: {
        enabled: true,
        role,
        slot,
      },
      data: {
        templateOverlay: {
          enabled: true,
          role,
          slot,
          targetOverlaySlot: slot,
        },
      },
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

  async patchConfig(
    patch: TemplateOverlayConfigPatch,
  ): Promise<TemplateOverlayConfig> {
    const next = patchTemplateOverlayConfig(this.config, patch);
    await this.writeConfig(next);
    return this.getConfig();
  }

  async clearConfig(): Promise<TemplateOverlayConfig> {
    const next = createEmptyTemplateOverlayConfig();
    await this.writeConfig(next);
    return this.getConfig();
  }

  refresh(): void {
    this.applyRuntimePatches();
  }

  private getTemplateFacade(): TemplateOverlayCapabilityApi {
    const facade: TemplateOverlayCapabilityApi = {
      clearConfig: () => this.clearConfig(),
      getConfig: () => this.getConfig(),
      patchConfig: (patch) => this.patchConfig(patch),
      refresh: () => this.refresh(),
      replaceConfig: (config) => this.replaceConfig(config),
    };
    return facade;
  }

  private onSceneLayoutChanged = () => {
    this.refresh();
  };

  private async writeConfig(next: TemplateOverlayConfig) {
    this.config = normalizeTemplateOverlayConfig(next);
    this.isUpdatingConfig = true;
    try {
      this.getConfigService()?.update(this.configKey, this.config);
    } finally {
      this.isUpdatingConfig = false;
    }
    this.refresh();
  }

  private getConfigService(): ConfigurationService | undefined {
    return this.context?.services.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
  }

  private getSurfaceFrameRect(): FrameRect {
    return resolveSurfaceFrameRect(this.canvasService, this.getConfigService());
  }

  private applyRuntimePatches(): void {
    const renderIntentService = this.renderIntentService;
    if (!renderIntentService) return;
    renderIntentService.clearRuntimePatches(TEMPLATE_OVERLAY_RENDER_SCOPE);
    const frame = this.getSurfaceFrameRect();
    renderIntentService
      .getGraph()
      .layers.flatMap((layer) =>
        layer.nodes.map((node) => ({ layer, node })),
      )
      .forEach(({ layer, node }) => {
        const overlay = isRecord(node.data.templateOverlay)
          ? node.data.templateOverlay
          : {};
        const slot = readTemplateOverlaySlot(overlay.slot);
        if (!slot) return;

        const slotConfig = this.config.slots[slot];
        if (!slotConfig) return;
        const src = slotConfig.src.trim();
        const slotFrame = this.resolveSlotFrame(frame, slotConfig.placement);
        const visible = slotConfig.enabled !== false && Boolean(src);
        renderIntentService.patchIntent(TEMPLATE_OVERLAY_RENDER_SCOPE, {
          id: node.subjectId,
          subject: {
            kind: "object",
            surfaceId: node.surfaceId,
            layerId: node.layerId,
            objectId: node.subjectId,
            objectType: node.type,
          },
          visual: visible
            ? {
                type: "image",
                replacement: {
                  src,
                  metadata: {
                    templateOverlay: {
                      slot,
                      source: TEMPLATE_OVERLAY_RENDER_SCOPE,
                    },
                  },
                },
              }
            : { type: "image" },
          placement: {
            frame: {
              x: slotFrame.left,
              y: slotFrame.top,
              width: slotFrame.width,
              height: slotFrame.height,
            },
            transform: {
              left: slotFrame.left,
              top: slotFrame.top,
              originX: "left",
              originY: "top",
            },
          },
          overlay: {
            enabled: true,
            slot,
          },
          export: {
            visible,
          },
          ordering: {
            layerId: node.layerId,
            layerOrder: layer.order,
            objectOrder: node.sortKey.objectOrder,
            channel: node.sortKey.channel,
            subOrder: node.sortKey.subOrder,
            stack: layer.stack,
          },
          props: {
            opacity:
              typeof slotConfig.opacity === "number" ? slotConfig.opacity : 1,
          },
        });
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

  private readTemplateOverlayPayload(
    effect: EditorEffect<TemplateOverlayEffectPayload>,
  ): { role: string; slot: TemplateOverlaySlotName } {
    const payload =
      effect.payload && typeof effect.payload === "object" ? effect.payload : {};
    const role = typeof payload.role === "string" && payload.role.trim()
      ? payload.role.trim()
      : "default-artwork";
    return {
      role,
      slot: readTemplateOverlaySlot(payload.slot) ?? "normal",
    };
  }
}
