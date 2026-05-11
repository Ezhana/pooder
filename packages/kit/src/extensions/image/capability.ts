import type { CapabilityDefinition } from "@pooder/core";
import type {
  ImageExportUserCroppedImageOptions,
  ImageExportUserCroppedImageResult,
  ImageItem,
  ImageTransformUpdates,
  ImageViewState,
  UpdateImageOptions,
  UpsertImageOptions,
} from "./ImageTool";
import type { ImageOperation } from "./imageOperations";

export const IMAGE_PLACEMENT_CAPABILITY_ID =
  "pooder.kit.image-placement";

export interface ImagePlacementLayerOptions {
  imageLayerId?: string;
  overlayLayerId?: string;
}

export interface ImagePlacementCapabilityOptions {
  capabilityId?: string;
  configNamespace?: string;
  layers?: ImagePlacementLayerOptions;
}

export interface ImagePlacementCapabilityApi {
  getViewState(): ImageViewState;
  addImage(
    url: string,
    options?: Partial<ImageItem>,
    operation?: ImageOperation,
  ): Promise<string>;
  upsertImage(
    url: string,
    options?: UpsertImageOptions,
  ): Promise<{ id: string; mode: "replace" | "add" }>;
  setImageTransform(
    id: string,
    updates: ImageTransformUpdates,
    options?: UpdateImageOptions,
  ): Promise<void>;
  applyImageOperation(
    id: string,
    operation: ImageOperation,
    options?: UpdateImageOptions,
  ): Promise<void>;
  focusImage(
    id: string | null,
    options?: { syncCanvasSelection?: boolean; skipRender?: boolean },
  ): { ok: boolean; id?: string | null; reason?: string };
  resetSession(): void;
  validateSession(): Promise<unknown>;
  completeSession(): Promise<unknown>;
  exportUserCroppedImage(
    options?: ImageExportUserCroppedImageOptions,
  ): Promise<ImageExportUserCroppedImageResult>;
}

export function normalizeImagePlacementConfigNamespace(
  namespace: string | undefined,
): string {
  const normalized = String(namespace || "image").trim();
  return normalized || "image";
}

export function normalizeImagePlacementLayerId(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function createImagePlacementCapabilityDefinition(
  facade: ImagePlacementCapabilityApi,
  options: ImagePlacementCapabilityOptions = {},
): CapabilityDefinition<ImagePlacementCapabilityApi> {
  return {
    id: options.capabilityId || IMAGE_PLACEMENT_CAPABILITY_ID,
    metadata: {
      name: "Image Placement",
      description:
        "Place, transform, validate, and export image elements without " +
        "requiring a kit-owned toolbar tool.",
      tags: ["kit", "image", "placement"],
    },
    commands: [
      { id: "addImage", title: "Add Image" },
      { id: "upsertImage", title: "Upsert Image" },
      { id: "setImageTransform", title: "Set Image Transform" },
      { id: "applyImageOperation", title: "Apply Image Operation" },
      { id: "getImageViewState", title: "Get Image View State" },
      { id: "exportUserCroppedImage", title: "Export User Cropped Image" },
    ],
    facade,
  };
}
