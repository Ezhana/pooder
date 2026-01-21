import { ExtensionContext } from "./context";
import {
  ContributionPointIds,
  CommandContribution,
  ToolContribution,
  ViewContribution,
} from "./contribution";
import { Extension } from "./extension";
import CommandService from "./services/CommandService";

export const fullExtension: Extension = {
  metadata: {
    name: "Full Feature Test Extension",
  },

  activate(context: ExtensionContext) {
    console.log("Full Feature Test Extension activated!");

    // Manually register a command (imperative way)
    const commandService =
      context.services.get<CommandService>("CommandService");
    commandService!.registerCommand("test.imperative.hello", (name: string) => {
      return `Hello Imperative ${name}`;
    });
  },

  deactivate(context: ExtensionContext) {
    console.log("Full Feature Test Extension deactivated!");
  },

  contribute() {
    return {
      // 1. Command Contributions
      [ContributionPointIds.COMMANDS]: [
        // Declarative command with handler (auto-registered by our updated ExtensionManager)
        {
          command: "test.declarative.auto",
          title: "Auto Registered Command",
          handler: () => {
            return "Auto Registered Result";
          },
        } as CommandContribution,

        // Declarative command without handler (just definition, maybe handled elsewhere)
        {
          command: "test.declarative.no-handler",
          title: "No Handler Command",
        } as CommandContribution,
      ],

      // 2. Tool Contributions
      [ContributionPointIds.TOOLS]: [
        {
          name: "Calculator",
          description: "Simple calculator",
          execute: async (op: string, a: number, b: number) => {
            if (op === "add") return a + b;
            return 0;
          },
        } as ToolContribution,
      ],

      // 3. View Contributions
      [ContributionPointIds.VIEWS]: [
        {
          name: "Test Sidebar",
          type: "sidebar",
          component: "SidebarComponent", // Mock component string
          location: "left",
        } as ViewContribution,
      ],
    };
  },
};
