import {
  RENDER_INTENT_COMPILER_REGISTRY_SERVICE,
  RENDER_INTENT_SERVICE,
  SURFACE_FRAME_SERVICE,
  mergeRenderIntentPatchEntries,
  type ConstraintSpec,
  type GeometryPoint,
  type GeometryRect,
  type RenderIntentCompilerRegistryService,
  type RenderIntentDiagnostic,
  type RenderIntentDraft,
  type RenderIntentInteractionAspect,
  type RenderIntentPatch,
  type RenderIntentPatchEntry,
  type RenderIntentService,
  type RuntimeConditionExpr,
  type Service,
  type ServiceIdentifier,
  type SurfaceFrameService,
} from "@pooder/core";
import {
  collectEditorDocumentCapabilityRequirements,
  isGenericEditorEffect,
  normalizeEditorDocument,
  validateEditorDocument,
  type EditorDocument,
  type EditorDocumentCapabilityCollectionOptions,
  type EditorDocumentDiagnostic,
  type EditorDocumentEffectCapabilityResolver,
  type EditorDocumentValidationOptions,
  type EditorBuiltinObjectEffect,
  type EditorEffect,
  type EditorInteractionConstraint,
  type EditorLayer,
  type EditorObject,
  type EditorObjectEffect,
  type EditorSurface,
  type ObjectSource,
} from "@pooder/document";

export interface ObjectSize {
  width: number;
  height: number;
}

export interface ObjectRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResolvedVisual {
  source: ObjectSource;
  pathData?: string;
  imageUrl?: string;
  text?: string;
  bounds?: GeometryRect;
  contentBounds?: GeometryRect;
  intrinsicSize?: ObjectSize;
  mimeType?: string;
}

export interface GeometryResolver {
  resolve(source: ObjectSource): ResolvedVisual | null;
  hitTest(source: ObjectSource, point: GeometryPoint): boolean;
}

export class DefaultGeometryResolver implements GeometryResolver {
  resolve(source: ObjectSource): ResolvedVisual | null {
    if (source.kind === "path") {
      const pathData = source.pathData.trim();
      if (!pathData) return null;
      const contentBounds =
        rectToBounds(source.sourceBounds) ??
        inferPathBounds(pathData) ??
        undefined;
      return {
        source,
        pathData,
        bounds: source.sourceSize
          ? sizeToBounds(source.sourceSize)
          : contentBounds,
        contentBounds,
        intrinsicSize: source.sourceSize,
      };
    }

    if (source.kind !== "shape") return null;
    const resolved = resolveShapeSource(source);
    return resolved ? { source, ...resolved } : null;
  }

  hitTest(source: ObjectSource, point: GeometryPoint): boolean {
    const visual = this.resolve(source);
    if (!visual?.bounds) return false;
    return containsPoint(visual.bounds, point);
  }
}

export class SourceResolver {
  constructor(
    private readonly geometryResolver: GeometryResolver = new DefaultGeometryResolver(),
  ) {}

  resolve(source: ObjectSource): ResolvedVisual | null {
    switch (source.kind) {
      case "url":
        return {
          source,
          imageUrl: source.url,
          mimeType: source.mimeType,
          intrinsicSize: source.intrinsicSize,
          bounds: source.intrinsicSize
            ? sizeToBounds(source.intrinsicSize)
            : undefined,
        };
      case "data-url":
        return {
          source,
          imageUrl: source.dataUrl,
          mimeType: source.mimeType,
          intrinsicSize: source.intrinsicSize,
          bounds: source.intrinsicSize
            ? sizeToBounds(source.intrinsicSize)
            : undefined,
        };
      case "blob-url":
        return {
          source,
          imageUrl: source.url,
          intrinsicSize: source.intrinsicSize,
          bounds: source.intrinsicSize
            ? sizeToBounds(source.intrinsicSize)
            : undefined,
        };
      case "path":
      case "shape":
        return this.geometryResolver.resolve(source);
      case "text":
        return {
          source,
          text: source.text,
        };
      default:
        return null;
    }
  }
}

