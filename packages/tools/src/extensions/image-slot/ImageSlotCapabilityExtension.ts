import {
  CANVAS_SERVICE,
  GEOMETRY_SOURCE_SERVICE,
  IMAGE_RESOURCE_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_LAYOUT_SERVICE,
  SESSION_SERVICE,
  coordinateMatrix,
  coordinateRect,
  createAffinePlacement,
  invertCoordinateMatrix,
  multiplyCoordinateMatrices,
  resolveImageFitScale,
  resolveImageGeometry,
  transformCoordinateRect,
  transformCoordinatePoint,
  type AffinePlacement,
  type Matrix2D,
  type CanvasService,
  type ExtensionContext,
  type ExtensionContributions,
  type ExtensionDefinition,
  type GeometrySourceService,
  type ImageResourceDescriptor,
  type ImageResourceResolution,
  type ImageResourceService,
  type InteractionOperationPhase,
  type SceneLayoutService,
  type RenderGraphNode,
  type RenderIntentDraft,
  type RenderIntentService,
  type SessionRenderContribution,
  type SessionRenderScope,
  type SessionHandle,
  type SessionService,
} from "@pooder/core";
import {
  findEditorDocumentObject,
  setEditorImageObjectSource,
  upsertEditorDocumentAsset,
  visitEditorDocumentObjects,
  type EditorDocument,
  type EditorImageAsset,
  type EditorImageObject,
  type EditorImagePlacement,
  type EditorObject,
} from "@pooder/document";
import {
  IMAGE_SLOT_BEHAVIOR_DEFINITION,
  IMAGE_SLOT_BEHAVIOR_TYPE,
} from "../../document/behavior-schemas";
import {
  IMAGE_SLOT_CAPABILITY_ID,
  IMAGE_SLOT_OPEN_SESSION_COMMAND_ID,
  IMAGE_SLOT_UPDATE_PLACEMENT_COMMAND_ID,
  createImageSlotCapabilityDefinition,
  type ImageSlotCapabilityApi,
  type ImageSlotDocumentController,
  type ImageSlotSessionDraft,
  type ImageSlotPlacementPreset,
  type ImageSlotViewState,
  type SessionRenderDecorationContribution,
} from "./capability";

const DEFAULT_PLACEMENT: EditorImagePlacement = {
  fit: "cover",
  anchorX: 0.5,
  anchorY: 0.5,
  zoom: 1,
  rotation: 0,
  opacity: 1,
  clip: "frame",
};

type ImageSlotOpenSessionResult = { ok: true } | { ok: false; reason: string };

interface ImageSlotCanvasTransformInput {
  objectId?: string;
  phase?: InteractionOperationPhase;
  /** Constraint-resolved absolute matrix supplied by InteractionService. */
  sceneMatrix?: Matrix2D<"object-local", "scene">;
  metadata?: {
    rectSnap?: ImageSlotRectSnapFeedback;
  };
  transform?: {
    centerX?: number;
    centerY?: number;
    rotation?: number;
    scaleX?: number;
    scaleY?: number;
  };
}

interface ImageSlotRectSnapFeedback {
  guides?: Array<{
    axis?: string;
    position?: number;
  }>;
}

export interface ImageSlotCapabilityExtensionOptions {
  outsideFramePolicy?: "free" | "warn" | "strict";
}

export class ImageSlotCapabilityExtension implements ExtensionDefinition {
  readonly id = IMAGE_SLOT_CAPABILITY_ID;
  readonly metadata = { name: "ImageSlotCapabilityExtension" };
  readonly activation = {
    requiresServices: [
      GEOMETRY_SOURCE_SERVICE,
      RENDER_INTENT_SERVICE,
      SESSION_SERVICE,
    ],
  };
  private document: EditorDocument | null = null;
  private controller: ImageSlotDocumentController | null = null;
  private state: ImageSlotViewState = { phase: "idle", draft: null };
  private readonly listeners = new Set<(state: ImageSlotViewState) => void>();
  private readonly decorations = new Map<
    string,
    SessionRenderDecorationContribution
  >();
  private canvasService?: CanvasService;
  private sceneLayoutService?: SceneLayoutService;
  private geometrySource?: GeometrySourceService;
  private renderIntentService?: RenderIntentService;
  private sessionService?: SessionService;
  private sceneLayoutSubscription: { dispose(): void } | null = null;
  private sessionRenderScope: SessionRenderScope | null = null;
  private sessionTerminalSubscription: { dispose(): void } | null = null;
  private snapFeedback: ImageSlotRectSnapFeedback | undefined;
  private sessionHandle: SessionHandle<ImageSlotSessionDraft> | null = null;
  private resolvedAsset: {
    assetId: string;
    resolution: Extract<ImageResourceResolution, { ok: true }>;
  } | null = null;
  private stagedAsset: EditorImageAsset | null = null;
  private getImageResourceService?: () => ImageResourceService | undefined;
  private openingSession: {
    objectId: string;
    promise: Promise<ImageSlotOpenSessionResult>;
  } | null = null;

  constructor(
    private readonly options: ImageSlotCapabilityExtensionOptions = {},
  ) {}

