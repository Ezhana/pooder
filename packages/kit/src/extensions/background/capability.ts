import type { CapabilityDefinition } from "@pooder/core";
import type { BackgroundConfig, BackgroundLayer } from "./BackgroundTool";

export const BACKGROUND_CAPABILITY_ID = "pooder.kit.background";

export interface BackgroundLayerOptions {
  backgroundLayerId?: string;
}

export interface BackgroundCapabilityOptions {
  capabilityId?: string;
  configNamespace?: string;
  layers?: BackgroundLayerOptions;
}

export interface BackgroundCapabilityApi {
  getConfig(): BackgroundConfig;
  resetConfig(): boolean;
  replaceConfig(config: BackgroundConfig): boolean;
  patchConfig(patch: Partial<BackgroundConfig>): boolean;
  upsertLayer(layer: Partial<BackgroundLayer> & { id: string }): boolean;
  removeLayer(id: string): boolean;
  refresh(): void;
}

export function normalizeBackgroundConfigNamespace(
  namespace: string | undefined,
): string {
  const normalized = String(namespace || "background").trim();
  return normalized || "background";
}

export function getBackgroundConfigKey(
  namespace: string | undefined,
  path: string,
): string {
  return `${normalizeBackgroundConfigNamespace(namespace)}.${path}`;
}

export function normalizeBackgroundLayerId(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function createBackgroundCapabilityDefinition(
  facade: BackgroundCapabilityApi,
  options: BackgroundCapabilityOptions = {},
): CapabilityDefinition<BackgroundCapabilityApi> {
  return {
    id: options.capabilityId || BACKGROUND_CAPABILITY_ID,
    metadata: {
      name: "Background",
      description:
        "Render and configure background layers without requiring a " +
        "kit-owned toolbar tool.",
      tags: ["kit", "background", "layer"],
    },
    commands: [
      { id: "getBackgroundConfig", title: "Get Background Config" },
      { id: "replaceBackgroundConfig", title: "Replace Background Config" },
      { id: "patchBackgroundConfig", title: "Patch Background Config" },
      { id: "upsertBackgroundLayer", title: "Upsert Background Layer" },
      { id: "removeBackgroundLayer", title: "Remove Background Layer" },
    ],
    facade,
  };
}
