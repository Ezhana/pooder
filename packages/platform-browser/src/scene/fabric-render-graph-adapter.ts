import { util } from "fabric";
import {
  GEOMETRY_SOURCE_SERVICE,
  INTERACTION_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_SERVICE,
  SESSION_SERVICE,
  SCENE_LAYOUT_SERVICE,
  SURFACE_FRAME_SERVICE,
  evaluateRuntimeCondition,
  coordinateMatrix,
  multiplyCoordinateMatrices,
  transformCoordinateRect,
  type AffinePlacement,
  type CanvasService,
  type GeometryRect,
  type GeometryRef,
  type GeometrySnapshot,
  type GeometrySourceService,
  type GeometrySource,
  type RenderEffectSpec,
  type RenderGraph,
  type RenderGraphLayer,
  type RenderGraphNode,
  type RenderInvalidation,
  type RenderIntentChangeReason,
  type InteractionManipulationKind,
  type InteractionProjectionPatch,
  type InteractionProjectionTarget,
  type InteractionSubject,
  type InteractionService,
  type InteractionSpec,
  type Matrix2D,
  type RenderObjectSpec,
  type SceneElement,
  type SceneLayer,
  type SceneRecord,
  type SceneSnapshot,
  type SceneChangeCause,
  type SceneChangeSet,
  type SceneService,
  type Service,
  type ServiceContext,
  type RuntimeConditionLayerState,
  type SessionService,
  type RenderIntentService,
  type SceneLayoutService,
  type SurfaceFrameService,
} from "@pooder/core";
import type {
  FabricRenderGraphReconcileOptions,
  FabricRenderTargetItem,
} from "../canvas-service";
import { CANVAS_SERVICE } from "../tokens";

export const RENDER_GRAPH_RENDER_SCOPE = "core-render-graph";
const FABRIC_RENDER_GRAPH_TARGET = "render-graph";
const FABRIC_INTERACTION_PROP_KEYS = new Set([
  "selectable",
  "evented",
  "hasControls",
  "hasBorders",
  "centeredRotation",
  "lockMovementX",
  "lockMovementY",
  "lockRotation",
  "lockScalingFlip",
  "lockScalingX",
  "lockScalingY",
  "lockUniScaling",
]);

export type FabricRenderGraphSyncCause =
  | { type: "initial" }
  | { type: "base-replaced" }
  | { type: "base-updated"; intentIds: string[] }
  | {
      type: "runtime-patch";
      operation: "upsert" | "remove" | "clear";
      sourceId?: string;
      intentIds: string[];
    }
  | {
      type: "runtime-condition";
      operation: "set" | "delete" | "clear";
      keys: string[];
    }
  | { type: "scene-content" }
  | {
      type: "interaction-preview";
      sessionId: string;
      toolId?: string;
    }
  | {
      type: "session-state";
      sessionId: string;
      reason: "opened" | "focus" | "phase" | "terminal";
    }
  | { type: "canvas-resize" }
  | { type: "layout-change"; surfaceId: string }
  | { type: "explicit-refresh" };

export interface FabricRenderGraphSyncState {
  causes: FabricRenderGraphSyncCause[];
  error?: unknown;
  generation: number;
  invalidations: RenderInvalidation[];
  pending: number;
  syncing: boolean;
}

export type FabricRenderGraphSyncStateListener = (
  state: FabricRenderGraphSyncState,
) => void;

type FabricRenderTargetCanvasService = CanvasService & {
  reconcileRenderGraphDrawList(
    items: FabricRenderTargetItem[],
    options?: FabricRenderGraphReconcileOptions,
  ): Promise<void>;
};

export class FabricRenderGraphAdapter implements Service {
  private renderIntentService?: RenderIntentService;
  private sceneService?: SceneService;
  private geometrySource?: GeometrySourceService;
  private interactionService?: InteractionService;
  private canvasService?: FabricRenderTargetCanvasService;
  private sceneLayoutService?: SceneLayoutService;
  private surfaceFrameService?: SurfaceFrameService;
  private sessionService?: SessionService;
  private graphSubscription?: { dispose(): void };
  private sceneSubscription?: { dispose(): void };
  private canvasEventDisposables: Array<{ dispose(): void }> = [];
  private runtimeConditionDisposables: Array<{ dispose(): void }> = [];
  private geometrySourceDisposable?: { dispose(): void };
  private layoutDisposables: Array<{ dispose(): void }> = [];
  private syncRequested = false;
  private syncPromise: Promise<void> | null = null;
  private syncGeneration = 0;
  private syncError: unknown;
  private pendingSyncCauses = new Map<string, FabricRenderGraphSyncCause>();
  private activeSyncCauses = new Map<string, FabricRenderGraphSyncCause>();
  private pendingInvalidations = new Map<string, RenderInvalidation>();
  private activeInvalidations = new Map<string, RenderInvalidation>();
  private renderedRootId: string | null | undefined;
  private interactionSequence = 0;
  private readonly syncStateListeners =
    new Set<FabricRenderGraphSyncStateListener>();
  private activeManipulations = new WeakMap<
    object,
    {
      kind: InteractionManipulationKind;
      sourceFrame: GeometryRect;
      sourceSceneMatrix?: Matrix2D<"object-local", "scene">;
      subject: InteractionSubject;
    }
  >();

  init(context: ServiceContext) {
    this.graphSubscription?.dispose();
    this.sceneSubscription?.dispose();
    this.renderIntentService = context.get(RENDER_INTENT_SERVICE);
    this.sceneService = context.get(SCENE_SERVICE);
    this.geometrySource = context.get(GEOMETRY_SOURCE_SERVICE);
    this.interactionService = context.get(INTERACTION_SERVICE);
    this.canvasService = context.get(CANVAS_SERVICE) as
      | FabricRenderTargetCanvasService
      | undefined;
    this.sceneLayoutService = context.get(SCENE_LAYOUT_SERVICE);
    this.surfaceFrameService = context.get(SURFACE_FRAME_SERVICE);
    this.sessionService = context.get(SESSION_SERVICE);

    if (!this.renderIntentService || !this.canvasService) {
      throw new Error(
        "[FabricRenderGraphAdapter] RenderIntentService and CanvasService are required.",
      );
    }

    this.graphSubscription = this.renderIntentService.onDidChange((event) => {
      if (
        event.reason.type === "base-updated" &&
        event.reason.intentIds.length === 0
      ) {
        return;
      }
      this.requestSync(
        this.toRenderIntentSyncCause(event.reason),
        this.toRenderIntentInvalidations(event.reason),
      );
    });
    this.sceneSubscription = this.sceneService?.onDidChange((event) => {
      this.requestSync(
        event.causes.map((cause) => this.toSceneSyncCause(cause)),
        this.toSceneInvalidations(event),
      );
    });
    this.canvasEventDisposables.forEach((disposable) => disposable.dispose());
    this.canvasEventDisposables = [
      this.canvasService.on("transform", (event) => {
        if (event.kind === "commit") {
          this.markInteractionOwnership(event.target, "committing");
          void this.handleRenderGraphObjectModified(event.target);
          return;
        }
        this.markInteractionOwnership(event.target, "active");
        this.handleRenderGraphObjectManipulating(event.kind, event.target);
      }),
      this.canvasService.on("pointer", (event) => {
        this.handleInteractionActivation(
          event.target,
          event.kind === "double-click" ? "double-click" : "primary-pointer",
        );
      }),
      this.canvasService.on("selection", (event) => {
        this.requireInteractionService().selectSubject(
          event.kind === "cleared"
            ? null
            : this.resolveInteractionSubject(event.target),
        );
      }),
    ];
    this.geometrySourceDisposable = this.geometrySource?.registerSource(
      this.createRenderGraphGeometrySource(),
    );
    this.attachRuntimeConditionEvents();
    this.attachLayoutChangeEvents();
    this.requestSync({ type: "initial" }, { type: "full" });
  }

