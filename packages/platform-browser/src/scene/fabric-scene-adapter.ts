import type {
  SceneElement,
  SceneService,
  Service,
  ServiceContext,
} from "@pooder/core";
import { SCENE_SERVICE } from "@pooder/core";
import type {
  CanvasPassStackingMeta,
  CanvasService,
} from "@pooder/core";
import type { RenderObjectSpec } from "../render-spec";
import { CANVAS_SERVICE } from "../tokens";

const SCENE_RENDER_SCOPE = "core-scene";
const DOCUMENT_OVERLAY_LAYER_STACK = 780;

function resolveSceneLayerStack(layer: { metadata?: Record<string, unknown> }): number {
  return layer.metadata?.documentLayerRole === "overlay"
    ? DOCUMENT_OVERLAY_LAYER_STACK
    : 0;
}

export class FabricSceneAdapter implements Service {
  private sceneService?: SceneService;
  private canvasService?: CanvasService;
  private sceneSubscription?: { dispose(): void };
  private renderedLayerIds = new Set<string>();
  private syncRequested = false;
  private syncPromise: Promise<void> | null = null;

  init(context: ServiceContext) {
    this.sceneSubscription?.dispose();
    this.sceneService = context.get(SCENE_SERVICE);
    this.canvasService = context.get(CANVAS_SERVICE);

    if (!this.sceneService || !this.canvasService) {
      throw new Error(
        "[FabricSceneAdapter] SceneService and CanvasService are required.",
      );
    }

    this.sceneSubscription = this.sceneService.onDidChange(() => {
      this.requestSync();
    });
    this.requestSync();
  }

  dispose() {
    this.sceneSubscription?.dispose();
    this.sceneSubscription = undefined;
    this.sceneService = undefined;
    this.canvasService = undefined;
    this.renderedLayerIds.clear();
    this.syncRequested = false;
    this.syncPromise = null;
  }

  requestSync() {
    this.syncRequested = true;
    if (this.syncPromise) {
      return this.syncPromise;
    }

    this.syncPromise = Promise.resolve()
      .then(() => this.runSyncLoop())
      .catch((error) => {
        console.error("[FabricSceneAdapter] scene sync failed.", error);
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
      await this.syncScene();
    }
  }

  private async syncScene() {
    const scene = this.requireSceneService();
    const canvas = this.requireCanvasService();
    const layers = scene.listLayers();
    const nextLayerIds = new Set(layers.map((layer) => layer.id));

    for (const layerId of this.renderedLayerIds) {
      if (nextLayerIds.has(layerId)) {
        continue;
      }
      await canvas.applyObjectSpecsToPass(layerId, [], {
        render: false,
        replace: true,
        scope: SCENE_RENDER_SCOPE,
      });
    }

    for (const layer of layers) {
      const specs = scene
        .listElements({ layerId: layer.id })
        .map((element) => this.toRenderObjectSpec(element, layer.visible));

      await canvas.applyObjectSpecsToPass(layer.id, specs, {
        render: false,
        replace: true,
        scope: SCENE_RENDER_SCOPE,
      });
    }

    canvas.syncPassStacking(
      layers.map(
        (layer): CanvasPassStackingMeta => ({
          id: layer.id,
          stack: resolveSceneLayerStack(layer),
          order: layer.order,
        }),
      ),
    );
    canvas.requestRenderAll();
    this.renderedLayerIds = nextLayerIds;
  }

  private toRenderObjectSpec(
    element: SceneElement,
    layerVisible: boolean,
  ): RenderObjectSpec {
    const visible = layerVisible && element.visible;
    const commonProps = {
      ...(element.style || {}),
      ...(element.transform || {}),
      visible,
    };
    const commonData = {
      ...(element.data || {}),
      sceneElementId: element.id,
      sceneLayerId: element.layerId,
      sceneMetadata: element.metadata,
    };

    if (element.type === "image") {
      return {
        id: element.id,
        type: "image",
        src: element.src,
        space: "scene",
        data: commonData,
        props: {
          ...commonProps,
          width: element.width,
          height: element.height,
        },
      };
    }

    if (element.type === "path") {
      return {
        id: element.id,
        type: "path",
        space: "scene",
        data: commonData,
        props: {
          ...commonProps,
          path: element.path,
        },
      };
    }

    if (element.type === "rect") {
      return {
        id: element.id,
        type: "rect",
        space: "scene",
        data: commonData,
        props: {
          ...commonProps,
          width: element.width,
          height: element.height,
        },
      };
    }

    return {
      id: element.id,
      type: "text",
      space: "scene",
      data: commonData,
      props: {
        ...commonProps,
        text: element.text,
      },
    };
  }

  private requireSceneService(): SceneService {
    if (!this.sceneService) {
      throw new Error("[FabricSceneAdapter] SceneService is not initialized.");
    }
    return this.sceneService;
  }

  private requireCanvasService(): CanvasService {
    if (!this.canvasService) {
      throw new Error("[FabricSceneAdapter] CanvasService is not initialized.");
    }
    return this.canvasService;
  }
}

export { SCENE_RENDER_SCOPE };
