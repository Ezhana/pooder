import type {
  EditorDocument,
  EditorDocumentDiagnostic,
  EditorDocumentDiagnosticSeverity,
  JsonValue,
} from "./index";
import { EffectSchemaRegistry, type EditorEffectSchema } from "./effect-schema";

export interface DocumentValueSchemaIssue {
  code: string;
  message: string;
  path?: string;
  severity?: EditorDocumentDiagnosticSeverity;
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
  document: EditorDocument;
  extensionId: string;
}

export interface DocumentExtensionContribution<
  TState = JsonValue,
> {
  id: string;
  stateSchema?: DocumentValueSchema<TState>;
  effects?: readonly EditorEffectSchema[];
  validateReferences?(
    state: TState,
    document: EditorDocument,
  ): readonly EditorDocumentDiagnostic[];
  preparePublication?(
    state: TState,
    context: DocumentPublicationContext,
  ): DocumentPublication | void | Promise<DocumentPublication | void>;
}

export class DocumentExtensionRegistry {
  private readonly contributions = new Map<
    string,
    DocumentExtensionContribution
  >();

  constructor(
    contributions: Iterable<DocumentExtensionContribution> = [],
  ) {
    this.registerMany(contributions);
  }

  register(contribution: DocumentExtensionContribution): this {
    const id = normalizeIdentifier(contribution.id);
    if (!id) throw new TypeError("Document extension id is required.");
    if (this.contributions.has(id)) {
      throw new Error(`Document extension "${id}" is already registered.`);
    }
    this.contributions.set(id, { ...contribution, id });
    return this;
  }

  registerMany(contributions: Iterable<DocumentExtensionContribution>): this {
    for (const contribution of contributions) this.register(contribution);
    return this;
  }

  get(id: string): DocumentExtensionContribution | undefined {
    return this.contributions.get(normalizeIdentifier(id));
  }

  list(): DocumentExtensionContribution[] {
    return Array.from(this.contributions.values());
  }

  createEffectSchemaRegistry(): EffectSchemaRegistry {
    return new EffectSchemaRegistry(
      this.list().flatMap((contribution) => contribution.effects ?? []),
    );
  }
}

export function validateEditorDocumentExtensions(
  value: unknown,
  registry: DocumentExtensionRegistry,
): EditorDocumentDiagnostic[] {
  const input = isRecord(value) ? value : {};
  const extensions = isRecord(input.extensions) ? input.extensions : {};
  const document = value as EditorDocument;
  const diagnostics: EditorDocumentDiagnostic[] = [];

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

    const schemaIssues = contribution.stateSchema?.validate(state, {
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
      ...(contribution.validateReferences?.(state as JsonValue, document) ?? []).map(
        (diagnostic) => ({
          ...diagnostic,
          stage: diagnostic.stage ?? "extension-schema",
          path: appendPath(path, diagnostic.path),
        }),
      ),
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
