import {
  type ExtensionContext,
  type ExtensionContributions,
  type ExtensionDefinition,
} from "@pooder/core";
import {
  createImageMaskCapabilityDefinition,
  IMAGE_MASK_CAPABILITY_ID,
  type ExtractAlphaMaskOptions,
  type ExtractAlphaMaskResult,
  type ImageMaskAlphaOptions,
  type ImageMaskCapabilityApi,
  type ImageMaskCapabilityOptions,
  type ImageMaskTint,
} from "./capability";

const DEFAULT_MASK_TINT: ImageMaskTint = { r: 255, g: 255, b: 255 };

export interface NormalizedImageMaskAlphaOptions {
  selection: "opaque" | "transparent";
  mapping: "continuous" | "threshold";
  threshold: number;
  softness: number;
  outputOpacity: number;
}

export function normalizeImageMaskAlpha(
  alpha?: ImageMaskAlphaOptions,
): NormalizedImageMaskAlphaOptions {
  return {
    selection: alpha?.selection === "transparent" ? "transparent" : "opaque",
    mapping: alpha?.mapping === "threshold" ? "threshold" : "continuous",
    threshold: normalizeUnitInterval(alpha?.threshold, 0.5),
    softness: normalizeUnitInterval(alpha?.softness, 0),
    outputOpacity: normalizeUnitInterval(alpha?.outputOpacity, 1),
  };
}

export function mapImageMaskAlpha(
  sourceAlpha: number,
  options: NormalizedImageMaskAlphaOptions,
): number {
  const selectedAlpha =
    options.selection === "transparent" ? 1 - sourceAlpha : sourceAlpha;
  if (options.mapping === "continuous") {
    return selectedAlpha * options.outputOpacity;
  }
  if (options.softness <= 0) {
    return (selectedAlpha >= options.threshold ? 1 : 0) * options.outputOpacity;
  }
  const halfSoftness = options.softness / 2;
  const lower = options.threshold - halfSoftness;
  const upper = options.threshold + halfSoftness;
  const progress = Math.max(
    0,
    Math.min(1, (selectedAlpha - lower) / Math.max(upper - lower, 0.000001)),
  );
  const smoothed = progress * progress * (3 - 2 * progress);
  return smoothed * options.outputOpacity;
}

function normalizeUnitInterval(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

export interface ImageMaskCapabilityExtensionOptions extends ImageMaskCapabilityOptions {
  id?: string;
}

export class ImageMaskCapabilityExtension implements ExtensionDefinition {
  id: string;
  metadata = {
    name: "ImageMaskCapabilityExtension",
  };

  private readonly capabilityId: string;

  constructor(options: ImageMaskCapabilityExtensionOptions = {}) {
    this.id =
      String(options.id || IMAGE_MASK_CAPABILITY_ID).trim() ||
      IMAGE_MASK_CAPABILITY_ID;
    this.capabilityId = options.capabilityId || IMAGE_MASK_CAPABILITY_ID;
  }

  activate(_context: ExtensionContext) {}

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createImageMaskCapabilityDefinition(this.getFacade(), {
          capabilityId: this.capabilityId,
        }),
      ],
    };
  }

  async extractAlphaMask(
    sourceUrl: string,
    options: ExtractAlphaMaskOptions = {},
  ): Promise<ExtractAlphaMaskResult> {
    const normalizedSource = String(sourceUrl || "").trim();
    if (!normalizedSource) {
      throw new Error("image-mask-source-required");
    }
    if (typeof document === "undefined" || typeof Image === "undefined") {
      throw new Error("image-mask-browser-required");
    }

    const element =
      options.element || (await this.loadImageElement(normalizedSource));
    const size = this.getElementSize(element);
    if (!size) {
      throw new Error("image-mask-source-size-unavailable");
    }

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("image-mask-canvas-unavailable");
    }

    ctx.drawImage(element as CanvasImageSource, 0, 0, size.width, size.height);
    const imageData = ctx.getImageData(0, 0, size.width, size.height);
    const tint = this.normalizeTint(options.tint);
    const alpha = normalizeImageMaskAlpha(options.alpha);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = tint.r;
      data[i + 1] = tint.g;
      data[i + 2] = tint.b;
      data[i + 3] = Math.round(
        mapImageMaskAlpha(data[i + 3] / 255, alpha) * 255,
      );
    }

    ctx.putImageData(imageData, 0, 0);
    return {
      url: canvas.toDataURL("image/png"),
      width: size.width,
      height: size.height,
      format: "png",
    };
  }

  private normalizeTint(tint?: Partial<ImageMaskTint>): ImageMaskTint {
    return {
      r: this.normalizeChannel(tint?.r, DEFAULT_MASK_TINT.r),
      g: this.normalizeChannel(tint?.g, DEFAULT_MASK_TINT.g),
      b: this.normalizeChannel(tint?.b, DEFAULT_MASK_TINT.b),
    };
  }

  private normalizeChannel(value: unknown, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, Math.min(255, Math.round(numeric)));
  }

  private getElementSize(
    element: ExtractAlphaMaskOptions["element"],
  ): { width: number; height: number } | null {
    if (!element) return null;
    const width = Number(
      (element as HTMLImageElement).naturalWidth ||
        (element as HTMLVideoElement).videoWidth ||
        (element as HTMLCanvasElement).width ||
        0,
    );
    const height = Number(
      (element as HTMLImageElement).naturalHeight ||
        (element as HTMLVideoElement).videoHeight ||
        (element as HTMLCanvasElement).height ||
        0,
    );
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width <= 0 || height <= 0) return null;
    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    };
  }

  private loadImageElement(sourceUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("image-mask-source-load-failed"));
      image.src = sourceUrl;
    });
  }

  private getFacade(): ImageMaskCapabilityApi {
    return {
      extractAlphaMask: (sourceUrl, options) =>
        this.extractAlphaMask(sourceUrl, options),
    };
  }
}
