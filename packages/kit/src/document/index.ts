import {
  SCENE_SERVICE,
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
  type EditorLayer,
  type EditorObject,
  type EditorSurface,
} from "@pooder/document/kit";
import {
  createBackgroundCapability,
  createDielineGeometryCapability,
  createImagePlacementCapability,
  createTemplateOverlayCapability,
  createWhiteInkCapability,
} from "../factories";
import { BACKGROUND_CAPABILITY_ID } from "../extensions/background";
import type { BackgroundCapabilityApi } from "../extensions/background";
import { DIELINE_GEOMETRY_CAPABILITY_ID } from "../extensions/dieline";
import type { DielineGeometryCapabilityApi } from "../extensions/dieline";
import { IMAGE_PLACEMENT_CAPABILITY_ID } from "../extensions/image";
import type { ImagePlacementCapabilityApi } from "../extensions/image";
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

const KIT_EFFECT_FACTORIES: Record<string, () => ExtensionDefinition> = {
  [BACKGROUND_CAPABILITY_ID]: () => createBackgroundCapability(),
  [DIELINE_GEOMETRY_CAPABILITY_ID]: () => createDielineGeometryCapability(),
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

  for (const entry of collectEffectEntries(document)) {
    const capabilityId = resolveKitEditorDocumentEffectCapabilityId(entry.effect);
    if (!capabilityId || !runtime.capabilities.has(capabilityId)) {
      continue;
    }
    await applyKitEffect(runtime, capabilityId, entry.effect, entry.context, assetsById);
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

function createSceneElement(
  surface: EditorSurface,
  layer: EditorLayer,
  object: EditorObject,
  assetsById: Map<string, EditorAsset>,
): SceneElementInput | null {
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
      const asset = object.assetId ? assetsById.get(object.assetId) : undefined;
      const src = object.src || asset?.src;
      if (!src) return null;
      return {
        ...base,
        type: "image",
        src,
        width: object.width,
        height: object.height,
      };
    }
    case "template": {
      const asset = assetsById.get(object.assetId);
      if (!asset?.src) return null;
      return {
        ...base,
        type: "image",
        src: asset.src,
        data: {
          ...base.data,
          assetId: object.assetId,
          templateRole: object.role,
        },
      };
    }
    case "slot":
      return {
        ...base,
        type: "rect",
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
          accepts: object.accepts,
          fit: object.fit,
          constraints: object.constraints,
          frame: object.frame,
        },
      };
    case "path":
      return { ...base, type: "path", path: object.path };
    case "rect":
      return { ...base, type: "rect", width: object.width, height: object.height };
    case "text":
      return { ...base, type: "text", text: object.text };
    default:
      return null;
  }
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

async function applyKitEffect(
  runtime: KitEditorDocumentRuntime,
  capabilityId: string,
  effect: EditorEffect,
  context: EffectContext,
  assetsById: Map<string, EditorAsset>,
) {
  switch (capabilityId) {
    case BACKGROUND_CAPABILITY_ID:
      applyBackgroundEffect(runtime, effect, context, assetsById);
      return;
    case TEMPLATE_OVERLAY_CAPABILITY_ID:
      await applyTemplateOverlayEffect(runtime, effect, context, assetsById);
      return;
    case DIELINE_GEOMETRY_CAPABILITY_ID:
      applyDielineEffect(runtime, effect, context);
      return;
    case IMAGE_PLACEMENT_CAPABILITY_ID:
      await applyImagePlacementEffect(runtime, effect, context, assetsById);
      return;
    case WHITE_INK_CAPABILITY_ID:
      await applyWhiteInkEffect(runtime, effect, context, assetsById);
      return;
    default:
      return;
  }
}

function getPayload(effect: EditorEffect): Record<string, unknown> {
  return effect.payload && typeof effect.payload === "object"
    ? effect.payload
    : {};
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
  assetsById: Map<string, EditorAsset>,
) {
  const facade = runtime.capabilities.get<TemplateOverlayCapabilityApi>(
    TEMPLATE_OVERLAY_CAPABILITY_ID,
  );
  if (!facade) return;
  const payload = { ...getPayload(effect) };
  if (context.object?.type === "template") {
    const asset = assetsById.get(context.object.assetId);
    if (asset?.src && !payload.slots) {
      payload.slots = {
        normal: {
          src: asset.src,
          enabled: true,
        },
      };
    }
  }
  await facade.patchConfig(payload as any);
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

async function applyImagePlacementEffect(
  runtime: KitEditorDocumentRuntime,
  effect: EditorEffect,
  context: EffectContext,
  assetsById: Map<string, EditorAsset>,
) {
  const facade = runtime.capabilities.get<ImagePlacementCapabilityApi>(
    IMAGE_PLACEMENT_CAPABILITY_ID,
  );
  if (!facade) return;
  const payload = getPayload(effect);
  const object = context.object;
  const asset =
    object?.type === "image" && object.assetId
      ? assetsById.get(object.assetId)
      : undefined;
  const src =
    (typeof payload.src === "string" && payload.src) ||
    (object?.type === "image" ? object.src : undefined) ||
    asset?.src;
  if (!src) return;
  await facade.upsertImage(src, {
    id: object?.id,
    ...(isRecord(payload.options) ? payload.options : {}),
  } as any);
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
