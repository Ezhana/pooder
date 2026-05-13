import {
  EFFECT_APPLICATOR_REGISTRY_SERVICE,
  SCENE_SERVICE,
  type EffectApplicationTarget,
  type EffectApplicatorRegistryService,
  type ExtensionDefinition,
  type SceneElementInput,
  type SceneService,
  type Service,
  type ServiceIdentifier,
} from "@pooder/core";
import {
  collectKitEditorDocumentCapabilityRequirements,
  normalizeKitEditorDocument,
  resolveKitEditorDocumentEffectCapabilityId,
  validateKitEditorDocument,
  type EditorAsset,
  type EditorDocument,
  type EditorDocumentDiagnostic,
  type EditorEffect,
  type EditorImageObject,
  type EditorLayer,
  type EditorObject,
  type EditorSurface,
} from "@pooder/document/kit";
import {
  createBackgroundCapability,
  createDielineGeometryCapability,
  createFeatureCapability,
  createImagePlacementCapability,
  createTemplateOverlayCapability,
  createWhiteInkCapability,
} from "../factories";
import { BACKGROUND_CAPABILITY_ID } from "../extensions/background";
import type { BackgroundCapabilityApi } from "../extensions/background";
import { DIELINE_GEOMETRY_CAPABILITY_ID } from "../extensions/dieline";
import type { DielineGeometryCapabilityApi } from "../extensions/dieline";
import { FEATURE_CAPABILITY_ID } from "../extensions/feature";
import type { FeatureCapabilityApi } from "../extensions/feature";
import { IMAGE_PLACEMENT_CAPABILITY_ID } from "../extensions/image";
import { TEMPLATE_OVERLAY_CAPABILITY_ID } from "../extensions/template-overlay";
import type { TemplateOverlayCapabilityApi } from "../extensions/template-overlay";
import { WHITE_INK_CAPABILITY_ID } from "../extensions/white-ink";
import type { WhiteInkCapabilityApi } from "../extensions/white-ink";

