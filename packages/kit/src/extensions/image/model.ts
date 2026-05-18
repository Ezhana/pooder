export type {
  ImagePlacementImageState,
  ImagePlacementPlaceholderStyle,
  ImagePlacementSlotState,
  ImagePlacementTransformUpdates,
} from "./ImagePlacementCapabilityImplementation";
export type { ImagePlacementViewState } from "./capability";

import type { ImagePlacementViewState } from "./capability";

export function hasAnyImageInViewState(
  state: ImagePlacementViewState | null | undefined,
): boolean {
  return Boolean(state?.hasAnyImage);
}
