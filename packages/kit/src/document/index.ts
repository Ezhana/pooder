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
  type EditorObjectEffect,
  type ObjectSource,
} from "@pooder/document";

export type KitEditorDocumentRuntime = EditorDocumentRuntime;
export type ApplyKitEditorDocumentResult = ApplyEditorDocumentResult;

export interface KitEditorDocumentController extends EditorDocumentController {
  updateObjectSource(
    objectId: string,
    source: ObjectSource,
    options?: {
      frame?: EditorObject["frame"];
      style?: Record<string, unknown>;
    },
  ): Promise<boolean>;
  updateObjectEffects(
    objectId: string,
    effects: readonly EditorObjectEffect[],
  ): Promise<boolean>;
}

export const KIT_EDITOR_DOCUMENT_EFFECT_CAPABILITY_IDS = {
  clip: "pooder.kit.clip",
  dieline: "pooder.kit.dieline-geometry",
  feature: "pooder.kit.feature",
  "configurable-visual": "pooder.kit.configurable-visual",
  "image-placement": "pooder.kit.image-placement",
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
  document.surfaces.forEach((surface, surfaceIndex) => {
    surface.layers.forEach((layer, layerIndex) => {
      layer.objects?.forEach((object, objectIndex) => {
        if (!object.interaction) return;
        result.requirements.push({
          capabilityId: "pooder.kit.interaction",
          effectType: "object-interaction",
          require: "strict",
          path: `surfaces[${surfaceIndex}].layers[${layerIndex}].objects[${objectIndex}].interaction`,
        });
      });
    });
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
  return createEditorDocumentController(runtime, {
    resolveEffectCapabilityId: resolveKitEditorDocumentEffectCapabilityId,
    afterApply: refreshKitDocumentRuntimeCapabilities,
  });
}

async function refreshKitDocumentRuntimeCapabilities(
  runtime: KitEditorDocumentRuntime,
  document: EditorDocument,
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

  await runtime.capabilities
    .get<{
      refresh(): Promise<void> | void;
    }>(KIT_EDITOR_DOCUMENT_EFFECT_CAPABILITY_IDS["image-placement"])
    ?.refresh();
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
