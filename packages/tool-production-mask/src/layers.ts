export const PRODUCTION_MASK_PREVIEW_LAYER_ID = "production-mask.preview";
export const PRODUCTION_MASK_COVER_LAYER_ID = "production-mask.cover";
export const PRODUCTION_MASK_OVERLAY_LAYER_ID = "production-mask.overlay";

export const POODER_PRODUCTION_MASK_LAYER_PRESET = {
  mask: PRODUCTION_MASK_PREVIEW_LAYER_ID,
  cover: PRODUCTION_MASK_COVER_LAYER_ID,
  overlay: PRODUCTION_MASK_OVERLAY_LAYER_ID,
} as const;
