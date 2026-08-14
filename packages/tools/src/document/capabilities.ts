import type { ExtensionDefinition } from "@pooder/core";
import {
  parseEditorDocument,
  visitEditorDocumentObjects,
} from "@pooder/document";
import {
  createImageSlotCapability,
  createMirrorCapability,
} from "../factories";
import { IMAGE_SLOT_CAPABILITY_ID } from "../extensions/image-slot";
import { MIRROR_CAPABILITY_ID } from "../extensions/mirror";
import { collectOfficialToolDocumentCapabilityRequirements } from "./index";
import { IMAGE_SLOT_BEHAVIOR_TYPE } from "./behavior-schemas";

const OFFICIAL_TOOL_EFFECT_FACTORIES: Record<
  string,
  () => ExtensionDefinition
> = {
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
  const requiredCapabilityIds = new Set(document.extension.required);
  visitEditorDocumentObjects(document, ({ object }) => {
    object.behaviors?.forEach((behavior) => {
      if (behavior.type === IMAGE_SLOT_BEHAVIOR_TYPE) {
        requiredCapabilityIds.add(IMAGE_SLOT_CAPABILITY_ID);
      }
    });
  });
  if (
    requiredCapabilityIds.has(IMAGE_SLOT_CAPABILITY_ID) &&
    !capabilityIds.includes(IMAGE_SLOT_CAPABILITY_ID)
  ) {
    capabilities.push(createImageSlotCapability(options.imageSlot));
  }
  return capabilities;
}
