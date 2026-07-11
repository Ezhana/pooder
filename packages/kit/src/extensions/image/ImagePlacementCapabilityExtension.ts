import {
  IMAGE_PLACEMENT_CAPABILITY_ID,
  type ImagePlacementCapabilityOptions,
} from "./capability";
import {
  ImagePlacementCapabilityImplementation,
  type ImagePlacementCapabilityImplementationOptions,
} from "./ImagePlacementCapabilityImplementation";

export interface ImagePlacementCapabilityExtensionOptions
  extends ImagePlacementCapabilityOptions {
  id?: string;
}

export class ImagePlacementCapabilityExtension extends ImagePlacementCapabilityImplementation {
  constructor(options: ImagePlacementCapabilityExtensionOptions = {}) {
    const toolOptions: ImagePlacementCapabilityImplementationOptions = {
      ...options,
      capabilityId: options.capabilityId || IMAGE_PLACEMENT_CAPABILITY_ID,
      id: options.id || IMAGE_PLACEMENT_CAPABILITY_ID,
    };
    super(toolOptions);
  }
}
