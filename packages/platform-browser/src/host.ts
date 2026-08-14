import type {
  GeometrySourceService,
  ImageResourceService,
  Service,
  ServiceIdentifier,
  SurfaceFrameService,
} from "@pooder/core";
import { GEOMETRY_SOURCE_SERVICE, SURFACE_FRAME_SERVICE } from "@pooder/core";
import { IMAGE_RESOURCE_SERVICE } from "@pooder/core";
import { OBJECT_IMAGE_RESOLVER_SERVICE } from "@pooder/core";
import { loadPaperGeometryBackend } from "@pooder/geometry-paper";
import { BrowserSceneExportService } from "./browser-scene-export-service";
import CanvasService from "./canvas-service";
import { FabricRenderGraphAdapter } from "./scene/fabric-render-graph-adapter";
import { SceneLayoutService } from "./scene-layout-service";
import { BrowserImageResourceService } from "./image-resource-service";
import { BrowserObjectImageResolverService } from "./object-image-resolver-service";
import {
  CANVAS_SERVICE,
  FABRIC_RENDER_GRAPH_ADAPTER,
  SCENE_EXPORT_SERVICE,
  SCENE_LAYOUT_SERVICE,
} from "./tokens";

interface BrowserHostRuntimeServices {
  get<T extends Service>(identifier: ServiceIdentifier<T>): T | undefined;
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
  services: BrowserHostRuntimeServices;
}

export interface BrowserHostAttachment {
  readonly browserSceneExportService: BrowserSceneExportService;
  readonly canvasService: CanvasService;
  readonly fabricRenderGraphAdapter: FabricRenderGraphAdapter;
  readonly imageResourceService: ImageResourceService;
  readonly objectImageResolverService: BrowserObjectImageResolverService;
  readonly sceneLayoutService: SceneLayoutService;
  dispose(): void;
}

