import type { CapabilityDefinition } from "@pooder/core";
import type {
  ConfigurableVisualConfig,
} from "./model";

export const CONFIGURABLE_VISUAL_CAPABILITY_ID =
  "pooder.kit.configurable-visual";

export interface ConfigurableVisualCapabilityOptions {
  capabilityId?: string;
}

export interface ConfigurableVisualCapabilityApi {
  getConfig(configKey: string): ConfigurableVisualConfig;
  refresh(): void;
}

export function normalizeConfigurableVisualConfigKey(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createConfigurableVisualCapabilityDefinition(
  facade: ConfigurableVisualCapabilityApi,
  options: ConfigurableVisualCapabilityOptions = {},
): CapabilityDefinition<ConfigurableVisualCapabilityApi> {
  return {
    id: options.capabilityId || CONFIGURABLE_VISUAL_CAPABILITY_ID,
    metadata: {
      name: "Configurable Visual",
      description:
        "Patch object visuals from document configuration without rewriting " +
        "the document structure.",
      tags: ["kit", "configurable-visual", "runtime-config"],
    },
    commands: [
      { id: "getConfigurableVisualConfig", title: "Get Configurable Visual Config" },
    ],
    facade,
  };
}
