import {
  BACKGROUND_CAPABILITY_ID,
  type BackgroundCapabilityOptions,
} from "./capability";
import { BackgroundTool, type BackgroundToolOptions } from "./BackgroundTool";

export interface BackgroundCapabilityExtensionOptions extends BackgroundCapabilityOptions {
  id?: string;
  contributeConfigurations?: boolean;
}

export class BackgroundCapabilityExtension extends BackgroundTool {
  constructor(options: BackgroundCapabilityExtensionOptions = {}) {
    const toolOptions: BackgroundToolOptions = {
      ...options,
      capabilityId: options.capabilityId || BACKGROUND_CAPABILITY_ID,
      contributeCommands: false,
      contributeTool: false,
      id: options.id || BACKGROUND_CAPABILITY_ID,
    };
    super(toolOptions);
  }
}
