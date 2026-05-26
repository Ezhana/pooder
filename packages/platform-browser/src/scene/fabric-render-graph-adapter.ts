import {
  CONSTRAINT_RESOLVER_SERVICE,
  GEOMETRY_SOURCE_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_SERVICE,
  SESSION_SERVICE,
  WORKBENCH_SERVICE,
  evaluateVisibilityExpr,
  type CanvasService,
  type ConstraintResolverCapability,
  type ConstraintSpec,
  type GeometryRect,
  type GeometrySourceCapability,
  type GeometrySourceProvider,
  type RenderEffectSpec,
  type RenderGraph,
  type RenderGraphLayer,
  type RenderGraphNode,
  type RenderIntentInteractionConstraint,
  type RenderObjectSpec,
  type SceneElement,
  type SceneLayer,
  type SceneRecord,
  type SceneService,
  type Service,
  type ServiceContext,
  type VisibilityLayerState,
  type SessionService,
  type RenderIntentService,
  type WorkbenchService,
} from "@pooder/core";
import type {
  FabricRenderTargetClipEffect,
  FabricRenderTargetItem,
} from "../canvas-service";
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
    effects?: FabricRenderTargetClipEffect[],
    options?: { render?: boolean },
  ): Promise<void>;
};

export class FabricRenderGraphAdapter implements Service {
  private renderIntentService?: RenderIntentService;
  private sceneService?: SceneService;
  private geometrySource?: GeometrySourceCapability;
  private constraintResolver?: ConstraintResolverCapability;
  private workbenchService?: WorkbenchService;
  private canvasService?: FabricRenderTargetCanvasService;
  private sessionService?: SessionService;
  private eventBus?: ServiceContext["eventBus"];
  private graphSubscription?: { dispose(): void };
  private sceneSubscription?: { dispose(): void };
  private canvasObjectMovingHandler?: (event?: any) => void;
  private canvasObjectModifiedHandler?: (event?: any) => void;
  private geometrySourceDisposable?: { dispose(): void };
  private syncRequested = false;
  private syncPromise: Promise<void> | null = null;
  private syncGeneration = 0;
  private completedSyncGeneration = 0;
  private syncError: unknown;
  private readonly syncStateListeners =
    new Set<FabricRenderGraphSyncStateListener>();

  private readonly onRuntimeVisibilityChange = () => {
    this.requestSync();
  };

