import type { CapabilityDefinition } from "@pooder/core";
import type {
  ImagePlacementSource,
  ImagePlacementSessionNotice,
  ImagePlacementState,
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
  beginSessionOnCanvasInteraction?: boolean;
  layers?: ImagePlacementLayerOptions;
}

export type ImagePlacementCommitTarget =
  | {
      type: "configurable-visual";
      configKey?: string;
      key: string;
    }
  | {
      type: "document-object";
      objectId: string;
    };

export interface ImagePlacementSessionInput {
  placementId: string;
  sessionId?: string;
}

export interface ImagePlacementViewState {
  placements: ImagePlacementState[];
  activePlacementId: string | null;
  focusedPlacement: ImagePlacementState | null;
  hasAnyImage: boolean;
  hasWorkingChanges: boolean;
  sessionNotice: ImagePlacementSessionNotice | null;
}

export interface ImagePlacementCapabilityApi {
  applyOperation(
    input: string | ImagePlacementSessionInput,
    operation: ImageOperation,
  ): Promise<{ ok: boolean; reason?: string } | ImagePlacementSessionNotice>;
  clearImage(input: string | ImagePlacementSessionInput): Promise<{ ok: boolean; reason?: string }>;
  commitSession(input?: string | ImagePlacementSessionInput): Promise<{ ok: boolean; reason?: string } | ImagePlacementSessionNotice>;
  getViewState(): ImagePlacementViewState;
  openSession(input: string | ImagePlacementSessionInput): Promise<{ ok: boolean; reason?: string }>;
  rollbackSession(input?: string | ImagePlacementSessionInput): Promise<{ ok: boolean; reason?: string }>;
  setSource(
    input: string | ImagePlacementSessionInput,
    source: ImagePlacementSource | string,
  ): Promise<{ ok: boolean; reason?: string }>;
  setTransform(
    input: string | ImagePlacementSessionInput,
    transform: ImagePlacementTransformUpdates,
  ): Promise<{ ok: boolean; reason?: string }>;
  validateSession(input?: string | ImagePlacementSessionInput): Promise<ImagePlacementSessionNotice | { ok: true }>;

  /** @deprecated Use validateSession(). */
  validatePlacement(placementId?: string): Promise<ImagePlacementSessionNotice | { ok: true }>;
  focusPlacement(
    placementId: string | null,
    options?: { syncCanvasSelection?: boolean; skipRender?: boolean },
  ): { ok: boolean; id?: string | null; reason?: string };
  refresh(): void;
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
        "Describe document-defined image placement targets and emit placement interactions.",
      tags: ["kit", "image", "placement"],
    },
    commands: [
      { id: "getImageViewState", title: "Get Image View State" },
      { id: "focusImagePlacement", title: "Focus Image Placement" },
      { id: "refreshImagePlacements", title: "Refresh Image Placements" },
    ],
    facade,
  };
}
