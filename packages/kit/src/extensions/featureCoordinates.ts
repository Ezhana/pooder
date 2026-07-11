import type { DielineFeature } from "./geometry";

export interface FeatureCoordinateGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function resolveFeaturePosition(
  feature: Pick<DielineFeature, "x" | "y">,
  geometry: FeatureCoordinateGeometry,
): { x: number; y: number } {
  const { x, y, width, height } = geometry;
  const left = x - width / 2;
  const top = y - height / 2;

  return {
    x: left + feature.x * width,
    y: top + feature.y * height,
  };
}

export function normalizePointInGeometry(
  point: { x: number; y: number },
  geometry: FeatureCoordinateGeometry,
): { x: number; y: number } {
  const left = geometry.x - geometry.width / 2;
  const top = geometry.y - geometry.height / 2;

  return {
    x: geometry.width > 0 ? (point.x - left) / geometry.width : 0.5,
    y: geometry.height > 0 ? (point.y - top) / geometry.height : 0.5,
  };
}
