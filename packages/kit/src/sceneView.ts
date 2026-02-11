import { Extension, ExtensionContext } from "@pooder/core";
import CanvasService from "./CanvasService";

export class SceneViewService implements Extension {
  id = "pooder.kit.sceneView";

  metadata = {
    name: "SceneViewService",
  };

  private canvasService?: CanvasService;
  private activeToolId?: string;

  activate(context: ExtensionContext) {
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    context.eventBus.on("tool:activated", this.onToolActivated);
    context.eventBus.on("object:added", this.onObjectAdded);
  }

  deactivate(context: ExtensionContext) {
    context.eventBus.off("tool:activated", this.onToolActivated);
    context.eventBus.off("object:added", this.onObjectAdded);
    this.activeToolId = undefined;
    this.canvasService = undefined;
  }

  private onToolActivated = (e: { id: string }) => {
    this.activeToolId = e.id;
    this.apply();
  };

  private onObjectAdded = () => {
    this.apply();
  };

  private apply() {
    if (!this.canvasService || !this.activeToolId) return;

    const dielineLayer = this.canvasService.getLayer("dieline-overlay");
    if (dielineLayer) {
      const visible = this.activeToolId !== "pooder.kit.image";
      (dielineLayer as any).set({ visible });
    }

    this.canvasService.requestRenderAll();
  }
}

