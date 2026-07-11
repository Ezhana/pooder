import type { CapabilityDefinition } from "@pooder/core";
import type {
  ConfigurableVisualConfig,
} from "./model";

export const CONFIGURABLE_VISUAL_CAPABILITY_ID =
  "pooder.kit.configurable-visual";

export interface ConfigurableVisualCapabilityOptions {
  capabilityId?: string;
}

export interface ConfigurableVisualCommitInput {
  configKey?: string;
  key: string;
  src: string;
  enabled?: boolean;
  opacity?: number;
  metadata?: Record<string, unknown>;
}

export interface ConfigurableVisualClearInput {
  configKey?: string;
  key: string;
}

export interface ConfigurableVisualCapabilityApi {
  clearCommittedVisual(input: ConfigurableVisualClearInput): void;
  getConfig(configKey: string): ConfigurableVisualConfig;
  refresh(): void;
  setCommittedVisual(input: ConfigurableVisualCommitInput): void;
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
      { id: "setConfigurableVisualCommittedVisual", title: "Set Configurable Visual Committed Visual" },
      { id: "clearConfigurableVisualCommittedVisual", title: "Clear Configurable Visual Committed Visual" },
    ],
    facade,
  };
}
