import {
  findEditorDocumentObject,
  type DocumentExtensionContribution,
  type DocumentValueSchemaIssue,
  type EditorDocumentDiagnostic,
} from "@pooder/document";

import {
  POODER_PRODUCTION_MASK_CAPABILITY_ID,
  type ProductionMaskDocumentState,
} from "./capability";

export const POODER_PRODUCTION_MASK_DOCUMENT_CONTRIBUTION: DocumentExtensionContribution<ProductionMaskDocumentState> =
  {
    id: POODER_PRODUCTION_MASK_CAPABILITY_ID,
    behaviors: [
      {
        behaviorType: "pooder.production-mask",
        capabilityId: POODER_PRODUCTION_MASK_CAPABILITY_ID,
        validate: (behavior) => {
          const config = behavior.config;
          return isRecord(config) &&
            Array.isArray(config.maskIds) &&
            config.maskIds.length > 0 &&
            config.maskIds.every(isNonEmptyString)
            ? []
            : [invalidType("config.maskIds", "a non-empty array of mask ids")];
        },
      },
    ],
    stateSchema: {
      validate: validateProductionMaskDocumentState,
    },
    validateReferences: validateProductionMaskReferences,
  };

function validateProductionMaskDocumentState(
  value: unknown,
): DocumentValueSchemaIssue[] {
  if (!isRecord(value)) return [invalidType(undefined, "an object")];
  if (!isRecord(value.masks)) return [invalidType("masks", "an object")];
  const issues: DocumentValueSchemaIssue[] = [];
  for (const [maskId, rawMask] of Object.entries(value.masks)) {
    const path = `masks.${maskId}`;
    if (!maskId.trim()) issues.push(invalidType(path, "a non-empty mask id"));
    if (!isRecord(rawMask)) {
      issues.push(invalidType(path, "an object"));
      continue;
    }
    if (!isNonEmptyString(rawMask.surfaceId)) {
      issues.push(invalidType(`${path}.surfaceId`, "a non-empty surface id"));
    }
    if (!isProcess(rawMask.process)) {
      issues.push(
        invalidType(
          `${path}.process`,
          '"white-ink", "reverse", or "spot-uv"',
        ),
      );
    }
    validateProduction(rawMask.production, `${path}.production`, issues);
    validatePresentation(rawMask.presentation, `${path}.presentation`, issues);
  }
  return issues;
}

function validateProduction(
  value: unknown,
  path: string,
  issues: DocumentValueSchemaIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(invalidType(path, "an object"));
    return;
  }
  if (typeof value.enabled !== "boolean") {
    issues.push(invalidType(`${path}.enabled`, "a boolean"));
  }
  if (!isNonEmptyString(value.referenceObjectId)) {
    issues.push(invalidType(`${path}.referenceObjectId`, "a non-empty object id"));
  }
  if (!isRecord(value.source)) {
    issues.push(invalidType(`${path}.source`, "an object"));
  } else if (value.source.kind === "asset") {
    if (!isNonEmptyString(value.source.assetId)) {
      issues.push(invalidType(`${path}.source.assetId`, "a non-empty asset id"));
    }
  } else if (value.source.kind !== "reference-object") {
    issues.push(
      invalidType(`${path}.source.kind`, '"reference-object" or "asset"'),
    );
  }
  validateAlpha(value.alpha, `${path}.alpha`, issues);
}

function validateAlpha(
  value: unknown,
  path: string,
  issues: DocumentValueSchemaIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(invalidType(path, "an object"));
    return;
  }
  if (value.selection !== "opaque" && value.selection !== "transparent") {
    issues.push(invalidType(`${path}.selection`, '"opaque" or "transparent"'));
  }
  if (value.mapping !== "continuous" && value.mapping !== "threshold") {
    issues.push(invalidType(`${path}.mapping`, '"continuous" or "threshold"'));
  }
  for (const key of ["threshold", "softness", "outputOpacity"] as const) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== "number" ||
        !Number.isFinite(value[key]) ||
        value[key] < 0 ||
        value[key] > 1)
    ) {
      issues.push(invalidType(`${path}.${key}`, "a number from 0 to 1"));
    }
  }
}

function validatePresentation(
  value: unknown,
  path: string,
  issues: DocumentValueSchemaIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(invalidType(path, "an object"));
    return;
  }
  for (const key of [
    "originalVisible",
    "originalMaskVisible",
    "currentMaskVisible",
  ] as const) {
    if (typeof value[key] !== "boolean") {
      issues.push(invalidType(`${path}.${key}`, "a boolean"));
    }
  }
}

function validateProductionMaskReferences(
  state: ProductionMaskDocumentState,
  document: Parameters<
    NonNullable<
      DocumentExtensionContribution<ProductionMaskDocumentState>["validateReferences"]
    >
  >[1],
): EditorDocumentDiagnostic[] {
  const diagnostics: EditorDocumentDiagnostic[] = [];
  for (const [maskId, mask] of Object.entries(state.masks)) {
    const path = `masks.${maskId}`;
    const surface = document.surfaces.find((entry) => entry.id === mask.surfaceId);
    if (!surface) {
      diagnostics.push(referenceError(`${path}.surfaceId`, "surface", mask.surfaceId));
      continue;
    }
    const reference = findEditorDocumentObject(document, mask.production.referenceObjectId);
    if (!reference) {
      diagnostics.push(
        referenceError(
          `${path}.production.referenceObjectId`,
          "object",
          mask.production.referenceObjectId,
        ),
      );
    } else if (
      !surface.layers.some((layer) =>
        layer.objects?.some((object) => containsObject(object, reference.id)),
      )
    ) {
      diagnostics.push({
        severity: "error",
        code: "production-mask-reference-cross-surface",
        message: `Production mask reference "${reference.id}" is outside surface "${surface.id}".`,
        path: `${path}.production.referenceObjectId`,
      });
    }
    const source = mask.production.source;
    if (
      source.kind === "asset" &&
      !document.assets.some((asset) => asset.id === source.assetId)
    ) {
      diagnostics.push(
        referenceError(
          `${path}.production.source.assetId`,
          "asset",
          source.assetId,
        ),
      );
    }
  }
  return diagnostics;
}

function containsObject(
  object: { id: string; children?: readonly { id: string; children?: readonly unknown[] }[] },
  objectId: string,
): boolean {
  if (object.id === objectId) return true;
  return (object.children ?? []).some((child) =>
    containsObject(child as Parameters<typeof containsObject>[0], objectId),
  );
}

function referenceError(
  path: string,
  kind: string,
  id: string,
): EditorDocumentDiagnostic {
  return {
    severity: "error",
    code: `production-mask-${kind}-missing`,
    message: `Production mask ${kind} "${id}" does not exist.`,
    path,
  };
}

function invalidType(
  path: string | undefined,
  expected: string,
): DocumentValueSchemaIssue {
  return {
    code: "production-mask-state-invalid",
    message: `Production mask state${path ? `.${path}` : ""} must be ${expected}.`,
    ...(path ? { path } : {}),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isProcess = (value: unknown): boolean =>
  value === "white-ink" || value === "reverse" || value === "spot-uv";
