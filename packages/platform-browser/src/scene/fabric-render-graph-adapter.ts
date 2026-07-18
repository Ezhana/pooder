import {
  GEOMETRY_SOURCE_SERVICE,
  INTERACTION_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_SERVICE,
  SESSION_SERVICE,
  SCENE_LAYOUT_SERVICE,
  SURFACE_FRAME_SERVICE,
  evaluateRuntimeCondition,
  type CanvasService,
  type GeometryRect,
  type GeometrySourceService,
  type GeometrySourceProvider,
  type RenderEffectSpec,
  type RenderGraph,
  type RenderGraphLayer,
  type RenderGraphNode,
  type InteractionManipulationKind,
  type InteractionService,
  type InteractionSpec,
  type RenderObjectSpec,
  type SceneElement,
  type SceneLayer,
  type SceneRecord,
  type SceneService,
  type Service,
  type ServiceContext,
  type RuntimeConditionLayerState,
  type SessionService,
  type RenderIntentService,
  type SceneLayoutService,
  type SurfaceFrameService,
} from "@pooder/core";
import type { FabricRenderTargetItem } from "../canvas-service";
import { CANVAS_SERVICE } from "../tokens";

export const RENDER_GRAPH_RENDER_SCOPE = "core-render-graph";
const FABRIC_RENDER_GRAPH_TARGET = "render-graph";

export interface FabricRenderGraphSyncState {
  error?: unknown;
  generation: number;
  loading: boolean;
  pending: number;
}

export type FabricRenderGraphSyncStateListener = (
  state: FabricRenderGraphSyncState,
) => void;

