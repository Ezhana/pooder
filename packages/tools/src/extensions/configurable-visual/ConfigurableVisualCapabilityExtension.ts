import type {
  ExtensionContributions,
  ExtensionDefinition,
} from "@pooder/core";
import type { EditorObject } from "@pooder/document";

import {
  CONFIGURABLE_VISUAL_BEHAVIOR_DEFINITION,
  CONFIGURABLE_VISUAL_BEHAVIOR_TYPE,
} from "../../document/behavior-schemas";
import {
  CONFIGURABLE_VISUAL_CAPABILITY_ID,
  createConfigurableVisualCapabilityDefinition,
  type ConfigurableVisualCapabilityApi,
  type ConfigurableVisualCapabilityOptions,
} from "./capability";

export interface ConfigurableVisualCapabilityExtensionOptions
  extends ConfigurableVisualCapabilityOptions {
  id?: string;
}

export class ConfigurableVisualCapabilityExtension
  implements ExtensionDefinition
{
  readonly id: string;
  readonly metadata = { name: "ConfigurableVisualCapabilityExtension" };
  private readonly capabilityId: string;

  constructor(options: ConfigurableVisualCapabilityExtensionOptions = {}) {
    this.id =
      String(options.id || CONFIGURABLE_VISUAL_CAPABILITY_ID).trim() ||
      CONFIGURABLE_VISUAL_CAPABILITY_ID;
    this.capabilityId =
      options.capabilityId || CONFIGURABLE_VISUAL_CAPABILITY_ID;
  }

  activate(): void {}

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createConfigurableVisualCapabilityDefinition(this.facade(), {
          capabilityId: this.capabilityId,
        }),
      ],
      documentExtensions: [
        {
          id: this.id,
          behaviors: [CONFIGURABLE_VISUAL_BEHAVIOR_DEFINITION],
        },
      ],
    };
  }

  private facade(): ConfigurableVisualCapabilityApi {
    return {
      getBehaviorKey: (object) => getConfigurableVisualBehaviorKey(object),
    };
  }
}

export function getConfigurableVisualBehaviorKey(
  object: EditorObject,
): string | null {
  const behavior = object.behaviors?.find(
    (candidate) => candidate.type === CONFIGURABLE_VISUAL_BEHAVIOR_TYPE,
  );
  const config = behavior?.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }
  const key = (config as { key?: unknown }).key;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}
