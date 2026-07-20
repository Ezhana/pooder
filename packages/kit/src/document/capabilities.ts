import type { ExtensionDefinition } from "@pooder/core";
import { normalizeEditorDocument } from "@pooder/document";
import {
  createConfigurableVisualCapability,
  createClipCapability,
  createDielineGeometryCapability,
  createFeatureCapability,
  createImageSlotCapability,
  createMirrorCapability,
} from "../factories";
import { CLIP_CAPABILITY_ID } from "../extensions/clip";
import { CONFIGURABLE_VISUAL_CAPABILITY_ID } from "../extensions/configurable-visual";
import { DIELINE_GEOMETRY_CAPABILITY_ID } from "../extensions/dieline";
import { FEATURE_CAPABILITY_ID } from "../extensions/feature";
import { IMAGE_SLOT_CAPABILITY_ID } from "../extensions/image-slot";
import { MIRROR_CAPABILITY_ID } from "../extensions/mirror";
import { collectKitEditorDocumentCapabilityRequirements } from "./index";

const KIT_EFFECT_FACTORIES: Record<string, () => ExtensionDefinition> = {
  [CLIP_CAPABILITY_ID]: () => createClipCapability(),
  [CONFIGURABLE_VISUAL_CAPABILITY_ID]: () =>
    createConfigurableVisualCapability(),
  [DIELINE_GEOMETRY_CAPABILITY_ID]: () => createDielineGeometryCapability(),
  [FEATURE_CAPABILITY_ID]: () => createFeatureCapability(),
  [IMAGE_SLOT_CAPABILITY_ID]: () => createImageSlotCapability(),
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

  const capabilities = capabilityIds.map((id) => KIT_EFFECT_FACTORIES[id]());
  const document = normalizeEditorDocument(value);
  const hasImageSlots = document.surfaces.some((surface) =>
    surface.layers.some((layer) =>
      layer.objects?.some(
        (object) =>
          object.source.kind === "image" &&
          "slot" in object &&
          Boolean(object.slot),
      ),
    ),
  );
  if (hasImageSlots) capabilities.push(createImageSlotCapability());
  return capabilities;
}