  dispose() {
    this.detachRuntimeConditionEvents();
    this.detachLayoutChangeEvents();
    this.canvasEventDisposables.forEach((disposable) => disposable.dispose());
    this.canvasEventDisposables = [];
    this.geometrySourceDisposable?.dispose();
    this.graphSubscription?.dispose();
    this.sceneSubscription?.dispose();
    this.graphSubscription = undefined;
    this.sceneSubscription = undefined;
    this.geometrySourceDisposable = undefined;
    this.renderIntentService = undefined;
    this.sceneService = undefined;
    this.geometrySource = undefined;
    this.interactionService = undefined;
    this.canvasService = undefined;
    this.sceneLayoutService = undefined;
    this.surfaceFrameService = undefined;
    this.sessionService = undefined;
    this.syncRequested = false;
    this.syncPromise = null;
    this.pendingSyncCauses.clear();
    this.activeSyncCauses.clear();
    this.pendingInvalidations.clear();
    this.activeInvalidations.clear();
    this.renderedRootId = undefined;
    this.emitSyncState();
    this.syncStateListeners.clear();
  }

  requestSync(
    causes: FabricRenderGraphSyncCause | readonly FabricRenderGraphSyncCause[],
    invalidations: RenderInvalidation | readonly RenderInvalidation[] = {
      type: "full",
    },
  ) {
    const nextCauses = Array.isArray(causes) ? causes : [causes];
    nextCauses.forEach((cause) =>
      this.pendingSyncCauses.set(this.getSyncCauseKey(cause), cause),
    );
    const nextInvalidations = Array.isArray(invalidations)
      ? invalidations
      : [invalidations];
    nextInvalidations.forEach((invalidation) =>
      this.enqueueInvalidation(invalidation),
    );
    this.syncRequested = true;
    this.syncError = undefined;
    this.emitSyncState();
    return this.startSyncLoop();
  }

  private startSyncLoop(): Promise<void> {
    if (this.syncPromise) return this.syncPromise;

    let syncError: unknown;
    this.syncPromise = Promise.resolve()
      .then(() => this.runSyncLoop())
      .catch((error) => {
        syncError = error;
        this.syncError = error;
        console.error("[FabricRenderGraphAdapter] graph sync failed.", error);
      })
      .finally(() => {
        this.syncPromise = null;
        this.activeSyncCauses.clear();
        this.activeInvalidations.clear();
        this.syncError = syncError;
        this.emitSyncState();
        if (this.syncRequested) void this.startSyncLoop();
      });
    return this.syncPromise;
  }

  async flush(): Promise<void> {
    while (this.syncPromise) {
      await this.syncPromise;
    }
  }

  async refresh(): Promise<void> {
    this.requestSync({ type: "explicit-refresh" }, { type: "full" });
    await this.flush();
  }

  getSyncState(): FabricRenderGraphSyncState {
    const causes = this.listSyncCauses();
    const syncing =
      this.syncRequested || Boolean(this.syncPromise) || causes.length > 0;
    return {
      causes,
      ...(this.syncError === undefined ? {} : { error: this.syncError }),
      generation: this.syncGeneration,
      invalidations: this.listInvalidations(),
      pending: causes.length,
      syncing,
    };
  }

  onSyncStateChange(
    listener: FabricRenderGraphSyncStateListener,
    options: { immediate?: boolean } = {},
  ): () => void {
    this.syncStateListeners.add(listener);
    if (options.immediate) {
      listener(this.getSyncState());
    }

    return () => {
      this.syncStateListeners.delete(listener);
    };
  }

  private emitSyncState() {
    const state = this.getSyncState();
    this.syncStateListeners.forEach((listener) => listener(state));
  }

  private listSyncCauses(): FabricRenderGraphSyncCause[] {
    const causes = new Map(this.activeSyncCauses);
    this.pendingSyncCauses.forEach((cause, key) => causes.set(key, cause));
    return Array.from(causes.values());
  }

  private listInvalidations(): RenderInvalidation[] {
    const invalidations = new Map(this.activeInvalidations);
    this.pendingInvalidations.forEach((invalidation, key) =>
      invalidations.set(key, invalidation),
    );
    return Array.from(invalidations.values()).map((invalidation) =>
      this.cloneInvalidation(invalidation),
    );
  }

  private enqueueInvalidation(invalidation: RenderInvalidation): void {
    if (invalidation.type === "full") {
      this.pendingInvalidations.clear();
      this.pendingInvalidations.set("full", { type: "full" });
      return;
    }
    if (this.pendingInvalidations.has("full")) return;
    this.pendingInvalidations.set(
      JSON.stringify(invalidation),
      this.cloneInvalidation(invalidation),
    );
  }

  private cloneInvalidation(
    invalidation: RenderInvalidation,
  ): RenderInvalidation {
    if (invalidation.type === "render-intents") {
      return {
        type: invalidation.type,
        intentIds: [...invalidation.intentIds],
      };
    }
    if (invalidation.type === "scene-elements") {
      return {
        type: invalidation.type,
        sceneId: invalidation.sceneId,
        elementIds: [...invalidation.elementIds],
      };
    }
    return { ...invalidation };
  }

  private getSyncCauseKey(cause: FabricRenderGraphSyncCause): string {
    return JSON.stringify(cause);
  }

  private toRenderIntentSyncCause(
    reason: RenderIntentChangeReason,
  ): FabricRenderGraphSyncCause {
    if (reason.type === "base-replaced") return { type: "base-replaced" };
    if (reason.type === "base-updated") {
      return {
        type: "base-updated",
        intentIds: reason.intentIds.slice(),
      };
    }
    if (reason.type === "runtime-condition") {
      return {
        type: "runtime-condition",
        operation: reason.operation,
        keys: reason.keys.slice(),
      };
    }
    return {
      type: "runtime-patch",
      operation: reason.operation,
      ...(reason.sourceId ? { sourceId: reason.sourceId } : {}),
      intentIds: reason.intentIds.slice(),
    };
  }

  private toRenderIntentInvalidations(
    reason: RenderIntentChangeReason,
  ): RenderInvalidation[] {
    if (reason.type === "base-updated") {
      return reason.intentIds.length
        ? [{ type: "render-intents", intentIds: reason.intentIds.slice() }]
        : [];
    }
    if (reason.type !== "runtime-patch" || !reason.intentIds.length) {
      return [{ type: "full" }];
    }
    return [{ type: "render-intents", intentIds: reason.intentIds.slice() }];
  }

