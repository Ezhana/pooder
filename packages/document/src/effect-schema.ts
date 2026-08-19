import type {
  AssetReferenceBinding,
  DocumentDiagnostic,
  DocumentDiagnosticSeverity,
} from "./index";

export interface EffectSchemaIssue {
  code: string;
  message: string;
  path?: string;
  severity?: DocumentDiagnosticSeverity;
}

export interface EffectSchemaValidationContext {
  effect: Readonly<Record<string, unknown>>;
  effectPath: string;
  effectType: string;
}

export interface EffectSchema {
  effectType: string;
  capabilityId?: string;
  phase?: "document" | "layout" | "render" | "interaction" | "export";
  require?: "strict" | "warn" | "ignore";
  validate(
    payload: unknown,
    context: EffectSchemaValidationContext,
  ): readonly EffectSchemaIssue[];
  collectAssetReferences?(
    payload: unknown,
    context: EffectSchemaValidationContext,
  ): readonly AssetReferenceBinding[];
}

export interface EffectSchemaValidationOptions {
  requireRegisteredSchema?: boolean;
}

export class EffectSchemaRegistry {
  private readonly schemas = new Map<string, EffectSchema>();

  constructor(schemas: Iterable<EffectSchema> = []) {
    this.registerMany(schemas);
  }

  register(schema: EffectSchema): this {
    const effectType = normalizeIdentifier(schema.effectType);
    if (!effectType) throw new TypeError("Effect schema type is required.");
    if (this.schemas.has(effectType)) {
      throw new Error(`Effect schema "${effectType}" is already registered.`);
    }
    this.schemas.set(effectType, { ...schema, effectType });
    return this;
  }

  registerMany(schemas: Iterable<EffectSchema>): this {
    for (const schema of schemas) this.register(schema);
    return this;
  }

  get(effectType: string): EffectSchema | undefined {
    return this.schemas.get(normalizeIdentifier(effectType));
  }

  list(): EffectSchema[] {
    return Array.from(this.schemas.values());
  }

  resolveCapabilityId(effectType: string): string | undefined {
    return normalizeIdentifier(this.get(effectType)?.capabilityId) || undefined;
  }

  resolvePhase(
    effectType: string,
  ): "document" | "layout" | "render" | "interaction" | "export" {
    return this.get(effectType)?.phase ?? "layout";
  }
}

export function validateDocumentEffectSchemas(
  value: unknown,
  registry: EffectSchemaRegistry,
  options: EffectSchemaValidationOptions = {},
): DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];
  visitRawEffects(value, (effect, path) => {
    const effectType = normalizeIdentifier(effect.type);
    if (!effectType || isDocumentBuiltinEffect(effectType)) return;
    const schema = registry.get(effectType);
    if (!schema) {
      if (options.requireRegisteredSchema !== false) {
        diagnostics.push({
          severity: "error",
          stage: "effect-schema",
          code: "effect-schema-missing",
          message: `No payload schema is registered for effect "${effectType}".`,
          path,
          effectType,
        });
      }
      return;
    }

    const context: EffectSchemaValidationContext = {
      effect,
      effectPath: path,
      effectType,
    };
    for (const issue of schema.validate(effect.payload, context)) {
      diagnostics.push({
        severity: issue.severity ?? "error",
        stage: "effect-schema",
        code: issue.code,
        message: issue.message,
        path: appendPayloadPath(path, issue.path),
        effectType,
        ...(schema.capabilityId ? { capabilityId: schema.capabilityId } : {}),
      });
    }
  });
  return diagnostics;
}

function visitRawEffects(
  value: unknown,
  visitor: (effect: Readonly<Record<string, unknown>>, path: string) => void,
): void {
  if (!isRecord(value) || !Array.isArray(value.surfaces)) return;
  value.surfaces.forEach((surface, surfaceIndex) => {
    if (!isRecord(surface)) return;
    visitObjectEffects(
      surface.objects,
      `surfaces[${surfaceIndex}].objects`,
      visitor,
    );
  });
}

function visitObjectEffects(
  value: unknown,
  objectsPath: string,
  visitor: (effect: Readonly<Record<string, unknown>>, path: string) => void,
): void {
  if (!Array.isArray(value)) return;
  value.forEach((object, objectIndex) => {
    if (!isRecord(object)) return;
    const objectPath = `${objectsPath}[${objectIndex}]`;
    visitEffectArray(object.effects, objectPath, visitor);
    visitObjectEffects(object.children, `${objectPath}.children`, visitor);
  });
}

function visitEffectArray(
  value: unknown,
  ownerPath: string,
  visitor: (effect: Readonly<Record<string, unknown>>, path: string) => void,
): void {
  if (!Array.isArray(value)) return;
  value.forEach((effect, effectIndex) => {
    if (isRecord(effect)) {
      visitor(effect, `${ownerPath}.effects[${effectIndex}]`);
    }
  });
}

function appendPayloadPath(effectPath: string, relativePath?: string): string {
  if (!relativePath) return `${effectPath}.payload`;
  return relativePath.startsWith("[")
    ? `${effectPath}.payload${relativePath}`
    : `${effectPath}.payload.${relativePath}`;
}

function isDocumentBuiltinEffect(effectType: string): boolean {
  return (
    effectType === "core.geometry.clip" ||
    effectType === "core.geometry.boolean"
  );
}

function normalizeIdentifier(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
