export const IMAGE_MASK_CAPABILITY_ID = "pooder.kit.image-mask";

export interface ImageMaskTint {
  r: number;
  g: number;
  b: number;
}

export type ImageMaskAlphaSelection = "opaque" | "transparent";
export type ImageMaskAlphaMapping = "continuous" | "threshold";

export interface ImageMaskAlphaOptions {
  selection?: ImageMaskAlphaSelection;
  mapping?: ImageMaskAlphaMapping;
  threshold?: number;
  softness?: number;
  outputOpacity?: number;
}

export interface ExtractAlphaMaskOptions {
  tint?: Partial<ImageMaskTint>;
  alpha?: ImageMaskAlphaOptions;
  element?:
    | HTMLImageElement
    | HTMLCanvasElement
    | HTMLVideoElement
    | ImageBitmap;
}

export interface ExtractAlphaMaskResult {
  url: string;
  width: number;
  height: number;
  format: "png";
}

export interface ImageMaskCapabilityOptions {
  capabilityId?: string;
}

export interface ImageMaskCapabilityApi {
  extractAlphaMask(
    sourceUrl: string,
    options?: ExtractAlphaMaskOptions,
  ): Promise<ExtractAlphaMaskResult>;
}
