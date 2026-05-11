import { RULER_CAPABILITY_ID, type RulerCapabilityOptions } from "./capability";
import { RulerTool, type RulerToolOptions } from "./RulerTool";

export interface RulerCapabilityExtensionOptions extends RulerCapabilityOptions {
  id?: string;
  contributeConfigurations?: boolean;
}

export class RulerCapabilityExtension extends RulerTool {
  constructor(options: RulerCapabilityExtensionOptions = {}) {
    const toolOptions: RulerToolOptions = {
      ...options,
      capabilityId: options.capabilityId || RULER_CAPABILITY_ID,
      contributeCommands: false,
      contributeTool: false,
      id: options.id || RULER_CAPABILITY_ID,
      legacyVisibility: false,
    };
    super(toolOptions);
  }
}