export function resolveObjectSource(
  source: ObjectSource,
): ResolvedVisual | null {
  return new SourceResolver().resolve(source);
}

export interface EditorDocumentRuntime {
  readonly config?: {
    export(): Record<string, unknown>;
    get<T = unknown>(key: string, defaultValue?: T): T;
    import(data: Record<string, unknown>): void;
    update(key: string, value: unknown): void;
  };
  readonly services: {
    getOrThrow<T extends Service>(
      identifier: ServiceIdentifier<T>,
      errorMessage?: string,
    ): T;
  };
  readonly capabilities: {
    has(id: string): boolean;
    get<T = unknown>(id: string): T | undefined;
  };
}

export interface ApplyEditorDocumentOptions {
  resolveEffectCapabilityId?: EditorDocumentEffectCapabilityResolver;
  validators?: EditorDocumentValidationOptions["validators"];
  afterApply?: (
    runtime: EditorDocumentRuntime,
    document: EditorDocument,
  ) => Promise<void> | void;
}

export interface ApplyEditorDocumentResult {
  ok: boolean;
  document: EditorDocument;
  diagnostics: EditorDocumentDiagnostic[];
  views: NonNullable<EditorDocument["views"]>;
  appliedSurfaceIds: string[];
}

export interface EditorDocumentController {
  apply(value: unknown): Promise<ApplyEditorDocumentResult>;
  export(): EditorDocument | null;
  updateObjectSource(
    objectId: string,
    source: ObjectSource,
    options?: {
      frame?: EditorObject["frame"];
      style?: Record<string, unknown>;
    },
  ): Promise<boolean>;
  updateObjectEffects(
    objectId: string,
    effects: readonly EditorObjectEffect[],
  ): Promise<boolean>;
}

interface EffectContext {
  surface: EditorSurface;
  layer?: EditorLayer;
  object?: EditorObject;
}

interface EffectEntry {
  effect: EditorEffect;
  context: EffectContext;
  path: string;
}

const EFFECT_PHASE_ORDER = {
  document: 0,
  layout: 1,
  render: 2,
  interaction: 3,
  export: 4,
} as const;

export async function applyEditorDocument(
  runtime: EditorDocumentRuntime,
  value: unknown,
  options: ApplyEditorDocumentOptions = {},
): Promise<ApplyEditorDocumentResult> {
  const validationOptions = toValidationOptions(options);
  const collectionOptions = toCollectionOptions(options);
  const document = normalizeEditorDocument(value);
  const diagnostics = validateEditorDocument(value, validationOptions);
  if (hasErrors(diagnostics)) {
    return createResult(false, document, diagnostics, []);
  }
  if (!runtime.config) {
    return createResult(
      false,
      document,
      [
        ...diagnostics,
        {
          severity: "error",
          code: "runtime-config-required",
          message:
            "ConfigurationService runtime facade is required to apply an EditorDocument.",
          path: "config",
        },
      ],
      [],
    );
  }
  runtime.config.import(document.config);
  runtime.services
    .getOrThrow<SurfaceFrameService>(
      SURFACE_FRAME_SERVICE,
      "SurfaceFrameService is required to apply an EditorDocument.",
    )
    .importFrames(
      Object.fromEntries(
        document.surfaces.map((surface) => [surface.id, surface.frames]),
      ),
    );

  const capabilityResult = collectEditorDocumentCapabilityRequirements(
    document,
    {
      ...collectionOptions,
      availableCapabilityIds: collectAvailableCapabilityIds(
        runtime,
        document,
        collectionOptions,
      ),
    },
  );
  const allDiagnostics = [...diagnostics, ...capabilityResult.diagnostics];
  if (hasErrors(allDiagnostics)) {
    return createResult(false, document, allDiagnostics, []);
  }

  const renderIntentService = runtime.services.getOrThrow<RenderIntentService>(
    RENDER_INTENT_SERVICE,
    "RenderIntentService is required to apply an EditorDocument.",
  );
  const compilerRegistry =
    runtime.services.getOrThrow<RenderIntentCompilerRegistryService>(
      RENDER_INTENT_COMPILER_REGISTRY_SERVICE,
      "RenderIntentCompilerRegistryService is required to apply an EditorDocument.",
    );
  const intentDrafts = createBaseRenderIntentDrafts(document);
  const effectEntries =
    collectEffectEntries(document).sort(compareEffectEntries);
  const patchEntries: RenderIntentPatchEntry[] = [];
  let patchSequence = 0;

  for (const entry of effectEntries) {
    if (entry.effect.require === "ignore") continue;
    const capabilityId = resolveEffectCapabilityId(entry.effect, options);
    if (!capabilityId || !runtime.capabilities.has(capabilityId)) continue;

    const patches = await compileRenderIntentPatches(
      compilerRegistry,
      document,
      capabilityId,
      entry,
      runtime,
      allDiagnostics,
    );
    patchEntries.push(
      ...patches.map((patch) => ({
        sourceId: `capability:${capabilityId}`,
        patch,
        priority: 0,
        phase: entry.effect.phase ?? "layout",
        sequence: patchSequence++,
        reason: entry.effect.type,
        debugLabel: entry.path,
      })),
    );
  }

  const mergeResult = mergeRenderIntentPatchEntries(intentDrafts, patchEntries);
  mergeResult.diagnostics.forEach((diagnostic) => {
    allDiagnostics.push(createRenderIntentDiagnostic(diagnostic));
  });

  if (hasErrors(allDiagnostics)) {
    return createResult(false, document, allDiagnostics, []);
  }

  renderIntentService.setDocumentIntents(mergeResult.drafts);
  await options.afterApply?.(runtime, document);

  return createResult(
    true,
    document,
    allDiagnostics,
    collectAppliedSurfaceIds(mergeResult.drafts),
  );
}