  activate(context: ExtensionContext): void {
    this.canvasService = context.services.get<CanvasService>(CANVAS_SERVICE);
    this.sceneLayoutService =
      context.services.get<SceneLayoutService>(SCENE_LAYOUT_SERVICE);
    this.geometrySource = context.services.getOrThrow<GeometrySourceService>(
      GEOMETRY_SOURCE_SERVICE,
    );
    this.renderIntentService = context.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    this.sessionService =
      context.services.getOrThrow<SessionService>(SESSION_SERVICE);
    this.getImageResourceService = () =>
      context.services.get<ImageResourceService>(IMAGE_RESOURCE_SERVICE);
    this.sessionTerminalSubscription?.dispose();
    this.sessionTerminalSubscription = this.sessionService.onDidTerminate(
      (event) => {
        if (
          event.descriptor.sessionId ===
          this.sessionHandle?.descriptor.sessionId
        ) {
          this.finalizeTerminatedSession();
        }
      },
    );
  }

  async deactivate(): Promise<void> {
    if (this.sessionHandle && this.sessionHandle.phase !== "closed") {
      await this.sessionHandle.cancel();
    }
    this.disposeSessionRender();
    this.sessionTerminalSubscription?.dispose();
    this.sessionTerminalSubscription = null;
    this.sessionHandle = null;
    this.canvasService = undefined;
    this.sceneLayoutService = undefined;
    this.geometrySource = undefined;
    this.renderIntentService = undefined;
    this.sessionService = undefined;
    this.getImageResourceService = undefined;
    this.resolvedAsset = null;
    this.stagedAsset = null;
  }

  contribute(): ExtensionContributions {
    return {
      capabilities: [createImageSlotCapabilityDefinition(this.facade())],
      documentExtensions: [
        {
          id: this.id,
          behaviors: [IMAGE_SLOT_BEHAVIOR_DEFINITION],
        },
      ],
      commands: [
        {
          id: IMAGE_SLOT_OPEN_SESSION_COMMAND_ID,
          command: IMAGE_SLOT_OPEN_SESSION_COMMAND_ID,
          title: "Open Image Slot",
          handler: (input: { objectId?: string; subjectId?: string } = {}) =>
            this.openSession({
              objectId: String(input.objectId || input.subjectId || ""),
            }),
        },
        {
          id: IMAGE_SLOT_UPDATE_PLACEMENT_COMMAND_ID,
          command: IMAGE_SLOT_UPDATE_PLACEMENT_COMMAND_ID,
          title: "Update Image Slot Placement",
          handler: (input: ImageSlotCanvasTransformInput = {}) =>
            this.updatePlacementFromCanvas(input),
        },
      ],
    };
  }

  bindDocument(
    document: EditorDocument,
    controller: ImageSlotDocumentController,
  ): void {
    this.document = document;
    this.controller = controller;
    if (
      this.state.draft &&
      !findImageSlot(document, this.state.draft.objectId)
    ) {
      const sessionHandle = this.sessionHandle;
      this.state = { phase: "idle", draft: null };
      this.listeners.forEach((listener) => listener(clone(this.state)));
      if (sessionHandle && sessionHandle.phase !== "closed") {
        void sessionHandle.cancel().catch(() => {
          if (this.sessionHandle === sessionHandle) {
            this.finalizeTerminatedSession();
          }
        });
      } else {
        this.finalizeTerminatedSession();
      }
    }
  }

