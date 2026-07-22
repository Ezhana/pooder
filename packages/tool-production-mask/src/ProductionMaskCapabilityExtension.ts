import {
  CAPABILITY_REGISTRY_SERVICE,
  EDITOR_INTERACTION_SESSION_GROUP_ID,
  OBJECT_IMAGE_RESOLVER_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_LAYOUT_SERVICE,
  SCENE_SERVICE,
  SESSION_SERVICE,
  SURFACE_FRAME_SERVICE,
  CapabilityRegistryService,
  SessionConflictError,
  TypedEventEmitter,
  createAffinePlacement,
  type AffinePlacement,
  type ExtensionActivationSpec,
  type ExtensionContext,
  type ExtensionContributions,
  type ExtensionDefinition,
  type ObjectImageResolverService,
  type RenderEffectSpec,
  type RenderGraphNode,
  type RenderIntentCompilerContext,
  type RenderIntentCompilerContribution,
  type RenderIntentPatch,
  type RenderIntentService,
  type SceneElementInput,
  type SceneHandle,
  type SceneLayoutService,
  type SceneService,
  type SessionHandle,
  type SessionService,
  type SurfaceFrameService,
} from "@pooder/core";
import {
  CANVAS_SERVICE,
  type CanvasService,
  type RenderObjectSpec,
} from "@pooder/core";
import type {
  EditorDocument,
  EditorEffect,
  EditorImageResource,
  EditorObjectEffect,
} from "@pooder/document";
import {
  IMAGE_MASK_CAPABILITY_ID,
  type ImageMaskCapabilityApi,
  type ImageMaskTint,
} from "@pooder/image-mask-contract";

import {
  POODER_PRODUCTION_MASK_CAPABILITY_ID,
  createProductionMaskCapabilityDefinition,
  normalizeProductionMaskLayerId,
  type GenerateProductionMaskOptions,
  type ProductionMaskAlphaParameters,
  type ProductionMaskCapabilityApi,
  type ProductionMaskCapabilityChangeEvent,
  type ProductionMaskCapabilityOptions,
  type ProductionMaskDescriptor,
  type ProductionMaskDocumentController,
  type ProductionMaskEffectPayload,
  type ProductionMaskOperationResult,
  type ProductionMaskSessionDraft,
  type ProductionMaskSessionProjection,
  type ProductionMaskSource,
  type ProductionMaskViewState,
} from "./capability";
import {
  POODER_PRODUCTION_MASK_LAYER_PRESET,
} from "./layers";
import { SubscriptionBag } from "./runtime/subscriptions";
import { type FrameRect, resolveSurfaceFrameRect } from "./scene/frame";

interface ImageSnapshot {
  id: string;
  placement: AffinePlacement;
  src: string;
  /** Clip effects copied from the live reference node (keeps masks in frame). */
  effects: RenderEffectSpec[];
}

interface MaskTint extends ImageMaskTint {
  key: string;
}

interface ProductionMaskSessionResult {
  descriptor: ProductionMaskDescriptor;
}

const PRODUCTION_MASK_SESSION_CHANNEL = "production-mask";
const PRODUCTION_MASK_SESSION_SCENE_PREFIX = "pooder.production-mask.session";
const PRODUCTION_MASK_BINDING_DATA_PREFIX = "pooder.production-mask.binding";
const DEFAULT_MASK_OPACITY = 0.85;
const DEFAULT_MASK_TINT: MaskTint = { r: 255, g: 255, b: 255, key: "white" };
const COVER_MASK_TINT: MaskTint = { r: 52, g: 136, b: 255, key: "cover" };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const cloneReferenceClipEffects = (
  node: RenderGraphNode,
): RenderEffectSpec[] =>
  node.effects
    .filter((effect) => effect.type === "clipPath")
    .map((effect) => clone(effect));

const normalizeStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((item) => String(item || "").trim())
            .filter((item) => item.length > 0),
        ),
      )
    : [];

const normalizeUnitInterval = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.min(1, numeric))
    : fallback;
};

const normalizeAlphaParameters = (
  value: Partial<ProductionMaskAlphaParameters> | undefined,
): ProductionMaskAlphaParameters => ({
  selection: value?.selection === "transparent" ? "transparent" : "opaque",
  mapping: value?.mapping === "threshold" ? "threshold" : "continuous",
  threshold: normalizeUnitInterval(value?.threshold, 0.5),
  softness: normalizeUnitInterval(value?.softness, 0),
  outputOpacity: normalizeUnitInterval(value?.outputOpacity, 1),
});

const normalizeTint = (value: Partial<ImageMaskTint> | undefined): MaskTint => {
  const channel = (input: unknown, fallback: number) => {
    const numeric = Number(input);
    return Number.isFinite(numeric)
      ? Math.max(0, Math.min(255, Math.round(numeric)))
      : fallback;
  };
  const r = channel(value?.r, DEFAULT_MASK_TINT.r);
  const g = channel(value?.g, DEFAULT_MASK_TINT.g);
  const b = channel(value?.b, DEFAULT_MASK_TINT.b);
  return { r, g, b, key: `${r},${g},${b}` };
};