export function createEditorDocumentController(
  runtime: EditorDocumentRuntime,
  options: ApplyEditorDocumentOptions = {},
): EditorDocumentController {
  let currentDocument: EditorDocument | null = null;

  return {
    async apply(value) {
      const result = await applyEditorDocument(runtime, value, options);
      if (result.ok) {
        currentDocument = cloneDocument(result.document);
      }
      return result;
    },
    export() {
      return currentDocument ? cloneDocument(currentDocument) : null;
    },
    async updateObjectSource(objectId, source, updateOptions = {}) {
      const id = normalizeObjectId(objectId);
      if (!id || !currentDocument) return false;

      const nextDocument = cloneDocument(currentDocument);
      nextDocument.config = runtime.config?.export() ?? nextDocument.config;
      const object = findSourceObject(nextDocument, id);
      if (!object) return false;

      object.source = cloneObjectSource(source);
      if (updateOptions.frame) {
        object.frame = { ...updateOptions.frame };
      }
      if (updateOptions.style) {
        object.style = { ...object.style, ...updateOptions.style };
      }
      const result = await applyEditorDocument(runtime, nextDocument, options);
      if (!result.ok) return false;

      currentDocument = cloneDocument(result.document);
      return true;
    },
    async updateObjectEffects(objectId, effects) {
      const id = normalizeObjectId(objectId);
      if (!id || !currentDocument) return false;

      const nextDocument = cloneDocument(currentDocument);
      nextDocument.config = runtime.config?.export() ?? nextDocument.config;
      const object = findSourceObject(nextDocument, id);
      if (!object) return false;

      object.effects = cloneObjectEffects([...effects]);
      const result = await applyEditorDocument(runtime, nextDocument, options);
      if (!result.ok) return false;

      currentDocument = cloneDocument(result.document);
      return true;
    },
  };
}

function toValidationOptions(
  options: ApplyEditorDocumentOptions,
): EditorDocumentValidationOptions {
  return {
    resolveEffectCapabilityId: options.resolveEffectCapabilityId,
    validators: options.validators,
  };
}

function toCollectionOptions(
  options: ApplyEditorDocumentOptions,
): EditorDocumentCapabilityCollectionOptions {
  return {
    resolveEffectCapabilityId: options.resolveEffectCapabilityId,
  };
}

function resolveEffectCapabilityId(
  effect: EditorEffect,
  options: ApplyEditorDocumentOptions,
): string | undefined {
  return effect.capabilityId || options.resolveEffectCapabilityId?.(effect);
}

