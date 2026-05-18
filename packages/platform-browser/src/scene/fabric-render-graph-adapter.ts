import {
  RENDER_INTENT_SERVICE,
  TOOL_SESSION_SERVICE,
  WORKBENCH_SERVICE,
  WORKFLOW_SESSION_SERVICE,
  evaluateVisibilityExpr,
  type CanvasService,
  type RenderEffectSpec,
  type RenderGraph,
  type RenderGraphLayer,
  type RenderGraphNode,
  type RenderObjectSpec,
  type Service,
  type ServiceContext,
  type ToolSessionService,
  type VisibilityLayerState,
  type WorkbenchService,
  type WorkflowSessionService,
  type RenderIntentService,
} from "@pooder/core";
import type {
  FabricRenderTargetClipEffect,
  FabricRenderTargetItem,
} from "../canvas-service";
import { CANVAS_SERVICE } from "../tokens";

export const RENDER_GRAPH_RENDER_SCOPE = "core-render-graph";

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
  private canvasService?: FabricRenderTargetCanvasService;
  private workbenchService?: WorkbenchService;
  private toolSessionService?: ToolSessionService;
  private workflowSessionService?: WorkflowSessionService;
  private eventBus?: ServiceContext["eventBus"];
  private graphSubscription?: { dispose(): void };
  private canvasMouseDownHandler?: (event?: any) => void;
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
    this.renderIntentService = context.get(RENDER_INTENT_SERVICE);
    this.canvasService = context.get(CANVAS_SERVICE) as
      | FabricRenderTargetCanvasService
      | undefined;
    this.workbenchService = context.get(WORKBENCH_SERVICE);
    this.toolSessionService = context.get(TOOL_SESSION_SERVICE);
    this.workflowSessionService = context.get(WORKFLOW_SESSION_SERVICE);
    this.eventBus = context.eventBus;

    if (!this.renderIntentService || !this.canvasService) {
      throw new Error(
        "[FabricRenderGraphAdapter] RenderIntentService and CanvasService are required.",
      );
    }

    this.graphSubscription = this.renderIntentService.onDidChange(() => {
      this.requestSync();
    });
    this.attachRuntimeVisibilityEvents();
    this.attachCanvasInteractionEvents();
    this.requestSync();
  }

  dispose() {
    this.detachRuntimeVisibilityEvents();
    this.detachCanvasInteractionEvents();
    this.graphSubscription?.dispose();
    this.graphSubscription = undefined;
    this.renderIntentService = undefined;
    this.canvasService = undefined;
    this.workbenchService = undefined;
    this.toolSessionService = undefined;
    this.workflowSessionService = undefined;
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
    eventBus.on("tool:activated", this.onRuntimeVisibilityChange);
    eventBus.on("tool:session:change", this.onRuntimeVisibilityChange);
    eventBus.on("workflow:session:change", this.onRuntimeVisibilityChange);
    eventBus.on("scene:layout:change", this.onRuntimeVisibilityChange);
  }

  private attachCanvasInteractionEvents() {
    if (
      !this.canvasService ||
      this.canvasMouseDownHandler ||
      typeof this.canvasService.onCanvasEvent !== "function"
    ) {
      return;
    }
    this.canvasMouseDownHandler = (event?: any) => {
      this.startInteractionSessionFromTarget(event?.target);
    };
    this.canvasService.onCanvasEvent("mouse:down", this.canvasMouseDownHandler);
  }

  private detachCanvasInteractionEvents() {
    if (
      !this.canvasService ||
      !this.canvasMouseDownHandler ||
      typeof this.canvasService.offCanvasEvent !== "function"
    ) {
      return;
    }
    this.canvasService.offCanvasEvent("mouse:down", this.canvasMouseDownHandler);
    this.canvasMouseDownHandler = undefined;
  }

  private startInteractionSessionFromTarget(target: any) {
    const session = normalizeInteractionSession(target?.data?.session);
    if (!session || !this.workflowSessionService) return;
    this.workflowSessionService.startSession({
      ...session,
      source: session.source || "render-graph",
      payload: {
        ...(session.payload ?? {}),
        renderNodeId: target?.data?.renderNodeId,
        subjectId: target?.data?.subjectId,
      },
    });
  }

  private detachRuntimeVisibilityEvents() {
    const eventBus = this.eventBus;
    if (!eventBus) return;
    eventBus.off("tool:activated", this.onRuntimeVisibilityChange);
    eventBus.off("tool:session:change", this.onRuntimeVisibilityChange);
    eventBus.off("workflow:session:change", this.onRuntimeVisibilityChange);
    eventBus.off("scene:layout:change", this.onRuntimeVisibilityChange);
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
      const layerVisible =
        layer.visible !== false &&
        evaluateVisibilityExpr(undefined, visibility);
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

        if (!layerVisible || !node.visible) return;
        if (!evaluateVisibilityExpr(node.visibility, visibility)) return;
        const spec = this.toRenderObjectSpec(layer, node);
        if (!spec) return;
        items.push({
          key: node.id,
          layerId: layer.id,
          order: layerIndex * 1_000_000 + nodeIndex,
          spec,
        });
      });
    });

    await canvas.reconcileRenderGraphDrawList(items, effects, { render: false });
    canvas.requestRenderAll();
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

    return this.requireRenderIntentService().createVisibilityEvalContext({
      activeToolId: this.workbenchService?.activeToolId ?? null,
      getLayerState: (layerId: string) => layers.get(layerId),
      isWorkflowSessionActive: (workflowId: string) =>
        this.workflowSessionService?.hasActiveSession(workflowId) ?? false,
      hasAnyActiveWorkflowSession: () =>
        this.workflowSessionService?.hasAnyActiveSession() ?? false,
      isSessionActive: (toolId: string) =>
        this.toolSessionService?.getState(toolId).status === "active",
      hasAnyActiveSession: () =>
        this.toolSessionService?.hasAnyActiveSession() ?? false,
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
  ): RenderObjectSpec | null {
    const commonProps = {
      ...node.props,
      ...this.resolvePlacementProps(node),
      visible: layer.visible && node.visible,
      excludeFromExport: !node.exportable,
    };
    const commonData = {
      ...node.data,
      layerId: layer.id,
      renderLayerId: layer.id,
      renderNodeId: node.id,
      subjectId: node.subjectId,
      exportKeys: node.exportKeys,
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

  private resolvePlacementProps(node: RenderGraphNode): Record<string, unknown> {
    const frame = node.frame;
    const transform = node.transform ?? {};
    const hasTransformLeft = Number.isFinite(transform.left);
    const hasTransformTop = Number.isFinite(transform.top);
    const visualMetadata = isRecord(node.visual?.metadata)
      ? node.visual.metadata
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

function normalizeInteractionSession(value: unknown): {
  kind: string;
  surfaceId?: string | null;
  objectId?: string | null;
  source?: string;
  mode?: string | null;
  payload?: Record<string, unknown>;
} | null {
  if (!isRecord(value)) return null;
  const kind = normalizeText(value.kind);
  if (!kind) return null;
  return {
    kind,
    surfaceId: normalizeText(value.surfaceId) || null,
    objectId: normalizeText(value.objectId) || null,
    source: normalizeText(value.source),
    mode: normalizeText(value.mode) || null,
    payload: isRecord(value.payload) ? { ...value.payload } : {},
  };
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
