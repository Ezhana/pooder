"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SceneViewService = void 0;
class SceneViewService {
    constructor() {
        this.id = "pooder.kit.sceneView";
        this.metadata = {
            name: "SceneViewService",
        };
        this.onToolActivated = (e) => {
            this.activeToolId = e.id;
            this.apply();
        };
        this.onObjectAdded = () => {
            this.apply();
        };
    }
    activate(context) {
        this.canvasService = context.services.get("CanvasService");
        context.eventBus.on("tool:activated", this.onToolActivated);
        context.eventBus.on("object:added", this.onObjectAdded);
    }
    deactivate(context) {
        context.eventBus.off("tool:activated", this.onToolActivated);
        context.eventBus.off("object:added", this.onObjectAdded);
        this.activeToolId = undefined;
        this.canvasService = undefined;
    }
    apply() {
        if (!this.canvasService || !this.activeToolId)
            return;
        const dielineLayer = this.canvasService.getLayer("dieline-overlay");
        if (dielineLayer) {
            const visible = this.activeToolId !== "pooder.kit.image";
            dielineLayer.set({ visible });
        }
        this.canvasService.requestRenderAll();
    }
}
exports.SceneViewService = SceneViewService;