type FabricRenderTargetCanvasService = CanvasService & {
  reconcileRenderGraphDrawList(
    items: FabricRenderTargetItem[],
    options?: { render?: boolean },
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
  private eventBus?: ServiceContext["eventBus"];
  private graphSubscription?: { dispose(): void };
  private sceneSubscription?: { dispose(): void };
  private canvasObjectMovingHandler?: (event?: any) => void;
  private canvasObjectScalingHandler?: (event?: any) => void;
  private canvasObjectRotatingHandler?: (event?: any) => void;
  private canvasObjectModifiedHandler?: (event?: any) => void;
  private canvasMouseDownHandler?: (event?: any) => void;
  private canvasDoubleClickHandler?: (event?: any) => void;
  private geometrySourceDisposable?: { dispose(): void };
  private layoutDisposables: Array<{ dispose(): void }> = [];
  private syncRequested = false;
  private syncPromise: Promise<void> | null = null;
  private syncGeneration = 0;
  private completedSyncGeneration = 0;
  private syncError: unknown;
  private readonly syncStateListeners =
    new Set<FabricRenderGraphSyncStateListener>();
  private readonly activeManipulations = new WeakMap<
    object,
    InteractionManipulationKind
  >();

  private readonly onRuntimeConditionChange = () => {
    this.requestSync();
  };

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
    this.eventBus = context.eventBus;

    if (!this.renderIntentService || !this.canvasService) {
      throw new Error(
        "[FabricRenderGraphAdapter] RenderIntentService and CanvasService are required.",
      );
    }

    this.graphSubscription = this.renderIntentService.onDidChange(() => {
      this.requestSync();
    });
    this.sceneSubscription = this.sceneService?.onDidChange(() => {
      this.requestSync();
    });
    this.canvasObjectMovingHandler = (event?: any) => {
      this.handleRenderGraphObjectManipulating("move", event?.target);
    };
    this.canvasObjectScalingHandler = (event?: any) => {
      this.handleRenderGraphObjectManipulating("resize", event?.target);
    };
    this.canvasObjectRotatingHandler = (event?: any) => {
      this.handleRenderGraphObjectManipulating("rotate", event?.target);
    };
    this.canvasObjectModifiedHandler = (event?: any) => {
      void this.handleRenderGraphObjectModified(event?.target);
    };
    this.canvasMouseDownHandler = (event?: any) => {
      this.handleInteractionActivation(event?.target, "primary-pointer");
    };
    this.canvasDoubleClickHandler = (event?: any) => {
      this.handleInteractionActivation(event?.target, "double-click");
    };
    this.canvasService.onCanvasEvent(
      "object:moving",
      this.canvasObjectMovingHandler,
    );
    this.canvasService.onCanvasEvent(
      "object:scaling",
      this.canvasObjectScalingHandler,
    );
    this.canvasService.onCanvasEvent(
      "object:rotating",
      this.canvasObjectRotatingHandler,
    );
    this.canvasService.onCanvasEvent(
      "object:modified",
      this.canvasObjectModifiedHandler,
    );
    this.canvasService.onCanvasEvent("mouse:down", this.canvasMouseDownHandler);
    this.canvasService.onCanvasEvent(
      "mouse:dblclick",
      this.canvasDoubleClickHandler,
    );
    this.geometrySourceDisposable = this.geometrySource?.registerSource(
      this.createRenderGraphGeometrySource(),
    );
    this.attachRuntimeConditionEvents();
    this.attachLayoutChangeEvents();
    this.requestSync();
  }

  dispose() {
    this.detachRuntimeConditionEvents();
    this.detachLayoutChangeEvents();
    if (this.canvasObjectMovingHandler) {
      this.canvasService?.offCanvasEvent(
        "object:moving",
        this.canvasObjectMovingHandler,
      );
    }
    if (this.canvasObjectModifiedHandler) {
      this.canvasService?.offCanvasEvent(
        "object:modified",
        this.canvasObjectModifiedHandler,
      );
    }
    if (this.canvasObjectScalingHandler) {
      this.canvasService?.offCanvasEvent(
        "object:scaling",
        this.canvasObjectScalingHandler,
      );
    }
    if (this.canvasObjectRotatingHandler) {
      this.canvasService?.offCanvasEvent(
        "object:rotating",
        this.canvasObjectRotatingHandler,
      );
    }
    if (this.canvasMouseDownHandler) {
      this.canvasService?.offCanvasEvent(
        "mouse:down",
        this.canvasMouseDownHandler,
      );
    }
    if (this.canvasDoubleClickHandler) {
      this.canvasService?.offCanvasEvent(
        "mouse:dblclick",
        this.canvasDoubleClickHandler,
      );
    }
    this.geometrySourceDisposable?.dispose();
    this.graphSubscription?.dispose();
    this.sceneSubscription?.dispose();
    this.graphSubscription = undefined;
    this.sceneSubscription = undefined;
    this.canvasObjectMovingHandler = undefined;
    this.canvasObjectScalingHandler = undefined;
    this.canvasObjectRotatingHandler = undefined;
    this.canvasObjectModifiedHandler = undefined;
    this.canvasMouseDownHandler = undefined;
    this.canvasDoubleClickHandler = undefined;
    this.geometrySourceDisposable = undefined;
    this.renderIntentService = undefined;
    this.sceneService = undefined;
    this.geometrySource = undefined;
    this.interactionService = undefined;
    this.canvasService = undefined;
    this.sceneLayoutService = undefined;
    this.surfaceFrameService = undefined;
    this.sessionService = undefined;
    this.eventBus = undefined;
    this.syncRequested = false;
    this.syncPromise = null;
    this.completedSyncGeneration = this.syncGeneration;
    this.emitSyncState();
    this.syncStateListeners.clear();
  }

  requestSync() {
    this.syncRequested = true;
    this.syncGeneration += 1;
    this.syncError = undefined;
    this.emitSyncState();
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
        if (this.syncRequested) {
          void this.requestSync();
          return;
        }
        this.completedSyncGeneration = this.syncGeneration;
        this.syncError = syncError;
        this.emitSyncState();
      });
    return this.syncPromise;
  }

  async flush(): Promise<void> {
    await this.requestSync();
  }

  getSyncState(): FabricRenderGraphSyncState {
    const pending = Math.max(
      0,
      this.syncGeneration - this.completedSyncGeneration,
    );
    return {
      ...(this.syncError === undefined ? {} : { error: this.syncError }),
      generation: this.syncGeneration,
      loading: pending > 0 || Boolean(this.syncPromise) || this.syncRequested,
      pending,
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

  private attachRuntimeConditionEvents() {
    const eventBus = this.eventBus;
    if (!eventBus) return;
    eventBus.on("session:change", this.onRuntimeConditionChange);
    eventBus.on("canvas:resized", this.onRuntimeConditionChange);
  }

  private detachRuntimeConditionEvents() {
    const eventBus = this.eventBus;
    if (!eventBus) return;
    eventBus.off("session:change", this.onRuntimeConditionChange);
    eventBus.off("canvas:resized", this.onRuntimeConditionChange);
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
        layoutService.onLayoutChange(surfaceId, this.onRuntimeConditionChange),
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

  private async runSyncLoop() {
    while (this.syncRequested) {
      this.syncRequested = false;
      await this.syncGraph();
    }
  }

  private async syncGraph() {
    const graph = this.requireRenderIntentService().getGraph();
    const canvas = this.requireCanvasService();
    const conditionContext = this.buildRuntimeConditionContext(graph);
    const items: FabricRenderTargetItem[] = [];

    graph.layers.forEach((layer, layerIndex) => {
      const layerEffects = this.normalizeActiveEffects(
        layer.effects,
        conditionContext,
      );

      layer.nodes.forEach((node, nodeIndex) => {
        if (!evaluateRuntimeCondition(node.visibleWhen, conditionContext))
          return;
        const spec = this.toRenderObjectSpec(
          layer,
          node,
          conditionContext,
          layerEffects,
        );
        if (!spec) return;
        items.push({
          key: node.id,
          layerId: layer.id,
          order: this.resolveGraphNodeRenderOrder(layerIndex, nodeIndex, node),
          spec,
        });
      });
    });

    const graphOrderOffset = graph.layers.length * 1_000_000;
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

    await canvas.reconcileRenderGraphDrawList(items, { render: false });
    canvas.requestRenderAll();
  }

  private resolveGraphNodeRenderOrder(
    layerIndex: number,
    nodeIndex: number,
    node: RenderGraphNode,
  ): number {
    return node.data?.documentLayerRole === "guide"
      ? 900_000_000 + layerIndex * 1_000_000 + nodeIndex
      : layerIndex * 1_000_000 + nodeIndex;
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
    const frame = this.getTargetSceneBounds(target);
    if (!frame) return;
    const result = this.requireInteractionService().resolveManipulation(kind, {
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
      coordinateSpace: "scene",
      target,
      metadata: {
        layerId: target.data?.layerId,
        renderIntentId: target.data?.renderIntentId,
        subjectId: target.data?.subjectId,
        surfaceId: target.data?.surfaceId,
      },
      commit,
    });
    if (!result.enabled) return;
    if (!commit && target && typeof target === "object") {
      this.activeManipulations.set(target, kind);
    }
    const resultFrame = result.result.frame;
    const updates: Record<string, number> = {};
    if (resultFrame) {
      const dx = canvas.toScreenLength(resultFrame.left - frame.left);
      const dy = canvas.toScreenLength(resultFrame.top - frame.top);
      if (dx !== 0) updates.left = finiteNumber(target.left, 0) + dx;
      if (dy !== 0) updates.top = finiteNumber(target.top, 0) + dy;
      if (frame.width > 0 && resultFrame.width !== frame.width) {
        updates.scaleX =
          finiteNumber(target.scaleX, 1) * (resultFrame.width / frame.width);
      }
      if (frame.height > 0 && resultFrame.height !== frame.height) {
        updates.scaleY =
          finiteNumber(target.scaleY, 1) * (resultFrame.height / frame.height);
      }
    }
    const resultPosition = result.result.position;
    if (!resultFrame && resultPosition) {
      updates.left =
        finiteNumber(target.left, 0) +
        canvas.toScreenLength(resultPosition.x - frame.left);
      updates.top =
        finiteNumber(target.top, 0) +
        canvas.toScreenLength(resultPosition.y - frame.top);
    }
    const resultSize = result.result.size;
    if (
      resultSize &&
      frame.width > 0 &&
      frame.height > 0 &&
      (resultSize.width !== frame.width || resultSize.height !== frame.height)
    ) {
      updates.scaleX =
        finiteNumber(target.scaleX, 1) * (resultSize.width / frame.width);
      updates.scaleY =
        finiteNumber(target.scaleY, 1) * (resultSize.height / frame.height);
    }
    if (typeof result.result.rotation === "number") {
      updates.angle = result.result.rotation;
    }
    const scale = result.result.scale;
    if (typeof scale === "number") {
      updates.scaleX = scale;
      updates.scaleY = scale;
    } else if (scale) {
      updates.scaleX = scale.x;
      updates.scaleY = scale.y;
    }
    if (Object.keys(updates).length) target.set?.(updates);
    target.setCoords?.();
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
        ? this.activeManipulations.get(target)
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
      subjectId: target.data?.subjectId ?? target.data?.subject?.objectId,
      surfaceId: target.data?.surfaceId ?? target.data?.subject?.surfaceId,
      targetData: cloneRecord(target.data ?? {}),
      trigger,
    });
  }

  private resolveLiveObjectFrame(objectId: string): GeometryRect | null {
    const canvas = this.canvasService;
    if (!canvas) return null;
    const normalized = String(objectId || "").trim();
    if (!normalized) return null;
    const target = canvas.selectObjects({
      data: { renderTarget: FABRIC_RENDER_GRAPH_TARGET },
      subjectIds: [normalized],
    })[0];
    return target ? this.getTargetSceneBounds(target) : null;
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

  private createRenderGraphGeometrySource(): GeometrySourceProvider {
    return {
      sourceId: "render-graph",
      getGeometry: (ref) => {
        const rect = this.resolveLiveObjectFrame(ref.geometryId);
        return rect
          ? {
              kind: "rect",
              ref,
              space: "scene",
              rect,
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
        this.sessionService?.isSessionActive(sessionId) ?? false,
      isSessionScopeActive: (scope) =>
        this.sessionService?.hasActiveSession({ scope }) ?? false,
      isSessionFocused: (sessionId: string) =>
        this.sessionService?.getFocusedSessionId() === sessionId,
      hasAnyActiveSession: (scope) =>
        this.sessionService?.hasActiveSession({ scope }) ?? false,
    });
  }

  private toRenderObjectSpec(
    layer: RenderGraphLayer,
    node: RenderGraphNode,
    conditionContext: ReturnType<
      FabricRenderGraphAdapter["buildRuntimeConditionContext"]
    >,
    layerEffects: RenderEffectSpec[] = [],
  ): RenderObjectSpec | null {
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
    const selectable = hasDeclarativeInteraction
      ? interactionState.selectionEnabled
      : node.props.selectable === true;
    const evented = hasDeclarativeInteraction
      ? interactionState.hitTestEnabled
      : typeof node.props.evented === "boolean"
        ? node.props.evented
        : selectable;
    const commonProps = {
      ...node.props,
      ...this.resolvePlacementProps(node),
      selectable,
      evented,
      hasControls: controlsEnabled,
      hasBorders: controlsEnabled,
      lockMovementX: !moveEnabled,
      lockMovementY: !moveEnabled,
      lockScalingX: !resizeEnabled,
      lockScalingY: !resizeEnabled,
      lockRotation: !rotateEnabled,
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
      ...(node.interaction ? { interactionSpec: node.interaction } : {}),
    };
    const effects = [
      ...layerEffects,
      ...this.normalizeActiveEffects(node.effects, conditionContext),
    ];

    if (node.type === "image") {
      const src = node.visual?.src;
      if (!src) return null;
      return {
        id: node.id,
        type: "image",
        src,
        space: node.coordinateSpace,
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
        data: commonData,
        ...(effects.length ? { effects } : {}),
        props: commonProps,
      };
    }

    return {
      id: node.id,
      type: "text",
      space: node.coordinateSpace,
      data: commonData,
      ...(effects.length ? { effects } : {}),
      props: commonProps,
    };
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
      ? element.data.renderProps
      : {};
    const props = {
      ...element.style,
      ...element.transform,
      ...renderProps,
      ...(element.type === "rect"
        ? { width: element.width, height: element.height }
        : {}),
      ...(element.type === "path" ? { pathData: element.path } : {}),
      ...(element.type === "text" ? { text: element.text } : {}),
      visible:
        scene.visible !== false &&
        layer.visible !== false &&
        element.visible !== false,
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
    };
    return {
      id: element.id,
      type: element.type,
      ...(element.type === "image" ? { src: element.src } : {}),
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

  private resolvePlacementProps(
    node: RenderGraphNode,
  ): Record<string, unknown> {
    const frame = node.frame;
    const transform = node.transform ?? {};
    const hasTransformLeft = Number.isFinite(transform.left);
    const hasTransformTop = Number.isFinite(transform.top);

    if (node.type === "image" && frame) {
      return {
        ...transform,
        left: hasTransformLeft ? transform.left : frame.x + frame.width / 2,
        top: hasTransformTop ? transform.top : frame.y + frame.height / 2,
        originX: hasTransformLeft ? transform.originX : "center",
        originY: hasTransformTop ? transform.originY : "center",
        width: frame.width,
        height: frame.height,
        scaleX: normalizeFrameImageScale(transform.scaleX),
        scaleY: normalizeFrameImageScale(transform.scaleY),
      };
    }

    if (!frame) {
      return { ...transform };
    }

    const placement = {
      left: hasTransformLeft ? transform.left : frame.x,
      top: hasTransformTop ? transform.top : frame.y,
      originX: transform.originX ?? "left",
      originY: transform.originY ?? "top",
    };

    if (node.type === "path") {
      return {
        ...transform,
        ...placement,
      };
    }

    return {
      ...transform,
      ...placement,
      width: frame.width,
      height: frame.height,
    };
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

function normalizeFrameImageScale(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed < 0 ? -1 : 1;
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
