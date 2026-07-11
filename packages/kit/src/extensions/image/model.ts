export type {
  ImagePlacementImageState,
  ImagePlacementPlaceholderStyle,
  ImagePlacementState,
  ImagePlacementTransformUpdates,
} from "./ImagePlacementCapabilityImplementation";
export type { ImagePlacementViewState } from "./capability";

import type { ImagePlacementViewState } from "./capability";

export function hasAnyImageInViewState(
  state: ImagePlacementViewState | null | undefined,
): boolean {
  return Boolean(state?.hasAnyImage);
}