function normalizeObjectId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cloneObjectSource(source: ObjectSource): ObjectSource {
  switch (source.kind) {
    case "url":
    case "data-url":
    case "blob-url":
      return {
        ...source,
        intrinsicSize: source.intrinsicSize
          ? { ...source.intrinsicSize }
          : undefined,
      };
    case "path":
      return {
        ...source,
        sourceBounds: source.sourceBounds
          ? { ...source.sourceBounds }
          : undefined,
        sourceSize: source.sourceSize ? { ...source.sourceSize } : undefined,
      };
    case "shape":
      return { ...source, params: { ...source.params } };
    case "text":
      return { ...source };
    default:
      return source;
  }
}

function cloneDocument(document: EditorDocument): EditorDocument {
  return JSON.parse(JSON.stringify(document)) as EditorDocument;
}

function cloneObjectEffects(
  effects: EditorObjectEffect[] | undefined,
): EditorObjectEffect[] | undefined {
  return effects?.length
    ? (JSON.parse(JSON.stringify(effects)) as EditorObjectEffect[])
    : undefined;
}

function findSourceObject(
  document: EditorDocument,
  objectId: string,
): EditorObject | null {
  for (const surface of document.surfaces) {
    for (const layer of surface.layers) {
      for (const object of layer.objects ?? []) {
        if (object.id === objectId) return object;
      }
    }
  }

  return null;
}

function createScaledPathTransform(
  object: EditorObject,
  bounds:
    | { left: number; top: number; width: number; height: number }
    | undefined,
  contentBounds:
    | { left: number; top: number; width: number; height: number }
    | undefined,
) {
  const transform = { ...(object.transform ?? {}) };
  const frame = object.frame;
  if (!frame || !bounds || bounds.width <= 0 || bounds.height <= 0) {
    return transform;
  }

  const pathBounds = contentBounds ?? bounds;
  const sourceScaleX = frame.width / bounds.width;
  const sourceScaleY = frame.height / bounds.height;
  const baseScaleX = Number(transform.scaleX);
  const baseScaleY = Number(transform.scaleY);
  return {
    ...transform,
    left: Number.isFinite(Number(transform.left))
      ? transform.left
      : frame.x + (pathBounds.left - bounds.left) * sourceScaleX,
    top: Number.isFinite(Number(transform.top))
      ? transform.top
      : frame.y + (pathBounds.top - bounds.top) * sourceScaleY,
    scaleX: (Number.isFinite(baseScaleX) ? baseScaleX : 1) * sourceScaleX,
    scaleY: (Number.isFinite(baseScaleY) ? baseScaleY : 1) * sourceScaleY,
  };
}

function createResult(
  ok: boolean,
  document: EditorDocument,
  diagnostics: EditorDocumentDiagnostic[],
  appliedSurfaceIds: string[],
): ApplyEditorDocumentResult {
  return {
    ok,
    document,
    diagnostics,
    views: document.views ?? [],
    appliedSurfaceIds,
  };
}

function hasErrors(diagnostics: EditorDocumentDiagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error");
}

function collectAvailableCapabilityIds(
  runtime: EditorDocumentRuntime,
  document: EditorDocument,
  options: EditorDocumentCapabilityCollectionOptions,
): string[] {
  const result = collectEditorDocumentCapabilityRequirements(document, options);
  return Array.from(
    new Set(
      result.requirements
        .map((item) => item.capabilityId)
        .filter((id) => runtime.capabilities.has(id)),
    ),
  );
}

function createBaseRenderIntentDrafts(
  document: EditorDocument,
): RenderIntentDraft[] {
  const drafts: RenderIntentDraft[] = [];
  document.surfaces.forEach((surface) => {
    surface.layers.forEach((layer) => {
      layer.objects?.forEach((object, index) => {
        const draft = createObjectRenderIntentDraft(
          surface,
          layer,
          object,
          index,
        );
        if (draft) drafts.push(draft);
      });
    });
  });
  return drafts;
}