  private facade(): ImageSlotCapabilityApi {
    return {
      syncDocument: (document, controller) =>
        this.bindDocument(document, controller),
      openSession: (input) => this.openSession(input),
      getViewState: () => clone(this.state),
      onDidChange: (listener) => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      },
      setAsset: (assetId, options) => this.setAsset(assetId, options),
      stageAsset: (asset, options) => this.stageAsset(asset, options),
      clearResource: () => this.clearResource(),
      updatePlacement: (partial) => this.updatePlacement(partial),
      applyPlacementPreset: (preset) => this.applyPlacementPreset(preset),
      validateSession: () => this.validateSession(),
      commitSession: () => this.commitSession(),
      rollbackSession: () => this.rollbackSession(),
      registerSessionRenderDecoration: (contribution) => {
        this.decorations.set(contribution.id, contribution);
        this.publishSessionRenderContributions();
        return {
          dispose: () => {
            this.decorations.delete(contribution.id);
            this.publishSessionRenderContributions();
          },
        };
      },
    };
  }

  private openSession(input: {
    objectId: string;
  }): Promise<ImageSlotOpenSessionResult> {
    const objectId = String(input.objectId || "").trim();
    if (
      this.state.draft?.objectId === objectId &&
      this.sessionHandle?.phase === "active"
    ) {
      return Promise.resolve({ ok: true });
    }
    if (this.openingSession) {
      return this.openingSession.objectId === objectId
        ? this.openingSession.promise
        : Promise.resolve({ ok: false, reason: "session-owner-conflict" });
    }
    const promise = this.openSessionInternal(objectId);
    this.openingSession = { objectId, promise };
    return promise.then(
      (result) => {
        if (this.openingSession?.promise === promise) {
          this.openingSession = null;
        }
        return result;
      },
      (error) => {
        if (this.openingSession?.promise === promise) {
          this.openingSession = null;
        }
        throw error;
      },
    );
  }

  private async openSessionInternal(
    objectId: string,
  ): Promise<ImageSlotOpenSessionResult> {
    const context = this.document
      ? findImageSlotContext(this.document, objectId)
      : null;
    const object = context?.object;
    if (!object || !context)
      return { ok: false as const, reason: "not-image-slot" };
    if (
      this.state.phase !== "idle" &&
      this.state.draft?.objectId !== objectId
    ) {
      return { ok: false as const, reason: "session-owner-conflict" };
    }
    if (!this.resolveDocumentObjectPlacement(objectId)) {
      return { ok: false as const, reason: "geometry-unavailable" };
    }
    const draft = toDraft(object, this.document!);
    this.stagedAsset = null;
    if (draft.assetId) {
      const resolved = await this.resolveAsset(draft.assetId);
      if (!resolved.ok) {
        this.resolvedAsset = null;
      }
    } else {
      this.resolvedAsset = null;
    }
    const sessionId = `image-slot:${objectId}`;
    try {
      this.sessionHandle =
        this.sessionService?.getHandle<ImageSlotSessionDraft>(sessionId) ??
        (await this.sessionService?.open<ImageSlotSessionDraft>({
          descriptor: {
            sessionId,
            ownerId: IMAGE_SLOT_CAPABILITY_ID,
            scope: {
              channel: "image-slot",
              groupId: IMAGE_SLOT_CAPABILITY_ID,
              subjectId: objectId,
              surfaceId: context.surfaceId,
            },
            interactionMode: "exclusive",
            leavePolicy: "block",
          },
          initialDraft: draft,
        })) ??
        null;
    } catch {
      return { ok: false as const, reason: "session-owner-conflict" };
    }
    this.setState({ phase: "active", draft });
    this.startSessionRender(context.surfaceId);
    return { ok: true };
  }

  private async setAsset(
    assetId: string,
    options: { placement?: "reset" | "preserve" } = {},
  ) {
    const draft = this.state.draft;
    if (!draft) return { ok: false, reason: "session-not-active" };
    const normalizedAssetId = String(assetId || "").trim();
    if (!normalizedAssetId) return { ok: false, reason: "asset-id-required" };
    const resolved = await this.resolveAsset(normalizedAssetId);
    if (!resolved.ok) return { ok: false, reason: "resource-load-failed" };
    this.stagedAsset = null;
    this.updateDraftAsset(normalizedAssetId, options);
    return { ok: true };
  }

  private async stageAsset(
    asset: EditorImageAsset,
    options: { placement?: "reset" | "preserve" } = {},
  ) {
    const draft = this.state.draft;
    if (!draft) return { ok: false, reason: "session-not-active" };
    const stagedAsset = clone(asset);
    const assetId = String(stagedAsset.id || "").trim();
    if (!assetId) return { ok: false, reason: "asset-id-required" };
    const resolved = await this.resolveImageAsset(stagedAsset);
    if (!resolved.ok) return { ok: false, reason: "resource-load-failed" };
    this.stagedAsset = stagedAsset;
    this.updateDraftAsset(assetId, options);
    return { ok: true };
  }

  private updateDraftAsset(
    assetId: string,
    options: { placement?: "reset" | "preserve" },
  ): void {
    const draft = this.state.draft;
    if (!draft) return;
    const placement =
      options.placement === "preserve"
        ? draft.placement
        : {
            ...DEFAULT_PLACEMENT,
            fit: draft.placement.fit,
            clip: draft.placement.clip,
          };
    this.setState({
      phase: "active",
      draft: { ...draft, assetId, placement },
    });
  }

  private async clearResource() {
    const draft = this.state.draft;
    if (!draft) return { ok: false, reason: "session-not-active" };
    this.resolvedAsset = null;
    this.stagedAsset = null;
    this.setState({
      phase: "active",
      draft: { objectId: draft.objectId, placement: draft.placement },
    });
    return { ok: true };
  }

  private updatePlacement(partial: Partial<EditorImagePlacement>) {
    const draft = this.state.draft;
    if (!draft) return { ok: false, reason: "session-not-active" };
    const next = normalizePlacement({ ...draft.placement, ...partial });
    this.setState({ phase: "active", draft: { ...draft, placement: next } });
    return { ok: true };
  }

  private applyPlacementPreset(preset: ImageSlotPlacementPreset) {
    const draft = this.state.draft;
    const context =
      draft && this.document
        ? findImageSlotContext(this.document, draft.objectId)
        : null;
    if (!draft || !context) {
      return { ok: false, reason: "session-not-active" };
    }
    const source = this.resolveDraftImage(draft)?.resolution;
    if (!source) return { ok: false, reason: "resource-load-failed" };
    const frame = context.object.placement.localBounds;
    const widthScale = frame.width / Math.max(source.width, 1);
    const heightScale = frame.height / Math.max(source.height, 1);
    const absoluteScale =
      preset === "cover"
        ? Math.max(widthScale, heightScale)
        : preset === "contain"
          ? Math.min(widthScale, heightScale)
          : preset === "maximizeHeight"
            ? heightScale
            : widthScale;
    const baseScale = resolveImageFitScale(
      frame,
      source,
      draft.placement.fit,
    ).x;
    const placement = normalizePlacement({
      ...draft.placement,
      anchorX: 0.5,
      anchorY: 0.5,
      zoom: absoluteScale / Math.max(baseScale, 0.0001),
    });
    this.setState({ phase: "active", draft: { ...draft, placement } });
    return { ok: true };
  }

  private updatePlacementFromCanvas(input: ImageSlotCanvasTransformInput) {
    const draft = this.state.draft;
    const objectId = String(input.objectId || "").trim();
    const context =
      draft && this.document
        ? findImageSlotContext(this.document, draft.objectId)
        : null;
    const transform = input.transform;
    const phase = input.phase ?? "preview";
    if (!draft || !context || (objectId && objectId !== draft.objectId)) {
      return { ok: false, reason: "session-not-active" };
    }
    const source = this.resolveDraftImage(draft)?.resolution;
    if (!source || (!transform && !input.sceneMatrix)) {
      return { ok: false, reason: "resource-load-failed" };
    }
    const frame = context.object.placement.localBounds;
    const objectPlacement = this.resolveDocumentObjectPlacement(draft.objectId);
    if (!objectPlacement) {
      return { ok: false, reason: "geometry-unavailable" };
    }
    const imageLocalToObjectLocal = input.sceneMatrix
      ? multiplyCoordinateMatrices(
          invertCoordinateMatrix(objectPlacement.localToScene),
          input.sceneMatrix,
        )
      : undefined;
    const fitScale = resolveImageFitScale(frame, source, draft.placement.fit);
    const matrixValues = imageLocalToObjectLocal?.values;
    const resolvedScaleX = matrixValues
      ? Math.hypot(matrixValues[0], matrixValues[1])
      : Number(transform?.scaleX);
    const resolvedScaleY = matrixValues
      ? Math.hypot(matrixValues[2], matrixValues[3])
      : Number(transform?.scaleY);
    const zoomCandidates = [
      resolvedScaleX / Math.max(Math.abs(fitScale.x), 0.0001),
      resolvedScaleY / Math.max(Math.abs(fitScale.y), 0.0001),
    ].filter((value) => Number.isFinite(value) && value > 0);
    const zoom = zoomCandidates.length
      ? zoomCandidates.reduce((total, value) => total + value, 0) /
        zoomCandidates.length
      : draft.placement.zoom;
    const imageCenter = {
      space: "object-local" as const,
      x: source.width / 2,
      y: source.height / 2,
    };
    const localCenter = imageLocalToObjectLocal
      ? transformCoordinatePoint(imageLocalToObjectLocal, imageCenter)
      : transformCoordinatePoint(
          invertCoordinateMatrix(objectPlacement.localToScene),
          {
            space: "scene",
            x: Number(transform?.centerX),
            y: Number(transform?.centerY),
          },
        );
    const rotation = matrixValues
      ? (Math.atan2(matrixValues[1], matrixValues[0]) * 180) / Math.PI
      : Number(transform?.rotation);
    const placement = normalizePlacement({
      ...draft.placement,
      anchorX: localCenter.x / Math.max(frame.width, 1),
      anchorY: localCenter.y / Math.max(frame.height, 1),
      rotation,
      zoom,
    });
    this.setState(
      { phase: "active", draft: { ...draft, placement } },
      { publishRender: false },
    );
    this.snapFeedback =
      phase === "commit" ? undefined : input.metadata?.rectSnap;
    this.publishSessionRenderContributions();
    return { ok: true };
  }

  private async validateSession() {
    const draft = this.state.draft;
    if (!draft) return { ok: false as const, reason: "session-not-active" };
    this.setState(
      { ...this.state, phase: "validating" },
      { publishRender: false },
    );
    if (draft.assetId && !this.resolveDraftImage(draft)) {
      this.setState(
        {
          ...this.state,
          phase: "error",
          error: "resource-load-failed",
        },
        { publishRender: false },
      );
      return { ok: false as const, reason: "resource-load-failed" };
    }
    const policy = this.options.outsideFramePolicy;
    if (
      policy === "strict" &&
      this.document &&
      doesDraftLeaveFrameUncovered(
        this.document,
        draft,
        this.resolveDraftImage(draft)?.resolution,
      )
    ) {
      this.setState(
        {
          ...this.state,
          phase: "error",
          error: "validation-failed",
        },
        { publishRender: false },
      );
      return { ok: false as const, reason: "outside-frame" };
    }
    this.setState(
      { ...this.state, phase: "active", error: undefined },
      { publishRender: false },
    );
    return { ok: true as const };
  }

  private async commitSession() {
    const validation = await this.validateSession();
    const draft = this.state.draft;
    if (!validation.ok || !draft || !this.controller || !this.document)
      return {
        type: "error" as const,
        reason: validation.ok ? "commit-failed" : validation.reason,
      };
    this.setState(
      { ...this.state, phase: "committing" },
      { publishRender: false },
    );
    const stagedAsset =
      draft.assetId && this.stagedAsset?.id === draft.assetId
        ? this.stagedAsset
        : null;
    if (
      draft.assetId &&
      !stagedAsset &&
      !this.document.assets.some((asset) => asset.id === draft.assetId)
    ) {
      this.setState(
        { ...this.state, phase: "error", error: "commit-failed" },
        { publishRender: false },
      );
      return { type: "error" as const, reason: "asset-not-found" };
    }
    const result = await this.controller.mutate((document) => {
      if (stagedAsset) upsertEditorDocumentAsset(document, stagedAsset);
      const current = findEditorDocumentObject(document, draft.objectId);
      if (!current || current.type !== "image") return;
      setEditorImageObjectSource(
        document,
        current.id,
        draft.assetId ? { kind: "asset", assetId: draft.assetId } : null,
      );
      current.appearance = clone(draft.placement);
      return document;
    });
    if (!result.ok) {
      this.setState(
        { ...this.state, phase: "error", error: "commit-failed" },
        { publishRender: false },
      );
      return { type: "error" as const, reason: result.reason };
    }
    this.document = result.document;
    if (this.sessionHandle?.phase === "active") {
      await this.sessionHandle.commit();
    } else {
      this.finalizeTerminatedSession();
    }
    return draft.assetId
      ? {
          type: "placed" as const,
          objectId: draft.objectId,
          assetId: draft.assetId,
          placement: draft.placement,
        }
      : { type: "cleared" as const, objectId: draft.objectId };
  }

  private async rollbackSession() {
    if (!this.state.draft) return { ok: false, reason: "session-not-active" };
    if (this.sessionHandle?.phase === "active") {
      await this.sessionHandle.rollback();
    } else {
      this.finalizeTerminatedSession();
    }
    return { ok: true };
  }

  private setState(
    state: ImageSlotViewState,
    options: { publishRender?: boolean } = {},
  ): void {
    this.state = clone(state);
    if (this.state.draft && this.sessionHandle?.phase === "active") {
      this.sessionHandle.updateDraft(this.state.draft);
      if (options.publishRender !== false) {
        this.publishSessionRenderContributions();
      }
    }
    this.listeners.forEach((listener) => listener(clone(this.state)));
  }

  private startSessionRender(surfaceId: string): void {
    this.disposeSessionRender();
    if (!this.sessionHandle || !this.renderIntentService) return;
    const scope = this.renderIntentService.createSessionRenderScope(
      this.sessionHandle.descriptor.sessionId,
    );
    this.sessionRenderScope = this.sessionHandle.own(scope);
    this.sceneLayoutSubscription =
      this.sceneLayoutService?.onLayoutChange(surfaceId, () =>
        this.publishSessionRenderContributions(),
      ) ?? null;
    this.publishSessionRenderContributions();
  }

  private publishSessionRenderContributions(): void {
    const scope = this.sessionRenderScope;
    const session = this.sessionHandle;
    const draft = this.state.draft;
    if (!scope || !session || !draft || !this.document) return;
    const context = findImageSlotContext(this.document, draft.objectId);
    const target = this.resolveDocumentObjectProjection(draft.objectId);
    if (!context || !target) {
      scope.replace([]);
      return;
    }
    const contributions: SessionRenderContribution[] = [];
    const workingProjection = this.createWorkingProjection(
      draft,
      context,
      target,
    );
    contributions.push({
      role: "override",
      sessionId: session.descriptor.sessionId,
      subjectId: draft.objectId,
      surfaceId: context.surfaceId,
      provenance: `${IMAGE_SLOT_CAPABILITY_ID}:working-image`,
      priority: 100,
      replacementTarget: {
        subjectId: draft.objectId,
        projectionId: target.id,
      },
      projection: workingProjection,
    });
    contributions.push(
      ...this.createSessionFrameContributions(
        session.descriptor.sessionId,
        draft.objectId,
        context.surfaceId,
        target,
      ),
      ...this.createSnapGuideContributions(
        session.descriptor.sessionId,
        draft.objectId,
        context.surfaceId,
        target,
      ),
    );
    for (const decoration of this.decorations.values()) {
      decoration
        .provide({ objectId: draft.objectId, surfaceId: context.surfaceId })
        .forEach((contribution) =>
          contributions.push({
            ...contribution,
            role: "auxiliary",
            sessionId: session.descriptor.sessionId,
          }),
        );
    }
    scope.replace(contributions);
  }

  private createWorkingProjection(
    draft: ImageSlotSessionDraft,
    context: ReturnType<typeof findImageSlotContext> & {},
    target: RenderGraphNode,
  ): RenderIntentDraft {
    const base: RenderIntentDraft = {
      id: `image-slot:${draft.objectId}:working`,
      subject: {
        kind: "object",
        surfaceId: target.surfaceId,
        layerId: target.layerId,
        objectId: draft.objectId,
        objectType: "image",
      },
      placement: clone(target.placement),
      containerGeometryRef: clone(target.containerGeometryRef),
      ordering: {
        layerId: target.layerId,
        layerOrder: target.sortKey.layerOrder,
        objectOrder: target.sortKey.objectOrder,
        channel: target.sortKey.channel,
        subOrder: target.sortKey.subOrder,
      },
    };
    const resolvedAsset = this.resolveDraftImage(draft);
    if (!resolvedAsset) return base;
    const objectPlacement = this.resolveDocumentObjectPlacement(draft.objectId);
    if (!objectPlacement) return base;
    const { src, width, height } = resolvedAsset.resolution;
    const objectSceneBounds = transformCoordinateRect(
      objectPlacement.localToScene,
      objectPlacement.localBounds,
    );
    const clipFrame = resolveImageSlotClipFrame(
      this.document!,
      context,
      objectPlacement,
    );
    const geometry = resolveImageGeometry({
      source: { src, size: { width, height } },
      frame: coordinateRect("object-local", {
        left: 0,
        top: 0,
        width: context.object.placement.localBounds.width,
        height: context.object.placement.localBounds.height,
      }),
      fit: draft.placement.fit,
      transform: draft.placement,
      ...(draft.placement.clip === "frame" ? { clip: clipFrame } : {}),
    });
    return {
      ...base,
      visual: { type: "image", src },
      placement: createAffinePlacement({
        localBounds: geometry.imageLocalBounds,
        localToScene: multiplyCoordinateMatrices(
          objectPlacement.localToScene,
          geometry.imageLocalToObjectLocal,
        ),
        pivot: {
          x:
            geometry.imageLocalBounds.left +
            geometry.imageLocalBounds.width / 2,
          y:
            geometry.imageLocalBounds.top +
            geometry.imageLocalBounds.height / 2,
        },
      }),
      data: { autoFocus: true, imageSlotObjectId: draft.objectId },
      props: { opacity: geometry.opacity },
      ...(geometry.clip
        ? {
            effects: [
              createImageSlotClipEffect(
                draft.objectId,
                geometry.clip,
                objectPlacement,
              ),
            ],
          }
        : {}),
      interaction: {
        selection: { enabled: true },
        manipulation: {
          move: {
            enabled: true,
            documentMutation: "action-owned",
            constraints: [
              {
                spec: {
                  type: "rect.snap",
                  application: { preview: "evaluate", commit: "apply" },
                  params: {
                    id: `image-slot:${draft.objectId}:frame`,
                    rect: objectSceneBounds,
                    thresholdPx: 6,
                  },
                },
              },
            ],
            action: createImageSlotPlacementAction(draft.objectId),
          },
          resize: {
            enabled: true,
            documentMutation: "action-owned",
            action: createImageSlotPlacementAction(draft.objectId),
          },
          rotate: {
            enabled: true,
            documentMutation: "action-owned",
            action: createImageSlotPlacementAction(draft.objectId),
          },
        },
      },
    };
  }

  private async resolveAsset(
    assetId: string,
  ): Promise<ImageResourceResolution> {
    const asset = this.document?.assets.find(
      (candidate) => candidate.id === assetId && candidate.type === "image",
    );
    if (!asset) return { ok: false, reason: "unsupported" };
    return this.resolveImageAsset(asset);
  }

  private async resolveImageAsset(
    asset: EditorImageAsset,
  ): Promise<ImageResourceResolution> {
    const assetId = asset.id;
    const descriptor: ImageResourceDescriptor = {
      ...asset.source,
      assetId,
      ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
      ...(asset.intrinsicSize ? { intrinsicSize: asset.intrinsicSize } : {}),
    };
    const service = this.getImageResourceService?.();
    const resolution = service
      ? service.read(descriptor) ?? (await service.ensure(descriptor))
      : asset.intrinsicSize
        ? {
            ok: true as const,
            src: resourceLocation(descriptor),
            ...asset.intrinsicSize,
          }
        : { ok: false as const, reason: "unsupported" as const };
    if (resolution.ok) this.resolvedAsset = { assetId, resolution };
    return resolution;
  }

  private resolveDraftImage(draft: ImageSlotSessionDraft) {
    return draft.assetId && this.resolvedAsset?.assetId === draft.assetId
      ? this.resolvedAsset
      : null;
  }

  private resolveDocumentObjectPlacement(
    objectId: string,
  ): AffinePlacement | undefined {
    const node = this.resolveDocumentObjectProjection(objectId);
    if (!node) return undefined;
    const snapshot = this.geometrySource?.getSnapshot(
      node.containerGeometryRef,
    ).value;
    if (!snapshot || snapshot.space !== "object-local") return undefined;
    return createAffinePlacement({
      localBounds: coordinateRect("object-local", snapshot.bounds),
      localToScene: coordinateMatrix(
        "object-local",
        "scene",
        snapshot.localToScene.values,
      ),
      pivot: {
        x: snapshot.bounds.left + snapshot.bounds.width / 2,
        y: snapshot.bounds.top + snapshot.bounds.height / 2,
      },
    });
  }

  private resolveDocumentObjectProjection(
    objectId: string,
  ): RenderGraphNode | undefined {
    return this.renderIntentService
      ?.getDocumentGraph()
      .layers.flatMap((layer) => layer.nodes)
      .find(
        (candidate) =>
          candidate.subjectId === objectId && candidate.type === "image",
      );
  }

  private createSessionFrameContributions(
    sessionId: string,
    objectId: string,
    surfaceId: string,
    target: RenderGraphNode,
  ): SessionRenderContribution[] {
    const canvas = this.canvasService;
    const viewport = canvas?.getScreenViewportRect();
    const objectPlacement = this.resolveDocumentObjectPlacement(objectId);
    if (!canvas || !viewport || !objectPlacement) return [];
    const viewportRect = canvas.toSceneRect(viewport);
    const cutRect = transformCoordinateRect(
      objectPlacement.localToScene,
      objectPlacement.localBounds,
    );
    const controlsLayerId = `session:${sessionId}:controls`;
    const controlsLayerOrder = target.sortKey.layerOrder + 1_000_000;
    const contribution = (
      projection: RenderIntentDraft,
      provenance: string,
    ): SessionRenderContribution => ({
      role: "auxiliary",
      sessionId,
      subjectId: objectId,
      surfaceId,
      provenance,
      priority: 100,
      projection,
    });
    return [
      contribution(
        {
          id: `image-slot:${objectId}:crop-mask`,
          subject: {
            kind: "object",
            surfaceId,
            layerId: controlsLayerId,
            objectId,
          },
          visual: { type: "path" },
          placement: createSceneRectPlacement(viewportRect),
          props: {
            pathData: buildViewportMaskPath(viewportRect, cutRect),
            fill: "rgba(245, 245, 245, 0.72)",
            fillRule: "evenodd",
            objectCaching: false,
            stroke: null,
          },
          data: { imageSlotObjectId: objectId, type: "image-slot-crop-mask" },
          ordering: {
            layerId: controlsLayerId,
            layerOrder: controlsLayerOrder,
            objectOrder: 0,
          },
        },
        `${IMAGE_SLOT_CAPABILITY_ID}:crop-mask`,
      ),
      contribution(
        {
          id: `image-slot:${objectId}:crop-frame`,
          subject: {
            kind: "object",
            surfaceId,
            layerId: controlsLayerId,
            objectId,
          },
          visual: { type: "rect" },
          placement: createSceneRectPlacement(cutRect),
          props: {
            width: cutRect.width,
            height: cutRect.height,
            fill: "rgba(0, 0, 0, 0)",
            stroke: "rgba(80, 80, 80, 0.9)",
            strokeDashArray: [8, 8],
            strokeUniform: true,
            strokeWidth: 1,
          },
          data: { imageSlotObjectId: objectId, type: "image-slot-crop-frame" },
          ordering: {
            layerId: controlsLayerId,
            layerOrder: controlsLayerOrder,
            objectOrder: 1,
          },
        },
        `${IMAGE_SLOT_CAPABILITY_ID}:crop-frame`,
      ),
    ];
  }

  private createSnapGuideContributions(
    sessionId: string,
    objectId: string,
    surfaceId: string,
    target: RenderGraphNode,
  ): SessionRenderContribution[] {
    const placement = this.resolveDocumentObjectPlacement(objectId);
    if (!placement) return [];
    const frame = transformCoordinateRect(
      placement.localToScene,
      placement.localBounds,
    );
    const guides = Array.isArray(this.snapFeedback?.guides)
      ? this.snapFeedback.guides
      : [];
    const vertical = guides.find(
      (guide) => guide.axis === "x" && Number.isFinite(guide.position),
    );
    const horizontal = guides.find(
      (guide) => guide.axis === "y" && Number.isFinite(guide.position),
    );
    const controlsLayerId = `session:${sessionId}:controls`;
    const createGuide = (
      axis: "x" | "y",
      position: number,
    ): SessionRenderContribution => {
      const isVertical = axis === "x";
      const guideRect = {
        left: isVertical ? position : frame.left,
        top: isVertical ? frame.top : position,
        width: isVertical ? 0 : frame.width,
        height: isVertical ? frame.height : 0,
      };
      return {
        role: "auxiliary",
        sessionId,
        subjectId: objectId,
        surfaceId,
        provenance: `${IMAGE_SLOT_CAPABILITY_ID}:snap-guide`,
        priority: 110,
        projection: {
          id: `image-slot:${objectId}:snap-guide:${axis}`,
          subject: {
            kind: "object",
            surfaceId,
            layerId: controlsLayerId,
            objectId,
          },
          visual: { type: "path" },
          placement: createSceneRectPlacement(guideRect),
          props: {
            pathData: isVertical
              ? `M 0 0 L 0 ${frame.height}`
              : `M 0 0 L ${frame.width} 0`,
            fill: null,
            objectCaching: false,
            stroke: "#1677ff",
            strokeUniform: true,
            strokeWidth: 1,
          },
          data: {
            type: "image-slot-snap-guide",
            imageSlotObjectId: objectId,
          },
          ordering: {
            layerId: controlsLayerId,
            layerOrder: target.sortKey.layerOrder + 1_000_000,
            objectOrder: 10,
            subOrder: axis === "x" ? 0 : 1,
          },
        },
      };
    };
    return [
      ...(vertical ? [createGuide("x", Number(vertical.position))] : []),
      ...(horizontal ? [createGuide("y", Number(horizontal.position))] : []),
    ];
  }

  private disposeSessionRender(): void {
    this.sceneLayoutSubscription?.dispose();
    this.sceneLayoutSubscription = null;
    this.snapFeedback = undefined;
    this.sessionRenderScope?.dispose();
    this.sessionRenderScope = null;
  }

  private finalizeTerminatedSession(): void {
    this.disposeSessionRender();
    this.sessionHandle = null;
    this.resolvedAsset = null;
    this.stagedAsset = null;
    this.state = { phase: "idle", draft: null };
    this.listeners.forEach((listener) => listener(clone(this.state)));
  }
}