export interface KitEditorDocumentRuntime {
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
  readonly config?: {
    update(key: string, value: unknown): void;
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

type KitEffectHandler = (
  runtime: KitEditorDocumentRuntime,
  effect: EditorEffect,
  context: EffectContext,
  assetsById: Map<string, EditorAsset>,
) => void | Promise<void>;

const EFFECT_PHASE_ORDER = {
  document: 0,
  layout: 1,
  render: 2,
  interaction: 3,
  export: 4,
} as const;

const KIT_EFFECT_FACTORIES: Record<string, () => ExtensionDefinition> = {
  [BACKGROUND_CAPABILITY_ID]: () => createBackgroundCapability(),
  [DIELINE_GEOMETRY_CAPABILITY_ID]: () => createDielineGeometryCapability(),
  [FEATURE_CAPABILITY_ID]: () => createFeatureCapability(),
  [IMAGE_PLACEMENT_CAPABILITY_ID]: () => createImagePlacementCapability(),
  [TEMPLATE_OVERLAY_CAPABILITY_ID]: () => createTemplateOverlayCapability(),
  [WHITE_INK_CAPABILITY_ID]: () => createWhiteInkCapability(),
};

export function createKitCapabilitiesForDocument(
  value: unknown,
): ExtensionDefinition[] {
  const result = collectKitEditorDocumentCapabilityRequirements(value, {
    includeIgnored: true,
  });
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

  const sceneService = runtime.services.getOrThrow<SceneService>(
    SCENE_SERVICE,
    "SceneService is required to apply an EditorDocument.",
  );
  const assetsById = new Map((document.assets ?? []).map((asset) => [asset.id, asset]));
  applySurfaceSizeConfig(runtime, document);

  sceneService.transaction(() => {
    document.surfaces.forEach((surface) => {
      surface.layers.forEach((layer) => {
        upsertSceneLayer(sceneService, surface, layer);
        layer.objects?.forEach((object) => {
          const element = createSceneElement(surface, layer, object, assetsById);
          if (!element) return;
          if (sceneService.getElement(element.id)) {
            sceneService.updateElement(element.id, element);
          } else {
            sceneService.addElement(element);
          }
        });
      });
    });
  });

  const effectEntries = collectEffectEntries(document).sort(compareEffectEntries);
  for (const entry of effectEntries) {
    const capabilityId = resolveKitEditorDocumentEffectCapabilityId(entry.effect);
    if (!capabilityId || !runtime.capabilities.has(capabilityId)) {
      continue;
    }
    const appliedByApplicator = await applyKitEffectApplicators(
      runtime,
      document,
      capabilityId,
      entry.effect,
      entry.context,
    );
    if (!appliedByApplicator) {
      await applyKitEffect(runtime, capabilityId, entry.effect, entry.context, assetsById);
    }
  }

  return createResult(
    true,
    document,
    allDiagnostics,
    document.surfaces.map((surface) => surface.id),
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
  const result = collectKitEditorDocumentCapabilityRequirements(document, {
    includeIgnored: true,
  });
  return Array.from(
    new Set(
      result.requirements
        .map((item) => item.capabilityId)
        .filter((id) => runtime.capabilities.has(id)),
    ),
  );
}

function upsertSceneLayer(
  sceneService: SceneService,
  surface: EditorSurface,
  layer: EditorLayer,
) {
  const input = {
    id: layer.id,
    order: layer.order,
    visible: layer.visible,
    metadata: {
      ...(layer.metadata ?? {}),
      documentSurfaceId: surface.id,
      documentLayerRole: layer.role,
      locked: layer.locked,
      exportable: layer.exportable,
    },
  };
  if (sceneService.getLayer(layer.id)) {
    sceneService.updateLayer(layer.id, input);
  } else {
    sceneService.addLayer(input);
  }
}

function findImagePlacementEffect(
  effects: readonly EditorEffect[] | undefined,
): EditorEffect | undefined {
  return effects?.find(
    (effect) =>
      resolveKitEditorDocumentEffectCapabilityId(effect) ===
      IMAGE_PLACEMENT_CAPABILITY_ID,
  );
}

function readImagePlacementPayload(effect: EditorEffect | undefined) {
  return isRecord(effect?.payload) ? effect.payload : {};
}

function normalizeImageSessionProjectionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function normalizeImageSessionProjections(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!isRecord(item)) return null;
      const sourceLayerIds = normalizeImageSessionProjectionIds(
        item.sourceLayerIds,
      );
      const sourceElementIds = normalizeImageSessionProjectionIds(
        item.sourceElementIds,
      );
      if (!sourceLayerIds.length && !sourceElementIds.length) return null;
      const placement =
        item.placement === "below" || item.placement === "controls"
          ? item.placement
          : "above";
      const id = String(item.id || `projection-${index + 1}`).trim();
      const opacity = Number(item.opacity);
      return {
        id: id || `projection-${index + 1}`,
        placement,
        ...(sourceLayerIds.length ? { sourceLayerIds } : {}),
        ...(sourceElementIds.length ? { sourceElementIds } : {}),
        ...(Number.isFinite(opacity)
          ? { opacity: Math.max(0, Math.min(1, opacity)) }
          : {}),
        ...(typeof item.interactive === "boolean"
          ? { interactive: item.interactive }
          : {}),
        ...(typeof item.hideSource === "boolean"
          ? { hideSource: item.hideSource }
          : {}),
      };
    })
    .filter(Boolean);
}