function createObjectRenderIntentDraft(
  surface: EditorSurface,
  layer: EditorLayer,
  object: EditorObject,
  index: number,
): RenderIntentDraft | null {
  if (!object.frame) return null;
  const objectOrder = object.order ?? index;
  const layerOrder = layer.order ?? 0;
  const locked = object.locked;
  const interaction = createObjectInteractionAspect(object);
  const objectEffects = cloneObjectEffects(object.effects);
  const outputMaskKeys = normalizeOutputMaskKeys(
    object.metadata?.outputMaskKeys ?? object.metadata?.outputMaskKey,
  );
  const tags = normalizeTags(layer.tags, object.tags);
  const base = {
    id: object.id,
    subject: {
      kind: "object" as const,
      surfaceId: surface.id,
      layerId: layer.id,
      objectId: object.id,
      objectType: object.source.kind,
    },
    placement: {
      frame: object.frame,
      transform: normalizeRenderIntentTransform(object),
      width: object.frame.width,
      height: object.frame.height,
    },
    ordering: {
      layerId: layer.id,
      layerOrder,
      objectOrder,
      channel: "normal" as const,
      subOrder: 0,
      stack: resolveLayerStack(layer),
    },
    export: {
      visible: (layer.visible ?? true) && (object.visible ?? true),
      tags,
    },
    ...(interaction ? { interaction } : {}),
    props: {
      ...(object.style ?? {}),
      ...(object.transform ?? {}),
    },
    data: {
      id: object.id,
      layerId: layer.id,
      documentSurfaceId: surface.id,
      documentObjectSourceKind: object.source.kind,
      documentLayerRole: layer.role,
      ...(objectEffects ? { documentObjectEffects: objectEffects } : {}),
      ...(typeof locked === "boolean" ? { locked } : {}),
      ...(outputMaskKeys.length ? { outputMaskKeys } : {}),
    },
  } satisfies Omit<RenderIntentDraft, "visual">;

  const visual = resolveObjectSource(object.source);
  if (!visual) return null;
  if (visual.imageUrl) {
    return {
      ...base,
      visual: {
        type: "image",
        src: visual.imageUrl,
      },
      props: {
        ...base.props,
        source: object.source,
      },
    };
  }
  if (visual.pathData) {
    return {
      ...base,
      placement: {
        ...base.placement,
        transform: createScaledPathTransform(
          object,
          visual.bounds,
          visual.contentBounds,
        ),
      },
      visual: { type: "path" },
      props: {
        ...base.props,
        path: visual.pathData,
        pathData: visual.pathData,
        source: object.source,
      },
    };
  }
  if (visual.text !== undefined) {
    return {
      ...base,
      visual: { type: "text" },
      props: { ...base.props, text: visual.text, source: object.source },
    };
  }
  return null;
}

function normalizeRenderIntentTransform(object: EditorObject) {
  return {
    ...(object.transform ?? {}),
    left: object.transform?.left ?? object.frame?.x ?? 0,
    top: object.transform?.top ?? object.frame?.y ?? 0,
    originX: object.transform?.originX ?? "left",
    originY: object.transform?.originY ?? "top",
  };
}

function resolveLayerStack(layer: EditorLayer): number {
  if (layer.role === "guide") return 900;
  return layer.role === "overlay" ? 780 : 0;
}

async function compileRenderIntentPatches(
  compilerRegistry: RenderIntentCompilerRegistryService,
  document: EditorDocument,
  capabilityId: string,
  entry: EffectEntry,
  runtime: EditorDocumentRuntime,
  diagnostics: EditorDocumentDiagnostic[],
): Promise<RenderIntentPatch[]> {
  const target = resolveRenderIntentTarget(
    entry.effect,
    entry.context,
    document,
  );
  if (!target) {
    diagnostics.push(
      createDiagnostic(
        entry,
        severityForEffect(entry.effect),
        "effect-target-missing",
        `Effect "${entry.effect.type}" could not resolve a render intent target.`,
        capabilityId,
      ),
    );
    return [];
  }

  const compilers = compilerRegistry.getCompilers({
    capabilityId,
    effectType: entry.effect.type,
  });
  if (compilers.length === 0) {
    diagnostics.push(
      createDiagnostic(
        entry,
        severityForEffect(entry.effect),
        "compiler-missing",
        `Capability "${capabilityId}" has no RenderIntent compiler for effect "${entry.effect.type}".`,
        capabilityId,
      ),
    );
    return [];
  }

  const patches: RenderIntentPatch[] = [];
  for (const compiler of compilers) {
    try {
      const compiled = await compiler.compile({
        document,
        effect: entry.effect,
        services: runtime.services as any,
        target,
      });
      patches.push(...normalizeRenderIntentPatches(compiled));
    } catch (error) {
      diagnostics.push(
        createDiagnostic(
          entry,
          severityForEffect(entry.effect),
          "effect-compile-failed",
          `RenderIntent compiler failed for effect "${entry.effect.type}": ${getErrorMessage(error)}`,
          capabilityId,
        ),
      );
    }
  }
  return patches;
}

