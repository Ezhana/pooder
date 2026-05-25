import type { CapabilityDefinition } from "../capability";
import type { RenderIntentCompilerContribution } from "../render-intent";

export interface CommandContribution {
  id: string;
  command: string;
  title: string;
  handler?: (...args: any[]) => any;
}

export type ToolInteraction = "instant" | "session" | "hybrid";

export interface ToolCommandBindings {
  execute?: string;
}

/**
 * @deprecated Legacy toolbar metadata. Core no longer consumes
 * ExtensionContributions.tools automatically; applications should own tool
 * catalogs and explicitly register any app-level tools they still need.
 */
export interface ToolContribution {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  interaction: ToolInteraction;
  parameters?: Record<string, any>;
  commands?: ToolCommandBindings;
}

export interface ConfigurationContribution {
  id: string;
  type:
    | "string"
    | "number"
    | "boolean"
    | "color"
    | "select"
    | "json"
    | "array";
  label: string;
  default?: any;
  description?: string;
  options?: Array<string | number>;
  min?: number;
  max?: number;
  step?: number;
}

export interface ExtensionContributions {
  capabilities?: CapabilityDefinition[];
  configurations?: ConfigurationContribution[];
  commands?: CommandContribution[];
  renderIntentCompilers?: RenderIntentCompilerContribution[];
  /**
   * @deprecated Core no longer consumes tools contributions automatically.
   * Applications should own product tool catalogs and explicitly register any
   * compatibility tools through app-level code.
   */
  tools?: ToolContribution[];
}
