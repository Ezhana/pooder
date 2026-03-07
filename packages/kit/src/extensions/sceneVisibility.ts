import { Service, ServiceContext, WORKBENCH_SERVICE } from "@pooder/core";
import { CanvasService } from "../services";

const CANVAS_SERVICE_ID = "CanvasService";
const HIDDEN_DIELINE_TOOLS = new Set(["pooder.kit.image", "pooder.kit.white-ink"]);
const HIDDEN_RULER_TOOLS = new Set(["pooder.kit.white-ink"]);

export class SceneVisibilityService implements Service {
  private context?: ServiceContext;
  private activeToolId: string | null = null;
  private canvasService?: CanvasService;

  init(context: ServiceContext) {
    if (this.context) {
      this.dispose(this.context);
    }

    const canvasService =
      context.get<CanvasService>(CANVAS_SERVICE_ID);
    if (!canvasService) {
      throw new Error("[SceneVisibilityService] CanvasService is required.");
    }

    this.context = context;
    this.canvasService = canvasService;
    this.activeToolId = context.get(WORKBENCH_SERVICE)?.activeToolId ?? null;
    context.eventBus.on("tool:activated", this.onToolActivated);
    context.eventBus.on("object:added", this.onObjectAdded);
    this.apply();
  }

  dispose(context: ServiceContext) {
    const activeContext = this.context ?? context;
    activeContext.eventBus.off("tool:activated", this.onToolActivated);
    activeContext.eventBus.off("object:added", this.onObjectAdded);
    this.context = undefined;
    this.activeToolId = null;
    this.canvasService = undefined;
  }

  private onToolActivated = (e: { id: string | null }) => {
    this.activeToolId = e.id;
    this.apply();
  };

  private onObjectAdded = () => {
    this.apply();
  };

  private apply() {
    if (!this.canvasService) return;

    const dielineLayer = this.canvasService.getLayer("dieline-overlay");
    if (dielineLayer) {
      const visible = !HIDDEN_DIELINE_TOOLS.has(this.activeToolId || "");
      if (dielineLayer.visible !== visible) {
        dielineLayer.set({ visible });
      }
    }

    const rulerLayer = this.canvasService.getLayer("ruler-overlay");
    const rulerVisible = !HIDDEN_RULER_TOOLS.has(this.activeToolId || "");
    if (rulerLayer) {
      if (rulerLayer.visible !== rulerVisible) {
        rulerLayer.set({ visible: rulerVisible });
      }
    }

    this.canvasService.requestRenderAll();
  }
}
