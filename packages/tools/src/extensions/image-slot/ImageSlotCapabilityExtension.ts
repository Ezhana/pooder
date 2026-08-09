import {
  CANVAS_SERVICE,
  GEOMETRY_SOURCE_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_LAYOUT_SERVICE,
  SCENE_SERVICE,
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
  type InteractionOperationPhase,
  type SceneHandle,
  type SceneLayoutService,
  type SceneService,
  type RenderIntentService,
  type SessionHandle,
  type SessionService,
} from "@pooder/core";
import {
  findEditorDocumentObject,
  isEditorVisualObject,
  visitEditorDocumentObjects,
  type EditorDocument,
  type EditorImageObject,
  type EditorImagePlacement,
} from "@pooder/document";
import { getOfficialToolEffectSchema } from "../../document/effect-schemas";
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
  type SessionSceneDecorationContribution,
} from "./capability";

type EditorImageResource = ImageResourceDescriptor;

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
    requiresServices: [GEOMETRY_SOURCE_SERVICE, SCENE_SERVICE, SESSION_SERVICE],
  };
  private document: EditorDocument | null = null;
  private controller: ImageSlotDocumentController | null = null;
  private original: ImageSlotSessionDraft | null = null;
  private state: ImageSlotViewState = { phase: "idle", draft: null };
  private readonly listeners = new Set<(state: ImageSlotViewState) => void>();
  private readonly decorations = new Map<
    string,
    SessionSceneDecorationContribution
  >();
  private sceneService?: SceneService;
  private canvasService?: CanvasService;
  private sceneLayoutService?: SceneLayoutService;
  private geometrySource?: GeometrySourceService;
  private renderIntentService?: RenderIntentService;
  private sessionService?: SessionService;
  private sceneHandle: SceneHandle | null = null;
  private sceneLayoutSubscription: { dispose(): void } | null = null;
  private sessionHandle: SessionHandle<ImageSlotSessionDraft> | null = null;
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
    this.sceneService =
      context.services.getOrThrow<SceneService>(SCENE_SERVICE);
    this.geometrySource = context.services.getOrThrow<GeometrySourceService>(
      GEOMETRY_SOURCE_SERVICE,
    );
    this.renderIntentService = context.services.get<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    this.sessionService =
      context.services.getOrThrow<SessionService>(SESSION_SERVICE);
  }

  async deactivate(): Promise<void> {
    this.disposeScene();
    if (this.sessionHandle && this.sessionHandle.phase !== "closed") {
      await this.sessionHandle.cancel();
    }
    this.sessionHandle = null;
    this.canvasService = undefined;
    this.sceneLayoutService = undefined;
    this.geometrySource = undefined;
    this.sceneService = undefined;
    this.renderIntentService = undefined;
    this.sessionService = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      capabilities: [createImageSlotCapabilityDefinition(this.facade())],
      documentExtensions: [
        {
          id: this.id,
          effects: [getOfficialToolEffectSchema("image-placement")],
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
      this.disposeScene();
      const sessionHandle = this.sessionHandle;
      this.sessionHandle = null;
      if (sessionHandle && sessionHandle.phase !== "closed") {
        void sessionHandle.cancel();
      }
      this.original = null;
      this.setState({ phase: "idle", draft: null });
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
      setResource: (resource, options) => this.setResource(resource, options),
      clearResource: () => this.clearResource(),
      updatePlacement: (partial) => this.updatePlacement(partial),
      applyPlacementPreset: (preset) => this.applyPlacementPreset(preset),
      validateSession: () => this.validateSession(),
      commitSession: () => this.commitSession(),
      rollbackSession: () => this.rollbackSession(),
      registerSessionSceneDecoration: (contribution) => {
        this.decorations.set(contribution.id, contribution);
        this.renderSessionScene();
        return { dispose: () => this.decorations.delete(contribution.id) };
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
    this.original = clone(draft);
    this.setState({ phase: "active", draft });
    this.createSessionScene(context.surfaceId, object);
    return { ok: true };
  }

  private async setResource(
    resource: EditorImageResource,
    options: { placement?: "reset" | "preserve" } = {},
  ) {
    const draft = this.state.draft;
    if (!draft) return { ok: false, reason: "session-not-active" };
    releaseUncommittedResource(
      draft.resource,
      this.original?.resource,
      resource,
    );
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
      draft: { ...draft, resource: clone(resource), placement },
    });
    return { ok: true };
  }

  private async clearResource() {
    const draft = this.state.draft;
    if (!draft) return { ok: false, reason: "session-not-active" };
    releaseUncommittedResource(draft.resource, this.original?.resource);
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
    const source = draft?.resource?.intrinsicSize;
    if (!draft || !context) {
      return { ok: false, reason: "session-not-active" };
    }
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
    const source = draft?.resource?.intrinsicSize;
    const transform = input.transform;
    const phase = input.phase ?? "preview";
    if (!draft || !context || (objectId && objectId !== draft.objectId)) {
      return { ok: false, reason: "session-not-active" };
    }
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
      { renderScene: phase === "commit" },
    );
    this.renderSnapGuides(
      phase === "commit" ? undefined : input.metadata?.rectSnap,
      draft.objectId,
      frame,
    );
    return { ok: true };
  }

  private async validateSession() {
    const draft = this.state.draft;
    if (!draft) return { ok: false as const, reason: "session-not-active" };
    this.setState(
      { ...this.state, phase: "validating" },
      { renderScene: false },
    );
    if (draft.resource && !draft.resource.intrinsicSize) {
      this.setState(
        {
          ...this.state,
          phase: "error",
          error: "resource-load-failed",
        },
        { renderScene: false },
      );
      return { ok: false as const, reason: "resource-load-failed" };
    }
    const policy = this.options.outsideFramePolicy;
    if (
      policy === "strict" &&
      this.document &&
      isDraftOutsideFrame(this.document, draft)
    ) {
      this.setState(
        {
          ...this.state,
          phase: "error",
          error: "validation-failed",
        },
        { renderScene: false },
      );
      return { ok: false as const, reason: "outside-frame" };
    }
    this.setState(
      { ...this.state, phase: "active", error: undefined },
      { renderScene: false },
    );
    return { ok: true as const };
  }

  private async commitSession() {
    const validation = await this.validateSession();
    const draft = this.state.draft;
    if (!validation.ok || !draft || !this.controller)
      return {
        type: "error" as const,
        reason: validation.ok ? "commit-failed" : validation.reason,
      };
    this.setState(
      { ...this.state, phase: "committing" },
      { renderScene: false },
    );
    if (draft.resource?.kind === "blob-url") {
      this.setState(
        { ...this.state, phase: "error", error: "commit-failed" },
        { renderScene: false },
      );
      return { type: "error" as const, reason: "transient-resource" };
    }
    const stableResource = draft.resource as
      | Exclude<ImageResourceDescriptor, { kind: "blob-url" }>
      | undefined;
    const result = await this.controller.mutate((document) => {
      const current = findEditorDocumentObject(document, draft.objectId);
      if (
        !current ||
        !isEditorVisualObject(current) ||
        current.source.kind !== "image" ||
        !("appearance" in current)
      )
        return;
      const previousAssetId = current.source.assetId;
      const assetId = previousAssetId || `${current.id}.image`;
      current.source = stableResource
        ? { kind: "image", assetId }
        : { kind: "image" };
      current.appearance = clone(draft.placement);
      if (stableResource) {
        const { kind, intrinsicSize, mimeType } = stableResource;
        const source =
          kind === "data-url"
            ? { kind, dataUrl: stableResource.dataUrl }
            : { kind, url: stableResource.url };
        const asset = {
          id: assetId,
          type: "image" as const,
          source,
          ...(mimeType ? { mimeType } : {}),
          ...(intrinsicSize ? { intrinsicSize: clone(intrinsicSize) } : {}),
        };
        const assetIndex = document.assets.findIndex(
          (entry) => entry.id === assetId,
        );
        if (assetIndex >= 0) document.assets[assetIndex] = asset;
        else document.assets.push(asset);
      } else if (previousAssetId) {
        const stillReferenced = document.surfaces.some((surface) =>
          surface.layers.some((layer) =>
            layer.objects?.some((object) =>
              objectReferencesAsset(object, previousAssetId),
            ),
          ),
        );
        if (!stillReferenced) {
          document.assets = document.assets.filter(
            (asset) => asset.id !== previousAssetId,
          );
        }
      }
      return document;
    });
    if (!result.ok) {
      this.setState(
        { ...this.state, phase: "error", error: "commit-failed" },
        { renderScene: false },
      );
      return { type: "error" as const, reason: result.reason };
    }
    this.document = result.document;
    this.disposeScene();
    if (this.sessionHandle?.phase === "active") {
      await this.sessionHandle.commit();
    }
    this.sessionHandle = null;
    this.original = null;
    this.setState({ phase: "idle", draft: null });
    return draft.resource
      ? {
          type: "placed" as const,
          objectId: draft.objectId,
          resource: draft.resource,
          placement: draft.placement,
        }
      : { type: "cleared" as const, objectId: draft.objectId };
  }

  private async rollbackSession() {
    if (!this.state.draft) return { ok: false, reason: "session-not-active" };
    releaseUncommittedResource(
      this.state.draft.resource,
      this.original?.resource,
    );
    this.disposeScene();
    if (this.sessionHandle?.phase === "active") {
      await this.sessionHandle.rollback();
    }
    this.sessionHandle = null;
    this.original = null;
    this.setState({ phase: "idle", draft: null });
    return { ok: true };
  }

  private setState(
    state: ImageSlotViewState,
    options: { renderScene?: boolean } = {},
  ): void {
    this.state = clone(state);
    if (this.state.draft && this.sessionHandle?.phase === "active") {
      this.sessionHandle.updateDraft(this.state.draft);
      if (options.renderScene !== false) this.renderSessionScene();
    }
    this.listeners.forEach((listener) => listener(clone(this.state)));
  }

  private createSessionScene(
    surfaceId: string,
    object: EditorImageObject,
  ): void {
    this.disposeScene();
    if (!this.sceneService || !this.sessionHandle) return;
    const sceneId = `image-slot:${object.id}:scene`;
    this.sceneService.getSceneHandle(sceneId)?.dispose();
    const projections = object.slot?.sessionProjections ?? [];
    const renderGraphEntries = (placement: "underlay" | "overlay") =>
      projections
        .filter((projection) => projection.placement === placement)
        .map((projection) => ({
          source: "render-graph" as const,
          interaction: "disabled" as const,
          filter: ({
            node,
          }: {
            node: { subjectId: string; surfaceId: string; tags: string[] };
          }) => {
            if (node.subjectId === object.id) return false;
            if (
              projection.surfaceScope !== "all" &&
              node.surfaceId !== surfaceId
            )
              return false;
            return (
              projection.source.objectIds?.includes(node.subjectId) === true ||
              node.tags.some(
                (tag) => projection.source.tags?.includes(tag) === true,
              )
            );
          },
        }));
    this.sceneHandle = this.sceneService.createScene({
      id: sceneId,
      owner: {
        type: "session",
        sessionId: this.sessionHandle.descriptor.sessionId,
      },
      composition: {
        entries: [
          ...renderGraphEntries("underlay"),
          { source: "local", layerIds: ["image-slot.underlay"] },
          { source: "local", layerIds: ["image-slot.working"] },
          ...renderGraphEntries("overlay"),
          { source: "local", layerIds: ["image-slot.overlay"] },
          { source: "local", layerIds: ["image-slot.controls"] },
        ],
      },
    });
    ["underlay", "working", "overlay", "controls"].forEach((name, order) =>
      this.sceneHandle?.addLayer({
        id: `image-slot.${name}`,
        order,
        visible: true,
      }),
    );
    this.sceneLayoutSubscription =
      this.sceneLayoutService?.onLayoutChange(surfaceId, () =>
        this.renderSessionScene(),
      ) ?? null;
    this.renderSessionScene();
  }

  private renderSessionScene(): void {
    const scene = this.sceneHandle;
    const draft = this.state.draft;
    if (!scene || !draft || !this.document) return;
    scene
      .selectElements()
      .forEach((element) => scene.removeElement(element.id));
    const context = findImageSlotContext(this.document, draft.objectId);
    if (!context) return;
    const resource = draft.resource;
    if (resource?.intrinsicSize) {
      const src = resourceLocation(resource);
      const objectPlacement = this.resolveDocumentObjectPlacement(
        draft.objectId,
      );
      if (!objectPlacement) return;
      const objectSceneBounds = transformCoordinateRect(
        objectPlacement.localToScene,
        objectPlacement.localBounds,
      );
      const clipFrame = resolveImageSlotClipFrame(
        this.document,
        context,
        objectPlacement,
      );
      const geometry = resolveImageGeometry({
        source: { src, size: resource.intrinsicSize },
        frame: coordinateRect("object-local", {
          left: 0,
          top: 0,
          width: context.object.placement.localBounds.width,
          height: context.object.placement.localBounds.height,
        }),
        fit: draft.placement.fit,
        transform: draft.placement,
        ...(draft.placement.clip === "frame"
          ? {
              clip: clipFrame,
            }
          : {}),
      });
      scene.addElement({
        id: `image-slot:${draft.objectId}:working`,
        layerId: "image-slot.working",
        type: "image",
        renderGraphProjection: {
          subjectId: draft.objectId,
          type: "image",
        },
        src,
        width: geometry.imageLocalBounds.width,
        height: geometry.imageLocalBounds.height,
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
        data: {
          autoFocus: true,
          imageSlotObjectId: draft.objectId,
        },
        style: {
          opacity: geometry.opacity,
        },
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
              constraints: [
                {
                  spec: {
                    type: "rect.snap",
                    application: {
                      preview: "evaluate",
                      commit: "apply",
                    },
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
              action: createImageSlotPlacementAction(draft.objectId),
            },
            rotate: {
              enabled: true,
              action: createImageSlotPlacementAction(draft.objectId),
            },
          },
        },
      });
    }
    this.renderSessionFrame(scene, draft.objectId, context.surfaceId);
    for (const contribution of this.decorations.values()) {
      contribution
        .provide({ objectId: draft.objectId, surfaceId: context.surfaceId })
        .forEach((element) =>
          scene.addElement({
            ...element,
            layerId: `image-slot.${contribution.placement}`,
          }),
        );
    }
  }

  private resolveDocumentObjectPlacement(
    objectId: string,
  ): AffinePlacement | undefined {
    for (const layer of this.renderIntentService?.getGraph().layers ?? []) {
      const node = layer.nodes.find(
        (candidate) => candidate.subjectId === objectId,
      );
      if (!node) continue;
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
    return undefined;
  }

  private renderSessionFrame(
    scene: SceneHandle,
    objectId: string,
    surfaceId: string,
  ): void {
    const viewport = this.canvasService?.getScreenViewportRect();
    const cutRect = this.sceneLayoutService?.getLayout(surfaceId)?.cutRect;
    if (!viewport || !cutRect) return;

    scene.addElement({
      id: `image-slot:${objectId}:crop-mask`,
      layerId: "image-slot.controls",
      type: "path",
      path: buildViewportMaskPath(viewport, cutRect),
      data: {
        imageSlotObjectId: objectId,
        renderSpace: "screen",
        type: "image-slot-crop-mask",
      },
      transform: {
        left: viewport.left,
        top: viewport.top,
        originX: "left",
        originY: "top",
      },
      style: {
        excludeFromExport: true,
        fill: "rgba(245, 245, 245, 0.72)",
        fillRule: "evenodd",
        objectCaching: false,
        stroke: null,
      },
    });
    scene.addElement({
      id: `image-slot:${objectId}:crop-frame`,
      layerId: "image-slot.controls",
      type: "rect",
      width: cutRect.width,
      height: cutRect.height,
      data: {
        imageSlotObjectId: objectId,
        renderSpace: "screen",
        type: "image-slot-crop-frame",
      },
      transform: {
        left: cutRect.left,
        top: cutRect.top,
        originX: "left",
        originY: "top",
      },
      style: {
        excludeFromExport: true,
        fill: "rgba(0, 0, 0, 0)",
        stroke: "rgba(80, 80, 80, 0.9)",
        strokeDashArray: [8, 8],
        strokeUniform: true,
        strokeWidth: 1,
      },
    });
  }

  private renderSnapGuides(
    snap: ImageSlotRectSnapFeedback | undefined,
    objectId: string,
    frame: { x: number; y: number; width: number; height: number },
  ): void {
    const scene = this.sceneHandle;
    if (!scene) return;
    scene
      .selectElements({ layerIds: ["image-slot.controls"] })
      .filter((element) => element.data?.type === "image-slot-snap-guide")
      .forEach((element) => scene.removeElement(element.id));

    const guides = Array.isArray(snap?.guides) ? snap.guides : [];
    const vertical = guides.find(
      (guide) => guide.axis === "x" && Number.isFinite(guide.position),
    );
    const horizontal = guides.find(
      (guide) => guide.axis === "y" && Number.isFinite(guide.position),
    );
    const addGuide = (axis: "x" | "y", position: number) => {
      const vertical = axis === "x";
      scene.addElement({
        id: `image-slot:${objectId}:snap-guide:${axis}`,
        layerId: "image-slot.controls",
        type: "path",
        path: vertical
          ? `M 0 0 L 0 ${frame.height}`
          : `M 0 0 L ${frame.width} 0`,
        data: {
          type: "image-slot-snap-guide",
          imageSlotObjectId: objectId,
        },
        transform: {
          left: vertical ? position : frame.x,
          top: vertical ? frame.y : position,
          originX: "left",
          originY: "top",
        },
        style: {
          excludeFromExport: true,
          fill: null,
          objectCaching: false,
          stroke: "#1677ff",
          strokeUniform: true,
          strokeWidth: 1,
        },
      });
    };
    if (vertical) addGuide("x", Number(vertical.position));
    if (horizontal) addGuide("y", Number(horizontal.position));
  }

  private disposeScene(): void {
    this.sceneLayoutSubscription?.dispose();
    this.sceneLayoutSubscription = null;
    this.sceneHandle?.dispose();
    this.sceneHandle = null;
  }
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
      isEditorVisualObject(object) &&
      object.source.kind === "image" &&
      "appearance" in object &&
      object.slot
    )
      match = object;
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
      isEditorVisualObject(object) &&
      object.source.kind === "image" &&
      "appearance" in object &&
      object.slot
    )
      match = { object, surfaceId: surface.id };
  });
  return match;
}

