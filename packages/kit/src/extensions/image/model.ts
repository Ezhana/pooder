export type {
  ImageItem,
  ImageTransformUpdates,
  ImageViewState,
} from "./ImageTool";

import type { ImageViewState } from "./ImageTool";

export function hasAnyImageInViewState(
  state: ImageViewState | null | undefined,
): boolean {
  return Boolean(state?.hasAnyImage);
}
