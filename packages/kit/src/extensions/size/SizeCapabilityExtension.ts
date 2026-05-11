import { SIZE_CAPABILITY_ID, type SizeCapabilityOptions } from "./capability";
import { SizeTool, type SizeToolOptions } from "./SizeTool";

export interface SizeCapabilityExtensionOptions extends SizeCapabilityOptions {
  id?: string;
  contributeConfigurations?: boolean;
}

export class SizeCapabilityExtension extends SizeTool {
  constructor(options: SizeCapabilityExtensionOptions = {}) {
    const toolOptions: SizeToolOptions = {
      ...options,
      capabilityId: options.capabilityId || SIZE_CAPABILITY_ID,
      contributeCommands: false,
      contributeTool: false,
      id: options.id || SIZE_CAPABILITY_ID,
    };
    super(toolOptions);
  }
}
