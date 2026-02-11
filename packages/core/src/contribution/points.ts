export interface ContributionPoint<T = any> {
  id: string;
  description?: string;
  validate?: (data: T) => boolean;
}

/**
 * Command Contribution Data Definition
 */
export interface CommandContribution {
  id: string;
  command: string;
  title: string;
  handler?: (...args: any[]) => any;
}

/**
 * Tool Contribution Data Definition
 */
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
  view?: {
    id?: string;
    type?: "sidebar" | "panel" | "editor" | "dialog";
    location?: string;
  };
  session?: {
    autoBegin?: boolean;
    leavePolicy?: ToolSessionLeavePolicy;
  };
}

/**
 * View Contribution Data Definition
 */
export interface ViewContribution {
  id: string;
  name: string;
  type: "sidebar" | "panel" | "editor" | "dialog" | "status-bar";
  component: any; // The component implementation (e.g., React component or generic render function)
  location?: string;
  icon?: string;
  priority?: number;
}

/**
 * Configuration Contribution Data Definition
 */
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
  options?: string[]; // For select type
  min?: number;
  max?: number;
  step?: number;
}

// Built-in Contribution Point IDs
export const ContributionPointIds = {
  CONTRIBUTIONS: "contribution.point.contributions",
  COMMANDS: "contribution.point.commands",
  TOOLS: "contribution.point.tools",
  VIEWS: "contribution.point.views",
  CONFIGURATIONS: "contribution.point.configurations",
};
