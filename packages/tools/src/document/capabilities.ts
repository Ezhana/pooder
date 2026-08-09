import type { ExtensionDefinition } from "@pooder/core";
import {
  isEditorVisualObject,
  normalizeEditorDocument,
} from "@pooder/document";
import {
  createConfigurableVisualCapability,
  createClipCapability,
  createImageSlotCapability,
  createMirrorCapability,
} from "../factories";
import { CLIP_CAPABILITY_ID } from "../extensions/clip";
import { CONFIGURABLE_VISUAL_CAPABILITY_ID } from "../extensions/configurable-visual";
import { IMAGE_SLOT_CAPABILITY_ID } from "../extensions/image-slot";
import { MIRROR_CAPABILITY_ID } from "../extensions/mirror";
import { collectOfficialToolDocumentCapabilityRequirements } from "./index";

const OFFICIAL_TOOL_EFFECT_FACTORIES: Record<
  string,
  () => ExtensionDefinition
> = {
  [CLIP_CAPABILITY_ID]: () => createClipCapability(),
  [CONFIGURABLE_VISUAL_CAPABILITY_ID]: () =>
    createConfigurableVisualCapability(),
  [IMAGE_SLOT_CAPABILITY_ID]: () => createImageSlotCapability(),
  [MIRROR_CAPABILITY_ID]: () => createMirrorCapability(),
};

export function createOfficialToolCapabilitiesForDocument(
  value: unknown,
  options: {
    imageSlot?: Parameters<typeof createImageSlotCapability>[0];
  } = {},
): ExtensionDefinition[] {
  const result = collectOfficialToolDocumentCapabilityRequirements(value);
  const capabilityIds = Array.from(
    new Set(
      result.requirements
        .map((item) => item.capabilityId)
        .filter((id) => OFFICIAL_TOOL_EFFECT_FACTORIES[id]),
    ),
  );

  const capabilities = capabilityIds.map((id) =>
    id === IMAGE_SLOT_CAPABILITY_ID
      ? createImageSlotCapability(options.imageSlot)
      : OFFICIAL_TOOL_EFFECT_FACTORIES[id](),
  );
  const document = normalizeEditorDocument(value);
  const hasImageSlots = document.surfaces.some((surface) =>
    surface.layers.some((layer) =>
      layer.objects?.some(
        (object) =>
          isEditorVisualObject(object) &&
          object.source.kind === "image" &&
          "slot" in object &&
          Boolean(object.slot),
      ),
    ),
  );
  if (hasImageSlots && !capabilityIds.includes(IMAGE_SLOT_CAPABILITY_ID)) {
    capabilities.push(createImageSlotCapability(options.imageSlot));
  }
  return capabilities;
}

/** @deprecated Use createOfficialToolCapabilitiesForDocument. */
export const createKitCapabilitiesForDocument =
  createOfficialToolCapabilitiesForDocument;