  private toSceneSyncCause(
    cause: SceneChangeCause,
  ): FabricRenderGraphSyncCause {
    return cause.type === "interaction-preview"
      ? {
          type: "interaction-preview",
          sessionId: cause.sessionId,
          ...(cause.toolId ? { toolId: cause.toolId } : {}),
        }
      : { type: "scene-content" };
  }

  private toSceneInvalidations(event: SceneChangeSet): RenderInvalidation[] {
    const sceneStructureChanged = Boolean(
      event.scenes &&
      (event.scenes.added.length ||
        event.scenes.updated.length ||
        event.scenes.removed.length),
    );
    if (sceneStructureChanged) return [{ type: "composition" }];

    const invalidations: RenderInvalidation[] = [];
    Object.entries(event.sceneChanges ?? {}).forEach(([sceneId, change]) => {
      const layersChanged = Boolean(
        change.layers.added.length ||
        change.layers.updated.length ||
        change.layers.removed.length,
      );
      if (layersChanged) {
        invalidations.push({ type: "scene", sceneId });
        return;
      }
      const elementIds = Array.from(
        new Set([
          ...change.elements.added,
          ...change.elements.updated,
          ...change.elements.removed,
        ]),
      );
      if (elementIds.length) {
        invalidations.push({ type: "scene-elements", sceneId, elementIds });
      }
    });
    return invalidations.length ? invalidations : [{ type: "full" }];
  }

  private attachRuntimeConditionEvents() {
    this.detachRuntimeConditionEvents();
    const sessionDisposable = this.sessionService?.onDidChange((event) => {
      if (event.reason !== "opened" && event.reason !== "focus") {
        return;
      }
      this.requestRootSyncIfChanged({
        type: "session-state",
        sessionId: event.snapshot.descriptor.sessionId,
        reason: event.reason,
      });
    });
    const sessionTerminalDisposable = this.sessionService?.onDidTerminate(
      (event) => {
        this.requestRootSyncIfChanged({
          type: "session-state",
          sessionId: event.descriptor.sessionId,
          reason: "terminal",
        });
      },
    );
    const canvasDisposable = this.canvasService?.on("resized", () => {
      this.resetInteractionPreview();
      this.requestSync({ type: "canvas-resize" }, { type: "full" });
    });
    this.runtimeConditionDisposables = [
      ...(sessionDisposable ? [sessionDisposable] : []),
      ...(sessionTerminalDisposable ? [sessionTerminalDisposable] : []),
      ...(canvasDisposable ? [canvasDisposable] : []),
    ];
  }

  private detachRuntimeConditionEvents() {
    this.runtimeConditionDisposables.forEach((disposable) =>
      disposable.dispose(),
    );
    this.runtimeConditionDisposables = [];
  }

  private requestRootSyncIfChanged(cause: FabricRenderGraphSyncCause): void {
    const activeRootId = this.sceneService?.getActiveRoot()?.id ?? null;
    if (activeRootId === this.renderedRootId) return;
    this.requestSync(cause, { type: "composition" });
  }

  private attachLayoutChangeEvents() {
    const layoutService = this.sceneLayoutService;
    const surfaceFrameService = this.surfaceFrameService;
    if (!layoutService || !surfaceFrameService) return;
    const observed = new Set<string>();
    const observe = (surfaceId: string) => {
      if (!surfaceId || observed.has(surfaceId)) return;
      observed.add(surfaceId);
      this.layoutDisposables.push(
        layoutService.onLayoutChange(surfaceId, () => {
          this.resetInteractionPreview();
          this.requestSync(
            { type: "layout-change", surfaceId },
            { type: "full" },
          );
        }),
      );
    };
    surfaceFrameService.listSurfaceIds().forEach(observe);
    this.layoutDisposables.push(
      surfaceFrameService.onAnyFramesChange((event) =>
        observe(event.surfaceId),
      ),
    );
  }

  private detachLayoutChangeEvents() {
    this.layoutDisposables.forEach((disposable) => disposable.dispose());
    this.layoutDisposables = [];
  }

  private resetInteractionPreview(): void {
    this.activeManipulations = new WeakMap();
  }

  private async runSyncLoop() {
    while (this.syncRequested) {
      this.syncRequested = false;
      this.activeSyncCauses = this.pendingSyncCauses;
      this.pendingSyncCauses = new Map();
      this.activeInvalidations = this.pendingInvalidations;
      this.pendingInvalidations = new Map();
      this.syncGeneration += 1;
      this.emitSyncState();
      await this.syncGraph(Array.from(this.activeInvalidations.values()));
      this.activeSyncCauses.clear();
      this.activeInvalidations.clear();
      this.emitSyncState();
    }
  }

  private async syncGraph(invalidations: readonly RenderInvalidation[]) {
    const graph = this.requireRenderIntentService().getGraph();
    const canvas = this.requireCanvasService();
    const conditionContext = this.buildRuntimeConditionContext(graph);
    const items: FabricRenderTargetItem[] = [];

    const activeRoot = this.sceneService?.getActiveRoot() ?? null;
    if (activeRoot) {
      this.appendRootCompositionItems(
        items,
        activeRoot,
        graph,
        conditionContext,
      );
    } else {
      this.appendRenderGraphItems(items, graph, conditionContext);
    }

    const graphOrderOffset = items.length + 1_000_000;
    this.getRenderableScenes().forEach((scene, sceneIndex) => {
      const sceneLayers = this.sceneService!.selectLayers({
        sceneId: scene.id,
      });
      sceneLayers.forEach((layer, layerIndex) => {
        if (layer.visible === false) return;
        const elements = this.sceneService!.selectElements({
          sceneId: scene.id,
          layerIds: [layer.id],
        });
        elements.forEach((element, elementIndex) => {
          if (element.visible === false) return;
          const spec = this.toSceneRenderObjectSpec(
            scene,
            layer,
            element,
            conditionContext,
          );
          if (!spec) return;
          items.push({
            key: `scene:${scene.id}:${element.id}`,
            layerId: layer.id,
            origin: {
              type: "scene-element",
              sceneId: scene.id,
              elementId: element.id,
            },
            order:
              graphOrderOffset +
              sceneIndex * 1_000_000 +
              layerIndex * 10_000 +
              elementIndex,
            spec,
          });
        });
      });
    });

    await canvas.reconcileRenderGraphDrawList(items, {
      invalidations: invalidations.length ? invalidations : [{ type: "full" }],
      render: false,
    });
    this.renderedRootId = activeRoot?.id ?? null;
    const autoFocusTarget = canvas.selectObjects({
      visible: true,
      data: { autoFocus: true },
    })[0];
    if (autoFocusTarget && canvas.getActiveObject() !== autoFocusTarget) {
      canvas.setActiveObject(autoFocusTarget);
    }
    canvas.requestRenderAll();
  }

