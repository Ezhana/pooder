import {
  CONFIGURATION_SERVICE,
  SURFACE_FRAME_SERVICE,
  Service,
  ServiceContext,
  type CanvasService as CanvasServiceContract,
  type ConfigurationService,
  type SceneLayoutService as SceneLayoutServiceContract,
  type SceneLayoutSnapshot,
  type SurfaceFrameService,
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
  private surfaceFrameService?: SurfaceFrameService;
  private readonly layoutBySurfaceId = new Map<
    string,
    SceneLayoutSnapshot | null
  >();
  private readonly revisionBySurfaceId = new Map<string, number>();
  private readonly dirtySurfaceIds = new Set<string>();
  private readonly listenersBySurfaceId = new Map<
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
    const surfaceFrameService =
      context.get<SurfaceFrameService>(SURFACE_FRAME_SERVICE);

    if (!canvasService || !surfaceFrameService) {
      throw new Error(
        "[SceneLayoutService] CanvasService and SurfaceFrameService are required.",
      );
    }

    this.canvasService = canvasService;
    this.configService = configService;
    this.surfaceFrameService = surfaceFrameService;
    this.subscriptions.on(
      context.eventBus,
      "canvas:resized",
      this.onCanvasResized,
    );
    this.subscriptions.add(
      surfaceFrameService.onAnyFramesChange((event) => {
        this.invalidateLayout(event.surfaceId);
      }),
    );
    if (configService) {
      this.subscriptions.add(
        configService.onDidChange("size.viewPadding", () => {
          this.invalidateAllLayouts();
        }),
      );
    }
    surfaceFrameService.listSurfaceIds().forEach((surfaceId) => {
      this.recomputeLayout(surfaceId);
    });
  }

  dispose() {
    this.subscriptions.disposeAll();
    this.canvasService = undefined;
    this.configService = undefined;
    this.surfaceFrameService = undefined;
    this.layoutBySurfaceId.clear();
    this.revisionBySurfaceId.clear();
    this.dirtySurfaceIds.clear();
    this.listenersBySurfaceId.clear();
  }

  getLayout(surfaceId?: string): SceneLayoutSnapshot | null {
    const normalized = this.resolveSurfaceId(surfaceId);
    if (!normalized) return null;
    if (!this.layoutBySurfaceId.has(normalized)) return null;
    return this.cloneLayout(this.layoutBySurfaceId.get(normalized) ?? null);
  }

  onLayoutChange(
    surfaceId: string,
    listener: (layout: SceneLayoutSnapshot | null) => void,
  ) {
    const normalized = String(surfaceId || "").trim();
    if (!normalized) {
      throw new Error("SceneLayoutService listener requires surfaceId.");
    }
    const listeners =
      this.listenersBySurfaceId.get(normalized) ??
      new Set<(layout: SceneLayoutSnapshot | null) => void>();
    listeners.add(listener);
    this.listenersBySurfaceId.set(normalized, listeners);
    return {
      dispose: () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.listenersBySurfaceId.delete(normalized);
        }
      },
    };
  }

  recomputeLayout(surfaceId?: string): SceneLayoutSnapshot | null {
    const normalized = this.resolveSurfaceId(surfaceId);
    if (!normalized || !this.canvasService || !this.surfaceFrameService) {
      return null;
    }
    const frames = this.surfaceFrameService.getFrames(normalized);
    const layout = frames
      ? computeSceneLayout({
          frames,
          fitOptions: this.resolveFitOptions(),
          revision: this.revisionBySurfaceId.get(normalized) ?? 0,
          surfaceId: normalized,
          viewportSize: this.canvasService.getViewportSize(),
        })
      : null;
    return this.updateSnapshot(normalized, layout);
  }

  invalidateLayout(surfaceId?: string): void {
    const normalized = this.resolveSurfaceId(surfaceId);
    if (!normalized) return;
    this.dirtySurfaceIds.add(normalized);
    this.recomputeLayout(normalized);
  }

  private onCanvasResized = () => {
    this.invalidateAllLayouts();
  };

  private invalidateAllLayouts(): void {
    this.surfaceFrameService?.listSurfaceIds().forEach((surfaceId) => {
      this.invalidateLayout(surfaceId);
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

  private resolveSurfaceId(surfaceId?: string): string {
    const normalized = String(surfaceId || "").trim();
    if (normalized) return normalized;
    return this.surfaceFrameService?.listSurfaceIds()[0] ?? "";
  }

  private emit(surfaceId: string, layout: SceneLayoutSnapshot | null) {
    this.listenersBySurfaceId.get(surfaceId)?.forEach((listener) => {
      listener(this.cloneLayout(layout));
    });
  }

  private updateSnapshot(
    surfaceId: string,
    nextLayout: SceneLayoutSnapshot | null,
  ): SceneLayoutSnapshot | null {
    const hadPrevious = this.layoutBySurfaceId.has(surfaceId);
    const previous = hadPrevious
      ? this.layoutBySurfaceId.get(surfaceId) ?? null
      : undefined;
    const comparableNext = nextLayout
      ? {
          ...nextLayout,
          revision:
            previous?.revision ?? this.revisionBySurfaceId.get(surfaceId) ?? 0,
          surfaceId,
        }
      : null;
    this.dirtySurfaceIds.delete(surfaceId);

    if (previous !== undefined && this.isSameLayout(previous, comparableNext)) {
      return this.cloneLayout(previous);
    }

    if (!comparableNext) {
      this.layoutBySurfaceId.set(surfaceId, null);
      if (previous !== undefined && previous !== null) {
        this.emit(surfaceId, null);
      }
      return null;
    }

    const revision = (this.revisionBySurfaceId.get(surfaceId) ?? 0) + 1;
    const snapshot = {
      ...comparableNext,
      revision,
      surfaceId,
      bleedRect: { ...comparableNext.bleedRect },
      cutRect: { ...comparableNext.cutRect },
      trimRect: { ...comparableNext.trimRect },
    };
    this.layoutBySurfaceId.set(surfaceId, snapshot);
    this.revisionBySurfaceId.set(surfaceId, revision);
    this.emit(surfaceId, snapshot);
    return this.cloneLayout(snapshot);
  }

  private isSameLayout(
    left: SceneLayoutSnapshot | null,
    right: SceneLayoutSnapshot | null,
  ): boolean {
    if (!left || !right) return left === right;
    return (
      left.surfaceId === right.surfaceId &&
      left.scale === right.scale &&
      left.offsetX === right.offsetX &&
      left.offsetY === right.offsetY &&
      this.isSameRect(left.trimRect, right.trimRect) &&
      this.isSameRect(left.cutRect, right.cutRect) &&
      this.isSameRect(left.bleedRect, right.bleedRect)
    );
  }

  private isSameRect(
    left: SceneLayoutSnapshot["trimRect"],
    right: SceneLayoutSnapshot["trimRect"],
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
      bleedRect: { ...layout.bleedRect },
      cutRect: { ...layout.cutRect },
      trimRect: { ...layout.trimRect },
    };
  }
}
