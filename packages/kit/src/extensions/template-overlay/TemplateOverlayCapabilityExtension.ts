import {
  TEMPLATE_OVERLAY_CAPABILITY_ID,
  type TemplateOverlayCapabilityOptions,
} from "./capability";
import {
  TemplateOverlayTool,
  type TemplateOverlayToolOptions,
} from "./TemplateOverlayTool";

export interface TemplateOverlayCapabilityExtensionOptions extends TemplateOverlayCapabilityOptions {
  id?: string;
  contributeConfigurations?: boolean;
}

export class TemplateOverlayCapabilityExtension extends TemplateOverlayTool {
  constructor(options: TemplateOverlayCapabilityExtensionOptions = {}) {
    const toolOptions: TemplateOverlayToolOptions = {
      ...options,
      capabilityId: options.capabilityId || TEMPLATE_OVERLAY_CAPABILITY_ID,
      contributeCommands: false,
      id: options.id || TEMPLATE_OVERLAY_CAPABILITY_ID,
    };
    super(toolOptions);
  }
}
