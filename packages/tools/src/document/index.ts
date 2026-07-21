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
  type EditorObject,
  type ObjectSource,
} from "@pooder/document";
import {
  OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS,
  createOfficialToolEffectSchemaRegistry,
} from "./effect-schemas";
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

export interface OfficialToolRuntime {
  readonly capabilities: {
    get<T = unknown>(id: string): T | undefined;
  };
}

export type OfficialToolDocumentEffectType =
  keyof typeof OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS;

export type OfficialToolDocumentEffect<TPayload = Record<string, unknown>> =
  EditorEffect<TPayload> & {
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
  if (effect.capabilityId) return effect.capabilityId;
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
  runtime: OfficialToolRuntime,
  document: EditorDocument,
  controller?: ImageSlotDocumentController,
): Promise<void> {
  const featureState = readObjectFeatureEffectState(document);
  runtime.capabilities
    .get<{
      replaceFeatures(
        features: Record<string, unknown>[],
        options?: Record<string, unknown>,
      ): void;
    }>(OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS.feature)
    ?.replaceFeatures(featureState?.features ?? [], {
      markDirty: false,
      target: "both",
    });

  if (controller) {
    runtime.capabilities
      .get<{
        syncDocument(
          document: EditorDocument,
          controller: ImageSlotDocumentController,
        ): void;
      }>("pooder.kit.image-slot")
      ?.syncDocument(document, controller);
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
