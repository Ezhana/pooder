import {
  collectEditorDocumentCapabilityRequirements,
  parseEditorDocument,
  validateEditorDocument,
  validateEditorDocumentEffectSchemas,
  type EditorDocument,
  type EditorDocumentCapabilityCollectionOptions,
  type EditorDocumentValidationOptions,
  type EditorExtensionObjectEffect,
} from "@pooder/document";

import type { ImageSlotDocumentController } from "../extensions/image-slot/capability";
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
  effect: EditorExtensionObjectEffect,
): string | undefined {
  return isOfficialToolDocumentEffectType(effect.type)
    ? OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS[effect.type]
    : undefined;
}

export function parseOfficialToolDocument(value: unknown): EditorDocument {
  return parseEditorDocument(value);
}

export function validateOfficialToolDocument(
  value: unknown,
  options: EditorDocumentValidationOptions = {},
) {
  const documentDiagnostics = validateEditorDocument(value, options);
  if (documentDiagnostics.some((item) => item.severity === "error")) {
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
  const document = parseEditorDocument(value);
  return collectEditorDocumentCapabilityRequirements(document, {
    ...options,
    resolveEffectCapabilityId: resolveOfficialToolDocumentEffectCapabilityId,
  });
}

export async function synchronizeOfficialToolsForDocument(
  getCapability: OfficialToolCapabilityResolver,
  document: EditorDocument,
  controller?: ImageSlotDocumentController,
): Promise<void> {
  if (!controller) return;
  getCapability<{
    syncDocument(
      document: EditorDocument,
      controller: ImageSlotDocumentController,
    ): void;
  }>("pooder.kit.image-slot")?.syncDocument(document, controller);
}

export type {
  EditorDocument,
  EditorDocumentDiagnostic,
  EditorExtensionObjectEffect,
  EditorObject,
  EditorObjectEffect,
  ObjectSource,
} from "@pooder/document";
