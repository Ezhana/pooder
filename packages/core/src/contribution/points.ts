export interface ContributionPoint<T = any> {
  id: string;
  description?: string;
  validate?: (data: T) => boolean;
}

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
  configurations?: ConfigurationContribution[];
  commands?: CommandContribution[];
  tools?: ToolContribution[];
}

export const ContributionPointIds = {
  COMMANDS: "contribution.point.commands",
  TOOLS: "contribution.point.tools",
  CONFIGURATIONS: "contribution.point.configurations",
} as const;
