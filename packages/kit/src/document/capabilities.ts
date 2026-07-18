import type { ExtensionDefinition } from "@pooder/core";
import {
  createConfigurableVisualCapability,
  createClipCapability,
  createDielineGeometryCapability,
  createFeatureCapability,
  createImagePlacementCapability,
  createMirrorCapability,
} from "../factories";
import { CLIP_CAPABILITY_ID } from "../extensions/clip";
import { CONFIGURABLE_VISUAL_CAPABILITY_ID } from "../extensions/configurable-visual";
import { DIELINE_GEOMETRY_CAPABILITY_ID } from "../extensions/dieline";
import { FEATURE_CAPABILITY_ID } from "../extensions/feature";
import { IMAGE_PLACEMENT_CAPABILITY_ID } from "../extensions/image";
import { MIRROR_CAPABILITY_ID } from "../extensions/mirror";
import { collectKitEditorDocumentCapabilityRequirements } from "./index";

const KIT_EFFECT_FACTORIES: Record<string, () => ExtensionDefinition> = {
  [CLIP_CAPABILITY_ID]: () => createClipCapability(),
  [CONFIGURABLE_VISUAL_CAPABILITY_ID]: () =>
    createConfigurableVisualCapability(),
  [DIELINE_GEOMETRY_CAPABILITY_ID]: () => createDielineGeometryCapability(),
  [FEATURE_CAPABILITY_ID]: () => createFeatureCapability(),
  [IMAGE_PLACEMENT_CAPABILITY_ID]: () => createImagePlacementCapability(),
  [MIRROR_CAPABILITY_ID]: () => createMirrorCapability(),
};

export function createKitCapabilitiesForDocument(
  value: unknown,
): ExtensionDefinition[] {
  const result = collectKitEditorDocumentCapabilityRequirements(value);
  const capabilityIds = Array.from(
    new Set(
      result.requirements
        .map((item) => item.capabilityId)
        .filter((id) => KIT_EFFECT_FACTORIES[id]),
    ),
  );

  return capabilityIds.map((id) => KIT_EFFECT_FACTORIES[id]());
}
