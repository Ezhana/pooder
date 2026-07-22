import type {
  CapabilityDefinition,
  Disposable,
  RenderObjectSpec,
} from "@pooder/core";
import type { ConstraintFeature } from "../constraints";
import type {
  FeaturePlacement,
  FeaturePlacementGeometry,
  FeatureProjectionGeometry,
} from "../featurePlacement";

export const FEATURE_CAPABILITY_ID = "pooder.kit.feature";

export interface FeatureLayerOptions {
  markerLayerId?: string;
  baseDielineLayerId?: string;
  sessionDielineLayerId?: string;
  imageClipLayerIds?: string[];
}

export interface FeatureCapabilityOptions {
  capabilityId?: string;
  configNamespace?: string;
  layers?: FeatureLayerOptions;
}

export type FeatureOperation = "add" | "subtract";

export interface ReplaceFeaturesOptions {
  target?: "working" | "committed" | "both";
  markDirty?: boolean;
}

export interface FeatureCompletionIssue {
  featureId: string;
  groupId?: string;
  reason: string;
}

export interface FeatureCompletionResult {
  ok: boolean;
  issues?: FeatureCompletionIssue[];
}

export interface FeatureWorkingChangeEvent {
  features: ConstraintFeature[];
}

export interface FeatureCapabilityApi {
  getFeatures(): ConstraintFeature[];
  getWorkingFeatures(): ConstraintFeature[];
  replaceFeatures(
    features: ConstraintFeature[],
    options?: ReplaceFeaturesOptions,
  ): { ok: boolean };
  beginSession(): Promise<{ ok: boolean }>;
  resetSession(): Promise<{ ok: boolean }>;
  rollbackSession(): Promise<{ ok: boolean }>;
  completeSession(): FeatureCompletionResult;
  addFeature(type?: FeatureOperation): boolean;
  addDoubleLayerHole(): boolean;
  clearFeatures(): boolean;
  updateWorkingGroupPosition(
    groupId: string,
    x: number,
    y: number,
  ): { ok: boolean };
  resolvePlacements(
    features: ConstraintFeature[],
    geometry: FeaturePlacementGeometry,
  ): FeaturePlacement[];
  projectPlacements(
    placements: FeaturePlacement[],
    geometry: FeatureProjectionGeometry,
    scale: number,
  ): ConstraintFeature[];
  getMarkerRenderSpecs(): RenderObjectSpec[];
  onWorkingChange(
    listener: (event: FeatureWorkingChangeEvent) => void,
  ): Disposable;
  refresh(): void;
}

export function normalizeFeatureConfigNamespace(
  namespace: string | undefined,
): string {
  const normalized = String(namespace || "dieline").trim();
  return normalized || "dieline";
}

export function getFeatureConfigKey(
  namespace: string | undefined,
  path: string,
): string {
  return `${normalizeFeatureConfigNamespace(namespace)}.${path}`;
}

export function normalizeFeatureLayerId(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function createFeatureCapabilityDefinition(
  facade: FeatureCapabilityApi,
  options: FeatureCapabilityOptions = {},
): CapabilityDefinition<FeatureCapabilityApi> {
  return {
    id: options.capabilityId || FEATURE_CAPABILITY_ID,
    metadata: {
      name: "Feature",
      description:
        "Manage feature geometry, constraints, and render support without " +
        "requiring a kit-owned toolbar tool.",
      tags: ["kit", "feature", "geometry"],
    },
    commands: [
      { id: "beginFeatureSession", title: "Begin Feature Session" },
      { id: "addFeature", title: "Add Feature" },
      { id: "addDoubleLayerHole", title: "Add Double Layer Hole" },
      { id: "clearFeatures", title: "Clear Features" },
      { id: "completeFeatures", title: "Complete Features" },
    ],
    facade,
  };
}
