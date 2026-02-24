"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SceneVisibilityService = void 0;
class SceneVisibilityService {
    constructor() {
        this.id = "pooder.kit.sceneVisibility";
        this.metadata = {
            name: "SceneVisibilityService",
        };
        this.activeToolId = null;
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
        this.activeToolId = null;
        this.canvasService = undefined;
    }
    apply() {
        if (!this.canvasService)
            return;
        const dielineLayer = this.canvasService.getLayer("dieline-overlay");
        if (dielineLayer) {
            const visible = this.activeToolId !== "pooder.kit.image" &&
                this.activeToolId !== "pooder.kit.white-ink";
            dielineLayer.set({ visible });
        }
        this.canvasService.requestRenderAll();
    }
}
exports.SceneVisibilityService = SceneVisibilityService;
