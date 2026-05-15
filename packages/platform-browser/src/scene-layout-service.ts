import {
  COMMAND_SERVICE,
  CONFIGURATION_SERVICE,
  CommandService,
  ConfigurationService,
  Service,
  ServiceContext,
  type CanvasService as CanvasServiceContract,
  type SceneLayoutService as SceneLayoutServiceContract,
} from "@pooder/core";
import { CANVAS_SERVICE } from "./tokens";
import {
  buildSceneGeometry,
  computeSceneLayout,
  readSizeState,
  type SceneGeometrySnapshot,
  type SceneLayoutSnapshot,
} from "./scene/scene-layout-model";
import { SubscriptionBag } from "./subscriptions";

interface ConfigChangeEvent {
  key: string;
  value: unknown;
  oldValue: unknown;
}

const CONFIG_WATCH_PREFIXES = ["size.", "surface.", "scene.", "dieline."] as const;
const GET_SCENE_LAYOUT_COMMAND = "getSceneLayout";
const GET_SCENE_GEOMETRY_COMMAND = "getSceneGeometry";

export class SceneLayoutService implements Service, SceneLayoutServiceContract {
  private context?: ServiceContext;
  private canvasService?: CanvasServiceContract;
  private configService?: ConfigurationService;
  private lastLayout: SceneLayoutSnapshot | null = null;
  private lastGeometry: SceneGeometrySnapshot | null = null;
  private readonly subscriptions = new SubscriptionBag();
  private commandDisposables: Array<{ dispose(): void }> = [];

  init(context: ServiceContext) {
    if (this.context) {
      this.dispose(this.context);
    }

    const canvasService = context.get<CanvasServiceContract>(CANVAS_SERVICE);
    const configService = context.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    const commandService = context.get<CommandService>(COMMAND_SERVICE);

    if (!canvasService || !configService || !commandService) {
      throw new Error(
        "[SceneLayoutService] CanvasService, ConfigurationService and CommandService are required.",
      );
    }

    this.context = context;
    this.canvasService = canvasService;
    this.configService = configService;

    this.commandDisposables.push(
      commandService.registerCommand(GET_SCENE_LAYOUT_COMMAND, () =>
        this.getLayout(),
      ),
      commandService.registerCommand(GET_SCENE_GEOMETRY_COMMAND, () =>
        this.getGeometry(),
      ),
    );

    this.subscriptions.disposeAll();
    this.subscriptions.onConfigChange(configService, this.onConfigChanged);
    this.subscriptions.on(
      context.eventBus,
      "canvas:resized",
      this.onCanvasResized,
    );
    this.refresh();
  }

  dispose(context: ServiceContext) {
    this.subscriptions.disposeAll();
    this.commandDisposables.forEach((item) => item.dispose());
    this.commandDisposables = [];
    this.context = undefined;
    this.canvasService = undefined;
    this.configService = undefined;
    this.lastLayout = null;
    this.lastGeometry = null;
  }

  private onCanvasResized = () => {
    this.refresh();
  };

  private onConfigChanged = (e: ConfigChangeEvent) => {
    if (CONFIG_WATCH_PREFIXES.some((prefix) => e.key.startsWith(prefix))) {
      this.refresh();
    }
  };

  private refresh() {
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

  getLayout(forceRefresh = false): SceneLayoutSnapshot | null {
    if (!this.canvasService || !this.configService) return null;
    if (!forceRefresh && this.lastLayout) return this.lastLayout;

    const state = readSizeState(this.configService);
    const layout = computeSceneLayout(this.canvasService, state);
    if (!layout) {
      this.lastLayout = null;
      return null;
    }

    this.lastLayout = layout;
    return layout;
  }

  getGeometry(forceRefresh = false): SceneGeometrySnapshot | null {
    if (!this.configService) return null;
    const layout = this.getLayout(forceRefresh);
    if (!layout) {
      this.lastGeometry = null;
      return null;
    }
    if (!forceRefresh && this.lastGeometry) return this.lastGeometry;

    const geometry = buildSceneGeometry(this.configService, layout);
    this.lastGeometry = geometry;
    return geometry;
  }
}
