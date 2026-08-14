export interface BoundsLike {
  width: number;
  height: number;
}

export function computeDetectEdgeSize(
  currentMax: number,
  baseBounds: BoundsLike,
  expandedBounds: BoundsLike,
): { width: number; height: number; scale: number } {
  const baseMax = Math.max(baseBounds.width, baseBounds.height);
  const scale = baseMax > 0 ? currentMax / baseMax : 1;
  return {
    scale,
    width: expandedBounds.width * scale,
    height: expandedBounds.height * scale,
  };
}