  private appendRootCompositionItems(
    items: FabricRenderTargetItem[],
    root: SceneSnapshot,
    graph: RenderGraph,
    conditionContext: ReturnType<
      FabricRenderGraphAdapter["buildRuntimeConditionContext"]
    >,
  ): void {
    const rootItemStart = items.length;
    root.composition.entries.forEach((entry, entryIndex) => {
      const orderBase = entryIndex * 1_000_000_000;
      if (entry.source === "render-graph") {
        this.appendRenderGraphItems(
          items,
          graph,
          conditionContext,
          orderBase,
          `root:${root.id}:${entryIndex}:render-graph`,
          entry.filter,
        );
        return;
      }
      entry.layerIds.forEach((layerId, groupLayerIndex) => {
        const layer = this.sceneService?.selectOneLayer({
          sceneId: root.id,
          ids: [layerId],
        });
        if (!layer || layer.visible === false) return;
        const elements =
          this.sceneService?.selectElements({
            sceneId: root.id,
            layerIds: [layer.id],
          }) ?? [];
        elements.forEach((element, elementIndex) => {
          if (element.visible === false) return;
          const spec = this.toSceneRenderObjectSpec(
            {
              id: root.id,
              order: 0,
              visible: true,
              renderable: false,
              transient: false,
            },
            layer,
            element,
            conditionContext,
          );
          if (!spec) return;
          items.push({
            key: `root:${root.id}:${entryIndex}:${groupLayerIndex}:${element.id}`,
            layerId: layer.id,
            origin: {
              type: "scene-element",
              sceneId: root.id,
              elementId: element.id,
            },
            order: orderBase + groupLayerIndex * 1_000_000 + elementIndex,
            spec,
          });
        });
      });
    });
    this.stabilizeRootCompositionItems(items, rootItemStart, graph);
    this.appendRetainedRenderGraphItems(items, graph, conditionContext);
  }

  private stabilizeRootCompositionItems(
    items: FabricRenderTargetItem[],
    start: number,
    graph: RenderGraph,
  ): void {
    const nodes = graph.layers.flatMap((layer) => layer.nodes);
    const usedKeys = new Set<string>();
    items.slice(start).forEach((item) => {
      let canonicalKey =
        item.origin?.type === "render-intent" ? item.spec.id : undefined;
      const sceneElement =
        item.origin?.type === "scene-element"
          ? this.sceneService?.selectOneElement({
              sceneId: item.origin.sceneId,
              ids: [item.origin.elementId],
            })
          : undefined;
      const projection = sceneElement?.renderGraphProjection;
      if (projection) {
        canonicalKey = nodes.find(
          (node) =>
            node.subjectId === projection.subjectId &&
            node.type === (projection.type ?? item.spec.type),
        )?.id;
      }
      if (canonicalKey && !usedKeys.has(canonicalKey)) {
        item.key = canonicalKey;
      }
      usedKeys.add(item.key);
    });
  }

  private appendRetainedRenderGraphItems(
    items: FabricRenderTargetItem[],
    graph: RenderGraph,
    conditionContext: ReturnType<
      FabricRenderGraphAdapter["buildRuntimeConditionContext"]
    >,
  ): void {
    const usedKeys = new Set(items.map((item) => item.key));
    const retained: FabricRenderTargetItem[] = [];
    this.appendRenderGraphItems(retained, graph, conditionContext);
    retained.forEach((item) => {
      if (usedKeys.has(item.key)) return;
      items.push({
        ...item,
        spec: {
          ...item.spec,
          props: {
            ...item.spec.props,
            evented: false,
            selectable: false,
            visible: false,
          },
        },
      });
      usedKeys.add(item.key);
    });
  }

  private appendRenderGraphItems(
    items: FabricRenderTargetItem[],
    graph: RenderGraph,
    conditionContext: ReturnType<
      FabricRenderGraphAdapter["buildRuntimeConditionContext"]
    >,
    orderBase = 0,
    keyPrefix = "",
    filter?: SceneSnapshot["composition"]["entries"][number] extends infer T
      ? T extends { source: "render-graph"; filter?: infer F }
        ? F
        : never
      : never,
  ): void {
    graph.layers.forEach((layer, layerIndex) => {
      const layerEffects = this.normalizeActiveEffects(
        layer.effects,
        conditionContext,
      );
      layer.nodes.forEach((node, nodeIndex) => {
        if (filter && !filter({ layer, node })) return;
        if (!evaluateRuntimeCondition(node.visibleWhen, conditionContext))
          return;
        const frameHitTarget = keyPrefix
          ? null
          : this.toFrameHitTargetSpec(layer, node, conditionContext);
        if (frameHitTarget) {
          items.push({
            key: `${node.id}:frame-hit-target`,
            layerId: layer.id,
            origin: {
              type: "render-intent",
              intentId: String(node.data.renderIntentId || node.id),
            },
            order:
              orderBase +
              this.resolveGraphNodeRenderOrder(layerIndex, nodeIndex) -
              0.001,
            spec: frameHitTarget,
          });
        }
        const spec = this.toRenderObjectSpec(
          layer,
          node,
          conditionContext,
          layerEffects,
          Boolean(keyPrefix),
        );
        if (!spec) return;
        items.push({
          key: keyPrefix ? `${keyPrefix}:${node.id}` : node.id,
          layerId: layer.id,
          origin: {
            type: "render-intent",
            intentId: String(node.data.renderIntentId || node.id),
          },
          order:
            orderBase +
            this.resolveGraphNodeRenderOrder(layerIndex, nodeIndex),
          spec,
        });
      });
    });
  }

  private toFrameHitTargetSpec(
    layer: RenderGraphLayer,
    node: RenderGraphNode,
    conditionContext: ReturnType<
      FabricRenderGraphAdapter["buildRuntimeConditionContext"]
    >,
  ): RenderObjectSpec | null {
    if (node.interaction?.hitRegion?.type !== "frame") return null;
    const state = this.requireInteractionService().resolveState(
      node.interaction,
      conditionContext,
      node.data?.locked === true,
    );
    return {
      id: `${node.id}:frame-hit-target`,
      type: "rect",
      space: node.coordinateSpace,
      placement: node.placement,
      data: {
        ...node.data,
        frameHitTarget: true,
        interactionSpec: node.interaction,
        layerId: layer.id,
        renderLayerId: layer.id,
        renderNodeId: node.id,
        subjectId: node.subjectId,
        surfaceId: node.surfaceId,
      },
      props: {
        width: node.placement.localBounds.width,
        height: node.placement.localBounds.height,
        fill: "rgba(0,0,0,0)",
        stroke: null,
        selectable: state.selectionEnabled,
        evented: state.hitTestEnabled,
        hasControls: false,
        hasBorders: false,
        excludeFromExport: true,
        visible: layer.visible && node.visible,
      },
    };
  }

  private resolveGraphNodeRenderOrder(
    layerIndex: number,
    nodeIndex: number,
  ): number {
    return layerIndex * 1_000_000 + nodeIndex;
  }

  private resolveProjectionTargets(
    subjectId: string,
  ): InteractionProjectionTarget[] {
    const graph = this.renderIntentService?.getGraph();
    const membership = graph?.projectionMemberships.find(
      (item) => item.subjectId === subjectId,
    );
    if (!graph || !membership) return [];
    const nodes = graph.layers.flatMap((layer) => layer.nodes);
    return membership.nodeIds.flatMap((projectionId) => {
      const node = nodes.find((candidate) => candidate.id === projectionId);
      return node
        ? [{ projectionId, geometryRef: { ...node.previewGeometryRef } }]
        : [];
    });
  }

