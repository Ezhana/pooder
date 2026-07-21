import type { CapabilityDefinition } from "@pooder/core";
import {
  IMAGE_MASK_CAPABILITY_ID,
  type ImageMaskCapabilityApi,
  type ImageMaskCapabilityOptions,
} from "@pooder/image-mask-contract";

export * from "@pooder/image-mask-contract";

export function createImageMaskCapabilityDefinition(
  facade: ImageMaskCapabilityApi,
  options: ImageMaskCapabilityOptions = {},
): CapabilityDefinition<ImageMaskCapabilityApi> {
  return {
    id: options.capabilityId || IMAGE_MASK_CAPABILITY_ID,
    metadata: {
      name: "Image Mask",
      description: "Extract PNG masks from image alpha channels.",
      tags: ["kit", "image", "mask"],
    },
    commands: [{ id: "extractAlphaMask", title: "Extract Alpha Mask" }],
    facade,
  };
}
