import type {
  CapabilityDefinition,
  ImageResourceDescriptor,
  SessionPhase,
  SessionTerminalReason,
} from "@pooder/core";
import type {
  AssetSource,
  EditorDocument,
  EditorDocumentDiagnostic,
} from "@pooder/document";

type EditorImageResource = ImageResourceDescriptor;

import {
  IMAGE_MASK_CAPABILITY_ID,
  type ImageMaskTint,
} from "@pooder/image-mask-contract";

export const POODER_PRODUCTION_MASK_CAPABILITY_ID = "pooder.production-mask";

export interface ProductionMaskLayerOptions {
  originalLayerId?: string;
  maskLayerId?: string;
  coverLayerId?: string;
  overlayLayerId?: string;
}

export interface ProductionMaskDocumentReference {
  type: "document-object";
  objectId: string;
}

export type ProductionMaskAlignmentMode =
  | "reference-source"
  | "reference-frame";
export type ProductionMaskAlphaSelection = "opaque" | "transparent";
export type ProductionMaskAlphaMapping = "continuous" | "threshold";

export interface ProductionMaskAlphaParameters {
  selection: ProductionMaskAlphaSelection;
  mapping: ProductionMaskAlphaMapping;
  threshold?: number;
  softness?: number;
  outputOpacity?: number;
}

export type ProductionMaskSource = { kind: "reference-object" } | AssetSource;

export type ProductionMaskProcess = "white-ink" | "reverse" | "spot-uv";

export interface ProductionMaskPresentationState {
  originalVisible: boolean;
  originalMaskVisible: boolean;
  currentMaskVisible: boolean;
}

export interface ProductionMaskDocumentEntry {
  surfaceId: string;
  process: ProductionMaskProcess;
  production: {
    enabled: boolean;
    referenceObjectId: string;
    source: { kind: "reference-object" } | AssetSource;
    alpha: ProductionMaskAlphaParameters;
  };
  presentation: ProductionMaskPresentationState;
}

export interface ProductionMaskDocumentState {
  masks: Record<string, ProductionMaskDocumentEntry>;
}

export interface ProductionMaskPreviewStyle {
  tint?: Partial<ImageMaskTint>;
  opacity?: number;
}

export interface ProductionMaskSettings {
  process: string;
  enabled: boolean;
  reference: ProductionMaskDocumentReference;
  alignment?: ProductionMaskAlignmentMode;
  source?: ProductionMaskSource;
  alpha: ProductionMaskAlphaParameters;
  preview?: ProductionMaskPreviewStyle;
}

export interface ProductionMaskCapabilityOptions {
  capabilityId?: string;
  layers?: ProductionMaskLayerOptions;
}

export interface ProductionMaskDocumentController {
  mutate(
    callback: (
      document: EditorDocument,
    ) => EditorDocument | void | Promise<EditorDocument | void>,
  ): Promise<
    | { ok: true; document: EditorDocument }
    | { ok: false; reason: string; diagnostics: EditorDocumentDiagnostic[] }
  >;
}

export interface ProductionMaskDescriptor {
  maskId: string;
  layerId: string | null;
  surfaceId: string;
  settings: ProductionMaskSettings;
  presentation: ProductionMaskPresentationState;
}

export interface ProductionMaskSessionDraft {
  descriptor: ProductionMaskDescriptor;
  /** Show the reference/user artwork projection in the session scene. */
  previewOriginalVisible: boolean;
  /** Show the cover overlay derived from the original artwork alpha. */
  previewOriginalMaskVisible: boolean;
  /** Show the current production-mask preview. */
  previewCurrentMaskVisible: boolean;
}

export interface ProductionMaskViewState {
  dirty: boolean;
  descriptor: ProductionMaskDescriptor | null;
  phase: SessionPhase | "idle";
  previewOriginalVisible: boolean;
  previewOriginalMaskVisible: boolean;
  previewCurrentMaskVisible: boolean;
  sessionId: string | null;
}

export interface ProductionMaskSessionOpenEvent {
  maskId: string;
  process: string;
  sessionId: string;
  source: "api";
  surfaceId: string;
}

export interface ProductionMaskSessionCloseEvent {
  maskId: string;
  reason: SessionTerminalReason;
  sessionId: string;
}

export type ProductionMaskCapabilityChangeEvent =
  | { type: "state"; state: ProductionMaskViewState }
  | { type: "session-opened"; event: ProductionMaskSessionOpenEvent }
  | { type: "session-closed"; event: ProductionMaskSessionCloseEvent };

export type ProductionMaskOperationFailureReason =
  | "document-not-bound"
  | "mask-not-found"
  | "reference-not-found"
  | "session-conflict"
  | "session-not-active"
  | "source-empty"
  | "transient-resource"
  | "document-update-failed";

export type ProductionMaskOperationResult =
  | { ok: true }
  | { ok: false; reason: ProductionMaskOperationFailureReason };

export interface GenerateProductionMaskOptions {
  alpha: ProductionMaskAlphaParameters;
  tint?: Partial<ImageMaskTint>;
}

export interface ProductionMaskCapabilityApi {
  syncDocument(
    document: EditorDocument,
    controller: ProductionMaskDocumentController,
  ): void;
  listMasks(): ProductionMaskDescriptor[];
  onDidChange(listener: (event: ProductionMaskCapabilityChangeEvent) => void): {
    dispose(): void;
  };
  openSession(input: {
    maskId?: string;
    process?: string;
  }): Promise<ProductionMaskOperationResult>;
  getViewState(): ProductionMaskViewState;
  setSource(resource: EditorImageResource): ProductionMaskOperationResult;
  useReferenceSource(): ProductionMaskOperationResult;
  clearSource(): ProductionMaskOperationResult;
  updateAlpha(
    parameters: Partial<ProductionMaskAlphaParameters>,
  ): ProductionMaskOperationResult;
  updateEnabled(enabled: boolean): ProductionMaskOperationResult;
  updatePreview(options: {
    originalVisible?: boolean;
    originalMaskVisible?: boolean;
    currentMaskVisible?: boolean;
  }): Promise<ProductionMaskOperationResult>;
  commitSession(): Promise<ProductionMaskOperationResult>;
  rollbackSession(): Promise<ProductionMaskOperationResult>;
  generateMask(
    sourceUrl: string,
    options: GenerateProductionMaskOptions,
  ): Promise<string>;
  refresh(): Promise<void>;
}

export function normalizeProductionMaskLayerId(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function createProductionMaskCapabilityDefinition(
  facade: ProductionMaskCapabilityApi,
  options: ProductionMaskCapabilityOptions = {},
): CapabilityDefinition<ProductionMaskCapabilityApi> {
  return {
    id: options.capabilityId || POODER_PRODUCTION_MASK_CAPABILITY_ID,
    metadata: {
      name: "Production Mask",
      description:
        "Edit parameterized production masks backed by Document effects.",
      tags: ["production", "image", "mask", "print"],
    },
    dependencies: {
      capabilities: [IMAGE_MASK_CAPABILITY_ID],
    },
    facade,
  };
}
