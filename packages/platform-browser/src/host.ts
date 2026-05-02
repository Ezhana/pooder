import type { EventBus, Service, ServiceIdentifier } from "@pooder/core";
import CanvasService from "./canvas-service";
import { SceneLayoutService } from "./scene-layout-service";
import { CANVAS_SERVICE, SCENE_LAYOUT_SERVICE } from "./tokens";

interface BrowserHostRuntimeServices {
  register<T extends Service>(
    service: T,
    identifier?: ServiceIdentifier<T>,
  ): boolean;
  unregister(
    serviceOrIdentifier: Service | ServiceIdentifier<Service>,
    identifier?: ServiceIdentifier<Service>,
  ): boolean;
}

export interface BrowserHostRuntime {
  eventBus: EventBus;
  services: BrowserHostRuntimeServices;
}

export interface BrowserHostAttachment {
  readonly canvasService: CanvasService;
  readonly sceneLayoutService: SceneLayoutService;
  dispose(): void;
}

type ResizeObserverLike = {
  disconnect(): void;
  observe(target: Element): void;
};

export interface AttachBrowserHostOptions {
  container: Element & { clientWidth: number; clientHeight: number };
  canvas: HTMLCanvasElement;
  createCanvasService?: (
    canvas: HTMLCanvasElement,
    runtime: BrowserHostRuntime,
  ) => CanvasService;
  createResizeObserver?: (
    callback: ResizeObserverCallback,
  ) => ResizeObserverLike;
  createSceneLayoutService?: () => SceneLayoutService;
}

function measureContainer(container: AttachBrowserHostOptions["container"]): {
  height: number;
  width: number;
} {
  return {
    width: Number(container.clientWidth || 0),
    height: Number(container.clientHeight || 0),
  };
}

export function attachBrowserHost(
  runtime: BrowserHostRuntime,
  options: AttachBrowserHostOptions,
): BrowserHostAttachment {
  const createCanvasService =
    options.createCanvasService ??
    ((canvas, currentRuntime) =>
      new CanvasService(canvas, { eventBus: currentRuntime.eventBus }));
  const createSceneLayoutService =
    options.createSceneLayoutService ?? (() => new SceneLayoutService());
  const createResizeObserver =
    options.createResizeObserver ??
    ((callback) => new ResizeObserver(callback));

  const { container, canvas } = options;
  const { height, width } = measureContainer(container);

  canvas.width = width;
  canvas.height = height;

  const canvasService = createCanvasService(canvas, runtime);
  const sceneLayoutService = createSceneLayoutService();

  const registeredCanvas = runtime.services.register(
    canvasService,
    CANVAS_SERVICE,
  );
  if (!registeredCanvas) {
    throw new Error(
      "[@pooder/platform-browser] Failed to register CanvasService.",
    );
  }

  const registeredLayout = runtime.services.register(
    sceneLayoutService,
    SCENE_LAYOUT_SERVICE,
  );
  if (!registeredLayout) {
    runtime.services.unregister(canvasService, CANVAS_SERVICE);
    throw new Error(
      "[@pooder/platform-browser] Failed to register SceneLayoutService.",
    );
  }

  const resizeObserver = createResizeObserver((entries) => {
    for (const entry of entries) {
      const nextWidth = entry.contentRect.width;
      const nextHeight = entry.contentRect.height;
      canvasService.resize(nextWidth, nextHeight);
    }
  });

  resizeObserver.observe(container);

  return {
    canvasService,
    sceneLayoutService,
    dispose() {
      resizeObserver.disconnect();
      runtime.services.unregister(sceneLayoutService, SCENE_LAYOUT_SERVICE);
      runtime.services.unregister(canvasService, CANVAS_SERVICE);
    },
  };
}
