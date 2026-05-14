import {
  RENDER_INTENT_SERVICE,
  type CanvasPassStackingMeta,
  type CanvasService,
  type RenderGraphLayer,
  type RenderGraphNode,
  type RenderIntentService,
  type RenderObjectSpec,
  type Service,
  type ServiceContext,
} from "@pooder/core";
import { CANVAS_SERVICE } from "../tokens";

export const RENDER_GRAPH_RENDER_SCOPE = "core-render-graph";

export class FabricRenderGraphAdapter implements Service {
  private renderIntentService?: RenderIntentService;
  private canvasService?: CanvasService;
  private graphSubscription?: { dispose(): void };
  private renderedPassIds = new Set<string>();
  private syncRequested = false;
  private syncPromise: Promise<void> | null = null;

  init(context: ServiceContext) {
    this.graphSubscription?.dispose();
    this.renderIntentService = context.get(RENDER_INTENT_SERVICE);
    this.canvasService = context.get(CANVAS_SERVICE);

    if (!this.renderIntentService || !this.canvasService) {
      throw new Error(
        "[FabricRenderGraphAdapter] RenderIntentService and CanvasService are required.",
      );
    }

    this.graphSubscription = this.renderIntentService.onDidChange(() => {
      this.requestSync();
    });
    this.requestSync();
  }

  dispose() {
    this.graphSubscription?.dispose();
    this.graphSubscription = undefined;
    this.renderIntentService = undefined;
    this.canvasService = undefined;
    this.renderedPassIds.clear();
    this.syncRequested = false;
    this.syncPromise = null;
  }

  requestSync() {
    this.syncRequested = true;
    if (this.syncPromise) return this.syncPromise;

    this.syncPromise = Promise.resolve()
      .then(() => this.runSyncLoop())
      .catch((error) => {
        console.error("[FabricRenderGraphAdapter] graph sync failed.", error);
      })
      .finally(() => {
        this.syncPromise = null;
        if (this.syncRequested) {
          void this.requestSync();
        }
      });
    return this.syncPromise;
  }

  async flush(): Promise<void> {
    await this.requestSync();
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
    const nextPassIds = new Set(graph.layers.map((layer) => layer.id));

    for (const passId of this.renderedPassIds) {
      if (nextPassIds.has(passId)) continue;
      await canvas.applyObjectSpecsToPass(passId, [], {
        render: false,
        replace: true,
        scope: RENDER_GRAPH_RENDER_SCOPE,
      });
    }

    for (const layer of graph.layers) {
      await canvas.applyPassSpec(
        {
          id: layer.id,
          stack: layer.stack,
          order: layer.order,
          replace: true,
          effects: layer.effects,
          objects: layer.nodes
            .filter((node) => layer.visible && node.visible)
            .map((node) => this.toRenderObjectSpec(layer, node))
            .filter((spec): spec is RenderObjectSpec => Boolean(spec)),
        },
        { render: false },
      );
    }

    canvas.syncPassStacking(
      graph.layers.map(
        (layer): CanvasPassStackingMeta => ({
          id: layer.id,
          stack: layer.stack,
          order: layer.order,
        }),
      ),
    );
    canvas.requestRenderAll();
    this.renderedPassIds = nextPassIds;
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
      renderGraphLayerId: layer.id,
      renderGraphNodeId: node.id,
      sceneElementId:
        typeof node.data.sceneElementId === "string"
          ? node.data.sceneElementId
          : node.subjectId,
      sceneLayerId:
        typeof node.data.sceneLayerId === "string"
          ? node.data.sceneLayerId
          : node.layerId,
    };

    if (node.type === "image") {
      const src = node.visual?.src;
      if (!src) return null;
      return {
        id: node.id,
        type: "image",
        src,
        space: "scene",
        data: commonData,
        props: commonProps,
        visibility: node.visibility,
      };
    }

    if (node.type === "path") {
      return {
        id: node.id,
        type: "path",
        space: "scene",
        data: commonData,
        props: commonProps,
        visibility: node.visibility,
      };
    }

    if (node.type === "rect") {
      return {
        id: node.id,
        type: "rect",
        space: "scene",
        data: commonData,
        props: commonProps,
        visibility: node.visibility,
      };
    }

    return {
      id: node.id,
      type: "text",
      space: "scene",
      data: commonData,
      props: commonProps,
      visibility: node.visibility,
    };
  }

  private resolvePlacementProps(node: RenderGraphNode): Record<string, unknown> {
    const frame = node.frame;
    const transform = node.transform ?? {};
    const hasTransformLeft = Number.isFinite(transform.left);
    const hasTransformTop = Number.isFinite(transform.top);
    const imageWidth = finitePositiveNumber(node.visual?.metadata?.width);
    const imageHeight = finitePositiveNumber(node.visual?.metadata?.height);
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

  private requireCanvasService(): CanvasService {
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
