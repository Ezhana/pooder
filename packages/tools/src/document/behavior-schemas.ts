import {
  createAssetReferenceBinding,
  findEditorDocumentObject,
  isAssetSource,
  type DocumentValueSchemaIssue,
  type EditorImageSlotBehaviorConfig,
  type EditorObjectBehavior,
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
    validateImageSlotConfig(behavior.config, context),
  collectAssetReferences: (behavior, context) => {
    const config = behavior.config;
    if (!isRecord(config) || !isAssetSource(config.placeholderSource))
      return [];
    return [
      createAssetReferenceBinding(
        config.placeholderSource,
        "image",
        `${context.path}.behaviors[pooder.image-slot].config.placeholderSource`,
        (source) => {
          config.placeholderSource = source;
        },
      ),
    ];
  },
};

function validateImageSlotConfig(
  value: unknown,
  context: Parameters<NonNullable<ObjectBehaviorDefinition["validate"]>>[1],
): DocumentValueSchemaIssue[] {
  if (!isRecord(value)) return [invalid("config", "an object")];
  const issues: DocumentValueSchemaIssue[] = [];
  const object = findEditorDocumentObject(context.document, context.objectId);
  if (!object || object.type !== "image") {
    issues.push(invalid("", "attached only to an image object"));
  }
  if (
    Object.keys(value).some(
      (key) => key !== "accepts" && key !== "placeholderSource",
    )
  ) {
    issues.push(
      invalid(
        "config",
        "an object containing only accepts and placeholderSource",
      ),
    );
  }
  if (
    value.accepts !== undefined &&
    (!Array.isArray(value.accepts) ||
      value.accepts.some((entry) => !isNonEmptyString(entry)))
  ) {
    issues.push(invalid("config.accepts", "an array of non-empty strings"));
  }
  if (!isAssetSource(value.placeholderSource)) {
    issues.push(invalid("config.placeholderSource", "an asset source"));
  }
  return issues;
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