const normalizeProjection = (
  value: unknown,
): ProductionMaskSessionProjection | null => {
  if (!isRecord(value) || !isRecord(value.source)) return null;
  const objectIds = normalizeStringList(value.source.objectIds);
  const tags = normalizeStringList(value.source.tags);
  if (objectIds.length === 0 && tags.length === 0) return null;
  return {
    placement: value.placement === "above" ? "above" : "below",
    source: {
      ...(objectIds.length ? { objectIds } : {}),
      ...(tags.length ? { tags } : {}),
    },
    ...(value.surfaceScope === "all" ? { surfaceScope: "all" as const } : {}),
  };
};

const normalizePayload = (
  value: ProductionMaskEffectPayload,
): ProductionMaskEffectPayload => ({
  process: String(value.process || "").trim(),
  enabled: value.enabled === true,
  reference: {
    type: "document-object",
    objectId: String(value.reference?.objectId || "").trim(),
  },
  alignment:
    value.alignment === "reference-source"
      ? "reference-source"
      : "reference-frame",
  ...(value.source ? { source: clone(value.source) } : {}),
  alpha: normalizeAlphaParameters(value.alpha),
  ...(value.preview
    ? {
        preview: {
          ...(value.preview.tint
            ? { tint: normalizeTint(value.preview.tint) }
            : {}),
          opacity: normalizeUnitInterval(
            value.preview.opacity,
            DEFAULT_MASK_OPACITY,
          ),
        },
      }
    : {}),
  sessionProjections: Array.isArray(value.sessionProjections)
    ? value.sessionProjections
        .map(normalizeProjection)
        .filter((item): item is ProductionMaskSessionProjection =>
          Boolean(item),
        )
    : [],
});

const resourceLocation = (resource: EditorImageResource | undefined): string =>
  resource
    ? resource.kind === "data-url"
      ? resource.dataUrl
      : resource.url
    : "";

const visitProductionMaskEffects = (
  document: EditorDocument,
  visitor: (
    effect: EditorEffect,
    context: { layerId: string | null; surfaceId: string },
  ) => void,
): void => {
  const visitEffects = (
    effects: readonly (EditorEffect | EditorObjectEffect)[] | undefined,
    context: { layerId: string | null; surfaceId: string },
  ) => {
    for (const effect of effects ?? []) {
      if (effect.type === "production-mask" && "payload" in effect) {
        visitor(effect as EditorEffect, context);
      }
    }
  };

  for (const surface of document.surfaces) {
    visitEffects(surface.effects, { layerId: null, surfaceId: surface.id });
    for (const layer of surface.layers) {
      const context = { layerId: layer.id, surfaceId: surface.id };
      visitEffects(layer.effects, context);
      for (const object of layer.objects ?? [])
        visitEffects(object.effects, context);
    }
  }
};

const listDescriptors = (
  document: EditorDocument | null,
): ProductionMaskDescriptor[] => {
  if (!document) return [];
  const descriptors: ProductionMaskDescriptor[] = [];
  visitProductionMaskEffects(document, (effect, context) => {
    const effectId = String(effect.id || "").trim();
    if (!effectId || !isRecord(effect.payload)) return;
    descriptors.push({
      effectId,
      layerId: context.layerId,
      surfaceId: context.surfaceId,
      payload: normalizePayload(
        effect.payload as unknown as ProductionMaskEffectPayload,
      ),
    });
  });
  return descriptors;
};

const replaceEffectPayload = (
  document: EditorDocument,
  effectId: string,
  payload: ProductionMaskEffectPayload,
): boolean => {
  let replaced = false;
  visitProductionMaskEffects(document, (effect) => {
    if (effect.id !== effectId) return;
    effect.payload = clone(payload) as unknown as Record<string, unknown>;
    effect.capabilityId = POODER_PRODUCTION_MASK_CAPABILITY_ID;
    replaced = true;
  });
  return replaced;
};

export interface ProductionMaskCapabilityExtensionOptions extends ProductionMaskCapabilityOptions {
  id?: string;
}

export class ProductionMaskCapabilityExtension implements ExtensionDefinition {
  id: string;
  metadata = { name: "ProductionMaskCapabilityExtension" };
  activation: ExtensionActivationSpec;

  private document: EditorDocument | null = null;
  private documentController: ProductionMaskDocumentController | null = null;
  private selectedEffectId: string | null = null;
  private previewMaskBySource = new Map<string, string>();
  private pendingPreviewMaskBySource = new Map<string, Promise<string>>();
  private canvasService?: CanvasService;
  private sceneLayoutService?: SceneLayoutService;
  private surfaceFrameService?: SurfaceFrameService;
  private sceneService?: SceneService;
  private sessionService?: SessionService;
  private renderIntentService?: RenderIntentService;
  private objectImageResolver?: ObjectImageResolverService;
  private imageMask?: ImageMaskCapabilityApi;
  private sessionHandle?: SessionHandle<
    ProductionMaskSessionDraft,
    ProductionMaskSessionResult
  >;
  private sessionScene?: SceneHandle;
  private originalSpecs: RenderObjectSpec[] = [];
  private maskSpecs: RenderObjectSpec[] = [];
  private coverSpecs: RenderObjectSpec[] = [];
  private overlaySpecs: RenderObjectSpec[] = [];
  private renderSequence = 0;
  private readonly subscriptions = new SubscriptionBag();
  private readonly events = new TypedEventEmitter<{
    change: ProductionMaskCapabilityChangeEvent;
  }>();
  private readonly capabilityId: string;
  private readonly originalLayerId: string;
  private readonly maskLayerId: string;
  private readonly coverLayerId: string;
  private readonly overlayLayerId: string;