function normalizeRenderIntentPatches(
  value: RenderIntentPatch[] | RenderIntentPatch | void,
): RenderIntentPatch[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function collectEffectEntries(document: EditorDocument): EffectEntry[] {
  const entries: EffectEntry[] = [];
  document.surfaces.forEach((surface, surfaceIndex) => {
    surface.effects?.forEach((effect, effectIndex) =>
      entries.push({
        effect,
        context: { surface },
        path: `/surfaces/${surfaceIndex}/effects/${effectIndex}`,
      }),
    );
    surface.layers.forEach((layer, layerIndex) => {
      layer.effects?.forEach((effect, effectIndex) =>
        entries.push({
          effect,
          context: { surface, layer },
          path: `/surfaces/${surfaceIndex}/layers/${layerIndex}/effects/${effectIndex}`,
        }),
      );
      layer.objects?.forEach((object, objectIndex) => {
        object.effects?.forEach((effect, effectIndex) => {
          if (isGenericEditorEffect(effect)) {
            entries.push({
              effect,
              context: { surface, layer, object },
              path:
                `/surfaces/${surfaceIndex}/layers/${layerIndex}` +
                `/objects/${objectIndex}/effects/${effectIndex}`,
            });
          }
        });
      });
    });
  });
  return entries;
}

function createObjectInteractionAspect(
  object: EditorObject,
): RenderIntentInteractionAspect | undefined {
  const effects = object.effects ?? [];
  const interactive = effects.find(isObjectInteractiveEffect);
  const effectConstraints = effects
    .filter(isObjectConstraintEffect)
    .map((effect) => ({
      spec: {
        type: mapObjectConstraintStrategy(effect.strategy),
        source: { sourceId: "render-graph", geometryId: effect.targetId },
        ...(effect.params ? { params: { ...effect.params } } : {}),
      },
    }));
  const documentConstraints =
    object.interaction?.drag?.constraints
      ?.map(normalizeDocumentInteractionConstraint)
      .filter(
        (constraint): constraint is NonNullable<typeof constraint> =>
          Boolean(constraint),
      ) ?? [];
  const constraints = [...documentConstraints, ...effectConstraints];
  const transformEnabled = object.interaction?.transform?.enabled;
  const dragEnabled =
    object.interaction?.drag?.enabled ??
    (typeof interactive?.enabled === "boolean" ? interactive.enabled : undefined);

  if (
    transformEnabled === undefined &&
    dragEnabled === undefined &&
    !object.interaction?.enabledWhen &&
    constraints.length === 0
  )
    return undefined;

  return {
    ...(object.interaction?.enabledWhen
      ? {
          enabledWhen:
            object.interaction.enabledWhen as RuntimeConditionExpr,
        }
      : {}),
    ...(transformEnabled !== undefined
      ? { transform: { enabled: transformEnabled } }
      : {}),
    ...(dragEnabled !== undefined || constraints.length
      ? {
          drag: {
            ...(dragEnabled !== undefined ? { enabled: dragEnabled } : {}),
            ...(constraints.length ? { constraints } : {}),
          },
        }
      : {}),
  };
}

function normalizeDocumentInteractionConstraint(
  constraint: EditorInteractionConstraint,
) {
  const spec = constraint.spec;
  const type = typeof spec.type === "string" ? spec.type.trim() : "";
  if (!type) return null;
  return {
    ...(constraint.activeWhen
      ? { activeWhen: constraint.activeWhen as RuntimeConditionExpr }
      : {}),
    spec: {
      ...((spec as unknown) as ConstraintSpec),
      type,
    },
  };
}

function isObjectInteractiveEffect(
  effect: EditorObjectEffect,
): effect is Extract<EditorObjectEffect, { type: "interactive" }> {
  return effect.type === "interactive" && "enabled" in effect;
}

function isObjectConstraintEffect(
  effect: EditorObjectEffect,
): effect is Extract<EditorBuiltinObjectEffect, { type: "object-constraint" }> {
  return effect.type === "object-constraint";
}

function mapObjectConstraintStrategy(strategy: string): string {
  if (strategy === "path" || strategy === "lowest-tangent")
    return "path.follow";
  if (strategy === "inside") return "rect.contain";
  return strategy;
}

function compareEffectEntries(a: EffectEntry, b: EffectEntry) {
  const phaseDelta =
    (EFFECT_PHASE_ORDER[a.effect.phase ?? "layout"] ?? 1) -
    (EFFECT_PHASE_ORDER[b.effect.phase ?? "layout"] ?? 1);
  return phaseDelta || (a.effect.order ?? 0) - (b.effect.order ?? 0);
}

function resolveRenderIntentTarget(
  effect: EditorEffect,
  context: EffectContext,
  document: EditorDocument,
): RenderIntentDraft["subject"] | null {
  const target = effect.target ?? "self";
  if (target === "self") {
    if (context.object && context.layer) {
      return {
        kind: "object",
        surfaceId: context.surface.id,
        layerId: context.layer.id,
        objectId: context.object.id,
        objectType: context.object.source.kind,
      };
    }
    if (context.layer) {
      return {
        kind: "layer",
        surfaceId: context.surface.id,
        layerId: context.layer.id,
      };
    }
    return { kind: "surface", surfaceId: context.surface.id };
  }

  if ("objectId" in target) {
    const resolved = findObjectContext(document, target.objectId);
    return resolved
      ? {
          kind: "object",
          surfaceId: resolved.surface.id,
          layerId: resolved.layer.id,
          objectId: resolved.object.id,
          objectType: resolved.object.source.kind,
        }
      : null;
  }
  if ("layerId" in target) {
    const resolved = findLayerContext(document, target.layerId);
    return resolved
      ? {
          kind: "layer",
          surfaceId: resolved.surface.id,
          layerId: resolved.layer.id,
        }
      : null;
  }
  if ("surfaceId" in target) {
    return document.surfaces.some((surface) => surface.id === target.surfaceId)
      ? { kind: "surface", surfaceId: target.surfaceId }
      : null;
  }
  return null;
}

function findLayerContext(document: EditorDocument, layerId: string) {
  for (const surface of document.surfaces) {
    const layer = surface.layers.find((item) => item.id === layerId);
    if (layer) return { surface, layer };
  }
  return null;
}

function findObjectContext(document: EditorDocument, objectId: string) {
  for (const surface of document.surfaces) {
    for (const layer of surface.layers) {
      const object = layer.objects?.find((item) => item.id === objectId);
      if (object) return { surface, layer, object };
    }
  }
  return null;
}

function severityForEffect(
  effect: EditorEffect,
): EditorDocumentDiagnostic["severity"] {
  return effect.require === "warn" ? "warning" : "error";
}

function createDiagnostic(
  entry: EffectEntry,
  severity: EditorDocumentDiagnostic["severity"],
  code: string,
  message: string,
  capabilityId?: string,
): EditorDocumentDiagnostic {
  return {
    severity,
    code,
    message,
    path: entry.path,
    capabilityId,
    effectType: entry.effect.type,
  };
}

function createRenderIntentDiagnostic(
  diagnostic: RenderIntentDiagnostic,
): EditorDocumentDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.debugLabel ?? "renderIntent",
    capabilityId: diagnostic.sourceId?.startsWith("capability:")
      ? diagnostic.sourceId.slice("capability:".length)
      : undefined,
    effectType: diagnostic.reason,
  };
}

