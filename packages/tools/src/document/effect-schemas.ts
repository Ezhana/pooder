import {
  EffectSchemaRegistry,
  type EditorEffectSchema,
  type EditorEffectSchemaIssue,
} from "@pooder/document";

export const OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS = {
  "image-placement": "pooder.kit.image-slot",
  "configurable-visual": "pooder.kit.configurable-visual",
  mirror: "pooder.kit.mirror",
} as const;

export const OFFICIAL_TOOL_EFFECT_SCHEMAS: readonly EditorEffectSchema[] = [
  {
    effectType: "configurable-visual",
    capabilityId:
      OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS["configurable-visual"],
    validate: (payload) =>
      validateOptionalRecordFields(payload, {
        configKey: "string",
        key: "string",
      }),
  },
  {
    effectType: "mirror",
    capabilityId: OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS.mirror,
    validate: (payload) =>
      validateOptionalRecordFields(payload, {
        horizontal: "boolean",
        vertical: "boolean",
      }),
  },
  {
    effectType: "image-placement",
    capabilityId:
      OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS["image-placement"],
    validate: validateImagePlacementPayload,
  },
];

export function getOfficialToolEffectSchema(
  effectType: string,
): EditorEffectSchema {
  const schema = OFFICIAL_TOOL_EFFECT_SCHEMAS.find(
    (candidate) => candidate.effectType === effectType,
  );
  if (!schema) throw new Error(`Unknown official tool effect "${effectType}".`);
  return schema;
}

export function createOfficialToolEffectSchemaRegistry(): EffectSchemaRegistry {
  return new EffectSchemaRegistry(OFFICIAL_TOOL_EFFECT_SCHEMAS);
}

function validateImagePlacementPayload(
  payload: unknown,
): EditorEffectSchemaIssue[] {
  const issues = validateOptionalRecord(payload);
  if (payload === undefined || !isRecord(payload)) return issues;
  if (
    payload.accepts !== undefined &&
    (!Array.isArray(payload.accepts) ||
      payload.accepts.some((value) => !isNonEmptyString(value)))
  ) {
    issues.push({
      code: "effect-payload-invalid",
      message: "Image placement payload.accepts must be an array of strings.",
      path: "accepts",
    });
  }
  return issues;
}

function validateOptionalRecord(payload: unknown): EditorEffectSchemaIssue[] {
  return payload === undefined || isRecord(payload)
    ? []
    : [invalidType(undefined, "an object")];
}

function validateOptionalRecordFields(
  payload: unknown,
  fields: Record<string, "boolean" | "string">,
): EditorEffectSchemaIssue[] {
  const issues = validateOptionalRecord(payload);
  if (payload === undefined || !isRecord(payload)) return issues;
  Object.entries(fields).forEach(([field, expected]) => {
    if (payload[field] !== undefined && typeof payload[field] !== expected) {
      issues.push(invalidType(field, `a ${expected}`));
    }
  });
  return issues;
}

function invalidType(
  path: string | undefined,
  expected: string,
): EditorEffectSchemaIssue {
  return {
    code: "effect-payload-invalid",
    message: `Effect payload${path ? `.${path}` : ""} must be ${expected}.`,
    ...(path ? { path } : {}),
  };
}

function invalidRequiredString(path: string): EditorEffectSchemaIssue {
  return {
    code: "effect-payload-invalid",
    message: `Effect payload.${path} must be a non-empty string.`,
    path,
  };
}

function invalidFiniteNumber(path: string): EditorEffectSchemaIssue {
  return {
    code: "effect-payload-invalid",
    message: `Effect payload.${path} must be a finite number.`,
    path,
  };
}

function invalidEnum(
  path: string,
  values: readonly string[],
): EditorEffectSchemaIssue {
  return {
    code: "effect-payload-invalid",
    message: `Effect payload.${path} must be one of: ${values.join(", ")}.`,
    path,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
