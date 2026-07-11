import {
  DIELINE_GEOMETRY_CAPABILITY_ID,
  type DielineGeometryCapabilityOptions,
} from "./capability";
import { DielineTool, type DielineToolOptions } from "./DielineTool";
import type { DielineState } from "./model";

export interface DielineGeometryCapabilityExtensionOptions
  extends DielineGeometryCapabilityOptions,
    Partial<DielineState> {
  id?: string;
  contributeConfigurations?: boolean;
}

export class DielineGeometryCapabilityExtension extends DielineTool {
  constructor(options: DielineGeometryCapabilityExtensionOptions = {}) {
    const toolOptions: DielineToolOptions = {
      ...options,
      capabilityId: options.capabilityId || DIELINE_GEOMETRY_CAPABILITY_ID,
      contributeCommands: false,
      id: options.id || DIELINE_GEOMETRY_CAPABILITY_ID,
    };
    super(toolOptions);
  }
}
