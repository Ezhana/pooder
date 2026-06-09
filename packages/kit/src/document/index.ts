import {
  RENDER_INTENT_COMPILER_REGISTRY_SERVICE,
  RENDER_INTENT_SERVICE,
  SURFACE_FRAME_SERVICE,
  mergeRenderIntentPatchEntries,
  resolveObjectSource,
  type ExtensionDefinition,
  type RenderIntentDiagnostic,
  type RenderIntentCompilerRegistryService,
  type RenderIntentDraft,
  type RenderIntentInteractionAspect,
  type RenderIntentPatch,
  type RenderIntentPatchEntry,
  type RenderIntentService,
  type Service,
  type ServiceIdentifier,
  type SurfaceFrameService,
} from "@pooder/core";
import {
  collectKitEditorDocumentCapabilityRequirements,
  normalizeKitEditorDocument,
  resolveKitEditorDocumentEffectCapabilityId,
  validateKitEditorDocument,
  type EditorDocument,
  type EditorDocumentDiagnostic,
  type EditorEffect,
  type EditorLayer,
  type EditorObject,
  type EditorObjectEffect,
  type EditorSurface,
  type ObjectSource,
} from "@pooder/document/kit";
import {
  createConfigurableVisualCapability,
  createClipCapability,
  createDielineGeometryCapability,
  createFeatureCapability,
  createImagePlacementCapability,
  createInteractionCapability,
  createMirrorCapability,
} from "../factories";
import { CLIP_CAPABILITY_ID } from "../extensions/clip";
import { CONFIGURABLE_VISUAL_CAPABILITY_ID } from "../extensions/configurable-visual";
import { DIELINE_GEOMETRY_CAPABILITY_ID } from "../extensions/dieline";
import { FEATURE_CAPABILITY_ID } from "../extensions/feature";
import {
  IMAGE_PLACEMENT_CAPABILITY_ID,
  type ImagePlacementCapabilityApi,
} from "../extensions/image";
import { INTERACTION_CAPABILITY_ID } from "../extensions/interaction";
import { MIRROR_CAPABILITY_ID } from "../extensions/mirror";

