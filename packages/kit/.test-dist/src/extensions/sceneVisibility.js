"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SceneVisibilityService = void 0;
const core_1 = require("@pooder/core");
const CANVAS_SERVICE_ID = "CanvasService";
const HIDDEN_DIELINE_TOOLS = new Set(["pooder.kit.image", "pooder.kit.white-ink"]);
const HIDDEN_RULER_TOOLS = new Set(["pooder.kit.white-ink"]);
class SceneVisibilityService {
    constructor() {
        this.activeToolId = null;
        this.onToolActivated = (e) => {
            this.activeToolId = e.id;
            this.apply();
        };
        this.onObjectAdded = () => {
            this.apply();
        };
    }
    init(context) {
        if (this.context) {
            this.dispose(this.context);
        }
        const canvasService = context.get(CANVAS_SERVICE_ID);
        if (!canvasService) {
            throw new Error("[SceneVisibilityService] CanvasService is required.");
        }
        this.context = context;
        this.canvasService = canvasService;
        this.activeToolId = context.get(core_1.WORKBENCH_SERVICE)?.activeToolId ?? null;
        context.eventBus.on("tool:activated", this.onToolActivated);
        context.eventBus.on("object:added", this.onObjectAdded);
        this.apply();
    }
    dispose(context) {
        const activeContext = this.context ?? context;
        activeContext.eventBus.off("tool:activated", this.onToolActivated);
        activeContext.eventBus.off("object:added", this.onObjectAdded);
        this.context = undefined;
        this.activeToolId = null;
        this.canvasService = undefined;
    }
    apply() {
        if (!this.canvasService)
            return;
        const dielineLayer = this.canvasService.getLayer("dieline-overlay");
        if (dielineLayer) {
            const visible = !HIDDEN_DIELINE_TOOLS.has(this.activeToolId || "");
            if (dielineLayer.visible !== visible) {
                dielineLayer.set({ visible });
            }
        }
        const rulerLayer = this.canvasService.getLayer("ruler-overlay");
        if (rulerLayer) {
            const visible = !HIDDEN_RULER_TOOLS.has(this.activeToolId || "");
            if (rulerLayer.visible !== visible) {
                rulerLayer.set({ visible });
            }
        }
        this.canvasService.requestRenderAll();
    }
}
exports.SceneVisibilityService = SceneVisibilityService;
