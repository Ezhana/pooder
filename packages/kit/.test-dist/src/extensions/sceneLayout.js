"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SceneLayoutService = void 0;
const core_1 = require("@pooder/core");
const sceneLayoutModel_1 = require("./sceneLayoutModel");
const CONFIG_WATCH_PREFIXES = ["size.", "dieline."];
const CANVAS_SERVICE_ID = "CanvasService";
const GET_SCENE_LAYOUT_COMMAND = "getSceneLayout";
const GET_SCENE_GEOMETRY_COMMAND = "getSceneGeometry";
class SceneLayoutService {
    constructor() {
        this.lastLayout = null;
        this.lastGeometry = null;
        this.commandDisposables = [];
        this.onCanvasResized = () => {
            this.refresh();
        };
        this.onConfigChanged = (e) => {
            if (CONFIG_WATCH_PREFIXES.some((prefix) => e.key.startsWith(prefix))) {
                this.refresh();
            }
        };
    }
    init(context) {
        if (this.context) {
            this.dispose(this.context);
        }
        const canvasService = context.get(CANVAS_SERVICE_ID);
        const configService = context.get(core_1.CONFIGURATION_SERVICE);
        const commandService = context.get(core_1.COMMAND_SERVICE);
        if (!canvasService || !configService || !commandService) {
            throw new Error("[SceneLayoutService] CanvasService, ConfigurationService and CommandService are required.");
        }
        this.context = context;
        this.canvasService = canvasService;
        this.configService = configService;
        this.commandDisposables.push(commandService.registerCommand(GET_SCENE_LAYOUT_COMMAND, () => this.getLayout()), commandService.registerCommand(GET_SCENE_GEOMETRY_COMMAND, () => this.getGeometry()));
        this.onConfigChange = configService.onAnyChange(this.onConfigChanged);
        context.eventBus.on("canvas:resized", this.onCanvasResized);
        this.refresh();
    }
    dispose(context) {
        const activeContext = this.context ?? context;
        activeContext.eventBus.off("canvas:resized", this.onCanvasResized);
        this.onConfigChange?.dispose();
        this.onConfigChange = undefined;
        this.commandDisposables.forEach((item) => item.dispose());
        this.commandDisposables = [];
        this.context = undefined;
        this.canvasService = undefined;
        this.configService = undefined;
        this.lastLayout = null;
        this.lastGeometry = null;
    }
    refresh() {
        const layout = this.getLayout(true);
        if (!layout) {
            this.lastGeometry = null;
            return;
        }
        this.context?.eventBus.emit("scene:layout:change", layout);
        const geometry = this.getGeometry(true);
        if (geometry) {
            this.context?.eventBus.emit("scene:geometry:change", geometry);
        }
    }
    getLayout(forceRefresh = false) {
        if (!this.canvasService || !this.configService)
            return null;
        if (!forceRefresh && this.lastLayout)
            return this.lastLayout;
        const state = (0, sceneLayoutModel_1.readSizeState)(this.configService);
        const layout = (0, sceneLayoutModel_1.computeSceneLayout)(this.canvasService, state);
        if (!layout) {
            this.lastLayout = null;
            return null;
        }
        this.lastLayout = layout;
        return layout;
    }
    getGeometry(forceRefresh = false) {
        if (!this.configService)
            return null;
        const layout = this.getLayout(forceRefresh);
        if (!layout) {
            this.lastGeometry = null;
            return null;
        }
        if (!forceRefresh && this.lastGeometry)
            return this.lastGeometry;
        const geometry = (0, sceneLayoutModel_1.buildSceneGeometry)(this.configService, layout);
        this.lastGeometry = geometry;
        return geometry;
    }
}
exports.SceneLayoutService = SceneLayoutService;
