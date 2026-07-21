import type { CommandContribution } from "@pooder/core";
import type { DetectEdgeOptions } from "../edge-detection";
import { createLegacyCommandBridge } from "../legacyCommandBridge";

export function createDielineCommands(
  tool: any,
  _state?: any,
): CommandContribution[] {
  return [
    createLegacyCommandBridge(
      "updateFeaturePosition",
      "Update Feature Position",
      (groupId: string, x: number, y: number) => {
        tool.updateFeaturePosition(groupId, x, y);
      },
    ),
    createLegacyCommandBridge(
      "detectEdge",
      "Detect Edge from Image",
      async (imageUrl: string, options?: DetectEdgeOptions) =>
        await tool.detectEdge(imageUrl, options),
    ),
  ];
}
