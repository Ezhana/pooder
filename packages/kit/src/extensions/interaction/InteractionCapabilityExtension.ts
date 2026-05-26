import {
  CONSTRAINT_RESOLVER_CAPABILITY_ID,
  CONSTRAINT_RESOLVER_SERVICE,
  GEOMETRY_SOURCE_CAPABILITY_ID,
  GEOMETRY_SOURCE_SERVICE,
  createConstraintResolverCapabilityDefinition,
  createGeometrySourceCapabilityDefinition,
  type ConstraintResolverCapability,
  type ConstraintSpec,
  type DefaultConstraintResolverCapability,
  type DefaultGeometrySourceCapability,
  type ExtensionContext,
  type ExtensionContributions,
  type ExtensionDefinition,
  type GeometrySourceCapability,
  type RenderIntentCompilerContext,
  type RenderIntentInteractionConstraint,
  type RenderIntentPatch,
  type RenderIntentSubject,
  type RuntimeConditionExpr,
} from "@pooder/core";
import type { EditorEffect } from "@pooder/document/kit";

export const INTERACTION_CAPABILITY_ID = "pooder.kit.interaction";

interface InteractionEffectPayload {
  enabled?: boolean;
  enabledWhen?: RuntimeConditionExpr;
}

interface ConstraintEffectPayload {
  activeWhen?: RuntimeConditionExpr;
  constraints: unknown[];
}

export class InteractionCapabilityExtension implements ExtensionDefinition {
  readonly id = "pooder.kit.interaction";
  private geometrySource?: GeometrySourceCapability;
  private constraintResolver?: ConstraintResolverCapability;

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createGeometrySourceCapabilityDefinition(this.getGeometryFacade()),
        createConstraintResolverCapabilityDefinition(this.getConstraintFacade()),
        {
          id: INTERACTION_CAPABILITY_ID,
          metadata: {
            name: "Interaction",
            description:
              "Compile declarative interaction and constraint effects.",
            tags: ["core", "interaction", "constraint"],
          },
        },
      ],
      renderIntentCompilers: [
        {
          capabilityId: INTERACTION_CAPABILITY_ID,
          effectType: "interaction",
          compile: (context) =>
            this.compileInteractionEffect(
              context as RenderIntentCompilerContext<EditorEffect, unknown>,
            ),
        },
        {
          capabilityId: INTERACTION_CAPABILITY_ID,
          effectType: "constraint",
          compile: (context) =>
            this.compileConstraintEffect(
              context as RenderIntentCompilerContext<EditorEffect, unknown>,
            ),
        },
      ],
    };
  }

  activate(context: ExtensionContext): void {
    this.geometrySource =
      context.services.get<DefaultGeometrySourceCapability>(
        GEOMETRY_SOURCE_SERVICE,
      );
    this.constraintResolver =
      context.services.get<DefaultConstraintResolverCapability>(
        CONSTRAINT_RESOLVER_SERVICE,
      );
    if (!this.geometrySource || !this.constraintResolver) {
      throw new Error(
        "GeometrySource and ConstraintResolver services are required.",
      );
    }
  }

  private compileInteractionEffect(
    context: RenderIntentCompilerContext<EditorEffect, unknown>,
  ): RenderIntentPatch | void {
    const id = getTargetIntentId(context.target);
    if (!id) return;
    const payload = normalizeInteractionPayload(context.effect.payload);
    return {
      id,
      interaction: {
        enabled: payload.enabled ?? true,
        ...(payload.enabledWhen ? { enabledWhen: payload.enabledWhen } : {}),
      },
    };
  }

  private compileConstraintEffect(
    context: RenderIntentCompilerContext<EditorEffect, unknown>,
  ): RenderIntentPatch | void {
    const id = getTargetIntentId(context.target);
    if (!id) return;
    const payload = normalizeConstraintPayload(context.effect.payload);
    const constraints = payload.constraints
      .map((constraint) => normalizeConstraint(constraint, payload.activeWhen))
      .filter(
        (constraint): constraint is RenderIntentInteractionConstraint =>
          Boolean(constraint),
      );
    if (!constraints.length) return;
    return {
      id,
      interaction: {
        constraints,
      },
    };
  }

  private getGeometryFacade(): GeometrySourceCapability {
    return {
      registerSource: (source) =>
        this.requireGeometrySource().registerSource(source),
      getGeometry: (ref) => this.requireGeometrySource().getGeometry(ref),
      listGeometries: (sourceId) =>
        this.requireGeometrySource().listGeometries(sourceId),
      projectGeometry: (ref, space) =>
        this.requireGeometrySource().projectGeometry(ref, space),
    };
  }

  private getConstraintFacade(): ConstraintResolverCapability {
    return {
      resolve: (input) => this.requireConstraintResolver().resolve(input),
      registerConstraint: (type, resolver) =>
        this.requireConstraintResolver().registerConstraint(type, resolver),
    };
  }

  private requireGeometrySource(): GeometrySourceCapability {
    if (!this.geometrySource) {
      throw new Error(
        `Capability "${GEOMETRY_SOURCE_CAPABILITY_ID}" is not active.`,
      );
    }
    return this.geometrySource;
  }

  private requireConstraintResolver(): ConstraintResolverCapability {
    if (!this.constraintResolver) {
      throw new Error(
        `Capability "${CONSTRAINT_RESOLVER_CAPABILITY_ID}" is not active.`,
      );
    }
    return this.constraintResolver;
  }
}

