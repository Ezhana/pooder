import type { CommandContribution } from "@pooder/core";
import { DESIGN_EXPORT_CAPABILITY_ID } from "./design-export/capability";
import { EDGE_DETECTION_CAPABILITY_ID } from "./edge-detection/capability";

export interface LegacyCommandBridgeDefinition {
  legacyCommand: string;
  capabilityId: string;
  facadeMethod: string;
  replacement: string;
}

export const LEGACY_COMMAND_BRIDGES = {
  exportImage: {
    legacyCommand: "exportImage",
    capabilityId: DESIGN_EXPORT_CAPABILITY_ID,
    facadeMethod: "exportImage",
    replacement: "DesignExportCapabilityApi.exportImage()",
  },
  detectEdge: {
    legacyCommand: "detectEdge",
    capabilityId: EDGE_DETECTION_CAPABILITY_ID,
    facadeMethod: "detectEdge",
    replacement: "EdgeDetectionCapabilityApi.detectEdge()",
  },
} as const satisfies Record<string, LegacyCommandBridgeDefinition>;

export type LegacyCommandBridgeId = keyof typeof LEGACY_COMMAND_BRIDGES;

export function listLegacyCommandBridges(): LegacyCommandBridgeDefinition[] {
  return Object.values(LEGACY_COMMAND_BRIDGES);
}

export function createLegacyCommandBridge(
  id: LegacyCommandBridgeId,
  title: string,
  handler: NonNullable<CommandContribution["handler"]>,
): CommandContribution {
  const bridge = LEGACY_COMMAND_BRIDGES[id];
  return {
    id: bridge.legacyCommand,
    command: bridge.legacyCommand,
    title,
    handler,
  };
}
