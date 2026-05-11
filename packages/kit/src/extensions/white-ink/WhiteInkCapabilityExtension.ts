import {
  WHITE_INK_CAPABILITY_ID,
  type WhiteInkCapabilityOptions,
} from "./capability";
import { WhiteInkTool, type WhiteInkToolOptions } from "./WhiteInkTool";

export interface WhiteInkCapabilityExtensionOptions extends WhiteInkCapabilityOptions {
  id?: string;
  contributeConfigurations?: boolean;
}

export class WhiteInkCapabilityExtension extends WhiteInkTool {
  constructor(options: WhiteInkCapabilityExtensionOptions = {}) {
    const toolOptions: WhiteInkToolOptions = {
      ...options,
      capabilityId: options.capabilityId || WHITE_INK_CAPABILITY_ID,
      contributeCommands: false,
      contributeTool: false,
      id: options.id || WHITE_INK_CAPABILITY_ID,
      requireImageExtension: false,
    };
    super(toolOptions);
  }
}
