export * from "./points";
export * from "./registry";

import { ContributionRegistry } from "./registry";
import {
  ContributionPointIds,
  CommandContribution,
  ToolContribution,
  ViewContribution,
  ContributionPoint,
} from "./points";

const registry = new ContributionRegistry();

// Initialize default contribution points
registry.registerPoint<ContributionPoint>({
  id: ContributionPointIds.CONTRIBUTIONS,
  description: "Contribution point for contribution points",
});

registry.registerPoint<CommandContribution>({
  id: ContributionPointIds.COMMANDS,
  description: "Contribution point for commands",
});

registry.registerPoint<ToolContribution>({
  id: ContributionPointIds.TOOLS,
  description: "Contribution point for tools",
});

registry.registerPoint<ViewContribution>({
  id: ContributionPointIds.VIEWS,
  description: "Contribution point for UI views",
});

export const contributionRegistry = registry;