  private resolveInteractionSubject(target: any): InteractionSubject | null {
    if (target?.data?.renderTarget !== FABRIC_RENDER_GRAPH_TARGET) return null;
    const graph = this.renderIntentService?.getGraph();
    if (!graph) return null;
    const renderNodeId = String(target.data?.renderNodeId || "").trim();
    const declaredSubjectId = String(target.data?.subjectId || "").trim();
    const membership = graph.projectionMemberships.find(
      (item) =>
        item.subjectId === declaredSubjectId ||
        (renderNodeId && item.nodeIds.includes(renderNodeId)),
    );
    const subjectId = membership?.subjectId || declaredSubjectId;
    if (!subjectId) return null;
    const projectionTargets = this.resolveProjectionTargets(subjectId);
    if (!projectionTargets.length && renderNodeId) {
      projectionTargets.push({
        projectionId: renderNodeId,
        geometryRef: {
          sourceId: "render-graph",
          geometryId: renderNodeId,
          purpose: "preview",
        },
      });
    }
    return {
      subjectId,
      ...(String(target.data?.surfaceId || "").trim()
        ? { surfaceId: String(target.data.surfaceId).trim() }
        : {}),
      projectionTargets,
    };
  }

  private resolveManipulationState(
    kind: InteractionManipulationKind,
    target: any,
  ):
    | {
        kind: InteractionManipulationKind;
        sourceFrame: GeometryRect;
        sourceSceneMatrix?: Matrix2D<"object-local", "scene">;
        subject: InteractionSubject;
      }
    | undefined {
    if (!target || typeof target !== "object") return undefined;
    const existing = this.activeManipulations.get(target);
    if (existing) {
      existing.kind = kind;
      return existing;
    }
    const subject = this.resolveInteractionSubject(target);
    const sourceFrame =
      this.resolveDeclarativeSceneFrame(target) ??
      this.getTargetSceneBounds(target);
    if (!subject || !sourceFrame) return undefined;
    const state = {
      kind,
      sourceFrame,
      sourceSceneMatrix: target.data?.affinePlacement?.localToScene,
      subject,
    };
    this.activeManipulations.set(target, state);
    return state;
  }

  private resolveDeclarativeSceneFrame(target: any): GeometryRect | null {
    const placement = target?.data?.affinePlacement as
      | AffinePlacement
      | undefined;
    if (!placement) return null;
    const frame = transformCoordinateRect(
      placement.localToScene,
      placement.localBounds,
    );
    return {
      left: frame.left,
      top: frame.top,
      width: frame.width,
      height: frame.height,
    };
  }

  private applyOperationPatches(
    patches: readonly InteractionProjectionPatch[],
    phase: "active" | "committing",
  ): void {
    const canvas = this.canvasService;
    if (!canvas) return;
    patches.forEach((patch) => {
      const projection = canvas
        .selectObjects({
          data: { renderTarget: FABRIC_RENDER_GRAPH_TARGET },
        })
        .find(
          (candidate: any) =>
            String(candidate?.data?.renderNodeId || "") ===
            patch.target.projectionId,
        ) as any;
      if (!projection) return;
      this.markInteractionOwnership(projection, phase);
      this.applyProjectionTransform(projection, patch.transform);
      projection.setCoords?.();
    });
  }

  private applyProjectionTransform(
    projection: any,
    patch: InteractionProjectionPatch["transform"],
  ): void {
    const canvas = this.canvasService;
    const placement = projection?.data?.affinePlacement as
      | AffinePlacement
      | undefined;
    if (!canvas || !placement) return;
    const sceneMatrix =
      patch.type === "translate"
        ? multiplyCoordinateMatrices(
            coordinateMatrix("scene", "scene", [
              1,
              0,
              0,
              1,
              patch.delta.x,
              patch.delta.y,
            ]),
            placement.localToScene,
          )
        : patch.matrix;
    const bounds = placement.localBounds;
    const centerToLocal = coordinateMatrix("object-local", "object-local", [
      1,
      0,
      0,
      1,
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    ]);
    const centerToScreen = canvas.toScreenMatrix(
      multiplyCoordinateMatrices(sceneMatrix, centerToLocal),
    );
    if (typeof projection.calcTransformMatrix === "function") {
      util.applyTransformToObject(projection, [...centerToScreen.values]);
      return;
    }
    const [a, b, c, d, e, f] = centerToScreen.values;
    projection.set?.({
      left: e - canvas.toScreenLength(bounds.width) / 2,
      top: f - canvas.toScreenLength(bounds.height) / 2,
      angle: (Math.atan2(b, a) * 180) / Math.PI,
      scaleX: Math.hypot(a, b),
      scaleY: Math.hypot(c, d),
    });
  }

  private markInteractionOwnership(
    target: any,
    phase: "active" | "committing",
  ): void {
    if (target?.data?.renderTarget !== FABRIC_RENDER_GRAPH_TARGET) return;
    const renderKey = String(target.data?.renderKey || "").trim();
    if (!renderKey) return;
    const currentOwnership = target.data?.renderOwnership;
    let interactionId =
      currentOwnership?.type === "interaction"
        ? String(currentOwnership.interactionId || "")
        : "";
    if (
      !interactionId ||
      (phase === "active" && currentOwnership?.phase !== "active")
    ) {
      interactionId = `${renderKey}:${++this.interactionSequence}`;
    }
    target.set?.({
      data: {
        ...(target.data || {}),
        renderOwnership: {
          type: "interaction",
          interactionId,
          phase,
        },
      },
    });
  }

  private handleRenderGraphObjectManipulating(
    kind: InteractionManipulationKind,
    target: any,
    commit = false,
  ) {
    const canvas = this.canvasService;
    if (!canvas || target?.data?.renderTarget !== FABRIC_RENDER_GRAPH_TARGET) {
      return;
    }
    const spec = target.data?.interactionSpec as InteractionSpec | undefined;
    if (!spec) return;
    const interactionState = this.resolveManipulationState(kind, target);
    if (!interactionState) return;
    const measuredFrame = this.getTargetSceneBounds(target);
    if (!measuredFrame) return;
    const sceneMatrix = this.resolveTargetSceneMatrix(target);
    const sourceSceneMatrix = interactionState.sourceSceneMatrix;
    const frame =
      kind === "move" && sourceSceneMatrix && sceneMatrix
        ? {
            ...measuredFrame,
            left:
              interactionState.sourceFrame.left +
              sceneMatrix.values[4] -
              sourceSceneMatrix.values[4],
            top:
              interactionState.sourceFrame.top +
              sceneMatrix.values[5] -
              sourceSceneMatrix.values[5],
          }
        : measuredFrame;
    const operationInput = {
      spec,
      runtimeContext: this.buildRuntimeConditionContext(
        this.requireRenderIntentService().getGraph(),
      ),
      locked: target.data?.locked === true,
      transform: {
        frame,
        position: { x: frame.left, y: frame.top },
        size: { width: frame.width, height: frame.height },
        rotation: finiteNumber(target.angle, 0),
        scale: {
          x: finiteNumber(target.scaleX, 1),
          y: finiteNumber(target.scaleY, 1),
        },
      },
      sourceTransform: { frame: interactionState.sourceFrame },
      sourceSceneMatrix,
      sceneMatrix,
      coordinateSpace: "scene" as const,
      target,
      projectionId: String(target.data?.renderNodeId || "").trim(),
      subject: interactionState.subject,
      metadata: {
        layerId: target.data?.layerId,
        ...this.resolveParentSceneMatrix(target),
        renderIntentId: target.data?.renderIntentId,
        subjectId: target.data?.subjectId,
        surfaceId: target.data?.surfaceId,
        viewportScale: canvas.getSceneScale(),
      },
    };
    const result = commit
      ? this.requireInteractionService().commitManipulation(
          kind,
          operationInput,
        )
      : this.requireInteractionService().previewManipulation(
          kind,
          operationInput,
        );
    if (!result.enabled) return;
    this.applyOperationPatches(
      result.projectionPatches,
      commit ? "committing" : "active",
    );
  }