  init(context: ServiceContext) {
    this.graphSubscription?.dispose();
    this.sceneSubscription?.dispose();
    this.renderIntentService = context.get(RENDER_INTENT_SERVICE);
    this.sceneService = context.get(SCENE_SERVICE);
    this.geometrySource = context.get(GEOMETRY_SOURCE_SERVICE);
    this.constraintResolver = context.get(CONSTRAINT_RESOLVER_SERVICE);
    this.workbenchService = context.get(WORKBENCH_SERVICE);
    this.canvasService = context.get(CANVAS_SERVICE) as
      | FabricRenderTargetCanvasService
      | undefined;
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
      this.handleRenderGraphObjectMoving(event?.target);
    };
    this.canvasObjectModifiedHandler = (event?: any) => {
      void this.handleRenderGraphObjectModified(event?.target);
    };
    this.canvasService.onCanvasEvent("object:moving", this.canvasObjectMovingHandler);
    this.canvasService.onCanvasEvent(
      "object:modified",
      this.canvasObjectModifiedHandler,
    );
    this.geometrySourceDisposable = this.geometrySource?.registerSource(
      this.createRenderGraphGeometrySource(),
    );
    this.attachRuntimeVisibilityEvents();
    this.requestSync();
  }

  dispose() {
    this.detachRuntimeVisibilityEvents();
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
    this.geometrySourceDisposable?.dispose();
    this.graphSubscription?.dispose();
    this.sceneSubscription?.dispose();
    this.graphSubscription = undefined;
    this.sceneSubscription = undefined;
    this.canvasObjectMovingHandler = undefined;
    this.canvasObjectModifiedHandler = undefined;
    this.geometrySourceDisposable = undefined;
    this.renderIntentService = undefined;
    this.sceneService = undefined;
    this.geometrySource = undefined;
    this.constraintResolver = undefined;
    this.workbenchService = undefined;
    this.canvasService = undefined;
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
    const pending = Math.max(0, this.syncGeneration - this.completedSyncGeneration);
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

  private attachRuntimeVisibilityEvents() {
    const eventBus = this.eventBus;
    if (!eventBus) return;
    eventBus.on("session:change", this.onRuntimeVisibilityChange);
    eventBus.on("scene:layout:change", this.onRuntimeVisibilityChange);
    eventBus.on("tool:switch", this.onRuntimeVisibilityChange);
  }

  private detachRuntimeVisibilityEvents() {
    const eventBus = this.eventBus;
    if (!eventBus) return;
    eventBus.off("session:change", this.onRuntimeVisibilityChange);
    eventBus.off("scene:layout:change", this.onRuntimeVisibilityChange);
    eventBus.off("tool:switch", this.onRuntimeVisibilityChange);
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
    const visibility = this.buildVisibilityContext(graph);
    const items: FabricRenderTargetItem[] = [];
    const effects: FabricRenderTargetClipEffect[] = [];

    graph.layers.forEach((layer, layerIndex) => {
      layer.effects.forEach((effect, index) => {
        const normalized = this.toClipEffect(effect, `layer:${layer.id}:${index}`, visibility);
        if (normalized) effects.push(normalized);
      });

      layer.nodes.forEach((node, nodeIndex) => {
        node.effects.forEach((effect, index) => {
          const normalized = this.toClipEffect(
            effect,
            `node:${node.id}:${index}`,
            visibility,
          );
          if (normalized) effects.push(normalized);
        });

        if (!evaluateVisibilityExpr(node.visibility, visibility)) return;
        const spec = this.toRenderObjectSpec(layer, node, visibility);
        if (!spec) return;
        items.push({
          key: node.id,
          layerId: layer.id,
          order: layerIndex * 1_000_000 + nodeIndex,
          spec,
        });
      });
    });

    const graphOrderOffset = graph.layers.length * 1_000_000;
    this.getRenderableScenes().forEach((scene, sceneIndex) => {
      const sceneLayers = this.sceneService!.selectLayers({ sceneId: scene.id });
      sceneLayers.forEach((layer, layerIndex) => {
        if (layer.visible === false) return;
        const elements = this.sceneService!.selectElements({
          sceneId: scene.id,
          layerIds: [layer.id],
        });
        elements.forEach((element, elementIndex) => {
          if (element.visible === false) return;
          const spec = this.toSceneRenderObjectSpec(scene, layer, element);
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

    await canvas.reconcileRenderGraphDrawList(items, effects, { render: false });
    canvas.requestRenderAll();
  }

  private handleRenderGraphObjectMoving(target: any) {
    const canvas = this.canvasService;
    if (!canvas || target?.data?.renderTarget !== FABRIC_RENDER_GRAPH_TARGET) {
      return;
    }
    if (target.data?.interactionEnabled !== true) return;
    const constraints = normalizeConstraintSpecs(target.data?.interactionConstraints);
    if (!constraints.length) return;

    const frame = this.getTargetSceneBounds(target);
    if (!frame) return;
    const resolved = this.requireConstraintResolver().resolve({
      transform: { frame },
      constraints,
      coordinateSpace: "scene",
      metadata: {
        renderIntentId: target.data?.renderIntentId,
        subjectId: target.data?.subjectId,
      },
    });
    const resultFrame = resolved.result.frame;
    if (!resultFrame) return;
    const dx = canvas.toScreenLength(resultFrame.left - frame.left);
    const dy = canvas.toScreenLength(resultFrame.top - frame.top);
    if (dx === 0 && dy === 0) return;
    target.set?.({
      left: finiteNumber(target.left, 0) + dx,
      top: finiteNumber(target.top, 0) + dy,
    });
    target.setCoords?.();
  }

  private handleRenderGraphObjectModified(target: any) {
    if (
      target?.data?.renderTarget !== FABRIC_RENDER_GRAPH_TARGET ||
      target.data?.interactionEnabled !== true
    ) {
      return;
    }
    const frame = this.getTargetSceneBounds(target);
    if (!frame) return;
    this.eventBus?.emit("render-graph:object-transform", {
      renderIntentId: target.data?.renderIntentId ?? target.data?.renderNodeId,
      subjectId: target.data?.subjectId ?? target.data?.subject?.objectId,
      layerId: target.data?.layerId,
      surfaceId: target.data?.subject?.surfaceId,
      transform: { frame },
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
            width: finiteNumber(target.width, 0) * finiteNumber(target.scaleX, 1),
            height: finiteNumber(target.height, 0) * finiteNumber(target.scaleY, 1),
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

  private requireConstraintResolver(): ConstraintResolverCapability {
    if (!this.constraintResolver) {
      throw new Error(
        "[FabricRenderGraphAdapter] ConstraintResolverCapability is not initialized.",
      );
    }
    return this.constraintResolver;
  }

  private buildVisibilityContext(graph: RenderGraph) {
    const layers = new Map<string, VisibilityLayerState>();
    graph.layers.forEach((layer) => {
      const visibleNodes = layer.nodes.filter((node) => node.visible !== false);
      layers.set(layer.id, {
        exists: true,
        objectCount: layer.nodes.length,
        visibleObjectCount: visibleNodes.length,
      });
    });
    this.getRenderableScenes().forEach((scene) => {
      this.sceneService?.selectLayers({ sceneId: scene.id }).forEach((layer) => {
        const elements =
          this.sceneService?.selectElements({
            sceneId: scene.id,
            layerIds: [layer.id],
          }) ??
          [];
        const visibleNodes = elements.filter((element) => element.visible !== false);
        layers.set(layer.id, {
          exists: true,
          objectCount: elements.length,
          visibleObjectCount: visibleNodes.length,
        });
      });
    });

    return this.requireRenderIntentService().createVisibilityEvalContext({
      activeToolId: this.workbenchService?.activeToolId ?? null,
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

  private toClipEffect(
    effect: RenderEffectSpec,
    fallbackKey: string,
    visibility: ReturnType<FabricRenderGraphAdapter["buildVisibilityContext"]>,
  ): FabricRenderTargetClipEffect | null {
    if (effect.type !== "clipPath") return null;
    if (!evaluateVisibilityExpr(effect.visibility, visibility)) return null;
    const key = String(effect.id || fallbackKey).trim();
    return {
      key,
      source: effect.source,
      targetLayerIds: normalizeIds(effect.targetLayerIds),
      targetSubjectIds: normalizeIds(effect.targetSubjectIds),
    };
  }

  private toRenderObjectSpec(
    layer: RenderGraphLayer,
    node: RenderGraphNode,
    visibility: ReturnType<FabricRenderGraphAdapter["buildVisibilityContext"]>,
  ): RenderObjectSpec | null {
    const hasDeclarativeInteraction =
      typeof node.interaction?.enabled === "boolean" ||
      node.interaction?.when !== undefined;
    const interactionEnabled =
      node.interaction?.enabled === true &&
      evaluateVisibilityExpr(node.interaction.when, visibility);
    const selectable = hasDeclarativeInteraction
      ? interactionEnabled
      : node.props.selectable === true;
    const evented = hasDeclarativeInteraction
      ? interactionEnabled
      : typeof node.props.evented === "boolean"
        ? node.props.evented
        : selectable;
    const interactionConstraints = interactionEnabled
      ? normalizeRenderInteractionConstraints(node.interaction?.constraints, visibility)
      : [];
    const commonProps = {
      ...node.props,
      ...this.resolvePlacementProps(node),
      selectable,
      evented,
      visible: layer.visible && node.visible,
    };
    const commonData = {
      ...node.data,
      layerId: layer.id,
      renderLayerId: layer.id,
      renderNodeId: node.id,
      subjectId: node.subjectId,
      exportKeys: node.exportKeys,
      tags: node.tags,
      interactionEnabled,
      ...(interactionConstraints.length
        ? { interactionConstraints }
        : {}),
    };

    if (node.type === "image") {
      const src = node.visual?.src;
      if (!src) return null;
      return {
        id: node.id,
        type: "image",
        src,
        space: node.coordinateSpace,
        data: commonData,
        props: commonProps,
      };
    }

    if (node.type === "path") {
      return {
        id: node.id,
        type: "path",
        space: node.coordinateSpace,
        data: commonData,
        props: commonProps,
      };
    }

    if (node.type === "rect") {
      return {
        id: node.id,
        type: "rect",
        space: node.coordinateSpace,
        data: commonData,
        props: commonProps,
      };
    }

    return {
      id: node.id,
      type: "text",
      space: node.coordinateSpace,
      data: commonData,
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
  ): RenderObjectSpec | null {
    const renderProps = isRecord(element.data?.renderProps)
      ? element.data.renderProps
      : {};
    const props = {
      ...element.style,
      ...element.transform,
      ...renderProps,
      ...(element.type === "rect" ? { width: element.width, height: element.height } : {}),
      ...(element.type === "path" ? { pathData: element.path } : {}),
      ...(element.type === "text" ? { text: element.text } : {}),
      visible: scene.visible !== false && layer.visible !== false && element.visible !== false,
    };
    const exportKeys = [
      element.id,
      ...normalizeIds(element.data?.exportKeys),
    ];
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
      props,
    };
  }

  private resolvePlacementProps(node: RenderGraphNode): Record<string, unknown> {
    const frame = node.frame;
    const transform = node.transform ?? {};
    const hasTransformLeft = Number.isFinite(transform.left);
    const hasTransformTop = Number.isFinite(transform.top);
    const nodeVisual = node.visual;
    const visualMetadata = isRecord(nodeVisual?.metadata)
      ? nodeVisual.metadata
      : undefined;
    const derivedMetadata = isRecord(visualMetadata?.derived)
      ? visualMetadata.derived
      : undefined;
    const imageWidth = finitePositiveNumber(
      derivedMetadata?.width ?? visualMetadata?.width,
    );
    const imageHeight = finitePositiveNumber(
      derivedMetadata?.height ?? visualMetadata?.height,
    );
    const hasFrameSizedImage =
      node.type === "image" && frame && imageWidth && imageHeight;

    if (hasFrameSizedImage) {
      return {
        ...transform,
        left: hasTransformLeft ? transform.left : frame.x + frame.width / 2,
        top: hasTransformTop ? transform.top : frame.y + frame.height / 2,
        originX: hasTransformLeft ? transform.originX : "center",
        originY: hasTransformTop ? transform.originY : "center",
        scaleX: transform.scaleX ?? frame.width / imageWidth,
        scaleY: transform.scaleY ?? frame.height / imageHeight,
      };
    }

    return {
      ...transform,
      ...(frame
        ? {
            left: hasTransformLeft ? transform.left : frame.x,
            top: hasTransformTop ? transform.top : frame.y,
            width: frame.width,
            height: frame.height,
            originX: hasTransformLeft ? transform.originX : "left",
            originY: hasTransformTop ? transform.originY : "top",
          }
        : {}),
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
      throw new Error("[FabricRenderGraphAdapter] CanvasService is not initialized.");
    }
    return this.canvasService;
  }
}

function finitePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRenderInteractionConstraints(
  value: unknown,
  visibility: ReturnType<FabricRenderGraphAdapter["buildVisibilityContext"]>,
): ConstraintSpec[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((constraint): ConstraintSpec | null => {
      if (!isRecord(constraint)) return null;
      const item = constraint as Partial<RenderIntentInteractionConstraint>;
      if (!evaluateVisibilityExpr(item.when, visibility)) return null;
      return normalizeConstraintSpec(item.spec);
    })
    .filter((constraint): constraint is ConstraintSpec => Boolean(constraint));
}

function normalizeConstraintSpecs(value: unknown): ConstraintSpec[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeConstraintSpec(item))
    .filter((item): item is ConstraintSpec => Boolean(item));
}

function normalizeConstraintSpec(value: unknown): ConstraintSpec | null {
  if (!isRecord(value)) return null;
  const type = String(value.type || "").trim();
  if (!type) return null;
  return {
    type,
    ...(value.source !== undefined
      ? { source: value.source as ConstraintSpec["source"] }
      : {}),
    ...(typeof value.mode === "string" ? { mode: value.mode } : {}),
    ...(isRecord(value.params) ? { params: { ...value.params } } : {}),
  };
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