function getTargetIntentId(target: RenderIntentSubject): string {
  return String(
    target.objectId ?? target.layerId ?? target.surfaceId ?? "",
  ).trim();
}

function normalizeInteractionPayload(value: unknown): InteractionEffectPayload {
  if (!isRecord(value)) return {};
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
    enabledWhen: normalizeRuntimeCondition(value.enabledWhen),
  };
}

function normalizeConstraintPayload(value: unknown): ConstraintEffectPayload {
  if (!isRecord(value)) return { constraints: [] };
  return {
    activeWhen: normalizeRuntimeCondition(value.activeWhen),
    constraints: Array.isArray(value.constraints) ? value.constraints : [],
  };
}

function normalizeConstraint(
  value: unknown,
  payloadActiveWhen?: RuntimeConditionExpr,
): RenderIntentInteractionConstraint | null {
  if (!isRecord(value)) return null;
  const entryActiveWhen = normalizeRuntimeCondition(value.activeWhen);
  const rawSpec = isRecord(value.spec) ? value.spec : value;
  if (!isRecord(rawSpec)) return null;
  const type = normalizeId(rawSpec.type);
  if (!type) return null;
  const spec: ConstraintSpec = {
    type,
    ...(rawSpec.source !== undefined
      ? { source: cloneRecord(rawSpec.source) as ConstraintSpec["source"] }
      : {}),
    ...(typeof rawSpec.mode === "string" ? { mode: rawSpec.mode } : {}),
    ...(isRecord(rawSpec.params)
      ? { params: cloneRecord(rawSpec.params) }
      : {}),
  };
  const activeWhen = combineRuntimeConditions(payloadActiveWhen, entryActiveWhen);
  return {
    ...(activeWhen ? { activeWhen } : {}),
    spec,
  };
}

function combineRuntimeConditions(
  first?: RuntimeConditionExpr,
  second?: RuntimeConditionExpr,
): RuntimeConditionExpr | undefined {
  if (first && second) return { op: "all", exprs: [first, second] };
  return first ?? second;
}

function normalizeRuntimeCondition(
  value: unknown,
): RuntimeConditionExpr | undefined {
  return isRecord(value) ? (cloneRecord(value) as RuntimeConditionExpr) : undefined;
}

function normalizeId(value: unknown): string {
  return String(value || "").trim();
}

function cloneRecord<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
