import {
  DESIGN_EXPORT_CAPABILITY_ID,
  type DesignExportCapabilityOptions,
} from "./capability";
import {
  DesignExportExtension,
  type DesignExportExtensionOptions,
} from "./DesignExportExtension";

export interface DesignExportCapabilityExtensionOptions extends DesignExportCapabilityOptions {
  id?: string;
}

export class DesignExportCapabilityExtension extends DesignExportExtension {
  constructor(options: DesignExportCapabilityExtensionOptions = {}) {
    const extensionOptions: DesignExportExtensionOptions = {
      ...options,
      capabilityId: options.capabilityId || DESIGN_EXPORT_CAPABILITY_ID,
      contributeCommands: false,
      id: options.id || DESIGN_EXPORT_CAPABILITY_ID,
    };
    super(extensionOptions);
  }
}
