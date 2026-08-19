import {
  collectDocumentCapabilityRequirements as collectBaseCapabilityRequirements,
  parseDocument,
  validateDocument as validateBaseDocument,
  validateDocumentEffectSchemas,
  type PooderDocument,
  type DocumentCapabilityCollectionOptions,
  type DocumentValidationOptions,
  type ExtensionObjectEffect,
} from "@pooder/document";

import type { ImageSlotDocumentController } from "../extensions/image-slot/capability";
import {
  EFFECT_CAPABILITY_IDS,
  createEffectSchemaRegistry,
} from "./effect-schemas";

export * from "./behavior-schemas";
export {
  EFFECT_CAPABILITY_IDS,
  EFFECT_SCHEMAS,
  createEffectSchemaRegistry,
} from "./effect-schemas";
export {
  IMAGE_SLOT_CAPABILITY_ID,
  IMAGE_SLOT_OPEN_SESSION_COMMAND_ID,
} from "../extensions/image-slot/capability";
export { parseDocument };

export type CapabilityResolver = <T = unknown>(
  id: string,
) => T | null | undefined;

export type DocumentEffectType = keyof typeof EFFECT_CAPABILITY_IDS;

export type DocumentEffect<TPayload = Record<string, unknown>> =
  ExtensionObjectEffect<TPayload> & {
    type: DocumentEffectType;
  };

export function isDocumentEffectType(type: string): type is DocumentEffectType {
  return Object.prototype.hasOwnProperty.call(EFFECT_CAPABILITY_IDS, type);
}

export function resolveEffectCapabilityId(
  effect: ExtensionObjectEffect,
): string | undefined {
  return isDocumentEffectType(effect.type)
    ? EFFECT_CAPABILITY_IDS[effect.type]
    : undefined;
}

export function validateDocument(
  value: unknown,
  options: DocumentValidationOptions = {},
) {
  const documentDiagnostics = validateBaseDocument(value, options);
  if (documentDiagnostics.some((item) => item.severity === "error")) {
    return documentDiagnostics;
  }
  return [
    ...documentDiagnostics,
    ...validateDocumentEffectSchemas(value, createEffectSchemaRegistry()),
  ];
}

export function collectDocumentCapabilityRequirements(
  value: unknown,
  options: Omit<
    DocumentCapabilityCollectionOptions,
    "resolveEffectCapabilityId"
  > = {},
) {
  const document = parseDocument(value);
  return collectBaseCapabilityRequirements(document, {
    ...options,
    resolveEffectCapabilityId,
  });
}

export async function synchronizeToolsForDocument(
  getCapability: CapabilityResolver,
  document: PooderDocument,
  controller?: ImageSlotDocumentController,
): Promise<void> {
  if (!controller) return;
  getCapability<{
    syncDocument(
      document: PooderDocument,
      controller: ImageSlotDocumentController,
    ): void;
  }>("pooder.kit.image-slot")?.syncDocument(document, controller);
}

export type {
  PooderDocument,
  DocumentDiagnostic,
  ExtensionObjectEffect,
  PooderObject,
  ObjectEffect,
  ObjectSource,
} from "@pooder/document";
