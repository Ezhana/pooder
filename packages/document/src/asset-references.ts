import type { DocumentExtensionRegistry } from "./extension-schema";
import {
  findEditorDocumentObject,
  visitEditorDocumentObjects,
  type AssetSource,
  type EditorAsset,
  type EditorAssetReferenceBinding,
  type EditorDocument,
  type EditorDocumentDiagnostic,
} from "./index";

export interface EditorDocumentAssetReferenceOptions {
  extensionRegistry?: DocumentExtensionRegistry;
}

/**
 * Collects only declared asset references. Extension JSON is never searched.
 * Behaviors, effects, and document extensions participate through their schema.
 */
export function collectEditorDocumentAssetReferences(
  document: EditorDocument,
  options: EditorDocumentAssetReferenceOptions = {},
): EditorAssetReferenceBinding[] {
  const references: EditorAssetReferenceBinding[] = [];
  const objectSchemas = options.extensionRegistry?.createObjectSchemaRegistry();
  const effectSchemas = options.extensionRegistry?.createEffectSchemaRegistry();

  visitEditorDocumentObjects(document, ({ object, path }) => {
    if (object.type === "image" && object.source) {
      references.push({
        source: object.source,
        expectedType: "image",
        path: `${path}.source`,
        replace: (source) => {
          object.source = source;
        },
      });
    }

    object.behaviors?.forEach((behavior) => {
      references.push(
        ...(objectSchemas
          ?.getBehavior(behavior.type)
          ?.collectAssetReferences?.(behavior, {
            document,
            objectId: object.id,
            path,
          }) ?? []),
      );
    });

    object.effects?.forEach((effect, effectIndex) => {
      const schema = effectSchemas?.get(effect.type);
      if (!schema?.collectAssetReferences || !("payload" in effect)) return;
      const effectPath = `${path}.effects[${effectIndex}]`;
      references.push(
        ...schema.collectAssetReferences(effect.payload, {
          effect: effect as unknown as Readonly<Record<string, unknown>>,
          effectPath,
          effectType: effect.type,
        }),
      );
    });
  });

  for (const [extensionId, state] of Object.entries(document.extensions)) {
    const contribution = options.extensionRegistry?.get(extensionId);
    references.push(
      ...(contribution?.collectAssetReferences?.(state, {
        document,
        extensionId,
      }) ?? []),
    );
  }
  return references;
}

export function validateEditorDocumentAssetReferences(
  document: EditorDocument,
  options: EditorDocumentAssetReferenceOptions = {},
): EditorDocumentDiagnostic[] {
  return collectEditorDocumentAssetReferences(document, options).flatMap(
    (reference) => {
      const asset = document.assets.find(
        (candidate) => candidate.id === reference.source.assetId,
      );
      if (!asset) {
        return [
          {
            severity: "error" as const,
            stage: "document-schema" as const,
            code: "asset-reference-missing",
            message: `Asset "${reference.source.assetId}" does not exist.`,
            path: `${reference.path}.assetId`,
          },
        ];
      }
      if (asset.type !== reference.expectedType) {
        return [
          {
            severity: "error" as const,
            stage: "document-schema" as const,
            code: "asset-reference-type-mismatch",
            message: `Asset "${asset.id}" must have type "${reference.expectedType}".`,
            path: `${reference.path}.assetId`,
          },
        ];
      }
      return [];
    },
  );
}

export function resolveEditorDocumentAsset<
  TAsset extends EditorAsset = EditorAsset,
>(
  document: EditorDocument,
  source: AssetSource | null | undefined,
  expectedType?: TAsset["type"],
): TAsset | undefined {
  if (!source) return undefined;
  const asset = document.assets.find(
    (candidate) => candidate.id === source.assetId,
  );
  return asset && (!expectedType || asset.type === expectedType)
    ? (asset as TAsset)
    : undefined;
}

export function replaceEditorDocumentAssetReferences(
  document: EditorDocument,
  assetId: string,
  replacement: AssetSource,
  options: EditorDocumentAssetReferenceOptions = {},
): number {
  let replaced = 0;
  collectEditorDocumentAssetReferences(document, options).forEach(
    (reference) => {
      if (reference.source.assetId !== assetId) return;
      reference.replace(replacement);
      replaced += 1;
    },
  );
  return replaced;
}

export function setEditorImageObjectSource(
  document: EditorDocument,
  objectId: string,
  source: AssetSource | null,
): AssetSource | null | undefined {
  const object = findEditorDocumentObject(document, objectId);
  if (!object || object.type !== "image") return undefined;
  const previous = object.source;
  object.source = source;
  return previous;
}

export function upsertEditorDocumentAsset(
  document: EditorDocument,
  asset: EditorAsset,
): void {
  const index = document.assets.findIndex(
    (candidate) => candidate.id === asset.id,
  );
  if (index >= 0) document.assets[index] = asset;
  else document.assets.push(asset);
}

export function createEditorDocumentAssetId(
  document: EditorDocument,
  preferredId: string,
): string {
  const existingIds = new Set(document.assets.map((asset) => asset.id));
  if (!existingIds.has(preferredId)) return preferredId;
  let sequence = 2;
  while (existingIds.has(`${preferredId}.${sequence}`)) sequence += 1;
  return `${preferredId}.${sequence}`;
}

export function reclaimOrphanedEditorDocumentAssets(
  document: EditorDocument,
  options: EditorDocumentAssetReferenceOptions = {},
): string[] {
  const referenced = new Set(
    collectEditorDocumentAssetReferences(document, options).map(
      (reference) => reference.source.assetId,
    ),
  );
  const removed = document.assets
    .filter((asset) => !referenced.has(asset.id))
    .map((asset) => asset.id);
  if (removed.length) {
    document.assets = document.assets.filter((asset) =>
      referenced.has(asset.id),
    );
  }
  return removed;
}

export function isAssetSource(value: unknown): value is AssetSource {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).kind === "asset" &&
    typeof (value as Record<string, unknown>).assetId === "string" &&
    Boolean((value as Record<string, unknown>).assetId)
  );
}

export function createAssetReferenceBinding(
  source: AssetSource,
  expectedType: EditorAsset["type"],
  path: string,
  replace: (source: AssetSource) => void,
): EditorAssetReferenceBinding {
  return { source, expectedType, path, replace };
}
