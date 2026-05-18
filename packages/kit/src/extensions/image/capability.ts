import type { CapabilityDefinition } from "@pooder/core";
import type {
  ImageExportPlacementImageOptions,
  ImageExportPlacementImageResult,
  ImagePlacementSessionNotice,
  ImagePlacementSlotState,
  ImagePlacementSource,
  ImagePlacementTransformUpdates,
} from "./ImagePlacementCapabilityImplementation";
import type { ImageOperation } from "./imageOperations";

export const IMAGE_PLACEMENT_CAPABILITY_ID =
  "pooder.kit.image-placement";

export interface ImagePlacementLayerOptions {
  imageLayerId?: string;
  overlayLayerId?: string;
}

export type ImageSessionProjectionPlacement = "below" | "above" | "controls";

export interface ImageSessionProjection {
  id: string;
  sourceLayerIds?: string[];
  sourceElementIds?: string[];
  placement: ImageSessionProjectionPlacement;
  opacity?: number;
  interactive?: boolean;
  hideSource?: boolean;
}

export interface ImagePlacementCapabilityOptions {
  capabilityId?: string;
  layers?: ImagePlacementLayerOptions;
  requestUpload?: (
    slot: ImagePlacementSlotState,
  ) => Promise<ImagePlacementSource | null | undefined>;
}

export interface ImagePlacementViewState {
  slots: ImagePlacementSlotState[];
  activeSlotId: string | null;
  focusedSlot: ImagePlacementSlotState | null;
  hasAnyImage: boolean;
  hasWorkingChanges: boolean;
  sessionNotice: ImagePlacementSessionNotice | null;
}

export interface ImagePlacementCapabilityApi {
  getViewState(): ImagePlacementViewState;
  beginSession(slotId: string): Promise<{ ok: boolean; reason?: string }>;
  requestUpload(slotId: string): Promise<{ ok: boolean; reason?: string }>;
  setImageSource(
    slotId: string,
    source: ImagePlacementSource,
  ): Promise<{ ok: boolean; reason?: string }>;
  setImageTransform(
    slotId: string,
    updates: ImagePlacementTransformUpdates,
  ): Promise<{ ok: boolean; reason?: string }>;
  applyImageOperation(
    slotId: string,
    operation: ImageOperation,
  ): Promise<{ ok: boolean; reason?: string }>;
  clearImage(slotId: string): Promise<{ ok: boolean; reason?: string }>;
  resetSession(slotId?: string): void;
  validatePlacement(slotId?: string): Promise<ImagePlacementSessionNotice | { ok: true }>;
  validateSession(slotId?: string): Promise<ImagePlacementSessionNotice | { ok: true }>;
  completeSession(slotId?: string): Promise<{ ok: boolean } | ImagePlacementSessionNotice>;
  focusSlot(
    slotId: string | null,
    options?: { syncCanvasSelection?: boolean; skipRender?: boolean },
  ): { ok: boolean; id?: string | null; reason?: string };
  exportPlacementImage(
    options?: ImageExportPlacementImageOptions,
  ): Promise<ImageExportPlacementImageResult>;
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
        "Upload, place, validate, and export document-defined image slots.",
      tags: ["kit", "image", "placement"],
    },
    commands: [
      { id: "beginSession", title: "Begin Image Placement Session" },
      { id: "requestUpload", title: "Request Image Upload" },
      { id: "setImageSource", title: "Set Image Source" },
      { id: "setImageTransform", title: "Set Image Transform" },
      { id: "applyImageOperation", title: "Apply Image Operation" },
      { id: "getImageViewState", title: "Get Image View State" },
      { id: "exportPlacementImage", title: "Export Placement Image" },
    ],
    facade,
  };
}