function collectAppliedSurfaceIds(
  drafts: readonly RenderIntentDraft[],
): string[] {
  return Array.from(
    new Set(
      drafts
        .map((draft) => draft.subject.surfaceId)
        .filter((surfaceId) => surfaceId.length > 0),
    ),
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeOutputMaskKeys(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function normalizeTags(...values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : []))
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function resolveShapeSource(
  source: Extract<ObjectSource, { kind: "shape" }>,
): Omit<ResolvedVisual, "source"> | null {
  switch (source.shape) {
    case "rect": {
      const width = positiveNumber(source.params.width, 1);
      const height = positiveNumber(source.params.height, 1);
      return {
        pathData: `M0 0H${width}V${height}H0Z`,
        bounds: { left: 0, top: 0, width, height },
        intrinsicSize: { width, height },
      };
    }
    case "circle": {
      const radius = positiveNumber(source.params.radius, 1);
      return {
        pathData: circlePath(radius, radius, radius),
        bounds: { left: 0, top: 0, width: radius * 2, height: radius * 2 },
        intrinsicSize: { width: radius * 2, height: radius * 2 },
      };
    }
    case "ellipse": {
      const rx = positiveNumber(
        source.params.rx,
        positiveNumber(source.params.width, 2) / 2,
      );
      const ry = positiveNumber(
        source.params.ry,
        positiveNumber(source.params.height, 2) / 2,
      );
      return {
        pathData: ellipsePath(rx, ry, rx, ry),
        bounds: { left: 0, top: 0, width: rx * 2, height: ry * 2 },
        intrinsicSize: { width: rx * 2, height: ry * 2 },
      };
    }
    case "heart": {
      const width = positiveNumber(source.params.width, 100);
      const height = positiveNumber(source.params.height, 90);
      return {
        pathData: heartPath(width, height),
        bounds: { left: 0, top: 0, width, height },
        intrinsicSize: { width, height },
      };
    }
    default:
      return null;
  }
}

function circlePath(cx: number, cy: number, radius: number): string {
  return [
    `M${cx} ${cy - radius}`,
    `A${radius} ${radius} 0 1 1 ${cx} ${cy + radius}`,
    `A${radius} ${radius} 0 1 1 ${cx} ${cy - radius}`,
    "Z",
  ].join("");
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return [
    `M${cx} ${cy - ry}`,
    `A${rx} ${ry} 0 1 1 ${cx} ${cy + ry}`,
    `A${rx} ${ry} 0 1 1 ${cx} ${cy - ry}`,
    "Z",
  ].join("");
}

function heartPath(width: number, height: number): string {
  return [
    `M${width / 2} ${height}`,
    `C${width * 0.1} ${height * 0.65} 0 ${height * 0.35} ${width * 0.2} ${height * 0.15}`,
    `C${width * 0.35} 0 ${width / 2} ${height * 0.15} ${width / 2} ${height * 0.3}`,
    `C${width / 2} ${height * 0.15} ${width * 0.65} 0 ${width * 0.8} ${height * 0.15}`,
    `C${width} ${height * 0.35} ${width * 0.9} ${height * 0.65} ${width / 2} ${height}`,
    "Z",
  ].join("");
}

function inferPathBounds(pathData: string): GeometryRect | null {
  const numbers =
    pathData.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  const points: GeometryPoint[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    const x = numbers[index];
    const y = numbers[index + 1];
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    left,
    top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

function sizeToBounds(size: ObjectSize): GeometryRect {
  return {
    left: 0,
    top: 0,
    width: positiveNumber(size.width, 1),
    height: positiveNumber(size.height, 1),
  };
}

function rectToBounds(rect: ObjectRect | undefined): GeometryRect | null {
  if (!rect) return null;
  const left = Number(rect.x);
  const top = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { left, top, width, height };
}

function containsPoint(bounds: GeometryRect, point: GeometryPoint): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.left + bounds.width &&
    point.y >= bounds.top &&
    point.y <= bounds.top + bounds.height
  );
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
