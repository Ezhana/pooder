import {
  EffectSchemaRegistry,
  type EditorEffectSchema,
  type EditorEffectSchemaIssue,
} from "@pooder/document";

export const OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS = {
  clip: "pooder.kit.clip",
  "image-placement": "pooder.kit.image-slot",
  "configurable-visual": "pooder.kit.configurable-visual",
  mirror: "pooder.kit.mirror",
} as const;

export const OFFICIAL_TOOL_EFFECT_SCHEMAS: readonly EditorEffectSchema[] = [
  {
    effectType: "clip",
    capabilityId: OFFICIAL_TOOL_DOCUMENT_EFFECT_CAPABILITY_IDS.clip,
    validate: validateClipPayload,
  },
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

export function createOfficialToolEffectSchemaRegistry(): EffectSchemaRegistry {
  return new EffectSchemaRegistry(OFFICIAL_TOOL_EFFECT_SCHEMAS);
}

function validateClipPayload(payload: unknown): EditorEffectSchemaIssue[] {
  const issues = validateOptionalRecordFields(payload, { enabled: "boolean" });
  if (
    payload === undefined ||
    !isRecord(payload) ||
    payload.source === undefined
  ) {
    return issues;
  }
  if (!isRecord(payload.source)) {
    issues.push(invalidType("source", "an object"));
    return issues;
  }
  const source = payload.source;
  if (
    source.type !== "image" &&
    source.type !== "path"
  ) {
    issues.push({
      code: "effect-payload-invalid",
      message: 'Clip source.type must be "image" or "path".',
      path: "source.type",
    });
    return issues;
  }
  if (source.type === "image" && !isNonEmptyString(source.src)) {
    issues.push(invalidRequiredString("source.src"));
  }
  if (
    source.type === "image" &&
    source.props !== undefined &&
    !isRecord(source.props)
  ) {
    issues.push(invalidType("source.props", "an object"));
  }
  if (source.type === "path" && !isNonEmptyString(source.pathData)) {
    issues.push(invalidRequiredString("source.pathData"));
  }
  if (
    source.space !== undefined &&
    source.space !== "scene" &&
    source.space !== "screen"
  ) {
    issues.push({
      code: "effect-payload-invalid",
      message: 'Clip source.space must be "scene" or "screen".',
      path: "source.space",
    });
  }
  return issues;
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
