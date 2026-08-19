import {
  EffectSchemaRegistry,
  type EffectSchema,
  type EffectSchemaIssue,
} from "@pooder/document";

export const EFFECT_CAPABILITY_IDS = {
  mirror: "pooder.kit.mirror",
} as const;

export const EFFECT_SCHEMAS: readonly EffectSchema[] = [
  {
    effectType: "mirror",
    capabilityId: EFFECT_CAPABILITY_IDS.mirror,
    validate: (payload) =>
      validateOptionalRecordFields(payload, {
        horizontal: "boolean",
        vertical: "boolean",
      }),
  },
];

export function getEffectSchema(effectType: string): EffectSchema {
  const schema = EFFECT_SCHEMAS.find(
    (candidate) => candidate.effectType === effectType,
  );
  if (!schema) throw new Error(`Unknown effect "${effectType}".`);
  return schema;
}

export function createEffectSchemaRegistry(): EffectSchemaRegistry {
  return new EffectSchemaRegistry(EFFECT_SCHEMAS);
}

function validateOptionalRecord(payload: unknown): EffectSchemaIssue[] {
  return payload === undefined || isRecord(payload)
    ? []
    : [invalidType(undefined, "an object")];
}

function validateOptionalRecordFields(
  payload: unknown,
  fields: Record<string, "boolean" | "string">,
): EffectSchemaIssue[] {
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
): EffectSchemaIssue {
  return {
    code: "effect-payload-invalid",
    message: `Effect payload${path ? `.${path}` : ""} must be ${expected}.`,
    ...(path ? { path } : {}),
  };
}

function invalidRequiredString(path: string): EffectSchemaIssue {
  return {
    code: "effect-payload-invalid",
    message: `Effect payload.${path} must be a non-empty string.`,
    path,
  };
}

function invalidFiniteNumber(path: string): EffectSchemaIssue {
  return {
    code: "effect-payload-invalid",
    message: `Effect payload.${path} must be a finite number.`,
    path,
  };
}

function invalidEnum(
  path: string,
  values: readonly string[],
): EffectSchemaIssue {
  return {
    code: "effect-payload-invalid",
    message: `Effect payload.${path} must be one of: ${values.join(", ")}.`,
    path,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
