import { ConstraintFeature, ConstraintRegistry } from "./constraints";
import type { GeometryOptions } from "./geometry";
import {
  normalizePointInGeometry,
  resolveFeaturePosition,
} from "./featureCoordinates";

export interface FeaturePlacementGeometry
  extends Pick<
    GeometryOptions,
    | "shape"
    | "shapeStyle"
    | "pathData"
    | "customSourceWidthPx"
    | "customSourceHeightPx"
    | "canvasWidth"
    | "canvasHeight"
  > {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  scale: number;
}

export interface FeatureProjectionGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FeaturePlacement<TFeature extends ConstraintFeature = ConstraintFeature> {
  feature: TFeature;
  normalizedX: number;
  normalizedY: number;
  centerX: number;
  centerY: number;
}

function scaleFeatureForRender<TFeature extends ConstraintFeature>(
  feature: TFeature,
  scale: number,
  x: number,
  y: number,
): TFeature {
  return {
    ...feature,
    x,
    y,
    width: feature.width !== undefined ? feature.width * scale : undefined,
    height: feature.height !== undefined ? feature.height * scale : undefined,
    radius: feature.radius !== undefined ? feature.radius * scale : undefined,
  };
}

export function resolveFeaturePlacements<TFeature extends ConstraintFeature>(
  features: TFeature[],
  geometry: FeaturePlacementGeometry,
): FeaturePlacement<TFeature>[] {
  const dielineWidth =
    geometry.scale > 0 ? geometry.width / geometry.scale : geometry.width;
  const dielineHeight =
    geometry.scale > 0 ? geometry.height / geometry.scale : geometry.height;

  return (features || []).map((feature) => {
    const activeConstraints = feature.constraints?.filter(
      (constraint) => !constraint.validateOnly,
    );
    const constrained = ConstraintRegistry.apply(
      feature.x,
      feature.y,
      feature,
      {
        dielineWidth,
        dielineHeight,
        geometry,
      },
      activeConstraints,
    );
    const center = resolveFeaturePosition(
      {
        ...feature,
        x: constrained.x,
        y: constrained.y,
      },
      geometry,
    );

    return {
      feature,
      normalizedX: constrained.x,
      normalizedY: constrained.y,
      centerX: center.x,
      centerY: center.y,
    };
  });
}

export function projectPlacedFeatures<TFeature extends ConstraintFeature>(
  placements: FeaturePlacement<TFeature>[],
  geometry: FeatureProjectionGeometry,
  scale: number,
): TFeature[] {
  return placements.map((placement) => {
    const normalized = normalizePointInGeometry(
      { x: placement.centerX, y: placement.centerY },
      geometry,
    );
    return scaleFeatureForRender(
      placement.feature,
      scale,
      normalized.x,
      normalized.y,
    );
  });
}
