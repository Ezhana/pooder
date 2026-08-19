import type {
  AssetReferenceBinding,
  PooderDocument,
  DocumentDiagnostic,
  DocumentDiagnosticSeverity,
  JsonValue,
} from "./index";
import { EffectSchemaRegistry, type EffectSchema } from "./effect-schema";
import {
  ObjectSchemaRegistry,
  type ObjectBehaviorDefinition,
  type ObjectConstraintDefinition,
  type ObjectTraitDefinition,
} from "./object-schema";

export interface DocumentValueSchemaIssue {
  code: string;
  message: string;
  path?: string;
  severity?: DocumentDiagnosticSeverity;
}

export interface DocumentValueSchemaContext {
  extensionId: string;
  path: string;
}

export interface DocumentValueSchema<TState = JsonValue> {
  validate(
    value: unknown,
    context: DocumentValueSchemaContext,
  ): readonly DocumentValueSchemaIssue[];
}

export interface DocumentPublication {
  publish(): void;
}

export interface DocumentPublicationContext {
  document: PooderDocument;
  extensionId: string;
}

export interface DocumentExtensionContribution<TState = JsonValue> {
  id: string;
  stateSchema?: DocumentValueSchema<TState>;
  effects?: readonly EffectSchema[];
  traits?: readonly ObjectTraitDefinition[];
  behaviors?: readonly ObjectBehaviorDefinition[];
  constraints?: readonly ObjectConstraintDefinition[];
  validateReferences?(
    state: TState,
    document: PooderDocument,
  ): readonly DocumentDiagnostic[];
  collectAssetReferences?(
    state: TState,
    context: DocumentPublicationContext,
  ): readonly AssetReferenceBinding[];
  preparePublication?(
    state: TState,
    context: DocumentPublicationContext,
  ): DocumentPublication | void | Promise<DocumentPublication | void>;
}

export class DocumentExtensionRegistry {
  private readonly contributions = new Map<
    string,
    DocumentExtensionContribution<unknown>
  >();

  constructor(
    contributions: Iterable<DocumentExtensionContribution<never>> = [],
  ) {
    this.registerMany(contributions);
  }

  register<TState>(contribution: DocumentExtensionContribution<TState>): this {
    const id = normalizeIdentifier(contribution.id);
    if (!id) throw new TypeError("Document extension id is required.");
    if (this.contributions.has(id)) {
      throw new Error(`Document extension "${id}" is already registered.`);
    }
    this.contributions.set(id, {
      ...contribution,
      id,
      ...(contribution.validateReferences
        ? {
            validateReferences: (state, document) =>
              contribution.validateReferences?.(state as TState, document) ??
              [],
          }
        : {}),
      ...(contribution.collectAssetReferences
        ? {
            collectAssetReferences: (state, context) =>
              contribution.collectAssetReferences?.(state as TState, context) ??
              [],
          }
        : {}),
      ...(contribution.preparePublication
        ? {
            preparePublication: (state, context) =>
              contribution.preparePublication?.(state as TState, context),
          }
        : {}),
    });
    return this;
  }

  registerMany<TState>(
    contributions: Iterable<DocumentExtensionContribution<TState>>,
  ): this {
    for (const contribution of contributions) this.register(contribution);
    return this;
  }

  get(id: string): DocumentExtensionContribution<unknown> | undefined {
    return this.contributions.get(normalizeIdentifier(id));
  }

  list(): DocumentExtensionContribution<unknown>[] {
    return Array.from(this.contributions.values());
  }

  createEffectSchemaRegistry(): EffectSchemaRegistry {
    return new EffectSchemaRegistry(
      this.list().flatMap((contribution) => contribution.effects ?? []),
    );
  }

  createObjectSchemaRegistry(): ObjectSchemaRegistry {
    const registry = new ObjectSchemaRegistry();
    registry.registerConstraint({ constraintType: "rect.contain" });
    for (const contribution of this.list()) {
      contribution.traits?.forEach((definition) =>
        registry.registerTrait(definition),
      );
      contribution.behaviors?.forEach((definition) =>
        registry.registerBehavior(definition),
      );
      contribution.constraints?.forEach((definition) =>
        registry.registerConstraint(definition),
      );
    }
    return registry;
  }
}

export function validateDocumentExtensions(
  value: unknown,
  registry: DocumentExtensionRegistry,
): DocumentDiagnostic[] {
  const input = isRecord(value) ? value : {};
  const extensions = isRecord(input.extensions) ? input.extensions : {};
  const document = value as PooderDocument;
  const diagnostics: DocumentDiagnostic[] = [];

  for (const [extensionId, state] of Object.entries(extensions)) {
    const path = `extensions.${extensionId}`;
    const contribution = registry.get(extensionId);
    if (!contribution) {
      diagnostics.push({
        severity: "error",
        stage: "extension-schema",
        code: "document-extension-unregistered",
        message: `Document extension "${extensionId}" is not registered.`,
        path,
      });
      continue;
    }

    const schemaIssues =
      contribution.stateSchema?.validate(state, {
        extensionId,
        path,
      }) ?? [];
    for (const issue of schemaIssues) {
      diagnostics.push({
        severity: issue.severity ?? "error",
        stage: "extension-schema",
        code: issue.code,
        message: issue.message,
        path: appendPath(path, issue.path),
      });
    }
    if (schemaIssues.some((issue) => (issue.severity ?? "error") === "error")) {
      continue;
    }
    diagnostics.push(
      ...(
        contribution.validateReferences?.(state as JsonValue, document) ?? []
      ).map((diagnostic) => ({
        ...diagnostic,
        stage: diagnostic.stage ?? "extension-schema",
        path: appendPath(path, diagnostic.path),
      })),
    );
  }

  return diagnostics;
}

const normalizeIdentifier = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const appendPath = (base: string, path: string | undefined): string =>
  path ? (path.startsWith("[") ? `${base}${path}` : `${base}.${path}`) : base;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
