import type {
  DocumentValueSchemaIssue,
  EditorImageSlotBehaviorConfig,
  EditorObjectBehavior,
  ObjectBehaviorDefinition,
} from "@pooder/document";

import { CONFIGURABLE_VISUAL_CAPABILITY_ID } from "../extensions/configurable-visual";
import {
  IMAGE_SLOT_CAPABILITY_ID,
  IMAGE_SLOT_OPEN_SESSION_COMMAND_ID,
} from "../extensions/image-slot";

export const IMAGE_SLOT_BEHAVIOR_TYPE = "pooder.image-slot";
export const CONFIGURABLE_VISUAL_BEHAVIOR_TYPE = "pooder.configurable-visual";

export interface ImageSlotObjectBehavior extends EditorObjectBehavior<EditorImageSlotBehaviorConfig> {
  type: typeof IMAGE_SLOT_BEHAVIOR_TYPE;
}

export interface ConfigurableVisualObjectBehavior extends EditorObjectBehavior<{
  key: string;
}> {
  type: typeof CONFIGURABLE_VISUAL_BEHAVIOR_TYPE;
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
  validate: (behavior) => validateImageSlotConfig(behavior.config),
};

export const CONFIGURABLE_VISUAL_BEHAVIOR_DEFINITION: ObjectBehaviorDefinition =
  {
    behaviorType: CONFIGURABLE_VISUAL_BEHAVIOR_TYPE,
    capabilityId: CONFIGURABLE_VISUAL_CAPABILITY_ID,
    validate: (behavior) => {
      const config = behavior.config;
      return isRecord(config) && isNonEmptyString(config.key)
        ? []
        : [invalid("config.key", "a non-empty string")];
    },
  };

function validateImageSlotConfig(value: unknown): DocumentValueSchemaIssue[] {
  if (value === undefined) return [];
  if (!isRecord(value)) return [invalid("config", "an object")];
  const issues: DocumentValueSchemaIssue[] = [];
  if (
    value.accepts !== undefined &&
    (!Array.isArray(value.accepts) ||
      value.accepts.some((entry) => !isNonEmptyString(entry)))
  ) {
    issues.push(invalid("config.accepts", "an array of non-empty strings"));
  }
  if (value.emptyPresentation !== undefined) {
    const empty = value.emptyPresentation;
    if (!isRecord(empty)) {
      issues.push(invalid("config.emptyPresentation", "an object"));
    } else {
      if (!isNonEmptyString(empty.assetId)) {
        issues.push(
          invalid("config.emptyPresentation.assetId", "a non-empty asset id"),
        );
      }
      if (
        empty.fit !== "cover" &&
        empty.fit !== "contain" &&
        empty.fit !== "stretch"
      ) {
        issues.push(
          invalid(
            "config.emptyPresentation.fit",
            '"cover", "contain", or "stretch"',
          ),
        );
      }
    }
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