  private resolveParentSceneMatrix(
    target: any,
  ):
    | { parentSceneMatrix: [number, number, number, number, number, number] }
    | Record<string, never> {
    const canvas = this.canvasService;
    const rawMatrix = target?.group?.calcTransformMatrix?.();
    if (
      !canvas ||
      !Array.isArray(rawMatrix) ||
      rawMatrix.length !== 6 ||
      rawMatrix.some((value: unknown) => !Number.isFinite(value))
    ) {
      return {};
    }
    const scale = Math.max(0.0001, canvas.getSceneScale());
    const translation = canvas.toScenePoint({
      space: "screen",
      x: rawMatrix[4],
      y: rawMatrix[5],
    });
    return {
      parentSceneMatrix: [
        rawMatrix[0] / scale,
        rawMatrix[1] / scale,
        rawMatrix[2] / scale,
        rawMatrix[3] / scale,
        translation.x,
        translation.y,
      ],
    };
  }

  private resolveTargetSceneMatrix(
    target: any,
  ): Matrix2D<"object-local", "scene"> | undefined {
    const canvas = this.canvasService;
    const placement = target?.data?.affinePlacement as
      | AffinePlacement
      | undefined;
    const rawMatrix = target?.calcTransformMatrix?.();
    if (
      !canvas ||
      !placement ||
      !Array.isArray(rawMatrix) ||
      rawMatrix.length !== 6 ||
      rawMatrix.some((value: unknown) => !Number.isFinite(value))
    ) {
      return undefined;
    }
    const bounds = placement.localBounds;
    const localToFabricCenter = coordinateMatrix(
      "object-local",
      "object-local",
      [
        1,
        0,
        0,
        1,
        -(bounds.left + bounds.width / 2),
        -(bounds.top + bounds.height / 2),
      ],
    );
    const fabricCenterToScreen = coordinateMatrix(
      "object-local",
      "screen",
      rawMatrix as [number, number, number, number, number, number],
    );
    return canvas.toSceneMatrix(
      multiplyCoordinateMatrices(fabricCenterToScreen, localToFabricCenter),
    );
  }

  private handleRenderGraphObjectModified(target: any) {
    if (
      target?.data?.renderTarget !== FABRIC_RENDER_GRAPH_TARGET ||
      !target.data?.interactionSpec
    ) {
      return;
    }
    const kind =
      (target && typeof target === "object"
        ? this.activeManipulations.get(target)?.kind
        : undefined) ?? "move";
    this.handleRenderGraphObjectManipulating(kind, target, true);
    if (target && typeof target === "object") {
      this.activeManipulations.delete(target);
    }
  }

  private handleInteractionActivation(
    target: any,
    trigger: "primary-pointer" | "double-click",
  ) {
    if (target?.data?.renderTarget !== FABRIC_RENDER_GRAPH_TARGET) return;
    const spec = target.data?.interactionSpec as InteractionSpec | undefined;
    if (!spec) return;
    void this.requireInteractionService().activate({
      spec,
      runtimeContext: this.buildRuntimeConditionContext(
        this.requireRenderIntentService().getGraph(),
      ),
      layerId: target.data?.layerId,
      renderIntentId: target.data?.renderIntentId ?? target.data?.renderNodeId,
      subject: this.resolveInteractionSubject(target) ?? undefined,
      surfaceId: target.data?.surfaceId ?? target.data?.subject?.surfaceId,
      targetData: cloneRecord(target.data ?? {}),
      trigger,
    });
  }

  private resolveLiveObjectFrame(objectId: string): GeometryRect | null {
    const target = this.resolveLiveProjection(objectId);
    return target ? this.getTargetSceneBounds(target) : null;
  }

  private resolveLiveProjection(projectionId: string): any | null {
    const canvas = this.canvasService;
    if (!canvas) return null;
    const normalized = String(projectionId || "").trim();
    if (!normalized) return null;
    return (
      canvas
        .selectObjects({
          data: { renderTarget: FABRIC_RENDER_GRAPH_TARGET },
        })
        .find(
          (candidate: any) =>
            String(candidate?.data?.renderNodeId || "") === normalized ||
            String(candidate?.data?.subjectId || "") === normalized,
        ) ?? null
    );
  }

  private getTargetSceneBounds(target: any): GeometryRect | null {
    const canvas = this.canvasService;
    if (!canvas || !target) return null;
    const rawBounds =
      typeof target.getBoundingRect === "function"
        ? target.getBoundingRect()
        : {
            left: finiteNumber(target.left, 0),
            top: finiteNumber(target.top, 0),
            width:
              finiteNumber(target.width, 0) * finiteNumber(target.scaleX, 1),
            height:
              finiteNumber(target.height, 0) * finiteNumber(target.scaleY, 1),
          };
    const sceneBounds = canvas.toSceneRect({
      space: "screen",
      left: finiteNumber(rawBounds.left, 0),
      top: finiteNumber(rawBounds.top, 0),
      width: finiteNumber(rawBounds.width, 0),
      height: finiteNumber(rawBounds.height, 0),
    });
    return {
      left: sceneBounds.left,
      top: sceneBounds.top,
      width: sceneBounds.width,
      height: sceneBounds.height,
    };
  }

  private createRenderGraphGeometrySource(): GeometrySource {
    return {
      sourceId: "render-graph",
      getSnapshot: (ref) => {
        const target = this.resolveLiveProjection(ref.geometryId);
        const placement = target?.data?.affinePlacement as
          | AffinePlacement
          | undefined;
        if (placement) {
          const bounds = {
            left: placement.localBounds.left,
            top: placement.localBounds.top,
            width: placement.localBounds.width,
            height: placement.localBounds.height,
          };
          return {
            kind: "rect",
            ref,
            space: "object-local",
            bounds,
            rect: bounds,
            localToScene: placement.localToScene,
          };
        }
        const rect = target ? this.getTargetSceneBounds(target) : null;
        return rect
          ? {
              kind: "rect",
              ref,
              space: "scene",
              bounds: rect,
              rect,
              localToScene: coordinateMatrix(
                "scene",
                "scene",
                [1, 0, 0, 1, 0, 0],
              ),
            }
          : null;
      },
      listGeometries: () => {
        const graph = this.renderIntentService?.getGraph();
        if (!graph) return [];
        return graph.layers.flatMap((layer) =>
          layer.nodes.map((node) => ({
            ref: {
              sourceId: "render-graph",
              geometryId: node.subjectId,
            },
            kind: "rect" as const,
            space: node.coordinateSpace,
            metadata: {
              renderIntentId: node.id,
              layerId: layer.id,
            },
          })),
        );
      },
    };
  }