function createSceneRectPlacement(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): AffinePlacement {
  return createAffinePlacement({
    localBounds: coordinateRect("object-local", {
      left: 0,
      top: 0,
      width: rect.width,
      height: rect.height,
    }),
    localToScene: coordinateMatrix("object-local", "scene", [
      1,
      0,
      0,
      1,
      rect.left,
      rect.top,
    ]),
    pivot: { x: rect.width / 2, y: rect.height / 2 },
  });
}

function buildViewportMaskPath(
  viewport: { left: number; top: number; width: number; height: number },
  cutRect: { left: number; top: number; width: number; height: number },
): string {
  const cutLeft = cutRect.left - viewport.left;
  const cutTop = cutRect.top - viewport.top;
  return [
    buildRectPath(0, 0, viewport.width, viewport.height),
    buildRectPath(cutLeft, cutTop, cutRect.width, cutRect.height),
  ].join(" ");
}

function buildRectPath(
  left: number,
  top: number,
  width: number,
  height: number,
): string {
  return `M ${left} ${top} L ${left + width} ${top} L ${left + width} ${
    top + height
  } L ${left} ${top + height} Z`;
}

function createImageSlotPlacementAction(objectId: string) {
  return {
    commandId: IMAGE_SLOT_UPDATE_PLACEMENT_COMMAND_ID,
    payload: { objectId },
  };
}

