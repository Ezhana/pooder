import {
  CONFIGURATION_SERVICE,
  SCENE_FRAME_SERVICE,
  Service,
  ServiceContext,
  type CanvasService as CanvasServiceContract,
  type ConfigurationService,
  type SceneLayoutService as SceneLayoutServiceContract,
  type SceneLayoutSnapshot,
  type SceneFrameService,
} from "@pooder/core";
import { CANVAS_SERVICE } from "./tokens";
import {
  computeSceneLayout,
  type SceneLayoutFitOptions,
} from "./scene/scene-layout-model";
import { SubscriptionBag } from "./subscriptions";

export interface SceneLayoutServiceOptions {
  fitOptions?: SceneLayoutFitOptions;
}

export class SceneLayoutService implements Service, SceneLayoutServiceContract {
  private canvasService?: CanvasServiceContract;
  private configService?: ConfigurationService;
  private sceneFrameService?: SceneFrameService;
  private readonly layoutBySceneId = new Map<
    string,
    SceneLayoutSnapshot | null
  >();
  private readonly revisionBySceneId = new Map<string, number>();
  private readonly dirtySceneIds = new Set<string>();
  private readonly listenersBySceneId = new Map<
    string,
    Set<(layout: SceneLayoutSnapshot | null) => void>
  >();
  private readonly subscriptions = new SubscriptionBag();
  private readonly fitOptions: SceneLayoutFitOptions;

  constructor(options: SceneLayoutServiceOptions = {}) {
    this.fitOptions = options.fitOptions ?? {};
  }

  init(context: ServiceContext) {
    this.dispose();

    const canvasService = context.get<CanvasServiceContract>(CANVAS_SERVICE);
    const configService = context.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    const sceneFrameService =
      context.get<SceneFrameService>(SCENE_FRAME_SERVICE);

    if (!canvasService || !sceneFrameService) {
      throw new Error(
        "[SceneLayoutService] CanvasService and SceneFrameService are required.",
      );
    }

    this.canvasService = canvasService;
    this.configService = configService;
    this.sceneFrameService = sceneFrameService;
    this.subscriptions.add(canvasService.on("resized", this.onCanvasResized));
    this.subscriptions.add(
      sceneFrameService.onAnyFramesChange((event) => {
        this.invalidateLayout(event.sceneId);
      }),
    );
    if (configService) {
      this.subscriptions.add(
        configService.onDidChange("size.viewPadding", () => {
          this.invalidateAllLayouts();
        }),
      );
    }
    sceneFrameService.listSceneIds().forEach((sceneId) => {
      this.recomputeLayout(sceneId);
    });
  }

  dispose() {
    this.subscriptions.disposeAll();
    this.canvasService = undefined;
    this.configService = undefined;
    this.sceneFrameService = undefined;
    this.layoutBySceneId.clear();
    this.revisionBySceneId.clear();
    this.dirtySceneIds.clear();
    this.listenersBySceneId.clear();
  }

  getLayout(sceneId: string): SceneLayoutSnapshot | null {
    const normalized = this.resolveSceneId(sceneId);
    if (!this.layoutBySceneId.has(normalized)) return null;
    return this.cloneLayout(this.layoutBySceneId.get(normalized) ?? null);
  }