  constructor(options: ProductionMaskCapabilityExtensionOptions = {}) {
    this.id = normalizeProductionMaskLayerId(
      options.id,
      POODER_PRODUCTION_MASK_CAPABILITY_ID,
    );
    this.capabilityId =
      options.capabilityId || POODER_PRODUCTION_MASK_CAPABILITY_ID;
    this.originalLayerId = normalizeProductionMaskLayerId(
      options.layers?.originalLayerId,
      POODER_PRODUCTION_MASK_LAYER_PRESET.original,
    );
    this.maskLayerId = normalizeProductionMaskLayerId(
      options.layers?.maskLayerId,
      POODER_PRODUCTION_MASK_LAYER_PRESET.mask,
    );
    this.coverLayerId = normalizeProductionMaskLayerId(
      options.layers?.coverLayerId,
      POODER_PRODUCTION_MASK_LAYER_PRESET.cover,
    );
    this.overlayLayerId = normalizeProductionMaskLayerId(
      options.layers?.overlayLayerId,
      POODER_PRODUCTION_MASK_LAYER_PRESET.overlay,
    );
    this.activation = {
      after: [IMAGE_MASK_CAPABILITY_ID],
      requiresServices: [
        CANVAS_SERVICE,
        RENDER_INTENT_SERVICE,
        OBJECT_IMAGE_RESOLVER_SERVICE,
        SCENE_SERVICE,
        SCENE_LAYOUT_SERVICE,
        SESSION_SERVICE,
      ],
    };
  }

  activate(context: ExtensionContext): void {
    this.subscriptions.disposeAll();
    this.canvasService =
      context.services.getOrThrow<CanvasService>(CANVAS_SERVICE);
    this.sceneLayoutService =
      context.services.getOrThrow<SceneLayoutService>(SCENE_LAYOUT_SERVICE);
    this.surfaceFrameService = context.services.get<SurfaceFrameService>(
      SURFACE_FRAME_SERVICE,
    );
    this.sceneService =
      context.services.getOrThrow<SceneService>(SCENE_SERVICE);
    this.sessionService =
      context.services.getOrThrow<SessionService>(SESSION_SERVICE);
    this.renderIntentService = context.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    this.objectImageResolver =
      context.services.getOrThrow<ObjectImageResolverService>(
        OBJECT_IMAGE_RESOLVER_SERVICE,
      );
    this.imageMask = context.services
      .get<CapabilityRegistryService>(CAPABILITY_REGISTRY_SERVICE)
      ?.getFacade<ImageMaskCapabilityApi>(IMAGE_MASK_CAPABILITY_ID);

    this.attachLayoutSubscriptions();
    this.subscriptions.add(
      this.sessionService.onDidTerminate((event) => {
        if (event.descriptor.ownerId !== this.id) return;
        this.finalizeTerminatedSession(
          event.descriptor.sessionId,
          event.reason,
        );
      }),
    );
    this.subscriptions.add(
      this.renderIntentService.onDidChange(() => {
        if (this.sessionHandle) this.refresh();
      }),
    );
    this.emitStateChange();
  }

