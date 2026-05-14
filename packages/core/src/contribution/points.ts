import type { CapabilityDefinition } from "../capability";
import type { EffectApplicatorContribution } from "../effect-applicator";
import type { RenderIntentCompilerContribution } from "../render-intent";

export interface CommandContribution {
  id: string;
  command: string;
  title: string;
  handler?: (...args: any[]) => any;
}

export type ToolInteraction = "instant" | "session" | "hybrid";

export type ToolSessionLeavePolicy = "block" | "commit" | "rollback";

export interface ToolCommandBindings {
  execute?: string;
  begin?: string;
  validate?: string;
  commit?: string;
  rollback?: string;
  reset?: string;
}

export interface ToolContribution {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  interaction: ToolInteraction;
  parameters?: Record<string, any>;
  commands?: ToolCommandBindings;
  session?: {
    autoBegin?: boolean;
    leavePolicy?: ToolSessionLeavePolicy;
  };
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
  effectApplicators?: EffectApplicatorContribution[];
  renderIntentCompilers?: RenderIntentCompilerContribution[];
  tools?: ToolContribution[];
}