function toDraft(
  object: EditorImageObject,
  document: EditorDocument,
): ImageSlotSessionDraft {
  const asset = object.source.assetId
    ? document.assets.find((entry) => entry.id === object.source.assetId)
    : undefined;
  return {
    objectId: object.id,
    ...(asset
      ? {
          resource: {
            ...asset.source,
            ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
            ...(asset.intrinsicSize
              ? { intrinsicSize: asset.intrinsicSize }
              : {}),
          },
        }
      : {}),
    placement: clone(object.appearance),
  };
}

function objectReferencesAsset(
  object: import("@pooder/document").EditorObject,
  assetId: string,
): boolean {
  if (isEditorVisualObject(object)) {
    return object.source.kind === "image" && object.source.assetId === assetId;
  }
  return object.children.some((child) => objectReferencesAsset(child, assetId));
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

function releaseUncommittedResource(
  resource: EditorImageResource | undefined,
  committed: EditorImageResource | undefined,
  replacement?: EditorImageResource,
): void {
  if (
    resource?.kind !== "blob-url" ||
    resource.url === resourceLocation(replacement)
  )
    return;
  if (committed?.kind === "blob-url" && committed.url === resource.url) return;
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(resource.url);
  }
}

function resourceLocation(resource: EditorImageResource | undefined): string {
  return resource
    ? resource.kind === "data-url"
      ? resource.dataUrl
      : resource.url
    : "";
}

function isDraftOutsideFrame(
  document: EditorDocument,
  draft: ImageSlotSessionDraft,
): boolean {
  const context = findImageSlotContext(document, draft.objectId);
  const size = draft.resource?.intrinsicSize;
  if (!context || !size) return false;
  const object = context.object;
  const geometry = resolveImageGeometry({
    source: { src: resourceLocation(draft.resource), size },
    frame: coordinateRect("object-local", {
      left: 0,
      top: 0,
      width: object.placement.localBounds.width,
      height: object.placement.localBounds.height,
    }),
    fit: draft.placement.fit,
    transform: draft.placement,
  });
  const imageBounds = transformCoordinateRect(
    geometry.imageLocalToObjectLocal,
    geometry.imageLocalBounds,
  );
  const epsilon = 1e-6;
  return (
    imageBounds.left < -epsilon ||
    imageBounds.top < -epsilon ||
    imageBounds.left + imageBounds.width >
      object.placement.localBounds.width + epsilon ||
    imageBounds.top + imageBounds.height >
      object.placement.localBounds.height + epsilon
  );
}