function createImageSlotClipEffect(
  objectId: string,
  frame: import("@pooder/core").CoordinateRect<"object-local">,
  objectPlacement: AffinePlacement,
) {
  return {
    type: "clipPath" as const,
    id: `image-slot:${objectId}:clip`,
    coordinateMode: "absolute" as const,
    source: {
      id: `image-slot:${objectId}:clip-source`,
      type: "rect" as const,
      space: "scene" as const,
      placement: createAffinePlacement({
        localBounds: frame,
        localToScene: objectPlacement.localToScene,
        pivot: {
          x: frame.left + frame.width / 2,
          y: frame.top + frame.height / 2,
        },
      }),
      data: { type: "image-slot-clip", objectId },
      props: {
        fill: "#000000",
        stroke: null,
      },
    },
  };
}

function resolveImageSlotClipFrame(
  document: EditorDocument,
  context: { object: EditorImageObject; surfaceId: string },
  objectPlacement: AffinePlacement,
) {
  const objectFrame = objectPlacement.localBounds;
  const production = document.surfaces.find(
    (surface) => surface.id === context.surfaceId,
  )?.geometry.productionBounds;
  if (!production) return objectFrame;
  const productionInObject = transformCoordinateRect(
    invertCoordinateMatrix(objectPlacement.localToScene),
    coordinateRect("scene", {
      left: production.x,
      top: production.y,
      width: production.width,
      height: production.height,
    }),
  );
  const left = Math.max(objectFrame.left, productionInObject.left);
  const top = Math.max(objectFrame.top, productionInObject.top);
  const right = Math.min(
    objectFrame.left + objectFrame.width,
    productionInObject.left + productionInObject.width,
  );
  const bottom = Math.min(
    objectFrame.top + objectFrame.height,
    productionInObject.top + productionInObject.height,
  );
  return right > left && bottom > top
    ? coordinateRect("object-local", {
        left,
        top,
        width: right - left,
        height: bottom - top,
      })
    : objectFrame;
}