  private requireInteractionService(): InteractionService {
    if (!this.interactionService) {
      throw new Error(
        "[FabricRenderGraphAdapter] InteractionService is not initialized.",
      );
    }
    return this.interactionService;
  }

  private buildRuntimeConditionContext(graph: RenderGraph) {
    const layers = new Map<string, RuntimeConditionLayerState>();
    graph.layers.forEach((layer) => {
      const visibleNodes = layer.nodes.filter((node) => node.visible !== false);
      layers.set(layer.id, {
        exists: true,
        objectCount: layer.nodes.length,
        visibleObjectCount: visibleNodes.length,
      });
    });
    this.getRenderableScenes().forEach((scene) => {
      this.sceneService
        ?.selectLayers({ sceneId: scene.id })
        .forEach((layer) => {
          const elements =
            this.sceneService?.selectElements({
              sceneId: scene.id,
              layerIds: [layer.id],
            }) ?? [];
          const visibleNodes = elements.filter(
            (element) => element.visible !== false,
          );
          layers.set(layer.id, {
            exists: true,
            objectCount: elements.length,
            visibleObjectCount: visibleNodes.length,
          });
        });
    });

    return this.requireRenderIntentService().createRuntimeConditionContext({
      getLayerState: (layerId: string) => layers.get(layerId),
      isSessionActive: (sessionId: string) =>
        this.sessionService?.isActive(sessionId) ?? false,
      isSessionScopeActive: (scope) =>
        this.sessionService?.hasActive(scope) ?? false,
      isSessionFocused: (sessionId: string) =>
        this.sessionService?.getFocusedSessionId() === sessionId,
      hasAnyActiveSession: (scope) =>
        this.sessionService?.hasActive(scope) ?? false,
    });
  }

  private toRenderObjectSpec(
    layer: RenderGraphLayer,
    node: RenderGraphNode,
    conditionContext: ReturnType<
      FabricRenderGraphAdapter["buildRuntimeConditionContext"]
    >,
    layerEffects: RenderEffectSpec[] = [],
    readOnly = false,
    geometryRef: GeometryRef = node.previewGeometryRef,
  ): RenderObjectSpec | null {
    const geometry = this.resolveGeometryProjection(geometryRef);
    if (!geometry) return null;
    const hasDeclarativeInteraction = Boolean(node.interaction);
    const interactionState = this.requireInteractionService().resolveState(
      node.interaction,
      conditionContext,
      node.data?.locked === true,
    );
    const moveEnabled = interactionState.manipulation.move.enabled;
    const resizeEnabled = interactionState.manipulation.resize.enabled;
    const rotateEnabled = interactionState.manipulation.rotate.enabled;
    const controlsEnabled = resizeEnabled || rotateEnabled;
    const selectable = readOnly
      ? false
      : hasDeclarativeInteraction
        ? interactionState.selectionEnabled
        : node.props.selectable === true;
    const evented = readOnly
      ? false
      : hasDeclarativeInteraction
        ? interactionState.hitTestEnabled
        : typeof node.props.evented === "boolean"
          ? node.props.evented
          : selectable;
    const commonProps = {
      ...node.props,
      ...(geometry.pathData ? { pathData: geometry.pathData } : {}),
      selectable,
      evented,
      hasControls: !readOnly && controlsEnabled,
      hasBorders: !readOnly && controlsEnabled,
      lockMovementX: readOnly || !moveEnabled,
      lockMovementY: readOnly || !moveEnabled,
      lockScalingX: readOnly || !resizeEnabled,
      lockScalingY: readOnly || !resizeEnabled,
      lockRotation: readOnly || !rotateEnabled,
      visible: layer.visible && node.visible,
    };
    const commonData = {
      ...node.data,
      layerId: layer.id,
      renderLayerId: layer.id,
      renderNodeId: node.id,
      subjectId: node.subjectId,
      surfaceId: node.surfaceId,
      exportKeys: node.exportKeys,
      tags: node.tags,
      ...(!readOnly && node.interaction
        ? { interactionSpec: node.interaction }
        : {}),
      ...(readOnly ? { readOnly: true } : {}),
    };
    const effects = [
      ...layerEffects,
      ...this.normalizeActiveEffects(node.effects, conditionContext),
    ].map((effect) =>
      this.materializeGeometryEffect(
        effect,
        readOnly ? "export" : "preview",
      ),
    );

    if (node.type === "image") {
      const src = node.visual?.src;
      if (!src) return null;
      return {
        id: node.id,
        type: "image",
        src,
        space: node.coordinateSpace,
        placement: geometry.placement,
        previewGeometryRef: node.previewGeometryRef,
        exportGeometryRef: node.exportGeometryRef,
        data: commonData,
        ...(effects.length ? { effects } : {}),
        props: commonProps,
      };
    }

    if (node.type === "path") {
      return {
        id: node.id,
        type: "path",
        space: node.coordinateSpace,
        placement: geometry.placement,
        previewGeometryRef: node.previewGeometryRef,
        exportGeometryRef: node.exportGeometryRef,
        data: commonData,
        ...(effects.length ? { effects } : {}),
        props: commonProps,
      };
    }

    if (node.type === "rect") {
      return {
        id: node.id,
        type: "rect",
        space: node.coordinateSpace,
        placement: geometry.placement,
        previewGeometryRef: node.previewGeometryRef,
        exportGeometryRef: node.exportGeometryRef,
        data: commonData,
        ...(effects.length ? { effects } : {}),
        props: commonProps,
      };
    }

    return {
      id: node.id,
      type: "text",
      space: node.coordinateSpace,
      placement: geometry.placement,
      previewGeometryRef: node.previewGeometryRef,
      exportGeometryRef: node.exportGeometryRef,
      data: commonData,
      ...(effects.length ? { effects } : {}),
      props: commonProps,
    };
  }

  createExportRenderObjectSpec(
    layer: RenderGraphLayer,
    node: RenderGraphNode,
  ): RenderObjectSpec | null {
    const conditionContext = this.buildRuntimeConditionContext(
      this.requireRenderIntentService().getGraph(),
    );
    return this.toRenderObjectSpec(
      layer,
      node,
      conditionContext,
      this.normalizeActiveEffects(layer.effects, conditionContext),
      true,
      node.exportGeometryRef,
    );
  }

