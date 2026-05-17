import {
  RENDER_INTENT_COMPILER_REGISTRY_SERVICE,
  RENDER_INTENT_SERVICE,
  mergeRenderIntentPatchDraft,
  type ExtensionDefinition,
  type RenderIntentCompilerRegistryService,
  type RenderIntentDraft,
  type RenderIntentPatch,
  type RenderIntentService,
  type Service,
  type ServiceIdentifier,
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
  type EditorSurface,
} from "@pooder/document/kit";
import {
  createConfigurableVisualCapability,
  createClipCapability,
  createDielineGeometryCapability,
  createFeatureCapability,
  createImagePlacementCapability,
  createTemplateOverlayCapability,
  createWhiteInkCapability,
} from "../factories";
import { CLIP_CAPABILITY_ID } from "../extensions/clip";
import { CONFIGURABLE_VISUAL_CAPABILITY_ID } from "../extensions/configurable-visual";
import { DIELINE_GEOMETRY_CAPABILITY_ID } from "../extensions/dieline";
import { FEATURE_CAPABILITY_ID } from "../extensions/feature";
import { IMAGE_PLACEMENT_CAPABILITY_ID } from "../extensions/image";
import { TEMPLATE_OVERLAY_CAPABILITY_ID } from "../extensions/template-overlay";
import { WHITE_INK_CAPABILITY_ID } from "../extensions/white-ink";

export interface KitEditorDocumentRuntime {
  readonly config?: {
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

const KIT_EFFECT_FACTORIES: Record<string, () => ExtensionDefinition> = {
  [CLIP_CAPABILITY_ID]: () => createClipCapability(),
  [CONFIGURABLE_VISUAL_CAPABILITY_ID]: () => createConfigurableVisualCapability(),
  [DIELINE_GEOMETRY_CAPABILITY_ID]: () => createDielineGeometryCapability(),
  [FEATURE_CAPABILITY_ID]: () => createFeatureCapability(),
  [IMAGE_PLACEMENT_CAPABILITY_ID]: () => createImagePlacementCapability(),
  [TEMPLATE_OVERLAY_CAPABILITY_ID]: () => createTemplateOverlayCapability(),
  [WHITE_INK_CAPABILITY_ID]: () => createWhiteInkCapability(),
};

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
          message: "ConfigurationService runtime facade is required to apply an EditorDocument.",
          path: "config",
        },
      ],
      [],
    );
  }
  runtime.config.import(document.config);

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
  const effectEntries = collectEffectEntries(document).sort(compareEffectEntries);

  for (const entry of effectEntries) {
    if (entry.effect.require === "ignore") continue;
    const capabilityId = resolveKitEditorDocumentEffectCapabilityId(entry.effect);
    if (!capabilityId || !runtime.capabilities.has(capabilityId)) continue;

    const patches = await compileRenderIntentPatches(
      compilerRegistry,
      document,
      capabilityId,
      entry,
      runtime,
      allDiagnostics,
    );
    for (const patch of patches) {
      const result = mergeRenderIntentPatchDraft(intentDrafts, patch);
      result.diagnostics.forEach((diagnostic) => {
        allDiagnostics.push(
          createDiagnostic(
            entry,
            "error",
            diagnostic.code,
            diagnostic.message,
            capabilityId,
          ),
        );
      });
      if (result.draft) {
        intentDrafts.push(result.draft);
      }
    }
  }

  if (hasErrors(allDiagnostics)) {
    return createResult(false, document, allDiagnostics, []);
  }

  renderIntentService.setDocumentIntents(intentDrafts);

  return createResult(
    true,
    document,
    allDiagnostics,
    collectAppliedSurfaceIds(intentDrafts),
  );
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

function createBaseRenderIntentDrafts(document: EditorDocument): RenderIntentDraft[] {
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
      width: object.type === "image" || object.type === "rect"
        ? object.width ?? object.frame.width
        : object.frame.width,
      height: object.type === "image" || object.type === "rect"
        ? object.height ?? object.frame.height
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
      exportable: (layer.exportable ?? true) && (object.exportable ?? true),
    },
    props: {
      ...(object.style ?? {}),
      selectable: object.locked !== true,
      evented: object.locked !== true,
      ...(object.transform ?? {}),
    },
    data: {
      id: object.id,
      layerId: layer.id,
      documentSurfaceId: surface.id,
      documentObjectType: object.type,
      documentLayerRole: layer.role,
      locked: object.locked,
      exportable: object.exportable,
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

  return {
    ...base,
    visual: { type: "text" },
    props: { ...base.props, text: object.text },
  };
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
  const target = resolveRenderIntentTarget(entry.effect, entry.context, document);
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
        object.effects?.forEach((effect, effectIndex) =>
          entries.push({
            effect,
            context: { surface, layer, object },
            path:
              `/surfaces/${surfaceIndex}/layers/${layerIndex}` +
              `/objects/${objectIndex}/effects/${effectIndex}`,
          }),
        );
      });
    });
  });
  return entries;
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

function severityForEffect(effect: EditorEffect): EditorDocumentDiagnostic["severity"] {
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

function collectAppliedSurfaceIds(drafts: readonly RenderIntentDraft[]): string[] {
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