function findImageSlot(
  document: EditorDocument,
  objectId: string,
): EditorImageObject | null {
  let match: EditorImageObject | null = null;
  visitEditorDocumentObjects(document, ({ object }) => {
    if (
      !match &&
      object.id === objectId &&
      object.type === "image" &&
      hasImageSlotBehavior(object)
    )
      match = object as EditorImageObject;
  });
  return match;
}

function findImageSlotContext(
  document: EditorDocument,
  objectId: string,
): { object: EditorImageObject; surfaceId: string } | null {
  let match: { object: EditorImageObject; surfaceId: string } | null = null;
  visitEditorDocumentObjects(document, ({ object, surface }) => {
    if (
      !match &&
      object.id === objectId &&
      object.type === "image" &&
      hasImageSlotBehavior(object)
    )
      match = { object: object as EditorImageObject, surfaceId: surface.id };
  });
  return match;
}

function hasImageSlotBehavior(object: EditorObject): boolean {
  return (
    object.behaviors?.some(
      (behavior) => behavior.type === IMAGE_SLOT_BEHAVIOR_TYPE,
    ) === true
  );
}

function toDraft(
  object: EditorImageObject,
  _document: EditorDocument,
): ImageSlotSessionDraft {
  return {
    objectId: object.id,
    ...(object.source?.kind === "asset"
      ? { assetId: object.source.assetId }
      : {}),
    placement: clone(object.appearance),
  };
}