  private resolveGeometryProjection(ref: GeometryRef): {
    placement: AffinePlacement;
    pathData?: string;
    snapshot: GeometrySnapshot;
  } | null {
    const source = this.geometrySource;
    if (!source) return null;
    const resolved = source.getSnapshot(ref);
    const snapshot = resolved.value;
    if (!snapshot) {
      resolved.diagnostics.forEach((diagnostic) =>
        console.warn(`[FabricRenderGraphAdapter] ${diagnostic.message}`),
      );
      return null;
    }
    const pathData = this.geometryPathData(snapshot);
    const localToScene = coordinateMatrix(
      "object-local",
      "scene",
      snapshot.localToScene.values,
    );
    return {
      snapshot,
      ...(pathData ? { pathData } : {}),
      placement: {
        localBounds: {
          space: "object-local",
          left: snapshot.bounds.left,
          top: snapshot.bounds.top,
          width: snapshot.bounds.width,
          height: snapshot.bounds.height,
        },
        localToScene,
        pivot: {
          space: "object-local",
          x: snapshot.bounds.left + snapshot.bounds.width / 2,
          y: snapshot.bounds.top + snapshot.bounds.height / 2,
        },
      },
    };
  }

  private geometryPathData(snapshot: GeometrySnapshot): string | undefined {
    if (snapshot.kind === "path") return snapshot.pathData;
    if (snapshot.kind === "rect") {
      const { left, top, width, height } = snapshot.rect;
      return `M${left} ${top}H${left + width}V${top + height}H${left}Z`;
    }
    if (snapshot.kind === "polygon") {
      const [first, ...rest] = snapshot.points;
      return first
        ? `M${first.x} ${first.y}${rest.map((point) => `L${point.x} ${point.y}`).join("")}Z`
        : undefined;
    }
    if (snapshot.kind !== "compound") return undefined;
    const children = snapshot.children
      .map((ref) => this.geometrySource?.getSnapshot(ref).value)
      .filter((child): child is GeometrySnapshot => Boolean(child));
    const paths = children
      .map((child) => this.geometryPathData(child))
      .filter((path): path is string => Boolean(path));
    return paths.length === children.length ? paths.join(" ") : undefined;
  }

  private materializeGeometryEffect(
    effect: RenderEffectSpec,
    purpose: "preview" | "export",
  ): RenderEffectSpec {
    if (effect.type !== "clipPath") return effect;
    const ref =
      purpose === "export"
        ? effect.exportGeometryRef
        : effect.previewGeometryRef;
    if (!ref) return effect;
    const geometry = this.resolveGeometryProjection(ref);
    if (!geometry) return effect;
    const pathData = this.geometryPathData(geometry.snapshot);
    if (!pathData) return effect;
    const source = {
      id: `${effect.id ?? "clipPath"}:${purpose}:geometry`,
      type: "path" as const,
      placement: geometry.placement,
      previewGeometryRef: effect.previewGeometryRef,
      exportGeometryRef: effect.exportGeometryRef,
      props: {
        pathData,
        fill: "#000000",
        stroke: null,
        selectable: false,
        evented: false,
        excludeFromExport: true,
      },
    };
    return effect.coordinateMode === "object"
      ? { ...effect, source: { ...source, space: "object-local" } }
      : { ...effect, source: { ...source, space: "scene" } };
  }

  private getRenderableScenes(): SceneRecord[] {
    return (
      this.sceneService
        ?.listScenes()
        .filter((scene) => scene.renderable && scene.visible !== false) ?? []
    );
  }

  private toSceneRenderObjectSpec(
    scene: SceneRecord,
    layer: SceneLayer,
    element: SceneElement,
    conditionContext: ReturnType<
      FabricRenderGraphAdapter["buildRuntimeConditionContext"]
    >,
  ): RenderObjectSpec | null {
    const renderProps = isRecord(element.data?.renderProps)
      ? withoutFabricInteractionProps(element.data.renderProps)
      : {};
    const interactionState = this.requireInteractionService().resolveState(
      element.interaction,
      conditionContext,
      false,
    );
    const moveEnabled = interactionState.manipulation.move.enabled;
    const resizeEnabled = interactionState.manipulation.resize.enabled;
    const rotateEnabled = interactionState.manipulation.rotate.enabled;
    const controlsEnabled = resizeEnabled || rotateEnabled;
    const props = {
      ...withoutFabricInteractionProps(element.style),
      ...(element.placement ? {} : element.transform),
      ...renderProps,
      ...(element.type === "rect"
        ? { width: element.width, height: element.height }
        : {}),
      ...(element.type === "image"
        ? {
            ...(element.width === undefined ? {} : { width: element.width }),
            ...(element.height === undefined ? {} : { height: element.height }),
          }
        : {}),
      ...(element.type === "path" ? { pathData: element.path } : {}),
      ...(element.type === "text" ? { text: element.text } : {}),
      visible:
        scene.visible !== false &&
        layer.visible !== false &&
        element.visible !== false,
      selectable: interactionState.selectionEnabled,
      evented: interactionState.hitTestEnabled,
      hasControls: controlsEnabled,
      hasBorders: controlsEnabled,
      lockMovementX: !moveEnabled,
      lockMovementY: !moveEnabled,
      lockScalingX: !resizeEnabled,
      lockScalingY: !resizeEnabled,
      lockRotation: !rotateEnabled,
    };
    const exportKeys = [element.id, ...normalizeIds(element.data?.exportKeys)];
    const data = {
      ...element.data,
      sceneId: scene.id,
      sceneElementId: element.id,
      layerId: layer.id,
      renderLayerId: layer.id,
      renderNodeId: `scene:${scene.id}:${element.id}`,
      subjectId: element.id,
      exportKeys,
      ...(element.interaction ? { interactionSpec: element.interaction } : {}),
    };
    return {
      id: element.id,
      type: element.type,
      ...(element.type === "image" ? { src: element.src } : {}),
      ...(element.placement ? { placement: element.placement } : {}),
      space: element.data?.renderSpace === "screen" ? "screen" : "scene",
      data,
      effects: [
        ...this.normalizeActiveEffects(layer.effects, conditionContext),
        ...this.normalizeActiveEffects(element.effects, conditionContext),
      ],
      props,
    };
  }

  private normalizeActiveEffects(
    effects: readonly RenderEffectSpec[] | undefined,
    conditionContext: ReturnType<
      FabricRenderGraphAdapter["buildRuntimeConditionContext"]
    >,
  ): RenderEffectSpec[] {
    if (!Array.isArray(effects)) return [];
    return effects
      .filter((effect) =>
        evaluateRuntimeCondition(effect.activeWhen, conditionContext),
      )
      .map((effect) => ({ ...effect }));
  }

  private requireRenderIntentService(): RenderIntentService {
    if (!this.renderIntentService) {
      throw new Error(
        "[FabricRenderGraphAdapter] RenderIntentService is not initialized.",
      );
    }
    return this.renderIntentService;
  }

  private requireCanvasService(): FabricRenderTargetCanvasService {
    if (!this.canvasService) {
      throw new Error(
        "[FabricRenderGraphAdapter] CanvasService is not initialized.",
      );
    }
    return this.canvasService;
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function withoutFabricInteractionProps(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !FABRIC_INTERACTION_PROP_KEYS.has(key),
    ),
  );
}
