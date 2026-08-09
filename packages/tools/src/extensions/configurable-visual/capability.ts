import type { CapabilityDefinition } from "@pooder/core";
import type { EditorObject } from "@pooder/document";

export const CONFIGURABLE_VISUAL_CAPABILITY_ID =
  "pooder.kit.configurable-visual";

export interface ConfigurableVisualCapabilityOptions {
  capabilityId?: string;
}

export interface ConfigurableVisualCapabilityApi {
  getBehaviorKey(object: EditorObject): string | null;
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
        "Identifies document-owned visuals that a host may configure.",
      tags: ["kit", "configurable-visual", "behavior"],
    },
    commands: [],
    facade,
  };
}
