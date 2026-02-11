import { ToolContribution } from "../contribution";
import Disposable from "../disposable";
import { Service } from "../service";

export default class ToolRegistryService implements Service {
  private tools = new Map<string, ToolContribution>();

  registerTool(tool: ToolContribution): Disposable {
    if (!tool?.id) {
      throw new Error("ToolContribution.id is required.");
    }
    this.tools.set(tool.id, tool);
    return {
      dispose: () => {
        if (this.tools.get(tool.id) === tool) {
          this.tools.delete(tool.id);
        }
      },
    };
  }

  unregisterTool(toolId: string) {
    this.tools.delete(toolId);
  }

  getTool(toolId: string): ToolContribution | undefined {
    return this.tools.get(toolId);
  }

  listTools(): ToolContribution[] {
    return Array.from(this.tools.values());
  }

  hasTool(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  dispose() {
    this.tools.clear();
  }
}