export async function registerBrowserGeometryBackend(
  runtime: BrowserHostRuntime,
): Promise<{ dispose(): void }> {
  const geometrySource = runtime.services.get<GeometrySourceService>(
    GEOMETRY_SOURCE_SERVICE,
  );
  if (!geometrySource) {
    throw new Error(
      "[@pooder/platform-browser] GeometrySourceService is not registered.",
    );
  }
  return loadPaperGeometryBackend(geometrySource);
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
  createBrowserSceneExportService?: () => BrowserSceneExportService;
  createFabricRenderGraphAdapter?: () => FabricRenderGraphAdapter;
  createResizeObserver?: (
    callback: ResizeObserverCallback,
  ) => ResizeObserverLike;
  createSceneLayoutService?: () => SceneLayoutService;
  createImageResourceService?: () => ImageResourceService;
  createObjectImageResolverService?: () => BrowserObjectImageResolverService;
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
    options.createCanvasService ?? ((canvas) => new CanvasService(canvas));
  const createBrowserSceneExportService =
    options.createBrowserSceneExportService ??
    (() => new BrowserSceneExportService());
  const createSceneLayoutService =
    options.createSceneLayoutService ?? (() => new SceneLayoutService());
  const createFabricRenderGraphAdapter =
    options.createFabricRenderGraphAdapter ??
    (() => new FabricRenderGraphAdapter());
  const createResizeObserver =
    options.createResizeObserver ??
    ((callback) => new ResizeObserver(callback));
  const createImageResourceService =
    options.createImageResourceService ??
    (() => new BrowserImageResourceService());
  const createObjectImageResolverService =
    options.createObjectImageResolverService ??
    (() => new BrowserObjectImageResolverService());

  const { container, canvas } = options;
  const { height, width } = measureContainer(container);

  canvas.width = width;
  canvas.height = height;

  const canvasService = createCanvasService(canvas, runtime);
  const sceneLayoutService = createSceneLayoutService();
  const browserSceneExportService = createBrowserSceneExportService();
  const fabricRenderGraphAdapter = createFabricRenderGraphAdapter();
  const imageResourceService = createImageResourceService();
  const objectImageResolverService = createObjectImageResolverService();

  const registeredImageResources = runtime.services.register(
    imageResourceService,
    IMAGE_RESOURCE_SERVICE,
  );
  if (!registeredImageResources) {
    throw new Error(
      "[@pooder/platform-browser] Failed to register BrowserImageResourceService.",
    );
  }

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

  const registeredSceneAdapter = runtime.services.register(
    fabricRenderGraphAdapter,
    FABRIC_RENDER_GRAPH_ADAPTER,
  );
  if (!registeredSceneAdapter) {
    runtime.services.unregister(sceneLayoutService, SCENE_LAYOUT_SERVICE);
    runtime.services.unregister(canvasService, CANVAS_SERVICE);
    throw new Error(
      "[@pooder/platform-browser] Failed to register FabricRenderGraphAdapter.",
    );
  }

  const registeredExport = runtime.services.register(
    browserSceneExportService,
    SCENE_EXPORT_SERVICE,
  );
  if (!registeredExport) {
    runtime.services.unregister(
      fabricRenderGraphAdapter,
      FABRIC_RENDER_GRAPH_ADAPTER,
    );
    runtime.services.unregister(sceneLayoutService, SCENE_LAYOUT_SERVICE);
    runtime.services.unregister(canvasService, CANVAS_SERVICE);
    throw new Error(
      "[@pooder/platform-browser] Failed to register BrowserSceneExportService.",
    );
  }

  const registeredObjectImageResolver = runtime.services.register(
    objectImageResolverService,
    OBJECT_IMAGE_RESOLVER_SERVICE,
  );
  if (!registeredObjectImageResolver) {
    runtime.services.unregister(
      browserSceneExportService,
      SCENE_EXPORT_SERVICE,
    );
    runtime.services.unregister(
      fabricRenderGraphAdapter,
      FABRIC_RENDER_GRAPH_ADAPTER,
    );
    runtime.services.unregister(sceneLayoutService, SCENE_LAYOUT_SERVICE);
    runtime.services.unregister(canvasService, CANVAS_SERVICE);
    runtime.services.unregister(imageResourceService, IMAGE_RESOURCE_SERVICE);
    throw new Error(
      "[@pooder/platform-browser] Failed to register BrowserObjectImageResolverService.",
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

  const viewportDisposables: Array<{ dispose(): void }> = [];
  const observedSurfaceIds = new Set<string>();
  const surfaceFrameService = runtime.services.get<SurfaceFrameService>(
    SURFACE_FRAME_SERVICE,
  );
  const applyViewportLayout = (surfaceId: string) => {
    const layout = sceneLayoutService.getLayout(surfaceId);
    const frames = surfaceFrameService?.getFrames(surfaceId);
    if (!layout || !frames) return;
    canvasService.setViewportLayout({
      scale: layout.scale,
      offsetX: layout.offsetX,
      offsetY: layout.offsetY,
      width: frames.previewBounds.widthMm * layout.scale,
      height: frames.previewBounds.heightMm * layout.scale,
    });
    canvasService.requestRenderAll();
  };
  const getActiveSurfaceId = () =>
    surfaceFrameService?.getActiveSurfaceId() ||
    surfaceFrameService?.listSurfaceIds()[0] ||
    "";
  const observeSurface = (surfaceId: string) => {
    if (!surfaceId || observedSurfaceIds.has(surfaceId)) return;
    observedSurfaceIds.add(surfaceId);
    viewportDisposables.push(
      sceneLayoutService.onLayoutChange(surfaceId, () => {
        if (surfaceId === getActiveSurfaceId()) {
          applyViewportLayout(surfaceId);
        }
      }),
    );
  };
  surfaceFrameService?.listSurfaceIds().forEach(observeSurface);
  applyViewportLayout(getActiveSurfaceId());
  const surfaceFramesDisposable = surfaceFrameService?.onAnyFramesChange(
    (event) => {
      observeSurface(event.surfaceId);
      if (event.surfaceId === getActiveSurfaceId()) {
        applyViewportLayout(event.surfaceId);
      }
    },
  );
  if (surfaceFramesDisposable) {
    viewportDisposables.push(surfaceFramesDisposable);
  }
  const activeSurfaceDisposable = surfaceFrameService?.onActiveSurfaceChange(
    (event) => {
      if (event.surfaceId) {
        observeSurface(event.surfaceId);
        applyViewportLayout(event.surfaceId);
      }
    },
  );
  if (activeSurfaceDisposable) {
    viewportDisposables.push(activeSurfaceDisposable);
  }

  return {
    browserSceneExportService,
    canvasService,
    fabricRenderGraphAdapter,
    imageResourceService,
    objectImageResolverService,
    sceneLayoutService,
    dispose() {
      resizeObserver.disconnect();
      viewportDisposables.forEach((disposable) => disposable?.dispose());
      runtime.services.unregister(
        objectImageResolverService,
        OBJECT_IMAGE_RESOLVER_SERVICE,
      );
      runtime.services.unregister(
        browserSceneExportService,
        SCENE_EXPORT_SERVICE,
      );
      runtime.services.unregister(
        fabricRenderGraphAdapter,
        FABRIC_RENDER_GRAPH_ADAPTER,
      );
      runtime.services.unregister(imageResourceService, IMAGE_RESOURCE_SERVICE);
      runtime.services.unregister(sceneLayoutService, SCENE_LAYOUT_SERVICE);
      runtime.services.unregister(canvasService, CANVAS_SERVICE);
    },
  };
}