function createSceneElement(
  surface: EditorSurface,
  layer: EditorLayer,
  object: EditorObject,
  assetsById: Map<string, EditorAsset>,
): SceneElementInput | null {
  if (!object.frame) return null;
  const base = {
    id: object.id,
    layerId: layer.id,
    order: object.order,
    visible: object.visible,
    metadata: {
      ...(object.metadata ?? {}),
      documentSurfaceId: surface.id,
      documentObjectType: object.type,
      locked: object.locked,
      exportable: object.exportable,
    },
    data: {
      documentObjectType: object.type,
      documentSurfaceId: surface.id,
    },
    style: object.style,
    transform: object.transform,
  };

  switch (object.type) {
    case "image": {
      const imagePlacement = createImagePlacementData(object, assetsById);
      if (imagePlacement) {
        return {
          ...base,
          type: "rect",
          visible: false,
          width: object.frame.width,
          height: object.frame.height,
          transform: {
            ...(object.transform ?? {}),
            left: object.frame.x,
            top: object.frame.y,
            originX: object.transform?.originX ?? "left",
            originY: object.transform?.originY ?? "top",
          },
          data: {
            ...base.data,
            id: object.id,
            layerId: layer.id,
            slotId: object.id,
            type: "image-placement-slot",
            frame: object.frame,
            imagePlacement,
          },
        };
      }

      const src = resolveImageObjectSource(object, assetsById);
      if (!src) return null;
      return {
        ...base,
        type: "image",
        src,
        width: object.width ?? object.frame.width,
        height: object.height ?? object.frame.height,
        transform: {
          ...(object.transform ?? {}),
          left: object.transform?.left ?? object.frame.x,
          top: object.transform?.top ?? object.frame.y,
          originX: object.transform?.originX ?? "left",
          originY: object.transform?.originY ?? "top",
        },
      };
    }
    case "path":
      return {
        ...base,
        type: "path",
        path: object.path,
        transform: {
          ...(object.transform ?? {}),
          left: object.transform?.left ?? object.frame.x,
          top: object.transform?.top ?? object.frame.y,
        },
      };
    case "rect":
      return {
        ...base,
        type: "rect",
        width: object.width ?? object.frame.width,
        height: object.height ?? object.frame.height,
        transform: {
          ...(object.transform ?? {}),
          left: object.transform?.left ?? object.frame.x,
          top: object.transform?.top ?? object.frame.y,
          originX: object.transform?.originX ?? "left",
          originY: object.transform?.originY ?? "top",
        },
      };
    case "text":
      return {
        ...base,
        type: "text",
        text: object.text,
        transform: {
          ...(object.transform ?? {}),
          left: object.transform?.left ?? object.frame.x,
          top: object.transform?.top ?? object.frame.y,
          originX: object.transform?.originX ?? "left",
          originY: object.transform?.originY ?? "top",
        },
      };
    default:
      return null;
  }
}

function resolveImageObjectSource(
  object: EditorImageObject,
  assetsById: Map<string, EditorAsset>,
): string | undefined {
  const asset = object.assetId ? assetsById.get(object.assetId) : undefined;
  return object.src || asset?.src;
}

function createImagePlacementData(
  object: EditorImageObject,
  assetsById: Map<string, EditorAsset>,
) {
  if (!object.frame) return null;
  const imagePlacementEffect = findImagePlacementEffect(object.effects);
  if (!imagePlacementEffect) return null;
  const payload = readImagePlacementPayload(imagePlacementEffect);
  const image = normalizeImagePlacementImageState(object, assetsById);
  return {
    enabled: true,
    slotId: object.id,
    frame: object.frame,
    fit:
      payload.fit === "contain" || payload.fit === "stretch"
        ? payload.fit
        : "cover",
    image,
    accepts: Array.isArray(payload.accepts) ? payload.accepts : ["image"],
    ...(isRecord(payload.placeholder) ? { placeholder: payload.placeholder } : {}),
    sessionProjections: normalizeImageSessionProjections(
      payload.sessionProjections,
    ),
  };
}

