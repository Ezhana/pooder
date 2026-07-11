import {
  FEATURE_CAPABILITY_ID,
  type FeatureCapabilityOptions,
} from "./capability";
import { FeatureTool, type FeatureToolOptions } from "./FeatureTool";

export interface FeatureCapabilityExtensionOptions
  extends FeatureCapabilityOptions {
  id?: string;
}

export class FeatureCapabilityExtension extends FeatureTool {
  constructor(options: FeatureCapabilityExtensionOptions = {}) {
    const toolOptions: FeatureToolOptions = {
      ...options,
      capabilityId: options.capabilityId || FEATURE_CAPABILITY_ID,
      contributeCommands: false,
      id: options.id || FEATURE_CAPABILITY_ID,
      requireDielineExtension: false,
    };
    super(toolOptions);
  }
}
