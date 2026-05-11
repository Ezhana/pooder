import type { CommandContribution } from "@pooder/core";
import { detectImageEdge, type DetectEdgeOptions } from "../edge-detection";

export function createDielineCommands(
  tool: any,
  _state?: any,
): CommandContribution[] {
  return [
    {
      command: "updateFeaturePosition",
      id: "updateFeaturePosition",
      title: "Update Feature Position",
      handler: (groupId: string, x: number, y: number) => {
        tool.updateFeaturePosition(groupId, x, y);
      },
    },
    {
      command: "detectEdge",
      id: "detectEdge",
      title: "Detect Edge from Image",
      handler: async (imageUrl: string, options?: DetectEdgeOptions) =>
        typeof tool.detectEdge === "function"
          ? await tool.detectEdge(imageUrl, options)
          : await detectImageEdge(imageUrl, options),
    },
  ];
}