function normalizeImagePlacementImageState(
  object: EditorImageObject,
  assetsById: Map<string, EditorAsset>,
) {
  const asset = object.assetId ? assetsById.get(object.assetId) : undefined;
  const src = object.src || asset?.src;
  const transform = object.transform ?? {};
  const metadata = isRecord(object.metadata?.imagePlacement)
    ? object.metadata.imagePlacement
    : undefined;
  if (!src && !object.assetId) return undefined;
  return {
    ...(object.assetId ? { assetId: object.assetId } : {}),
    ...(src ? { src } : {}),
    ...(Number.isFinite(transform.left) ? { left: transform.left } : {}),
    ...(Number.isFinite(transform.top) ? { top: transform.top } : {}),
    ...(Number.isFinite(transform.scaleX) && transform.scaleX === transform.scaleY
      ? { scale: transform.scaleX }
      : {}),
    ...(Number.isFinite(transform.angle) ? { angle: transform.angle } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function collectEffectEntries(document: EditorDocument): Array<{
  effect: EditorEffect;
  context: EffectContext;
}> {
  const entries: Array<{ effect: EditorEffect; context: EffectContext }> = [];
  document.surfaces.forEach((surface) => {
    surface.effects?.forEach((effect) =>
      entries.push({ effect, context: { surface } }),
    );
    surface.layers.forEach((layer) => {
      layer.effects?.forEach((effect) =>
        entries.push({ effect, context: { surface, layer } }),
      );
      layer.objects?.forEach((object) => {
        object.effects?.forEach((effect) =>
          entries.push({ effect, context: { surface, layer, object } }),
        );
      });
    });
  });
  return entries;
}

function compareEffectEntries(
  a: { effect: EditorEffect },
  b: { effect: EditorEffect },
) {
  const phaseDelta =
    (EFFECT_PHASE_ORDER[a.effect.phase ?? "layout"] ?? 1) -
    (EFFECT_PHASE_ORDER[b.effect.phase ?? "layout"] ?? 1);
  return phaseDelta || (a.effect.order ?? 0) - (b.effect.order ?? 0);
}

async function applyKitEffect(
  runtime: KitEditorDocumentRuntime,
  capabilityId: string,
  effect: EditorEffect,
  context: EffectContext,
  assetsById: Map<string, EditorAsset>,
) {
  const handler = KIT_EFFECT_HANDLERS[capabilityId];
  if (!handler) return;
  await handler(runtime, effect, context, assetsById);
}

const KIT_EFFECT_HANDLERS: Record<string, KitEffectHandler> = {
  [BACKGROUND_CAPABILITY_ID]: applyBackgroundEffect,
  [TEMPLATE_OVERLAY_CAPABILITY_ID]: applyTemplateOverlayEffect,
  [DIELINE_GEOMETRY_CAPABILITY_ID]: applyDielineEffect,
  [FEATURE_CAPABILITY_ID]: applyFeatureEffect,
  [IMAGE_PLACEMENT_CAPABILITY_ID]: applyImagePlacementEffect,
  [WHITE_INK_CAPABILITY_ID]: applyWhiteInkEffect,
};

function getPayload(effect: EditorEffect): Record<string, unknown> {
  return effect.payload && typeof effect.payload === "object"
    ? effect.payload
    : {};
}

async function applyKitEffectApplicators(
  runtime: KitEditorDocumentRuntime,
  document: EditorDocument,
  capabilityId: string,
  effect: EditorEffect,
  context: EffectContext,
): Promise<boolean> {
  let registry: EffectApplicatorRegistryService | undefined;
  try {
    registry = runtime.services.getOrThrow<EffectApplicatorRegistryService>(
      EFFECT_APPLICATOR_REGISTRY_SERVICE,
      "EffectApplicatorRegistryService is required to apply effect applicators.",
    );
  } catch {
    return false;
  }

  const applicators = registry.getApplicators({
    capabilityId,
    effectType: effect.type,
  });
  if (applicators.length === 0) {
    return false;
  }

  const target = resolveEffectTarget(effect, context, document);
  if (!target) {
    return false;
  }

  for (const applicator of applicators) {
    await applicator.apply({
      document,
      effect,
      services: runtime.services as any,
      target,
    });
  }
  return true;
}

function resolveEffectTarget(
  effect: EditorEffect,
  context: EffectContext,
  document: EditorDocument,
): EffectApplicationTarget | null {
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

function applyBackgroundEffect(
  runtime: KitEditorDocumentRuntime,
  effect: EditorEffect,
  context: EffectContext,
  assetsById: Map<string, EditorAsset>,
) {
  const facade = runtime.capabilities.get<BackgroundCapabilityApi>(
    BACKGROUND_CAPABILITY_ID,
  );
  if (!facade) return;
  const payload = getPayload(effect);
  const assetId = typeof payload.assetId === "string" ? payload.assetId : undefined;
  const asset = assetId ? assetsById.get(assetId) : undefined;
  const src = typeof payload.src === "string" ? payload.src : asset?.src;
  facade.upsertLayer({
    id:
      (typeof payload.id === "string" && payload.id) ||
      context.layer?.id ||
      context.object?.id ||
      context.surface.id,
    kind: src ? "image" : "color",
    src,
    color: typeof payload.color === "string" ? payload.color : undefined,
    order: context.layer?.order,
    enabled: true,
    exportable: context.layer?.exportable ?? true,
    fit:
      payload.fit === "contain" || payload.fit === "stretch"
        ? payload.fit
        : "cover",
    opacity: typeof payload.opacity === "number" ? payload.opacity : 1,
    anchor: "center",
  });
}

async function applyTemplateOverlayEffect(
  runtime: KitEditorDocumentRuntime,
  effect: EditorEffect,
  context: EffectContext,
  _assetsById: Map<string, EditorAsset>,
) {
  if (context.object) return;
  const facade = runtime.capabilities.get<TemplateOverlayCapabilityApi>(
    TEMPLATE_OVERLAY_CAPABILITY_ID,
  );
  if (!facade) return;
  await facade.patchConfig(getPayload(effect) as any);
}

function applyDielineEffect(
  runtime: KitEditorDocumentRuntime,
  effect: EditorEffect,
  context: EffectContext,
) {
  const facade = runtime.capabilities.get<DielineGeometryCapabilityApi>(
    DIELINE_GEOMETRY_CAPABILITY_ID,
  );
  if (!facade) return;
  const payload = getPayload(effect);
  if (runtime.config) {
    Object.entries(payload).forEach(([key, value]) => {
      if (key === "pathData") return;
      runtime.config?.update(`dieline.${key}`, value);
    });
  }
  if (typeof payload.pathData === "string") {
    facade.upsertPathElement({
      layerId: context.layer?.id,
      elementId: `${context.layer?.id ?? context.surface.id}.dieline`,
      pathData: payload.pathData,
    });
  }
  facade.refresh();
}

function applyFeatureEffect(runtime: KitEditorDocumentRuntime, effect: EditorEffect) {
  const facade = runtime.capabilities.get<FeatureCapabilityApi>(
    FEATURE_CAPABILITY_ID,
  );
  if (!facade) return;
  const payload = getPayload(effect);
  if (!Array.isArray(payload.features)) return;
  facade.replaceFeatures(payload.features as any[], {
    markDirty: typeof payload.markDirty === "boolean" ? payload.markDirty : false,
    target:
      payload.target === "working" ||
      payload.target === "committed" ||
      payload.target === "both"
        ? payload.target
        : "both",
  });
}

async function applyImagePlacementEffect(
  _runtime: KitEditorDocumentRuntime,
  effect: EditorEffect,
  context: EffectContext,
  _assetsById: Map<string, EditorAsset>,
) {
  void effect;
  void context;
  return;
}

async function applyWhiteInkEffect(
  runtime: KitEditorDocumentRuntime,
  effect: EditorEffect,
  context: EffectContext,
  assetsById: Map<string, EditorAsset>,
) {
  const facade = runtime.capabilities.get<WhiteInkCapabilityApi>(
    WHITE_INK_CAPABILITY_ID,
  );
  if (!facade) return;
  const payload = getPayload(effect);
  if (typeof payload.printEnabled === "boolean") {
    facade.setPrintEnabled(payload.printEnabled);
  }
  const object = context.object;
  const asset =
    object?.type === "image" && object.assetId
      ? assetsById.get(object.assetId)
      : undefined;
  const src =
    (typeof payload.src === "string" && payload.src) ||
    (typeof payload.sourceUrl === "string" && payload.sourceUrl) ||
    (object?.type === "image" ? object.src : undefined) ||
    asset?.src;
  if (src) {
    await facade.upsertWhiteInk(src, {
      id: typeof payload.id === "string" ? payload.id : object?.id,
    } as any);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}


function applySurfaceSizeConfig(
  runtime: KitEditorDocumentRuntime,
  document: EditorDocument,
) {
  if (!runtime.config) return;
  const surface = resolveActiveSurface(document);
  if (!surface) return;
  const widthMm = toMm(surface.size.width, surface.size.unit);
  const heightMm = toMm(surface.size.height, surface.size.unit);
  const sizeMetadata = isRecord(surface.metadata?.size)
    ? surface.metadata.size
    : {};

  runtime.config.update("size.actualWidthMm", widthMm);
  runtime.config.update("size.actualHeightMm", heightMm);
  runtime.config.update("size.aspectRatio", widthMm / Math.max(0.001, heightMm));
  runtime.config.update("size.unit", surface.size.unit);
  runtime.config.update("size.cutMode", sizeMetadata.cutMode ?? "trim");
  runtime.config.update("size.cutMarginMm", sizeMetadata.cutMarginMm ?? 0);
  runtime.config.update("size.maxMm", sizeMetadata.maxMm ?? Math.max(widthMm, heightMm, 2000));
  runtime.config.update("size.minMm", sizeMetadata.minMm ?? 0.1);
  runtime.config.update("size.stepMm", sizeMetadata.stepMm ?? 0.001);
  runtime.config.update("size.viewPadding", sizeMetadata.viewPadding ?? "16%");
}

function resolveActiveSurface(document: EditorDocument): EditorSurface | undefined {
  const firstSurfaceId = document.views?.[0]?.surfaceIds?.[0];
  return firstSurfaceId
    ? document.surfaces.find((surface) => surface.id === firstSurfaceId) ??
        document.surfaces[0]
    : document.surfaces[0];
}

function toMm(value: number, unit: string): number {
  if (unit === "cm") return value * 10;
  if (unit === "in") return value * 25.4;
  return value;
}
