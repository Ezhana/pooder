import {
  CONFIGURATION_SERVICE,
  RENDER_INTENT_SERVICE,
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
} from "@pooder/document";
import { getOfficialToolEffectSchema } from "../../document/effect-schemas";
import { SubscriptionBag } from "../../shared/runtime/subscriptions";
import {
  CONFIGURABLE_VISUAL_CAPABILITY_ID,
  createConfigurableVisualCapabilityDefinition,
  normalizeConfigurableVisualConfigKey,
  type ConfigurableVisualClearInput,
  type ConfigurableVisualCapabilityApi,
  type ConfigurableVisualCapabilityOptions,
  type ConfigurableVisualCommitInput,
} from "./capability";
import {
  createEmptyConfigurableVisualConfig,
  normalizeConfigurableVisualConfig,
  type ConfigurableVisualConfig,
} from "./model";

const CONFIGURABLE_VISUAL_RENDER_SCOPE = "pooder.kit.configurable-visual";
const DEFAULT_CONFIG_KEY = "configurableVisual";

interface ConfigurableVisualEffectPayload {
  configKey?: unknown;
  key?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export interface ConfigurableVisualCapabilityExtensionOptions
  extends ConfigurableVisualCapabilityOptions {
  id?: string;
}

export class ConfigurableVisualCapabilityExtension implements ExtensionDefinition {
  id: string;

  metadata = {
    name: "ConfigurableVisualCapabilityExtension",
  };

  activation = {
    requiresServices: [CONFIGURATION_SERVICE, RENDER_INTENT_SERVICE],
  };

  private context?: ExtensionContext;
  private renderIntentService?: RenderIntentService;
  private isApplyingRuntimePatches = false;
  private readonly subscriptions = new SubscriptionBag();
  private readonly capabilityId: string;

  constructor(options: ConfigurableVisualCapabilityExtensionOptions = {}) {
    this.id =
      String(options.id || CONFIGURABLE_VISUAL_RENDER_SCOPE).trim() ||
      CONFIGURABLE_VISUAL_RENDER_SCOPE;
    this.capabilityId =
      options.capabilityId || CONFIGURABLE_VISUAL_CAPABILITY_ID;
  }

  activate(context: ExtensionContext) {
    this.subscriptions.disposeAll();
    this.context = context;
    this.renderIntentService = context.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );

    const configService = context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    this.subscriptions.onConfigChange(
      configService,
      () => this.refresh(),
    );
    this.subscriptions.add(
      this.renderIntentService.onDidChange(() => {
        if (this.isApplyingRuntimePatches) return;
        this.refresh();
      }),
    );

    this.refresh();
  }

