"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SceneLayoutService = void 0;
const core_1 = require("@pooder/core");
const sceneLayoutModel_1 = require("./sceneLayoutModel");
const GEOMETRY_KEYS = new Set([
    "dieline.shape",
    "dieline.radius",
    "dieline.pathData",
    "size.unit",
]);
class SceneLayoutService {
    constructor() {
        this.id = "pooder.kit.sceneLayout";
        this.metadata = {
            name: "SceneLayoutService",
        };
        this.lastLayout = null;
        this.lastGeometry = null;
        this.onCanvasResized = () => {
            this.refresh(true);
        };
    }
    activate(context) {
        this.context = context;
        this.canvasService = context.services.get("CanvasService");
        this.configService = context.services.get("ConfigurationService");
        if (!this.canvasService || !this.configService)
            return;
        this.onConfigChange = this.configService.onAnyChange((e) => {
            if (e.key.startsWith("size.") || e.key.startsWith("dieline.")) {
                this.refresh(GEOMETRY_KEYS.has(e.key));
            }
        });
        context.eventBus.on("canvas:resized", this.onCanvasResized);
        this.refresh(true);
    }
    deactivate(context) {
        context.eventBus.off("canvas:resized", this.onCanvasResized);
        this.onConfigChange?.dispose();
        this.onConfigChange = undefined;
        this.context = undefined;
        this.canvasService = undefined;
        this.configService = undefined;
        this.lastLayout = null;
        this.lastGeometry = null;
    }
    contribute() {
        return {
            [core_1.ContributionPointIds.COMMANDS]: [
                {
                    command: "getSceneLayout",
                    title: "Get Scene Layout",
                    handler: () => this.getLayout(),
                },
                {
                    command: "getSceneGeometry",
                    title: "Get Scene Geometry",
                    handler: () => this.getGeometry(),
                },
            ],
        };
    }
    refresh(forceGeometry = false) {
        const layout = this.getLayout(true);
        if (!layout)
            return;
        this.context?.eventBus.emit("scene:layout:change", layout);
        if (forceGeometry || !this.lastGeometry) {
            const geometry = this.getGeometry(true);
            if (geometry) {
                this.context?.eventBus.emit("scene:geometry:change", geometry);
            }
        }
    }
    getLayout(forceRefresh = false) {
        if (!this.canvasService || !this.configService)
            return null;
        if (!forceRefresh && this.lastLayout)
            return this.lastLayout;
        const state = (0, sceneLayoutModel_1.readSizeState)(this.configService);
        const layout = (0, sceneLayoutModel_1.computeSceneLayout)(this.canvasService, state);
        this.lastLayout = layout;
        return layout;
    }
    getGeometry(forceRefresh = false) {
        if (!this.configService)
            return null;
        const layout = this.getLayout(forceRefresh);
        if (!layout)
            return null;
        if (!forceRefresh && this.lastGeometry)
            return this.lastGeometry;
        const geometry = (0, sceneLayoutModel_1.buildSceneGeometry)(this.configService, layout);
        this.lastGeometry = geometry;
        return geometry;
    }
}
exports.SceneLayoutService = SceneLayoutService;
