export const IMAGE_OBJECT_LAYER_ID = "image.user";
export const IMAGE_OVERLAY_LAYER_ID = "image-overlay";
export const WHITE_INK_OBJECT_LAYER_ID = "white-ink.user";
export const WHITE_INK_COVER_LAYER_ID = "white-ink.cover";
export const WHITE_INK_OVERLAY_LAYER_ID = "white-ink.overlay";
export const DIELINE_LAYER_ID = "dieline-overlay";
export const FEATURE_DIELINE_LAYER_ID = "feature-dieline-overlay";
export const FEATURE_OVERLAY_LAYER_ID = "feature-overlay";
export const RULER_LAYER_ID = "ruler-overlay";

export const KIT_LEGACY_LAYER_PRESET = {
  imageObject: IMAGE_OBJECT_LAYER_ID,
  imageOverlay: IMAGE_OVERLAY_LAYER_ID,
  whiteInkObject: WHITE_INK_OBJECT_LAYER_ID,
  whiteInkCover: WHITE_INK_COVER_LAYER_ID,
  whiteInkOverlay: WHITE_INK_OVERLAY_LAYER_ID,
  dieline: DIELINE_LAYER_ID,
  featureDieline: FEATURE_DIELINE_LAYER_ID,
  featureOverlay: FEATURE_OVERLAY_LAYER_ID,
  rulerOverlay: RULER_LAYER_ID,
} as const;

export type KitLegacyLayerPreset = typeof KIT_LEGACY_LAYER_PRESET;

export const LAYER_IDS = KIT_LEGACY_LAYER_PRESET;
