import type {
  EditorEffectSchema,
  EditorEffectSchemaIssue,
  EditorEffectSchemaValidationContext,
} from "@pooder/document";

import { POODER_PRODUCTION_MASK_CAPABILITY_ID } from "./capability";

export const POODER_PRODUCTION_MASK_EFFECT_SCHEMA: EditorEffectSchema = {
  effectType: "production-mask",
  capabilityId: POODER_PRODUCTION_MASK_CAPABILITY_ID,
  validate: validateProductionMaskEffectPayload,
};

function validateProductionMaskEffectPayload(
  payload: unknown,
  context: EditorEffectSchemaValidationContext,
): EditorEffectSchemaIssue[] {
  if (!isRecord(payload)) return [invalidType(undefined, "an object")];

  const issues: EditorEffectSchemaIssue[] = [];
  if (!isNonEmptyString(context.effect.id)) {
    issues.push({
      code: "effect-id-required",
      message: "Production mask effects must have a stable id.",
    });
  }
  if (!isNonEmptyString(payload.process)) {
    issues.push(invalidType("process", "a non-empty string"));
  }
  if (typeof payload.enabled !== "boolean") {
    issues.push(invalidType("enabled", "a boolean"));
  }
  validateReference(payload.reference, issues);
  validateAlignment(payload.alignment, issues);
  validateAlpha(payload.alpha, issues);

  if (payload.source !== undefined) {
    validateSource(payload.source, issues);
  } else if (payload.enabled === true) {
    issues.push(
      invalidType("source", "a source when the production mask is enabled"),
    );
  }

  if (payload.preview !== undefined) validatePreview(payload.preview, issues);
  if (payload.sessionProjections !== undefined) {
    validateSessionProjections(payload.sessionProjections, issues);
  }
  return issues;
}

function validateReference(
  value: unknown,
  issues: EditorEffectSchemaIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(invalidType("reference", "an object"));
    return;
  }
  if (value.type !== "document-object") {
    issues.push(invalidValue("reference.type", '"document-object"'));
  }
  if (!isNonEmptyString(value.objectId)) {
    issues.push(invalidType("reference.objectId", "a non-empty string"));
  }
}

function validateAlignment(
  value: unknown,
  issues: EditorEffectSchemaIssue[],
): void {
  if (
    value !== undefined &&
    value !== "reference-source" &&
    value !== "reference-frame"
  ) {
    issues.push(
      invalidValue("alignment", '"reference-source" or "reference-frame"'),
    );
  }
}

function validateSource(
  value: unknown,
  issues: EditorEffectSchemaIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(invalidType("source", "an object"));
    return;
  }
  if (value.type === "reference-object") return;
  if (value.type !== "image-resource") {
    issues.push(
      invalidValue("source.type", '"reference-object" or "image-resource"'),
    );
    return;
  }
  if (!isRecord(value.resource)) {
    issues.push(invalidType("source.resource", "an image resource"));
    return;
  }
  const resource = value.resource;
  if (resource.kind === "data-url") {
    if (!isNonEmptyString(resource.dataUrl)) {
      issues.push(invalidType("source.resource.dataUrl", "a non-empty string"));
    }
    return;
  }
  if (resource.kind === "url" || resource.kind === "blob-url") {
    if (!isNonEmptyString(resource.url)) {
      issues.push(invalidType("source.resource.url", "a non-empty string"));
    }
    if (resource.kind === "blob-url" && resource.transient !== true) {
      issues.push(
        invalidValue("source.resource.transient", "true for blob URLs"),
      );
    }
    return;
  }
  issues.push(
    invalidValue("source.resource.kind", '"url", "data-url", or "blob-url"'),
  );
}

function validateAlpha(
  value: unknown,
  issues: EditorEffectSchemaIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(invalidType("alpha", "an object"));
    return;
  }
  if (value.selection !== "opaque" && value.selection !== "transparent") {
    issues.push(invalidValue("alpha.selection", '"opaque" or "transparent"'));
  }
  if (value.mapping !== "continuous" && value.mapping !== "threshold") {
    issues.push(invalidValue("alpha.mapping", '"continuous" or "threshold"'));
  }
  validateOptionalUnitInterval(value, "threshold", "alpha", issues);
  validateOptionalUnitInterval(value, "softness", "alpha", issues);
  validateOptionalUnitInterval(value, "outputOpacity", "alpha", issues);
}

function validatePreview(
  value: unknown,
  issues: EditorEffectSchemaIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(invalidType("preview", "an object"));
    return;
  }
  validateOptionalUnitInterval(value, "opacity", "preview", issues);
  if (value.tint === undefined) return;
  if (!isRecord(value.tint)) {
    issues.push(invalidType("preview.tint", "an RGB object"));
    return;
  }
  for (const channel of ["r", "g", "b"]) {
    const channelValue = value.tint[channel];
    if (
      channelValue !== undefined &&
      (!Number.isFinite(channelValue) ||
        Number(channelValue) < 0 ||
        Number(channelValue) > 255)
    ) {
      issues.push(
        invalidValue(`preview.tint.${channel}`, "a number from 0 to 255"),
      );
    }
  }
}

function validateSessionProjections(
  value: unknown,
  issues: EditorEffectSchemaIssue[],
): void {
  if (!Array.isArray(value)) {
    issues.push(invalidType("sessionProjections", "an array"));
    return;
  }
  value.forEach((projection, index) => {
    const path = `sessionProjections[${index}]`;
    if (!isRecord(projection)) {
      issues.push(invalidType(path, "an object"));
      return;
    }
    if (projection.placement !== "below" && projection.placement !== "above") {
      issues.push(invalidValue(`${path}.placement`, '"below" or "above"'));
    }
    if (!isRecord(projection.source)) {
      issues.push(invalidType(`${path}.source`, "an object"));
    } else {
      validateOptionalStringArray(
        projection.source,
        "objectIds",
        `${path}.source`,
        issues,
      );
      validateOptionalStringArray(
        projection.source,
        "tags",
        `${path}.source`,
        issues,
      );
    }
    if (
      projection.surfaceScope !== undefined &&
      projection.surfaceScope !== "same-surface" &&
      projection.surfaceScope !== "all"
    ) {
      issues.push(
        invalidValue(`${path}.surfaceScope`, '"same-surface" or "all"'),
      );
    }
  });
}

function validateOptionalUnitInterval(
  payload: Record<string, unknown>,
  field: string,
  ownerPath: string,
  issues: EditorEffectSchemaIssue[],
): void {
  const value = payload[field];
  if (
    value !== undefined &&
    (!Number.isFinite(value) || Number(value) < 0 || Number(value) > 1)
  ) {
    issues.push(invalidValue(`${ownerPath}.${field}`, "a number from 0 to 1"));
  }
}

function validateOptionalStringArray(
  payload: Record<string, unknown>,
  field: string,
  ownerPath: string,
  issues: EditorEffectSchemaIssue[],
): void {
  const value = payload[field];
  if (
    value !== undefined &&
    (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item)))
  ) {
    issues.push(
      invalidType(`${ownerPath}.${field}`, "an array of non-empty strings"),
    );
  }
}

function invalidType(
  path: string | undefined,
  expected: string,
): EditorEffectSchemaIssue {
  return {
    code: "effect-payload-invalid",
    message: `Production mask effect payload${path ? `.${path}` : ""} must be ${expected}.`,
    ...(path ? { path } : {}),
  };
}

function invalidValue(path: string, expected: string): EditorEffectSchemaIssue {
  return {
    code: "effect-payload-invalid",
    message: `Production mask effect payload.${path} must be ${expected}.`,
    path,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