  deactivate() {
    this.subscriptions.disposeAll();
    this.renderIntentService?.clearRuntimePatches(
      CONFIGURABLE_VISUAL_RENDER_SCOPE,
    );
    this.renderIntentService = undefined;
    this.context = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createConfigurableVisualCapabilityDefinition(
          this.getConfigurableVisualFacade(),
          {
            capabilityId: this.capabilityId,
          },
        ),
      ],
      documentExtensions: [
        {
          id: this.id,
          effects: [getOfficialToolEffectSchema("configurable-visual")],
        },
      ],
      renderIntentCompilers: [this.createRenderIntentCompiler()],
    };
  }

  getConfig(configKey: string): ConfigurableVisualConfig {
    const key = normalizeConfigurableVisualConfigKey(configKey);
    if (!key) return createEmptyConfigurableVisualConfig();
    return normalizeConfigurableVisualConfig(this.getConfigService()?.get(key));
  }

  refresh = (): void => {
    this.applyRuntimePatches();
  };

  private createRenderIntentCompiler(): RenderIntentCompilerContribution<
    EditorEffect<ConfigurableVisualEffectPayload>,
    EditorDocument
  > {
    return {
      capabilityId: this.capabilityId,
      effectType: "configurable-visual",
      compile: (context) => this.compileDocumentConfigurableVisualEffect(context),
    };
  }

  private compileDocumentConfigurableVisualEffect(
    context: RenderIntentCompilerContext<
      EditorEffect<ConfigurableVisualEffectPayload>,
      EditorDocument
    >,
  ): RenderIntentPatch | void {
    if (context.target.kind !== "object" || !context.target.objectId) return;

    const payload = this.readConfigurableVisualPayload(context.effect);
    return {
      id: context.target.objectId,
      data: {
        configurableVisual: {
          enabled: true,
          configKey: payload.configKey,
          key: payload.key,
        },
      },
    };
  }

  private getConfigurableVisualFacade(): ConfigurableVisualCapabilityApi {
    return {
      clearCommittedVisual: (input) => this.clearCommittedVisual(input),
      getConfig: (configKey) => this.getConfig(configKey),
      refresh: () => this.refresh(),
      setCommittedVisual: (input) => this.setCommittedVisual(input),
    };
  }

  private getConfigService(): ConfigurationService | undefined {
    return this.context?.services.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
  }

  private setCommittedVisual(input: ConfigurableVisualCommitInput): void {
    const configService = this.getConfigService();
    if (!configService) return;

    const configKey =
      normalizeConfigurableVisualConfigKey(input.configKey) ||
      DEFAULT_CONFIG_KEY;
    const key = normalizeConfigurableVisualConfigKey(input.key);
    const src = typeof input.src === "string" ? input.src.trim() : "";
    if (!configKey || !key) return;

    const current = this.getConfig(configKey);
    configService.update(configKey, {
      ...current,
      [key]: {
        ...(current[key] ?? {}),
        ...(input.metadata ?? {}),
        enabled: input.enabled ?? Boolean(src),
        ...(typeof input.opacity === "number" ? { opacity: input.opacity } : {}),
        src,
      },
    });
    this.refresh();
  }

  private clearCommittedVisual(input: ConfigurableVisualClearInput): void {
    const configService = this.getConfigService();
    if (!configService) return;

    const configKey =
      normalizeConfigurableVisualConfigKey(input.configKey) ||
      DEFAULT_CONFIG_KEY;
    const key = normalizeConfigurableVisualConfigKey(input.key);
    if (!configKey || !key) return;

    const current = this.getConfig(configKey);
    configService.update(configKey, {
      ...current,
      [key]: {
        ...(current[key] ?? {}),
        enabled: false,
        src: "",
      },
    });
    this.refresh();
  }

  private applyRuntimePatches(): void {
    const renderIntentService = this.renderIntentService;
    if (!renderIntentService || this.isApplyingRuntimePatches) return;

    this.isApplyingRuntimePatches = true;
    try {
      renderIntentService.clearRuntimePatches(CONFIGURABLE_VISUAL_RENDER_SCOPE);
      renderIntentService
        .getGraph()
        .layers.flatMap((layer) =>
          layer.nodes.map((node) => ({ layer, node })),
        )
        .forEach(({ layer, node }) => {
          const binding = isRecord(node.data.configurableVisual)
            ? node.data.configurableVisual
            : {};
          const configKey = normalizeConfigurableVisualConfigKey(
            binding.configKey,
          );
          const key = normalizeConfigurableVisualConfigKey(binding.key);
          if (!configKey) return;
          if (!key) return;
          const config = this.getConfig(configKey);
          const configEntry = config[key];
          if (!configEntry) return;

          const src = typeof configEntry.src === "string"
            ? configEntry.src.trim()
            : "";
          const visible = configEntry.enabled !== false && Boolean(src);
          const {
            enabled: _enabled,
            opacity: _opacity,
            src: _src,
            ...metadata
          } = configEntry;
          renderIntentService.patchIntent(CONFIGURABLE_VISUAL_RENDER_SCOPE, {
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
                      ...metadata,
                      configurableVisual: {
                        configKey,
                        key,
                        source: CONFIGURABLE_VISUAL_RENDER_SCOPE,
                      },
                    },
                  },
                }
              : { type: "image" },
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
                typeof configEntry.opacity === "number" ? configEntry.opacity : 1,
            },
          });
        });
    } finally {
      this.isApplyingRuntimePatches = false;
    }
  }

  private readConfigurableVisualPayload(
    effect: EditorEffect<ConfigurableVisualEffectPayload>,
  ): { configKey: string; key: string } {
    const payload =
      effect.payload && typeof effect.payload === "object" ? effect.payload : {};
    const configKey =
      normalizeConfigurableVisualConfigKey(payload.configKey) ||
      DEFAULT_CONFIG_KEY;
    const key = normalizeConfigurableVisualConfigKey(payload.key);
    return { configKey, key };
  }
}