  onLayoutChange(
    sceneId: string,
    listener: (layout: SceneLayoutSnapshot | null) => void,
  ) {
    const normalized = String(sceneId || "").trim();
    if (!normalized) {
      throw new Error("SceneLayoutService listener requires sceneId.");
    }
    const listeners =
      this.listenersBySceneId.get(normalized) ??
      new Set<(layout: SceneLayoutSnapshot | null) => void>();
    listeners.add(listener);
    this.listenersBySceneId.set(normalized, listeners);
    return {
      dispose: () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.listenersBySceneId.delete(normalized);
        }
      },
    };
  }

  recomputeLayout(sceneId: string): SceneLayoutSnapshot | null {
    const normalized = this.resolveSceneId(sceneId);
    if (!normalized || !this.canvasService || !this.sceneFrameService) {
      return null;
    }
    const frames = this.sceneFrameService.getFrames(normalized);
    const layout = frames
      ? computeSceneLayout({
          frames,
          fitOptions: this.resolveFitOptions(),
          revision: this.revisionBySceneId.get(normalized) ?? 0,
          sceneId: normalized,
          viewportSize: this.canvasService.getViewportSize(),
        })
      : null;
    return this.updateSnapshot(normalized, layout);
  }

  invalidateLayout(sceneId: string): void {
    const normalized = this.resolveSceneId(sceneId);
    if (!normalized) return;
    this.dirtySceneIds.add(normalized);
    this.recomputeLayout(normalized);
  }

  private onCanvasResized = () => {
    this.invalidateAllLayouts();
  };

  private invalidateAllLayouts(): void {
    this.sceneFrameService?.listSceneIds().forEach((sceneId) => {
      this.invalidateLayout(sceneId);
    });
  }

  private resolveFitOptions(): SceneLayoutFitOptions {
    if (this.fitOptions.viewPadding !== undefined) {
      return this.fitOptions;
    }
    const configViewPadding = this.configService?.get("size.viewPadding");
    if (configViewPadding !== undefined) {
      return {
        ...this.fitOptions,
        viewPadding: configViewPadding as SceneLayoutFitOptions["viewPadding"],
      };
    }
    return this.fitOptions;
  }

  private resolveSceneId(sceneId: string): string {
    const normalized = String(sceneId || "").trim();
    if (!normalized) throw new Error("SceneLayoutService requires sceneId.");
    return normalized;
  }

  private emit(sceneId: string, layout: SceneLayoutSnapshot | null) {
    this.listenersBySceneId.get(sceneId)?.forEach((listener) => {
      listener(this.cloneLayout(layout));
    });
  }

  private updateSnapshot(
    sceneId: string,
    nextLayout: SceneLayoutSnapshot | null,
  ): SceneLayoutSnapshot | null {
    const hadPrevious = this.layoutBySceneId.has(sceneId);
    const previous = hadPrevious
      ? (this.layoutBySceneId.get(sceneId) ?? null)
      : undefined;
    const comparableNext = nextLayout
      ? {
          ...nextLayout,
          revision:
            previous?.revision ?? this.revisionBySceneId.get(sceneId) ?? 0,
          sceneId,
        }
      : null;
    this.dirtySceneIds.delete(sceneId);

    if (previous !== undefined && this.isSameLayout(previous, comparableNext)) {
      return this.cloneLayout(previous);
    }

    if (!comparableNext) {
      this.layoutBySceneId.set(sceneId, null);
      if (previous !== undefined && previous !== null) {
        this.emit(sceneId, null);
      }
      return null;
    }

    const revision = (this.revisionBySceneId.get(sceneId) ?? 0) + 1;
    const snapshot = {
      ...comparableNext,
      revision,
      sceneId,
      contentRect: { ...comparableNext.contentRect },
    };
    this.layoutBySceneId.set(sceneId, snapshot);
    this.revisionBySceneId.set(sceneId, revision);
    this.emit(sceneId, snapshot);
    return this.cloneLayout(snapshot);
  }

  private isSameLayout(
    left: SceneLayoutSnapshot | null,
    right: SceneLayoutSnapshot | null,
  ): boolean {
    if (!left || !right) return left === right;
    return (
      left.sceneId === right.sceneId &&
      left.scale === right.scale &&
      left.offsetX === right.offsetX &&
      left.offsetY === right.offsetY &&
      this.isSameRect(left.contentRect, right.contentRect)
    );
  }

  private isSameRect(
    left: SceneLayoutSnapshot["contentRect"],
    right: SceneLayoutSnapshot["contentRect"],
  ): boolean {
    return (
      left.left === right.left &&
      left.top === right.top &&
      left.width === right.width &&
      left.height === right.height &&
      left.centerX === right.centerX &&
      left.centerY === right.centerY
    );
  }

  private cloneLayout(
    layout: SceneLayoutSnapshot | null,
  ): SceneLayoutSnapshot | null {
    if (!layout) return null;
    return {
      ...layout,
      contentRect: { ...layout.contentRect },
    };
  }
}
