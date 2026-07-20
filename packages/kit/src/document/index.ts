import {
  applyEditorDocument,
  createEditorDocumentController,
  type ApplyEditorDocumentResult,
  type EditorDocumentController,
  type EditorDocumentRuntime,
} from "@pooder/document-core";
import {
  collectEditorDocumentCapabilityRequirements,
  normalizeEditorDocument,
  validateEditorDocument,
  type EditorDocument,
  type EditorDocumentCapabilityCollectionOptions,
  type EditorDocumentDiagnostic,
  type EditorDocumentValidationOptions,
  type EditorEffect,
  type EditorObject,
  type ObjectSource,
} from "@pooder/document";
export {
  IMAGE_SLOT_CAPABILITY_ID,
  IMAGE_SLOT_OPEN_SESSION_COMMAND_ID,
} from "../extensions/image-slot/capability";

export type KitEditorDocumentRuntime = EditorDocumentRuntime;
export type ApplyKitEditorDocumentResult = ApplyEditorDocumentResult;

export interface KitEditorDocumentController extends EditorDocumentController {}

export const KIT_EDITOR_DOCUMENT_EFFECT_CAPABILITY_IDS = {
  clip: "pooder.kit.clip",
  dieline: "pooder.kit.dieline-geometry",
  feature: "pooder.kit.feature",
  "configurable-visual": "pooder.kit.configurable-visual",
  mirror: "pooder.kit.mirror",
} as const;

export type KitEditorDocumentEffectType =
  keyof typeof KIT_EDITOR_DOCUMENT_EFFECT_CAPABILITY_IDS;

export type KitEditorDocumentEffect<TPayload = Record<string, unknown>> =
  EditorEffect<TPayload> & {
    type: KitEditorDocumentEffectType;
  };

export function isKitEditorDocumentEffectType(
  type: string,
): type is KitEditorDocumentEffectType {
  return Object.prototype.hasOwnProperty.call(
    KIT_EDITOR_DOCUMENT_EFFECT_CAPABILITY_IDS,
    type,
  );
}

export function resolveKitEditorDocumentEffectCapabilityId(
  effect: EditorEffect,
): string | undefined {
  if (effect.capabilityId) return effect.capabilityId;
  return isKitEditorDocumentEffectType(effect.type)
    ? KIT_EDITOR_DOCUMENT_EFFECT_CAPABILITY_IDS[effect.type]
    : undefined;
}

export function normalizeKitEditorDocument(value: unknown) {
  return normalizeEditorDocument(value);
}

export function validateKitEditorDocument(
  value: unknown,
  options: Omit<
    EditorDocumentValidationOptions,
    "resolveEffectCapabilityId"
  > = {},
) {
  return validateEditorDocument(value, {
    ...options,
    resolveEffectCapabilityId: resolveKitEditorDocumentEffectCapabilityId,
  });
}

export function collectKitEditorDocumentCapabilityRequirements(
  value: unknown,
  options: Omit<
    EditorDocumentCapabilityCollectionOptions,
    "resolveEffectCapabilityId"
  > = {},
) {
  const document = normalizeEditorDocument(value);
  const result = collectEditorDocumentCapabilityRequirements(document, {
    ...options,
    resolveEffectCapabilityId: resolveKitEditorDocumentEffectCapabilityId,
  });
  return result;
}

export async function applyKitEditorDocument(
  runtime: KitEditorDocumentRuntime,
  value: unknown,
): Promise<ApplyKitEditorDocumentResult> {
  return applyEditorDocument(runtime, value, {
    resolveEffectCapabilityId: resolveKitEditorDocumentEffectCapabilityId,
    afterApply: refreshKitDocumentRuntimeCapabilities,
  });
}

export function createKitEditorDocumentController(
  runtime: KitEditorDocumentRuntime,
): KitEditorDocumentController {
  let controller: KitEditorDocumentController;
  controller = createEditorDocumentController(runtime, {
    resolveEffectCapabilityId: resolveKitEditorDocumentEffectCapabilityId,
    afterApply: (nextRuntime, document) =>
      refreshKitDocumentRuntimeCapabilities(nextRuntime, document, controller),
  });
  return controller;
}

async function refreshKitDocumentRuntimeCapabilities(
  runtime: KitEditorDocumentRuntime,
  document: EditorDocument,
  controller?: KitEditorDocumentController,
): Promise<void> {
  const featureState = readObjectFeatureEffectState(document);
  runtime.capabilities
    .get<{
      replaceFeatures(
        features: Record<string, unknown>[],
        options?: Record<string, unknown>,
      ): void;
    }>(KIT_EDITOR_DOCUMENT_EFFECT_CAPABILITY_IDS.feature)
    ?.replaceFeatures(featureState?.features ?? [], {
      markDirty: false,
      target: "both",
    });

  if (controller) {
    runtime.capabilities
      .get<{
        syncDocument(
          document: EditorDocument,
          controller: EditorDocumentController,
        ): void;
      }>("pooder.kit.image-slot")
      ?.syncDocument(document, controller);
  }
}

function readObjectFeatureEffectState(
  document: EditorDocument,
): { features: Record<string, unknown>[] } | null {
  for (const surface of document.surfaces) {
    for (const layer of surface.layers) {
      for (const object of layer.objects ?? []) {
        for (const effect of object.effects ?? []) {
          if (effect.type !== "feature") continue;
          const payload =
            "payload" in effect &&
            effect.payload &&
            typeof effect.payload === "object"
              ? effect.payload
              : {};
          const features = (payload as Record<string, unknown>).features;
          if (Array.isArray(features)) {
            return {
              features: JSON.parse(JSON.stringify(features)) as Record<
                string,
                unknown
              >[],
            };
          }
        }
      }
    }
  }

  return null;
}

export type {
  EditorDocument,
  EditorDocumentDiagnostic,
  EditorEffect,
  EditorObject,
  EditorObjectEffect,
  ObjectSource,
} from "@pooder/document";
