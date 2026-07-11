import type { CapabilityDefinition } from "../capability";
import type {
  RenderEffectDefinition,
  RenderEffectRendererContribution,
} from "../render";
import type { RenderIntentCompilerContribution } from "../render-intent";

export interface CommandContribution {
  id: string;
  command: string;
  title: string;
  handler?: (...args: any[]) => any;
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
  renderEffectDefinitions?: RenderEffectDefinition[];
  renderEffectRenderers?: RenderEffectRendererContribution[];
  renderIntentCompilers?: RenderIntentCompilerContribution[];
}
