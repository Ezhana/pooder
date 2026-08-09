import {
  collectEditorDocumentCapabilityRequirements,
  normalizeEditorDocument,
  validateEditorDocument,
  validateEditorDocumentEffectSchemas,
  type EditorDocument,
  type EditorDocumentCapabilityCollectionOptions,
  type EditorDocumentDiagnostic,
  type EditorDocumentValidationOptions,
  type EditorEffect,
  type EditorExtensionObjectEffect,
  type EditorObject,
  type ObjectSource,
} from "@pooder/document";
import {
  OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS,
  createOfficialToolEffectSchemaRegistry,
} from "./effect-schemas";
export * from "./behavior-schemas";
export {
  OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS,
  OFFICIAL_TOOL_EFFECT_SCHEMAS,
  createOfficialToolEffectSchemaRegistry,
} from "./effect-schemas";
export {
  IMAGE_SLOT_CAPABILITY_ID,
  IMAGE_SLOT_OPEN_SESSION_COMMAND_ID,
} from "../extensions/image-slot/capability";
import type { ImageSlotDocumentController } from "../extensions/image-slot/capability";

export type OfficialToolCapabilityResolver = <T = unknown>(
  id: string,
) => T | null | undefined;

export type OfficialToolDocumentEffectType =
  keyof typeof OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS;

export type OfficialToolDocumentEffect<TPayload = Record<string, unknown>> =
  EditorExtensionObjectEffect<TPayload> & {
    type: OfficialToolDocumentEffectType;
  };

export function isOfficialToolDocumentEffectType(
  type: string,
): type is OfficialToolDocumentEffectType {
  return Object.prototype.hasOwnProperty.call(
    OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS,
    type,
  );
}

export function resolveOfficialToolDocumentEffectCapabilityId(
  effect: EditorEffect,
): string | undefined {
  return isOfficialToolDocumentEffectType(effect.type)
    ? OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS[effect.type]
    : undefined;
}

export function normalizeOfficialToolDocument(value: unknown) {
  return normalizeEditorDocument(value);
}

export function validateOfficialToolDocument(
  value: unknown,
  options: EditorDocumentValidationOptions = {},
) {
  const documentDiagnostics = validateEditorDocument(value, options);
  if (
    documentDiagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    return documentDiagnostics;
  }
  return [
    ...documentDiagnostics,
    ...validateEditorDocumentEffectSchemas(
      value,
      createOfficialToolEffectSchemaRegistry(),
    ),
  ];
}

export function collectOfficialToolDocumentCapabilityRequirements(
  value: unknown,
  options: Omit<
    EditorDocumentCapabilityCollectionOptions,
    "resolveEffectCapabilityId"
  > = {},
) {
  const document = normalizeEditorDocument(value);
  const result = collectEditorDocumentCapabilityRequirements(document, {
    ...options,
    resolveEffectCapabilityId: resolveOfficialToolDocumentEffectCapabilityId,
  });
  return result;
}

export async function synchronizeOfficialToolsForDocument(
  getCapability: OfficialToolCapabilityResolver,
  document: EditorDocument,
  controller?: ImageSlotDocumentController,
): Promise<void> {
  if (controller) {
    getCapability<{
      syncDocument(
        document: EditorDocument,
        controller: ImageSlotDocumentController,
      ): void;
    }>("pooder.kit.image-slot")?.syncDocument(document, controller);
  }
}

/** @deprecated Use OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS. */
export const KIT_EDITOR_DOCUMENT_EFFECT_CAPABILITY_IDS =
  OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS;
/** @deprecated Use OfficialToolDocumentEffectType. */
export type KitEditorDocumentEffectType = OfficialToolDocumentEffectType;
/** @deprecated Use OfficialToolDocumentEffect. */
export type KitEditorDocumentEffect<TPayload = Record<string, unknown>> =
  OfficialToolDocumentEffect<TPayload>;
/** @deprecated Use isOfficialToolDocumentEffectType. */
export const isKitEditorDocumentEffectType = isOfficialToolDocumentEffectType;
/** @deprecated Use resolveOfficialToolDocumentEffectCapabilityId. */
export const resolveKitEditorDocumentEffectCapabilityId =
  resolveOfficialToolDocumentEffectCapabilityId;
/** @deprecated Use normalizeOfficialToolDocument. */
export const normalizeKitEditorDocument = normalizeOfficialToolDocument;
/** @deprecated Use validateOfficialToolDocument. */
export const validateKitEditorDocument = validateOfficialToolDocument;
/** @deprecated Use collectOfficialToolDocumentCapabilityRequirements. */
export const collectKitEditorDocumentCapabilityRequirements =
  collectOfficialToolDocumentCapabilityRequirements;

export type {
  EditorDocument,
  EditorDocumentDiagnostic,
  EditorEffect,
  EditorObject,
  EditorObjectEffect,
  ObjectSource,
} from "@pooder/document";
