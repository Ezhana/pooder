import {
  CommandContribution,
  ConfigurationService,
  ContributionPointIds,
  Extension,
  ExtensionContext,
} from "@pooder/core";
import CanvasService from "./CanvasService";
import {
  buildSceneGeometry,
  computeSceneLayout,
  readSizeState,
  type SceneGeometrySnapshot,
  type SceneLayoutSnapshot,
} from "./sceneLayoutModel";

const GEOMETRY_KEYS = new Set([
  "dieline.shape",
  "dieline.radius",
  "dieline.pathData",
  "size.unit",
]);

export class SceneLayoutService implements Extension {
  id = "pooder.kit.sceneLayout";
  metadata = {
    name: "SceneLayoutService",
  };

  private context?: ExtensionContext;
  private canvasService?: CanvasService;
  private configService?: ConfigurationService;
  private lastLayout: SceneLayoutSnapshot | null = null;
  private lastGeometry: SceneGeometrySnapshot | null = null;
  private onConfigChange?: { dispose(): void };

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    this.configService = context.services.get<ConfigurationService>(
      "ConfigurationService",
    );

    if (!this.canvasService || !this.configService) return;

    this.onConfigChange = this.configService.onAnyChange((e) => {
      if (e.key.startsWith("size.") || e.key.startsWith("dieline.")) {
        this.refresh(GEOMETRY_KEYS.has(e.key));
      }
    });
    context.eventBus.on("canvas:resized", this.onCanvasResized);
    this.refresh(true);
  }

  deactivate(context: ExtensionContext) {
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
      [ContributionPointIds.COMMANDS]: [
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
      ] as CommandContribution[],
    };
  }

  private onCanvasResized = () => {
    this.refresh(true);
  };

  private refresh(forceGeometry = false) {
    const layout = this.getLayout(true);
    if (!layout) return;
    this.context?.eventBus.emit("scene:layout:change", layout);

    if (forceGeometry || !this.lastGeometry) {
      const geometry = this.getGeometry(true);
      if (geometry) {
        this.context?.eventBus.emit("scene:geometry:change", geometry);
      }
    }
  }

  private getLayout(forceRefresh = false): SceneLayoutSnapshot | null {
    if (!this.canvasService || !this.configService) return null;
    if (!forceRefresh && this.lastLayout) return this.lastLayout;

    const state = readSizeState(this.configService);
    const layout = computeSceneLayout(this.canvasService, state);
    this.lastLayout = layout;
    return layout;
  }

  private getGeometry(forceRefresh = false): SceneGeometrySnapshot | null {
    if (!this.configService) return null;
    const layout = this.getLayout(forceRefresh);
    if (!layout) return null;
    if (!forceRefresh && this.lastGeometry) return this.lastGeometry;

    const geometry = buildSceneGeometry(this.configService, layout);
    this.lastGeometry = geometry;
    return geometry;
  }
}

