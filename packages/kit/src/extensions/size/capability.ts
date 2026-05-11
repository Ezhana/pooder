import type { CapabilityDefinition } from "@pooder/core";
import type { Unit } from "../../coordinate";
import type { ChangedSizeField, SizeViewState } from "./SizeTool";

export const SIZE_CAPABILITY_ID = "pooder.kit.size";

export interface SizeCapabilityOptions {
  capabilityId?: string;
}

export interface UpdateSizeDimensionsInput {
  width?: number;
  height?: number;
  unit?: Unit;
  changed?: ChangedSizeField;
}

export interface SizeCapabilityApi {
  getState(): SizeViewState | null;
  updateDimensions(input?: UpdateSizeDimensionsInput): SizeViewState | null;
  setConstraintMode(mode: string): SizeViewState | null;
  setUnit(unit: Unit | string): SizeViewState | null;
  setCut(cutMode: string, cutMarginMm?: number): SizeViewState | null;
  getSelectedImageSize(id?: string): unknown;
}

export function createSizeCapabilityDefinition(
  facade: SizeCapabilityApi,
  options: SizeCapabilityOptions = {},
): CapabilityDefinition<SizeCapabilityApi> {
  return {
    id: options.capabilityId || SIZE_CAPABILITY_ID,
    metadata: {
      name: "Size",
      description:
        "Read and mutate scene size state without requiring a kit-owned " +
        "toolbar tool.",
      tags: ["kit", "size", "scene"],
    },
    commands: [
      { id: "getSizeState", title: "Get Size State" },
      { id: "updateSizeDimensions", title: "Update Size Dimensions" },
      { id: "setSizeConstraintMode", title: "Set Size Constraint Mode" },
      { id: "setSizeDisplayUnit", title: "Set Size Display Unit" },
      { id: "setSizeCut", title: "Set Size Cut" },
    ],
    facade,
  };
}