  async deactivate(): Promise<void> {
    await this.sessionHandle?.cancel();
    this.subscriptions.disposeAll();
    this.previewMaskBySource.clear();
    this.pendingPreviewMaskBySource.clear();
    this.clearRenderedMask();
    this.canvasService = undefined;
    this.sceneLayoutService = undefined;
    this.surfaceFrameService = undefined;
    this.sceneService = undefined;
    this.sessionService = undefined;
    this.renderIntentService = undefined;
    this.objectImageResolver = undefined;
    this.imageMask = undefined;
    this.document = null;
    this.documentController = null;
    this.sessionHandle = undefined;
    this.sessionScene = undefined;
    this.events.clear();
  }

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createProductionMaskCapabilityDefinition(this.getFacade(), {
          capabilityId: this.capabilityId,
          layers: {
            originalLayerId: this.originalLayerId,
            maskLayerId: this.maskLayerId,
            coverLayerId: this.coverLayerId,
            overlayLayerId: this.overlayLayerId,
          },
        }),
      ],
      renderIntentCompilers: [this.createRenderIntentCompiler()],
    };
  }

  private createRenderIntentCompiler(): RenderIntentCompilerContribution<
    EditorEffect<ProductionMaskEffectPayload>,
    EditorDocument
  > {
    return {
      capabilityId: this.capabilityId,
      effectType: "production-mask",
      compile: (context) => this.compileDocumentProductionMaskEffect(context),
    };
  }

  private compileDocumentProductionMaskEffect(
    context: RenderIntentCompilerContext<
      EditorEffect<ProductionMaskEffectPayload>,
      EditorDocument
    >,
  ): RenderIntentPatch | void {
    const effectId = String(context.effect.id || "").trim();
    if (!context.effect.payload) return;
    const payload = normalizePayload(context.effect.payload);
    const referenceObjectId = payload.reference.objectId;
    if (!effectId || !referenceObjectId) return;

    return {
      id: referenceObjectId,
      data: {
        [`${PRODUCTION_MASK_BINDING_DATA_PREFIX}:${effectId}`]: {
          effectId,
          payload,
          surfaceId: context.target.surfaceId,
        },
      },
    };
  }

  private syncDocument(
    document: EditorDocument,
    controller: ProductionMaskDocumentController,
  ): void {
    this.document = clone(document);
    this.documentController = controller;
    const descriptors = listDescriptors(this.document);
    if (!descriptors.some((item) => item.effectId === this.selectedEffectId)) {
      this.selectedEffectId = descriptors[0]?.effectId ?? null;
    }
    this.emitStateChange();
    if (this.sessionHandle) void this.refresh();
  }

  private listMasks(): ProductionMaskDescriptor[] {
    return listDescriptors(this.document).map(clone);
  }

  private resolveDescriptor(input: {
    effectId?: string;
    process?: string;
  }): ProductionMaskDescriptor | null {
    const effectId = String(input.effectId || "").trim();
    const process = String(input.process || "").trim();
    const descriptors = this.listMasks();
    return (
      (effectId
        ? descriptors.find((item) => item.effectId === effectId)
        : undefined) ??
      (process
        ? descriptors.find((item) => item.payload.process === process)
        : undefined) ??
      descriptors[0] ??
      null
    );
  }

  private async openSession(input: {
    effectId?: string;
    process?: string;
  }): Promise<ProductionMaskOperationResult> {
    if (!this.document || !this.documentController) {
      return { ok: false, reason: "document-not-bound" };
    }
    if (!this.sessionService || !this.sceneService) {
      return { ok: false, reason: "session-not-active" };
    }
    const descriptor = this.resolveDescriptor(input);
    if (!descriptor) return { ok: false, reason: "effect-not-found" };
    if (!this.getReferenceNode(descriptor)) {
      return { ok: false, reason: "reference-not-found" };
    }
    const sessionId = `${PRODUCTION_MASK_SESSION_CHANNEL}:${descriptor.effectId}`;
    if (
      this.sessionHandle &&
      this.sessionHandle.descriptor.sessionId !== sessionId &&
      this.sessionHandle.phase !== "closed"
    ) {
      return { ok: false, reason: "session-conflict" };
    }
    try {
      this.sessionHandle = await this.sessionService.open<
        ProductionMaskSessionDraft,
        ProductionMaskSessionResult
      >({
        descriptor: {
          sessionId,
          ownerId: this.id,
          scope: {
            surfaceId: descriptor.surfaceId,
            subjectId: descriptor.effectId,
            channel: PRODUCTION_MASK_SESSION_CHANNEL,
            groupId: EDITOR_INTERACTION_SESSION_GROUP_ID,
          },
          interactionMode: "exclusive",
          leavePolicy: "block",
        },
        initialDraft: {
          descriptor: clone(descriptor),
          previewOriginalVisible: true,
          previewOriginalMaskVisible: true,
          previewCurrentMaskVisible: true,
        } satisfies ProductionMaskSessionDraft,
      });
    } catch (error) {
      if (error instanceof SessionConflictError) {
        return { ok: false, reason: "session-conflict" };
      }
      throw error;
    }

    this.selectedEffectId = descriptor.effectId;
    const sessionHandle = this.sessionHandle;
    if (!sessionHandle) return { ok: false, reason: "session-not-active" };
    this.ensureSessionScene(descriptor, sessionId, sessionHandle);
    this.events.emit("change", {
      type: "session-opened",
      event: {
        effectId: descriptor.effectId,
        process: descriptor.payload.process,
        sessionId,
        source: "api",
        surfaceId: descriptor.surfaceId,
      },
    });
    await this.refresh();
    this.emitStateChange();
    return { ok: true };
  }

  private updateDraft(
    update: (draft: ProductionMaskSessionDraft) => ProductionMaskSessionDraft,
  ): ProductionMaskOperationResult {
    const handle = this.sessionHandle;
    if (!handle || handle.phase === "closed") {
      return { ok: false, reason: "session-not-active" };
    }
    handle.updateDraft((draft) => update(clone(draft)));
    handle.setDirty(true);
    this.emitStateChange();
    void this.refresh();
    return { ok: true };
  }

  private setSource(
    resource: EditorImageResource,
  ): ProductionMaskOperationResult {
    const sourceUrl = resourceLocation(resource);
    if (!sourceUrl) return { ok: false, reason: "source-empty" };
    return this.updateDraft((draft) => ({
      ...draft,
      descriptor: {
        ...draft.descriptor,
        payload: {
          ...draft.descriptor.payload,
          enabled: true,
          source: { type: "image-resource", resource: clone(resource) },
        },
      },
    }));
  }

  private useReferenceSource(): ProductionMaskOperationResult {
    return this.updateDraft((draft) => ({
      ...draft,
      descriptor: {
        ...draft.descriptor,
        payload: {
          ...draft.descriptor.payload,
          enabled: true,
          source: { type: "reference-object" },
        },
      },
    }));
  }

  private clearSource(): ProductionMaskOperationResult {
    this.previewMaskBySource.clear();
    this.pendingPreviewMaskBySource.clear();
    return this.updateDraft((draft) => {
      const { source: _source, ...payload } = draft.descriptor.payload;
      return {
        ...draft,
        descriptor: {
          ...draft.descriptor,
          payload: { ...payload, enabled: false },
        },
      };
    });
  }

  private updateAlpha(
    parameters: Partial<ProductionMaskAlphaParameters>,
  ): ProductionMaskOperationResult {
    return this.updateDraft((draft) => ({
      ...draft,
      descriptor: {
        ...draft.descriptor,
        payload: {
          ...draft.descriptor.payload,
          alpha: normalizeAlphaParameters({
            ...draft.descriptor.payload.alpha,
            ...parameters,
          }),
        },
      },
    }));
  }

  private updateEnabled(enabled: boolean): ProductionMaskOperationResult {
    return this.updateDraft((draft) => ({
      ...draft,
      descriptor: {
        ...draft.descriptor,
        payload: { ...draft.descriptor.payload, enabled },
      },
    }));
  }

  private updatePreview(options: {
    originalVisible?: boolean;
    originalMaskVisible?: boolean;
    currentMaskVisible?: boolean;
  }): ProductionMaskOperationResult {
    return this.updateDraft((draft) => ({
      ...draft,
      previewOriginalVisible:
        typeof options.originalVisible === "boolean"
          ? options.originalVisible
          : draft.previewOriginalVisible,
      previewOriginalMaskVisible:
        typeof options.originalMaskVisible === "boolean"
          ? options.originalMaskVisible
          : draft.previewOriginalMaskVisible,
      previewCurrentMaskVisible:
        typeof options.currentMaskVisible === "boolean"
          ? options.currentMaskVisible
          : draft.previewCurrentMaskVisible,
    }));
  }

  private async commitSession(): Promise<ProductionMaskOperationResult> {
    const handle = this.sessionHandle;
    const controller = this.documentController;
    if (!handle || handle.phase === "closed") {
      return { ok: false, reason: "session-not-active" };
    }
    if (!controller) return { ok: false, reason: "document-not-bound" };
    const draft = clone(handle.getDraft());
    const result = await controller.mutate((document) => {
      if (
        !replaceEffectPayload(
          document,
          draft.descriptor.effectId,
          draft.descriptor.payload,
        )
      ) {
        throw new Error("production-mask-effect-not-found");
      }
    });
    if (!result.ok) return { ok: false, reason: "document-update-failed" };
    this.document = clone(result.document);
    await handle.commit();
    return { ok: true };
  }

  private async rollbackSession(): Promise<ProductionMaskOperationResult> {
    const handle = this.sessionHandle;
    if (!handle || handle.phase === "closed") {
      return { ok: false, reason: "session-not-active" };
    }
    await handle.rollback();
    return { ok: true };
  }

  private getViewState(): ProductionMaskViewState {
    const draft = this.sessionHandle?.getDraft() ?? null;
    const descriptor =
      draft?.descriptor ??
      this.resolveDescriptor({ effectId: this.selectedEffectId ?? "" });
    return {
      dirty: this.sessionHandle?.dirty ?? false,
      descriptor: descriptor ? clone(descriptor) : null,
      phase: this.sessionHandle?.phase ?? "idle",
      previewOriginalVisible: draft?.previewOriginalVisible ?? true,
      previewOriginalMaskVisible: draft?.previewOriginalMaskVisible ?? true,
      previewCurrentMaskVisible: draft?.previewCurrentMaskVisible ?? true,
      sessionId: this.sessionHandle?.descriptor.sessionId ?? null,
    };
  }

  private finalizeTerminatedSession(
    sessionId: string,
    reason: "committed" | "rolled-back" | "cancelled",
  ): void {
    if (this.sessionHandle?.descriptor.sessionId !== sessionId) return;
    const effectId = this.sessionHandle.getDraft().descriptor.effectId;
    this.sessionHandle = undefined;
    this.sessionScene = undefined;
    this.clearRenderedMask();
    this.events.emit("change", {
      type: "session-closed",
      event: { effectId, reason, sessionId },
    });
    this.emitStateChange();
  }

  private emitStateChange(): void {
    this.events.emit("change", { type: "state", state: this.getViewState() });
  }

  private attachLayoutSubscriptions(): void {
    const layoutService = this.sceneLayoutService;
    const frameService = this.surfaceFrameService;
    if (!layoutService || !frameService) return;
    const observed = new Set<string>();
    const observe = (surfaceId: string) => {
      if (!surfaceId || observed.has(surfaceId)) return;
      observed.add(surfaceId);
      this.subscriptions.add(
        layoutService.onLayoutChange(surfaceId, () => void this.refresh()),
      );
    };
    frameService.listSurfaceIds().forEach(observe);
    this.subscriptions.add(
      frameService.onAnyFramesChange((event) => observe(event.surfaceId)),
    );
  }

  private ensureSessionScene(
    descriptor: ProductionMaskDescriptor,
    sessionId: string,
    session: SessionHandle<
      ProductionMaskSessionDraft,
      ProductionMaskSessionResult
    >,
  ): void {
    if (!this.sceneService) return;
    const existing = this.sessionScene;
    if (existing && this.sceneService.getSceneHandle(existing.id) === existing)
      return;
    const scene = this.sceneService.createScene({
      id: `${PRODUCTION_MASK_SESSION_SCENE_PREFIX}:${descriptor.effectId}`,
      owner: { type: "session", sessionId },
      composition: {
        entries: [
          ...this.createDocumentProjectionEntries(descriptor, "below"),
          { source: "local", layerIds: [this.originalLayerId] },
          { source: "local", layerIds: [this.coverLayerId] },
          { source: "local", layerIds: [this.maskLayerId] },
          ...this.createDocumentProjectionEntries(descriptor, "above"),
          { source: "local", layerIds: [this.overlayLayerId] },
        ],
      },
    });
    scene.addLayer({ id: this.originalLayerId, order: 0 });
    scene.addLayer({ id: this.coverLayerId, order: 1 });
    scene.addLayer({ id: this.maskLayerId, order: 2 });
    scene.addLayer({ id: this.overlayLayerId, order: 3 });
    session.own(scene);
    this.sessionScene = scene;
  }

  private createDocumentProjectionEntries(
    descriptor: ProductionMaskDescriptor,
    placement: ProductionMaskSessionProjection["placement"],
  ) {
    const referenceObjectId = descriptor.payload.reference.objectId;
    const projections = descriptor.payload.sessionProjections ?? [];
    return projections
      .filter((projection) => projection.placement === placement)
      .map((projection) => {
        const objectIds = (projection.source.objectIds ?? []).filter(
          (objectId) => objectId !== referenceObjectId,
        );
        const tags = projection.source.tags ?? [];
        if (objectIds.length === 0 && tags.length === 0) {
          return null;
        }
        const nextProjection: ProductionMaskSessionProjection = {
          ...projection,
          source: {
            ...(objectIds.length > 0 ? { objectIds } : {}),
            ...(tags.length > 0 ? { tags } : {}),
          },
        };
        return {
          source: "render-graph" as const,
          interaction: "disabled" as const,
          filter: ({ node }: { node: RenderGraphNode }) =>
            this.matchesProjection(descriptor, nextProjection, node),
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          source: "render-graph";
          interaction: "disabled";
          filter: (input: { node: RenderGraphNode }) => boolean;
        } => entry !== null,
      );
  }

  private matchesProjection(
    descriptor: ProductionMaskDescriptor,
    projection: ProductionMaskSessionProjection,
    node: RenderGraphNode,
  ): boolean {
    if (
      projection.surfaceScope !== "all" &&
      node.surfaceId !== descriptor.surfaceId
    )
      return false;
    const objectIds = new Set(projection.source.objectIds ?? []);
    const tags = new Set(projection.source.tags ?? []);
    return (
      objectIds.has(node.subjectId) || node.tags.some((tag) => tags.has(tag))
    );
  }

  private getReferenceNode(
    descriptor: ProductionMaskDescriptor,
  ): RenderGraphNode | null {
    const graph = this.renderIntentService?.getGraph();
    if (!graph) return null;
    return (
      graph.layers
        .flatMap((layer) => layer.nodes)
        .find(
          (node) =>
            node.surfaceId === descriptor.surfaceId &&
            node.subjectId === descriptor.payload.reference.objectId,
        ) ?? null
    );
  }

  private async createReferenceSnapshot(
    descriptor: ProductionMaskDescriptor,
  ): Promise<ImageSnapshot | null> {
    const objectId = descriptor.payload.reference.objectId;
    const referenceNode = this.getReferenceNode(descriptor);
    if (!objectId || !referenceNode || !this.objectImageResolver) return null;
    try {
      // Use the live reference geometry (placement + clip) so original preview
      // and uploaded masks share the same bitmap space as the canvas image.
      // original-resource keeps source pixels 1:1 with placement.localBounds;
      // clipPath effects keep the result inside the frame.
      const resolved = await this.objectImageResolver.resolve({
        objectId,
        representation: "original-resource",
      });
      const effects =
        descriptor.payload.alignment === "reference-source"
          ? []
          : cloneReferenceClipEffects(referenceNode);
      return {
        id: resolved.objectId,
        placement: clone(referenceNode.placement),
        src: resolved.url,
        effects,
      };
    } catch {
      return null;
    }
  }

  private sourceUrl(
    source: ProductionMaskSource | undefined,
    reference: ImageSnapshot,
  ): string {
    if (!source || source.type === "reference-object") return reference.src;
    return resourceLocation(source.resource);
  }

  private maskCacheKey(
    sourceUrl: string,
    alpha: ProductionMaskAlphaParameters,
    tint: MaskTint,
  ): string {
    return `${sourceUrl}::${tint.key}::${JSON.stringify(normalizeAlphaParameters(alpha))}`;
  }

  private async getMaskSource(
    sourceUrl: string,
    alpha: ProductionMaskAlphaParameters,
    tint: MaskTint,
  ): Promise<string> {
    if (!sourceUrl || !this.imageMask) return "";
    const cacheKey = this.maskCacheKey(sourceUrl, alpha, tint);
    const cached = this.previewMaskBySource.get(cacheKey);
    if (cached) return cached;
    const pending = this.pendingPreviewMaskBySource.get(cacheKey);
    if (pending) return await pending;
    const task = this.imageMask
      .extractAlphaMask(sourceUrl, {
        alpha: normalizeAlphaParameters(alpha),
        tint,
      })
      .then((result) => {
        this.previewMaskBySource.set(cacheKey, result.url);
        return result.url;
      })
      .finally(() => this.pendingPreviewMaskBySource.delete(cacheKey));
    this.pendingPreviewMaskBySource.set(cacheKey, task);
    return await task;
  }

  private async generateMask(
    sourceUrl: string,
    options: GenerateProductionMaskOptions,
  ): Promise<string> {
    return await this.getMaskSource(
      sourceUrl,
      normalizeAlphaParameters(options.alpha),
      normalizeTint(options.tint),
    );
  }

  private buildImageSpec(
    id: string,
    snapshot: ImageSnapshot,
    src: string,
    opacity: number,
    layerId: string,
    type: string,
  ): RenderObjectSpec {
    const { width, height } = snapshot.placement.localBounds;
    return {
      id,
      type: "image",
      src,
      placement: createAffinePlacement({
        localBounds: snapshot.placement.localBounds,
        pivot: snapshot.placement.pivot,
        localToScene: snapshot.placement.localToScene,
      }),
      ...(snapshot.effects.length ? { effects: clone(snapshot.effects) } : {}),
      data: { id, imageId: snapshot.id, layerId, type },
      props: {
        // Force fabric create-path to size the bitmap into the reference
        // source's localBounds so uploaded masks share the same geometry.
        width,
        height,
        opacity: normalizeUnitInterval(opacity, DEFAULT_MASK_OPACITY),
        excludeFromExport: true,
      },
    };
  }

  private buildFrameSpecs(frame: FrameRect): RenderObjectSpec[] {
    if (!this.sessionHandle || frame.width <= 0 || frame.height <= 0) return [];
    return [
      {
        id: "production-mask.frame",
        type: "rect",
        data: {
          id: "production-mask.frame",
          layerId: this.overlayLayerId,
          type: "production-mask-frame",
        },
        props: {
          left: frame.left,
          top: frame.top,
          width: frame.width,
          height: frame.height,
          originX: "left",
          originY: "top",
          fill: "rgba(0,0,0,0)",
          stroke: "#808080",
          strokeWidth: this.canvasService?.toSceneLength(2) ?? 2,
          strokeDashArray: [
            this.canvasService?.toSceneLength(8) ?? 8,
            this.canvasService?.toSceneLength(8) ?? 8,
          ],
          excludeFromExport: true,
        },
      },
    ];
  }

  private async refresh(): Promise<void> {
    const draft = this.sessionHandle?.getDraft();
    if (!draft || !this.canvasService) return;
    const sequence = ++this.renderSequence;
    const descriptor = draft.descriptor;
    const reference = await this.createReferenceSnapshot(descriptor);
    if (sequence !== this.renderSequence) return;

    let originalSpecs: RenderObjectSpec[] = [];
    let maskSpecs: RenderObjectSpec[] = [];
    let coverSpecs: RenderObjectSpec[] = [];
    if (reference && draft.previewOriginalVisible) {
      originalSpecs = [
        this.buildImageSpec(
          `production-mask-original:${descriptor.effectId}`,
          reference,
          reference.src,
          1,
          this.originalLayerId,
          "production-mask-original",
        ),
      ];
    }
    if (reference && descriptor.payload.enabled && descriptor.payload.source) {
      const sourceUrl = this.sourceUrl(descriptor.payload.source, reference);
      const tint = normalizeTint(descriptor.payload.preview?.tint);
      if (draft.previewCurrentMaskVisible) {
        const maskSource = await this.getMaskSource(
          sourceUrl,
          descriptor.payload.alpha,
          tint,
        );
        if (sequence !== this.renderSequence) return;
        if (maskSource) {
          maskSpecs = [
            this.buildImageSpec(
              `production-mask:${descriptor.effectId}`,
              reference,
              maskSource,
              descriptor.payload.preview?.opacity ?? DEFAULT_MASK_OPACITY,
              this.maskLayerId,
              descriptor.payload.process,
            ),
          ];
        }
      }
      if (draft.previewOriginalMaskVisible) {
        const coverSource = await this.getMaskSource(
          reference.src,
          normalizeAlphaParameters({
            selection: "opaque",
            mapping: "continuous",
          }),
          COVER_MASK_TINT,
        );
        if (sequence !== this.renderSequence) return;
        if (coverSource) {
          coverSpecs = [
            this.buildImageSpec(
              `production-mask-cover:${descriptor.effectId}`,
              reference,
              coverSource,
              0.38,
              this.coverLayerId,
              "production-mask-cover",
            ),
          ];
        }
      }
    }

    this.originalSpecs = originalSpecs;
    this.maskSpecs = maskSpecs;
    this.coverSpecs = coverSpecs;
    this.overlaySpecs = this.buildFrameSpecs(
      resolveSurfaceFrameRect(this.canvasService, this.sceneLayoutService),
    );
    this.publishSessionScene();
    this.canvasService.requestRenderAll();
  }

  private publishSessionScene(): void {
    const scene = this.sessionScene;
    if (!scene || !this.sessionHandle) return;
    scene
      .selectElements()
      .forEach((element) => scene.removeElement(element.id));
    [
      [this.originalLayerId, this.originalSpecs],
      [this.coverLayerId, this.coverSpecs],
      [this.maskLayerId, this.maskSpecs],
      [this.overlayLayerId, this.overlaySpecs],
    ].forEach(([layerId, specs]) => {
      (specs as RenderObjectSpec[]).forEach((spec, index) => {
        const element = this.renderSpecToSceneElement(
          spec,
          String(layerId),
          index,
        );
        if (element) scene.addElement(element);
      });
    });
  }

  private renderSpecToSceneElement(
    spec: RenderObjectSpec,
    layerId: string,
    order: number,
  ): SceneElementInput | null {
    const props = { ...(spec.props ?? {}) };
    const style = { ...props };
    [
      "visible",
      "left",
      "top",
      "scaleX",
      "scaleY",
      "angle",
      "flipX",
      "flipY",
      "skewX",
      "skewY",
      "originX",
      "originY",
      "width",
      "height",
      "pathData",
      "path",
      "text",
    ].forEach((key) => delete style[key]);
    const transform = {
      ...(Number.isFinite(props.left) ? { left: Number(props.left) } : {}),
      ...(Number.isFinite(props.top) ? { top: Number(props.top) } : {}),
      ...(Number.isFinite(props.scaleX)
        ? { scaleX: Number(props.scaleX) }
        : {}),
      ...(Number.isFinite(props.scaleY)
        ? { scaleY: Number(props.scaleY) }
        : {}),
      ...(Number.isFinite(props.angle) ? { angle: Number(props.angle) } : {}),
      ...(typeof props.flipX === "boolean" ? { flipX: props.flipX } : {}),
      ...(typeof props.flipY === "boolean" ? { flipY: props.flipY } : {}),
      ...(Number.isFinite(props.skewX) ? { skewX: Number(props.skewX) } : {}),
      ...(Number.isFinite(props.skewY) ? { skewY: Number(props.skewY) } : {}),
      ...(props.originX === "left" ||
      props.originX === "center" ||
      props.originX === "right"
        ? { originX: props.originX }
        : {}),
      ...(props.originY === "top" ||
      props.originY === "center" ||
      props.originY === "bottom"
        ? { originY: props.originY }
        : {}),
    };
    const common = {
      id: spec.id,
      layerId,
      order,
      visible: props.visible !== false,
      data: {
        ...(spec.data ?? {}),
        renderSpace: spec.space ?? "scene",
        exportKeys: [spec.id],
      },
      style,
      ...(spec.placement ? { placement: spec.placement } : {}),
      transform,
      effects: spec.effects,
    };
    if (spec.type === "image") {
      return spec.src
        ? {
            ...common,
            type: "image",
            src: spec.src,
            width: Number(props.width) || undefined,
            height: Number(props.height) || undefined,
          }
        : null;
    }
    if (spec.type === "rect") {
      const width = Number(props.width);
      const height = Number(props.height);
      return width > 0 && height > 0
        ? { ...common, type: "rect", width, height }
        : null;
    }
    return null;
  }

  private clearRenderedMask(): void {
    this.originalSpecs = [];
    this.maskSpecs = [];
    this.coverSpecs = [];
    this.overlaySpecs = [];
    this.renderSequence += 1;
    this.sessionScene
      ?.selectElements()
      .forEach((element) => this.sessionScene?.removeElement(element.id));
    this.canvasService?.requestRenderAll();
  }

  private getFacade(): ProductionMaskCapabilityApi {
    return {
      syncDocument: (document, controller) =>
        this.syncDocument(document, controller),
      listMasks: () => this.listMasks(),
      onDidChange: (listener) => this.events.on("change", listener),
      openSession: (input) => this.openSession(input),
      getViewState: () => this.getViewState(),
      setSource: (resource) => this.setSource(resource),
      useReferenceSource: () => this.useReferenceSource(),
      clearSource: () => this.clearSource(),
      updateAlpha: (parameters) => this.updateAlpha(parameters),
      updateEnabled: (enabled) => this.updateEnabled(enabled),
      updatePreview: (options) => this.updatePreview(options),
      commitSession: () => this.commitSession(),
      rollbackSession: () => this.rollbackSession(),
      generateMask: (sourceUrl, options) =>
        this.generateMask(sourceUrl, options),
      refresh: () => this.refresh(),
    };
  }
}

export const createProductionMaskCapability = (
  options?: ProductionMaskCapabilityExtensionOptions,
) => new ProductionMaskCapabilityExtension(options);