export interface KitEditorDocumentRuntime {
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

export interface ApplyKitEditorDocumentResult {
  ok: boolean;
  document: EditorDocument;
  diagnostics: EditorDocumentDiagnostic[];
  views: NonNullable<EditorDocument["views"]>;
  appliedSurfaceIds: string[];
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

export interface KitEditorDocumentController {
  apply(value: unknown): Promise<ApplyKitEditorDocumentResult>;
  export(): EditorDocument | null;
  updateObjectSource(
    objectId: string,
    source: ObjectSource,
    options?: {
      frame?: EditorObject["frame"];
      style?: Record<string, unknown>;
    },
  ): Promise<boolean>;
}

const KIT_EFFECT_FACTORIES: Record<string, () => ExtensionDefinition> = {
  [CLIP_CAPABILITY_ID]: () => createClipCapability(),
  [CONFIGURABLE_VISUAL_CAPABILITY_ID]: () =>
    createConfigurableVisualCapability(),
  [DIELINE_GEOMETRY_CAPABILITY_ID]: () => createDielineGeometryCapability(),
  [FEATURE_CAPABILITY_ID]: () => createFeatureCapability(),
  [IMAGE_PLACEMENT_CAPABILITY_ID]: () => createImagePlacementCapability(),
  [INTERACTION_CAPABILITY_ID]: () => createInteractionCapability(),
  [MIRROR_CAPABILITY_ID]: () => createMirrorCapability(),
};

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

export function createKitCapabilitiesForDocument(
  value: unknown,
): ExtensionDefinition[] {
  const result = collectKitEditorDocumentCapabilityRequirements(value);
  const capabilityIds = Array.from(
    new Set(
      result.requirements
        .map((item) => item.capabilityId)
        .filter((id) => KIT_EFFECT_FACTORIES[id]),
    ),
  );

  return capabilityIds.map((id) => KIT_EFFECT_FACTORIES[id]());
}

export async function applyKitEditorDocument(
  runtime: KitEditorDocumentRuntime,
  value: unknown,
): Promise<ApplyKitEditorDocumentResult> {
  const document = normalizeKitEditorDocument(value);
  const diagnostics = validateKitEditorDocument(value);
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

  const capabilityResult = collectKitEditorDocumentCapabilityRequirements(
    document,
    {
      availableCapabilityIds: collectAvailableCapabilityIds(runtime, document),
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
    const capabilityId = resolveKitEditorDocumentEffectCapabilityId(
      entry.effect,
    );
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
  await refreshDocumentRuntimeCapabilities(runtime);

  return createResult(
    true,
    document,
    allDiagnostics,
    collectAppliedSurfaceIds(mergeResult.drafts),
  );
}

export function createKitEditorDocumentController(
  runtime: KitEditorDocumentRuntime,
): KitEditorDocumentController {
  let currentDocument: EditorDocument | null = null;

  return {
    async apply(value) {
      const result = await applyKitEditorDocument(runtime, value);
      if (result.ok) {
        currentDocument = cloneDocument(result.document);
      }
      return result;
    },
    export() {
      return currentDocument ? cloneDocument(currentDocument) : null;
    },
    async updateObjectSource(objectId, source, options = {}) {
      const id = normalizeObjectId(objectId);
      if (!id || !currentDocument) return false;

      const nextDocument = cloneDocument(currentDocument);
      nextDocument.config = runtime.config?.export() ?? nextDocument.config;
      const object = findSourceObject(nextDocument, id);
      if (!object) return false;

      object.source = cloneObjectSource(source);
      if (options.frame) {
        object.frame = { ...options.frame };
      }
      if (options.style) {
        object.style = { ...object.style, ...options.style };
      }
      const result = await applyKitEditorDocument(runtime, nextDocument);
      if (!result.ok) return false;

      currentDocument = cloneDocument(result.document);
      return true;
    },
  };
}

async function refreshDocumentRuntimeCapabilities(
  runtime: KitEditorDocumentRuntime,
): Promise<void> {
  await runtime.capabilities
    .get<ImagePlacementCapabilityApi>(IMAGE_PLACEMENT_CAPABILITY_ID)
    ?.refresh();
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
): Extract<EditorObject, { type: "object" }> | null {
  for (const surface of document.surfaces) {
    for (const layer of surface.layers) {
      for (const object of layer.objects ?? []) {
        if (object.id === objectId && object.type === "object") {
          return object;
        }
      }
    }
  }

  return null;
}

function createScaledPathTransform(
  object: Extract<EditorObject, { type: "object" }>,
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
): ApplyKitEditorDocumentResult {
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
  runtime: KitEditorDocumentRuntime,
  document: EditorDocument,
): string[] {
  const result = collectKitEditorDocumentCapabilityRequirements(document);
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
      objectType: object.type,
    },
    placement: {
      frame: object.frame,
      transform: normalizeRenderIntentTransform(object),
      width:
        object.type === "image" || object.type === "rect"
          ? (object.width ?? object.frame.width)
          : object.frame.width,
      height:
        object.type === "image" || object.type === "rect"
          ? (object.height ?? object.frame.height)
          : object.frame.height,
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
      documentObjectType: object.type,
      documentLayerRole: layer.role,
      ...(objectEffects ? { documentObjectEffects: objectEffects } : {}),
      ...(typeof locked === "boolean" ? { locked } : {}),
      ...(outputMaskKeys.length ? { outputMaskKeys } : {}),
    },
  } satisfies Omit<RenderIntentDraft, "visual">;

  if (object.type === "image") {
    return {
      ...base,
      visual: {
        type: "image",
        ...(object.src ? { src: object.src } : {}),
      },
    };
  }

  if (object.type === "path") {
    return {
      ...base,
      visual: { type: "path" },
      props: { ...base.props, path: object.path, pathData: object.path },
    };
  }

  if (object.type === "rect") {
    return {
      ...base,
      visual: { type: "rect" },
      props: {
        ...base.props,
        width: object.width ?? object.frame.width,
        height: object.height ?? object.frame.height,
      },
    };
  }

  if (object.type === "object") {
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
    return null;
  }

  if (object.type === "text") {
    return {
      ...base,
      visual: { type: "text" },
      props: { ...base.props, text: object.text },
    };
  }

  return {
    ...base,
    visual: { type: "rect" },
  } satisfies RenderIntentDraft;
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
  runtime: KitEditorDocumentRuntime,
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
          if (isEditorEffect(effect)) {
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

function isEditorEffect(effect: EditorObjectEffect): effect is EditorEffect {
  if (
    effect.type === "constraint" &&
    "targetId" in effect &&
    "strategy" in effect
  ) {
    return false;
  }

  return !(
    effect.type === "clip-source" ||
    effect.type === "boolean" ||
    effect.type === "interactive" ||
    effect.type === "guide"
  );
}

function createObjectInteractionAspect(
  object: EditorObject,
): RenderIntentInteractionAspect | undefined {
  const effects = object.effects ?? [];
  const interactive = effects.find(isObjectInteractiveEffect);
  const constraints = effects
    .filter(
      (
        effect,
      ): effect is Extract<
        EditorObjectEffect,
        { type: "constraint"; targetId: string }
      > =>
        effect.type === "constraint" &&
        "targetId" in effect &&
        "strategy" in effect,
    )
    .map((effect) => ({
      spec: {
        type: mapObjectConstraintStrategy(effect.strategy),
        source: { sourceId: "render-graph", geometryId: effect.targetId },
        ...(effect.params ? { params: { ...effect.params } } : {}),
      },
    }));

  if (!interactive && constraints.length === 0) return undefined;

  return {
    ...(typeof interactive?.enabled === "boolean"
      ? { enabled: interactive.enabled }
      : {}),
    ...(constraints.length ? { constraints } : {}),
  };
}

function isObjectInteractiveEffect(
  effect: EditorObjectEffect,
): effect is Extract<EditorObjectEffect, { type: "interactive" }> {
  return effect.type === "interactive" && "enabled" in effect;
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
        objectType: context.object.type,
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
          objectType: resolved.object.type,
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
