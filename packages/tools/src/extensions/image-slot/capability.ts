import type {
  CapabilityDefinition,
  ImageResourceDescriptor,
  SessionRenderAuxiliaryVisual,
} from "@pooder/core";
import type {
  PooderDocument,
  ImageAsset,
  ImageContentFit,
} from "@pooder/document";

export interface ImageSlotDocumentController {
  mutate(
    callback: (document: PooderDocument) => PooderDocument | void,
  ): Promise<
    | { ok: true; document: PooderDocument }
    | {
        ok: false;
        reason: string;
        diagnostics: import("@pooder/document").DocumentDiagnostic[];
      }
  >;
  updateObject(
    objectId: string,
    update: (
      current: Readonly<import("@pooder/document").PooderObject>,
    ) => import("@pooder/document").PooderObject,
  ): Promise<
    | { ok: true; document: PooderDocument }
    | {
        ok: false;
        reason: string;
        diagnostics: import("@pooder/document").DocumentDiagnostic[];
      }
  >;
}

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
  assetId?: string;
  placement: ImageContentFit;
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
      assetId: string;
      placement: ImageContentFit;
    }
  | { type: "cleared"; objectId: string };

export interface SessionRenderDecorationContext {
  objectId: string;
  surfaceId: string;
}

export interface SessionRenderDecorationContribution {
  id: string;
  provide(
    context: SessionRenderDecorationContext,
  ): Array<Omit<SessionRenderAuxiliaryVisual, "sessionId" | "role">>;
}

export interface ImageSlotCapabilityApi {
  /** @internal Document bridge used by the kit controller after a successful apply. */
  syncDocument(
    document: PooderDocument,
    controller: ImageSlotDocumentController,
  ): void;
  openSession(input: {
    objectId: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
  getViewState(): ImageSlotViewState;
  onDidChange(listener: (state: ImageSlotViewState) => void): {
    dispose(): void;
  };
  setAsset(
    assetId: string,
    options?: { placement?: "reset" | "preserve" },
  ): Promise<{ ok: boolean; reason?: string }>;
  stageAsset(
    asset: ImageAsset,
    options?: { placement?: "reset" | "preserve" },
  ): Promise<{ ok: boolean; reason?: string }>;
  clearResource(): Promise<{ ok: boolean; reason?: string }>;
  updatePlacement(partial: Partial<ImageContentFit>): {
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
  registerSessionRenderDecoration(
    contribution: SessionRenderDecorationContribution,
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
