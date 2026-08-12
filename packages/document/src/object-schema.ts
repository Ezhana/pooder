import type {
  DocumentConstraintSpec,
  EditorAssetReferenceBinding,
  EditorDocument,
  EditorDocumentDiagnostic,
  EditorObjectBehavior,
  EditorObjectTrait,
  JsonValue,
} from "./index";
import type { DocumentValueSchemaIssue } from "./extension-schema";

export interface ObjectSchemaContext {
  document: EditorDocument;
  objectId: string;
  path: string;
}

export interface ObjectTraitDefinition {
  traitType: string;
  validate?(
    trait: EditorObjectTrait,
    context: ObjectSchemaContext,
  ): readonly DocumentValueSchemaIssue[];
}

export interface ObjectBehaviorDefinition {
  behaviorType: string;
  capabilityId: string;
  compileInteraction?(
    behavior: EditorObjectBehavior,
    context: ObjectSchemaContext,
  ): ObjectBehaviorInteractionSpec | undefined;
  validate?(
    behavior: EditorObjectBehavior,
    context: ObjectSchemaContext,
  ): readonly DocumentValueSchemaIssue[];
  collectAssetReferences?(
    behavior: EditorObjectBehavior,
    context: ObjectSchemaContext,
  ): readonly EditorAssetReferenceBinding[];
}

export interface ObjectBehaviorInteractionSpec {
  hitRegion?: { type: "frame"; space: "scene" };
  activation?: {
    enabled?: boolean;
    trigger?: "primary-pointer" | "double-click";
    action: {
      commandId: string;
      payload?: Record<string, JsonValue>;
    };
    session?: {
      channel: string;
      groupId: string;
      sessionId?: string;
      mode: "exclusive" | "cooperative" | "passive";
      scope: "subject" | "surface" | "editor";
      leavePolicy?: "block" | "commit" | "rollback";
    };
  };
}

export interface ObjectConstraintDefinition {
  constraintType: string;
  validate?(
    constraint: DocumentConstraintSpec,
    context: ObjectSchemaContext,
  ): readonly DocumentValueSchemaIssue[];
}

export class ObjectSchemaRegistry {
  private readonly traits = new Map<string, ObjectTraitDefinition>();
  private readonly behaviors = new Map<string, ObjectBehaviorDefinition>();
  private readonly constraints = new Map<string, ObjectConstraintDefinition>();

  registerTrait(definition: ObjectTraitDefinition): this {
    registerUnique(this.traits, definition.traitType, definition, "trait");
    return this;
  }

  registerBehavior(definition: ObjectBehaviorDefinition): this {
    registerUnique(
      this.behaviors,
      definition.behaviorType,
      definition,
      "behavior",
    );
    return this;
  }

  registerConstraint(definition: ObjectConstraintDefinition): this {
    registerUnique(
      this.constraints,
      definition.constraintType,
      definition,
      "constraint",
    );
    return this;
  }

  getTrait(type: string): ObjectTraitDefinition | undefined {
    return this.traits.get(normalizeType(type));
  }

  getBehavior(type: string): ObjectBehaviorDefinition | undefined {
    return this.behaviors.get(normalizeType(type));
  }

  getConstraint(type: string): ObjectConstraintDefinition | undefined {
    return this.constraints.get(normalizeType(type));
  }
}

export function validateEditorDocumentObjectSchemas(
  document: EditorDocument,
  registry: ObjectSchemaRegistry,
): EditorDocumentDiagnostic[] {
  const diagnostics: EditorDocumentDiagnostic[] = [];
  const visitObjects = (
    objects: EditorDocument["surfaces"][number]["layers"][number]["objects"],
    path: string,
  ) => {
    objects.forEach((object, objectIndex) => {
      const objectPath = `${path}[${objectIndex}]`;
      const context = { document, objectId: object.id, path: objectPath };
      object.traits?.forEach((trait, index) => {
        if (trait.type.startsWith("core.")) return;
        validateInstance(
          diagnostics,
          registry.getTrait(trait.type),
          "trait",
          trait.type,
          `${objectPath}.traits[${index}]`,
          (definition) => definition.validate?.(trait, context) ?? [],
        );
      });
      object.behaviors?.forEach((behavior, index) => {
        validateInstance(
          diagnostics,
          registry.getBehavior(behavior.type),
          "behavior",
          behavior.type,
          `${objectPath}.behaviors[${index}]`,
          (definition) => definition.validate?.(behavior, context) ?? [],
        );
      });
      for (const [operationName, operation] of Object.entries(
        object.interaction?.manipulation ?? {},
      )) {
        operation.constraints?.forEach((constraint, index) => {
          const constraintPath = `${objectPath}.interaction.manipulation.${operationName}.constraints[${index}]`;
          validateInstance(
            diagnostics,
            registry.getConstraint(constraint.spec.type),
            "constraint",
            constraint.spec.type,
            constraintPath,
            (definition) =>
              definition.validate?.(constraint.spec, context) ?? [],
          );
        });
      }
      if (Array.isArray(object.children)) {
        visitObjects(object.children, `${objectPath}.children`);
      }
    });
  };
  document.surfaces.forEach((surface, surfaceIndex) =>
    surface.layers.forEach((layer, layerIndex) =>
      visitObjects(
        layer.objects,
        `surfaces[${surfaceIndex}].layers[${layerIndex}].objects`,
      ),
    ),
  );
  return diagnostics;
}

function validateInstance<TDefinition>(
  diagnostics: EditorDocumentDiagnostic[],
  definition: TDefinition | undefined,
  kind: "trait" | "behavior" | "constraint",
  type: string,
  path: string,
  validate: (definition: TDefinition) => readonly DocumentValueSchemaIssue[],
): void {
  if (!definition) {
    diagnostics.push({
      severity: "error",
      stage: "extension-schema",
      code: `object-${kind}-unregistered`,
      message: `Object ${kind} "${type}" is not registered.`,
      path,
    });
    return;
  }
  for (const issue of validate(definition)) {
    diagnostics.push({
      severity: issue.severity ?? "error",
      stage: "extension-schema",
      code: issue.code,
      message: issue.message,
      path: issue.path ? `${path}.${issue.path}` : path,
    });
  }
}

function registerUnique<T>(
  registry: Map<string, T>,
  rawType: string,
  definition: T,
  kind: string,
): void {
  const type = normalizeType(rawType);
  if (!type) throw new TypeError(`Object ${kind} type is required.`);
  if (registry.has(type)) {
    throw new Error(`Object ${kind} "${type}" is already registered.`);
  }
  registry.set(type, definition);
}

const normalizeType = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";
