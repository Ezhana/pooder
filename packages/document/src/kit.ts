import type { EditorEffect } from "./index";
import {
  collectEditorDocumentCapabilityRequirements,
  normalizeEditorDocument,
  validateEditorDocument,
  type EditorDocumentCapabilityCollectionOptions,
  type EditorDocumentValidationOptions,
} from "./index";

export const KIT_EDITOR_DOCUMENT_EFFECT_CAPABILITY_IDS = {
  background: "pooder.kit.background",
  "template-overlay": "pooder.kit.template-overlay",
  dieline: "pooder.kit.dieline-geometry",
  feature: "pooder.kit.feature",
  "image-placement": "pooder.kit.image-placement",
  "white-ink": "pooder.kit.white-ink",
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
  options: Omit<EditorDocumentValidationOptions, "resolveEffectCapabilityId"> = {},
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
  return collectEditorDocumentCapabilityRequirements(value, {
    ...options,
    resolveEffectCapabilityId: resolveKitEditorDocumentEffectCapabilityId,
  });
}

export type {
  EditorAsset,
  EditorDocument,
  EditorDocumentCapabilityRequirement,
  EditorDocumentDiagnostic,
  EditorDocumentRequirePolicy,
  EditorEffect,
  EditorImageObject,
  EditorLayer,
  EditorObject,
  EditorSurface,
  EditorView,
} from "./index";
