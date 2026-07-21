export const IMAGE_MASK_CAPABILITY_ID = "pooder.kit.image-mask";

export interface ImageMaskTint {
  r: number;
  g: number;
  b: number;
}

export interface ExtractAlphaMaskOptions {
  tint?: Partial<ImageMaskTint>;
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
