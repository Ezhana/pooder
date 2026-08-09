import type { ExtensionDefinition } from "@pooder/core";
import {
  parseEditorDocument,
  visitEditorDocumentObjects,
} from "@pooder/document";
import {
  createConfigurableVisualCapability,
  createImageSlotCapability,
  createMirrorCapability,
} from "../factories";
import { CONFIGURABLE_VISUAL_CAPABILITY_ID } from "../extensions/configurable-visual";
import { IMAGE_SLOT_CAPABILITY_ID } from "../extensions/image-slot";
import { MIRROR_CAPABILITY_ID } from "../extensions/mirror";
import { collectOfficialToolDocumentCapabilityRequirements } from "./index";
import {
  CONFIGURABLE_VISUAL_BEHAVIOR_TYPE,
  IMAGE_SLOT_BEHAVIOR_TYPE,
} from "./behavior-schemas";

const OFFICIAL_TOOL_EFFECT_FACTORIES: Record<
  string,
  () => ExtensionDefinition
> = {
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
  const document = parseEditorDocument(value);
  const behaviorCapabilityIds = new Set<string>();
  visitEditorDocumentObjects(document, ({ object }) => {
    object.behaviors?.forEach((behavior) => {
      if (behavior.type === IMAGE_SLOT_BEHAVIOR_TYPE) {
        behaviorCapabilityIds.add(IMAGE_SLOT_CAPABILITY_ID);
      } else if (behavior.type === CONFIGURABLE_VISUAL_BEHAVIOR_TYPE) {
        behaviorCapabilityIds.add(CONFIGURABLE_VISUAL_CAPABILITY_ID);
      }
    });
  });
  const hasImageSlots = behaviorCapabilityIds.has(IMAGE_SLOT_CAPABILITY_ID);
  if (hasImageSlots && !capabilityIds.includes(IMAGE_SLOT_CAPABILITY_ID)) {
    capabilities.push(createImageSlotCapability(options.imageSlot));
  }
  if (
    behaviorCapabilityIds.has(CONFIGURABLE_VISUAL_CAPABILITY_ID) &&
    !capabilityIds.includes(CONFIGURABLE_VISUAL_CAPABILITY_ID)
  ) {
    capabilities.push(createConfigurableVisualCapability());
  }
  return capabilities;
}
