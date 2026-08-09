import {
  selectEditorDocumentObjects,
  type DocumentValueSchemaIssue,
  type EditorImageSlotBehaviorConfig,
  type EditorObjectBehavior,
  type ObjectSelector,
  type ObjectBehaviorDefinition,
} from "@pooder/document";

import {
  IMAGE_SLOT_CAPABILITY_ID,
  IMAGE_SLOT_OPEN_SESSION_COMMAND_ID,
} from "../extensions/image-slot";

export const IMAGE_SLOT_BEHAVIOR_TYPE = "pooder.image-slot";

export interface ImageSlotObjectBehavior extends EditorObjectBehavior<EditorImageSlotBehaviorConfig> {
  type: typeof IMAGE_SLOT_BEHAVIOR_TYPE;
}

export const IMAGE_SLOT_BEHAVIOR_DEFINITION: ObjectBehaviorDefinition = {
  behaviorType: IMAGE_SLOT_BEHAVIOR_TYPE,
  capabilityId: IMAGE_SLOT_CAPABILITY_ID,
  compileInteraction: () => ({
    hitRegion: { type: "frame", space: "scene" },
    activation: {
      action: { commandId: IMAGE_SLOT_OPEN_SESSION_COMMAND_ID },
      session: {
        channel: "image-slot",
        groupId: IMAGE_SLOT_CAPABILITY_ID,
        mode: "exclusive",
        scope: "subject",
        leavePolicy: "block",
      },
    },
  }),
  validate: (behavior, context) =>
    validateImageSlotConfig(behavior.config, context.document),
};

function validateImageSlotConfig(
  value: unknown,
  document: Parameters<typeof selectEditorDocumentObjects>[0],
): DocumentValueSchemaIssue[] {
  if (!isRecord(value)) return [invalid("config", "an object")];
  const issues: DocumentValueSchemaIssue[] = [];
  if (
    Object.keys(value).some(
      (key) => key !== "accepts" && key !== "placeholderSelector",
    )
  ) {
    issues.push(invalid("config", "an object containing only accepts and placeholderSelector"));
  }
  if (
    value.accepts !== undefined &&
    (!Array.isArray(value.accepts) ||
      value.accepts.some((entry) => !isNonEmptyString(entry)))
  ) {
    issues.push(invalid("config.accepts", "an array of non-empty strings"));
  }
  const selector = parseObjectSelector(value.placeholderSelector);
  if (!selector) {
    issues.push(invalid("config.placeholderSelector", "a non-empty object selector"));
    return issues;
  }
  const placeholders = selectEditorDocumentObjects(document, selector);
  if (!placeholders.length) {
    issues.push(invalid("config.placeholderSelector", "a selector matching at least one object"));
  } else if (
    placeholders.some(
      (object) => !object.traits?.some((trait) => trait.type === "core.placeholder"),
    )
  ) {
    issues.push(invalid("config.placeholderSelector", "a selector matching only core.placeholder objects"));
  }
  return issues;
}

function parseObjectSelector(value: unknown): ObjectSelector | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => !["ids", "tags", "tagMatch"].includes(key))) {
    return null;
  }
  const parseValues = (entry: unknown) =>
    Array.isArray(entry) && entry.length > 0 && entry.every(isNonEmptyString)
      ? entry as string[]
      : undefined;
  const ids = value.ids === undefined ? undefined : parseValues(value.ids);
  const tags = value.tags === undefined ? undefined : parseValues(value.tags);
  if ((value.ids !== undefined && !ids) || (value.tags !== undefined && !tags)) return null;
  if (value.tagMatch !== undefined && value.tagMatch !== "all" && value.tagMatch !== "any") {
    return null;
  }
  if (!ids && !tags) return null;
  return { ...(ids ? { ids } : {}), ...(tags ? { tags } : {}), ...(value.tagMatch ? { tagMatch: value.tagMatch } : {}) };
}

function invalid(path: string, expected: string): DocumentValueSchemaIssue {
  return {
    code: "object-behavior-config-invalid",
    message: `Behavior ${path} must be ${expected}.`,
    path,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
