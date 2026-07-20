import type { CapabilityDefinition, SceneElementInput } from "@pooder/core";
import type {
  EditorDocument,
  EditorImagePlacement,
  EditorImageResource,
} from "@pooder/document";
import type { EditorDocumentController } from "@pooder/document-core";

export const IMAGE_SLOT_CAPABILITY_ID = "pooder.kit.image-slot";
export const IMAGE_SLOT_OPEN_SESSION_COMMAND_ID = "pooder.image-slot.open";
export const IMAGE_SLOT_UPDATE_PLACEMENT_COMMAND_ID =
  "pooder.image-slot.update-placement";

export type ImageSlotPlacementPreset =
  | "cover"
  | "contain"
  | "maximizeWidth"
  | "maximizeHeight";

export interface ImageSlotSessionDraft {
  objectId: string;
  resource?: EditorImageResource;
  placement: EditorImagePlacement;
}

export interface ImageSlotViewState {
  phase: "idle" | "active" | "validating" | "committing" | "error";
  draft: ImageSlotSessionDraft | null;
  error?:
    | "object-not-found"
    | "not-image-slot"
    | "resource-load-failed"
    | "validation-failed"
    | "commit-failed";
}

export type ImageSlotSessionResult =
  | {
      type: "placed";
      objectId: string;
      resource: EditorImageResource;
      placement: EditorImagePlacement;
    }
  | { type: "cleared"; objectId: string };

export interface SessionSceneDecorationContext {
  objectId: string;
  surfaceId: string;
}

export interface SessionSceneDecorationContribution {
  id: string;
  placement: "underlay" | "overlay" | "controls";
  provide(context: SessionSceneDecorationContext): SceneElementInput[];
}

export interface ImageSlotCapabilityApi {
  /** @internal Document bridge used by the kit controller after a successful apply. */
  syncDocument(
    document: EditorDocument,
    controller: EditorDocumentController,
  ): void;
  openSession(input: {
    objectId: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
  getViewState(): ImageSlotViewState;
  onDidChange(listener: (state: ImageSlotViewState) => void): {
    dispose(): void;
  };
  setResource(
    resource: EditorImageResource,
    options?: { placement?: "reset" | "preserve" },
  ): Promise<{ ok: boolean; reason?: string }>;
  clearResource(): Promise<{ ok: boolean; reason?: string }>;
  updatePlacement(partial: Partial<EditorImagePlacement>): {
    ok: boolean;
    reason?: string;
  };
  applyPlacementPreset(preset: ImageSlotPlacementPreset): {
    ok: boolean;
    reason?: string;
  };
  validateSession(): Promise<{ ok: true } | { ok: false; reason: string }>;
  commitSession(): Promise<
    ImageSlotSessionResult | { type: "error"; reason: string }
  >;
  rollbackSession(): Promise<{ ok: boolean; reason?: string }>;
  registerSessionSceneDecoration(
    contribution: SessionSceneDecorationContribution,
  ): { dispose(): void };
}

export function createImageSlotCapabilityDefinition(
  facade: ImageSlotCapabilityApi,
): CapabilityDefinition<ImageSlotCapabilityApi> {
  return {
    id: IMAGE_SLOT_CAPABILITY_ID,
    metadata: {
      name: "Image Slot",
      description: "Coordinates image slot editing sessions.",
      tags: ["kit", "image", "session"],
    },
    facade,
  };
}
