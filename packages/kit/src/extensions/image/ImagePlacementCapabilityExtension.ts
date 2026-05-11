import {
  IMAGE_PLACEMENT_CAPABILITY_ID,
  type ImagePlacementCapabilityOptions,
} from "./capability";
import { ImageTool, type ImageToolOptions } from "./ImageTool";

export interface ImagePlacementCapabilityExtensionOptions
  extends ImagePlacementCapabilityOptions {
  id?: string;
  contributeConfigurations?: boolean;
}

export class ImagePlacementCapabilityExtension extends ImageTool {
  constructor(options: ImagePlacementCapabilityExtensionOptions = {}) {
    const toolOptions: ImageToolOptions = {
      ...options,
      capabilityId: options.capabilityId || IMAGE_PLACEMENT_CAPABILITY_ID,
      contributeCommands: false,
      contributeTool: false,
      id: options.id || IMAGE_PLACEMENT_CAPABILITY_ID,
    };
    super(toolOptions);
  }
}