function normalizePlacement(value: EditorImagePlacement): EditorImagePlacement {
  return {
    fit:
      value.fit === "contain" || value.fit === "stretch" ? value.fit : "cover",
    anchorX: Math.min(
      1,
      Math.max(0, Number.isFinite(value.anchorX) ? value.anchorX : 0.5),
    ),
    anchorY: Math.min(
      1,
      Math.max(0, Number.isFinite(value.anchorY) ? value.anchorY : 0.5),
    ),
    zoom: Number.isFinite(value.zoom) && value.zoom > 0 ? value.zoom : 1,
    rotation: Number.isFinite(value.rotation) ? value.rotation : 0,
    opacity: Number.isFinite(value.opacity)
      ? Math.max(0, Math.min(1, value.opacity))
      : 1,
    clip: value.clip === "none" ? "none" : "frame",
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resourceLocation(
  resource: ImageResourceDescriptor | undefined,
): string {
  return resource
    ? resource.kind === "data-url"
      ? resource.dataUrl
      : resource.url
    : "";
}

function doesDraftLeaveFrameUncovered(
  document: EditorDocument,
  draft: ImageSlotSessionDraft,
  resolution?: Extract<ImageResourceResolution, { ok: true }>,
): boolean {
  const context = findImageSlotContext(document, draft.objectId);
  const size = resolution
    ? { width: resolution.width, height: resolution.height }
    : undefined;
  if (!context || !size) return false;
  const object = context.object;
  const geometry = resolveImageGeometry({
    source: { src: resolution!.src, size },
    frame: coordinateRect("object-local", {
      left: 0,
      top: 0,
      width: object.placement.localBounds.width,
      height: object.placement.localBounds.height,
    }),
    fit: draft.placement.fit,
    transform: draft.placement,
  });
  const objectLocalToImageLocal = invertCoordinateMatrix(
    geometry.imageLocalToObjectLocal,
  );
  const frameWidth = object.placement.localBounds.width;
  const frameHeight = object.placement.localBounds.height;
  const frameCorners = [
    { space: "object-local" as const, x: 0, y: 0 },
    { space: "object-local" as const, x: frameWidth, y: 0 },
    { space: "object-local" as const, x: 0, y: frameHeight },
    {
      space: "object-local" as const,
      x: frameWidth,
      y: frameHeight,
    },
  ];
  const imageBounds = geometry.imageLocalBounds;
  const epsilon = 1e-6;
  return frameCorners.some((corner) => {
    const imagePoint = transformCoordinatePoint(
      objectLocalToImageLocal,
      corner,
    );
    return (
      imagePoint.x < imageBounds.left - epsilon ||
      imagePoint.y < imageBounds.top - epsilon ||
      imagePoint.x > imageBounds.left + imageBounds.width + epsilon ||
      imagePoint.y > imageBounds.top + imageBounds.height + epsilon
    );
  });
}
