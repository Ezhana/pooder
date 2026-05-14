import type { CapabilityDefinition } from "@pooder/core";
import type {
  TemplateOverlayConfig,
  TemplateOverlayConfigPatch,
} from "./model";

export const TEMPLATE_OVERLAY_CAPABILITY_ID = "pooder.kit.template-overlay";

export interface TemplateOverlayLayerOptions {
  clipTargetLayerIds?: string[];
}

export interface TemplateOverlayCapabilityOptions {
  capabilityId?: string;
  configNamespace?: string;
  layers?: TemplateOverlayLayerOptions;
}

export interface TemplateOverlayCapabilityApi {
  getConfig(): TemplateOverlayConfig;
  replaceConfig(config: unknown): Promise<TemplateOverlayConfig>;
  patchConfig(
    patch: TemplateOverlayConfigPatch,
  ): Promise<TemplateOverlayConfig>;
  clearConfig(): Promise<TemplateOverlayConfig>;
  refresh(): void;
}

export function normalizeTemplateOverlayConfigNamespace(
  namespace: string | undefined,
): string {
  const normalized = String(namespace || "templateOverlay").trim();
  return normalized || "templateOverlay";
}

export function getTemplateOverlayConfigKey(
  namespace: string | undefined,
  path: string,
): string {
  return `${normalizeTemplateOverlayConfigNamespace(namespace)}.${path}`;
}

export function normalizeTemplateOverlayLayerId(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function createTemplateOverlayCapabilityDefinition(
  facade: TemplateOverlayCapabilityApi,
  options: TemplateOverlayCapabilityOptions = {},
): CapabilityDefinition<TemplateOverlayCapabilityApi> {
  return {
    id: options.capabilityId || TEMPLATE_OVERLAY_CAPABILITY_ID,
    metadata: {
      name: "Template Overlay",
      description:
        "Render and configure template overlays without requiring a " +
        "kit-owned toolbar tool.",
      tags: ["kit", "template-overlay", "layer"],
    },
    commands: [
      { id: "getTemplateOverlayConfig", title: "Get Template Overlay Config" },
      {
        id: "replaceTemplateOverlayConfig",
        title: "Replace Template Overlay Config",
      },
      {
        id: "patchTemplateOverlayConfig",
        title: "Patch Template Overlay Config",
      },
      {
        id: "clearTemplateOverlayConfig",
        title: "Clear Template Overlay Config",
      },
    ],
    facade,
  };
}
