import type { CommandContribution } from "@pooder/core";
import { DESIGN_EXPORT_CAPABILITY_ID } from "./design-export/capability";
import { DIELINE_GEOMETRY_CAPABILITY_ID } from "./dieline/capability";
import { EDGE_DETECTION_CAPABILITY_ID } from "./edge-detection/capability";
import { FEATURE_CAPABILITY_ID } from "./feature/capability";

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
  updateFeaturePosition: {
    legacyCommand: "updateFeaturePosition",
    capabilityId: DIELINE_GEOMETRY_CAPABILITY_ID,
    facadeMethod: "updateFeaturePosition",
    replacement: "DielineGeometryCapabilityApi.updateFeaturePosition()",
  },
  beginFeatureSession: {
    legacyCommand: "beginFeatureSession",
    capabilityId: FEATURE_CAPABILITY_ID,
    facadeMethod: "beginSession",
    replacement: "FeatureCapabilityApi.beginSession()",
  },
  addFeature: {
    legacyCommand: "addFeature",
    capabilityId: FEATURE_CAPABILITY_ID,
    facadeMethod: "addFeature",
    replacement: "FeatureCapabilityApi.addFeature()",
  },
  addHole: {
    legacyCommand: "addHole",
    capabilityId: FEATURE_CAPABILITY_ID,
    facadeMethod: "addFeature",
    replacement: "FeatureCapabilityApi.addFeature('subtract')",
  },
  addDoubleLayerHole: {
    legacyCommand: "addDoubleLayerHole",
    capabilityId: FEATURE_CAPABILITY_ID,
    facadeMethod: "addDoubleLayerHole",
    replacement: "FeatureCapabilityApi.addDoubleLayerHole()",
  },
  clearFeatures: {
    legacyCommand: "clearFeatures",
    capabilityId: FEATURE_CAPABILITY_ID,
    facadeMethod: "clearFeatures",
    replacement: "FeatureCapabilityApi.clearFeatures()",
  },
  rollbackFeatureSession: {
    legacyCommand: "rollbackFeatureSession",
    capabilityId: FEATURE_CAPABILITY_ID,
    facadeMethod: "rollbackSession",
    replacement: "FeatureCapabilityApi.rollbackSession()",
  },
  resetWorkingFeatures: {
    legacyCommand: "resetWorkingFeatures",
    capabilityId: FEATURE_CAPABILITY_ID,
    facadeMethod: "resetSession",
    replacement: "FeatureCapabilityApi.resetSession()",
  },
  updateWorkingGroupPosition: {
    legacyCommand: "updateWorkingGroupPosition",
    capabilityId: FEATURE_CAPABILITY_ID,
    facadeMethod: "updateWorkingGroupPosition",
    replacement: "FeatureCapabilityApi.updateWorkingGroupPosition()",
  },
  completeFeatures: {
    legacyCommand: "completeFeatures",
    capabilityId: FEATURE_CAPABILITY_ID,
    facadeMethod: "completeSession",
    replacement: "FeatureCapabilityApi.completeSession()",
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
