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
  category?: string;
  icon?: string;
  keybinding?: {
    win?: string;
    mac?: string;
    linux?: string;
    when?: string;
  };
  handler?: (...args: any[]) => any;
}

/**
 * Tool Contribution Data Definition
 */
export interface ToolContribution {
  id: string;
  name: string;
  description: string;
  parameters?: Record<string, any>; // JSON Schema for parameters
  execute: (...args: any[]) => Promise<any>;
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
 * Generic Contribution Wrapper
 */
export interface Contribution<T = any> {
  pointId: string;
  id: string;
  data: T;
}

// Built-in Contribution Point IDs
export const ContributionPointIds = {
  CONTRIBUTIONS: "contribution.point.contributions",
  COMMANDS: "contribution.point.commands",
  TOOLS: "contribution.point.tools",
  VIEWS: "contribution.point.views",
};
