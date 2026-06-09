import type { Service } from "@pooder/core";
import {
  CONFIGURATION_SERVICE,
  Pooder,
  RENDER_INTENT_SERVICE,
  SCENE_SERVICE,
  SURFACE_FRAME_SERVICE,
  type RenderIntentService,
} from "@pooder/core";
import type { SurfaceSceneFrames } from "@pooder/core";
import {
  attachBrowserHost,
  BrowserSceneExportService,
  CANVAS_SERVICE,
  CanvasService,
  FABRIC_RENDER_GRAPH_ADAPTER,
  FabricRenderGraphAdapter,
  SCENE_EXPORT_SERVICE,
  SCENE_LAYOUT_SERVICE,
  SceneLayoutService,
  applyAlphaMaskData,
  applyTransparentColorToAlpha,
  createBoundaryOutputMaskAlpha,
} from "../src";
import type { FabricRenderTargetItem } from "../src/canvas-service";
import { ViewportSystem } from "../src/viewport-system";

declare const process: {
  exit(code: number): never;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message} (expected ${String(expected)}, got ${String(actual)})`,
    );
  }
}

function assertClose(
  actual: number,
  expected: number,
  message: string,
  epsilon = 1e-6,
) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(
      `${message} (expected ${String(expected)}, got ${String(actual)})`,
    );
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message} (expected ${expectedJson}, got ${actualJson})`);
  }
}

class FakeCanvasService {
  objects: any[] = [];
  handlers = new Map<string, Array<(...args: any[]) => void>>();
  resizeCalls: Array<{ height: number; width: number }> = [];
  viewportLayoutCalls: Array<{
    height: number;
    offsetX: number;
    offsetY: number;
    scale: number;
    width: number;
  }> = [];
  renderCalls = 0;
  reconcileCalls: Array<{
    items: FabricRenderTargetItem[];
  }> = [];

  resize(width: number, height: number) {
    this.resizeCalls.push({ width, height });
  }

  requestRenderAll() {
    this.renderCalls += 1;
  }

  setViewportLayout(layout: {
    height: number;
    offsetX: number;
    offsetY: number;
    scale: number;
    width: number;
  }) {
    this.viewportLayoutCalls.push(layout);
  }

  async reconcileRenderGraphDrawList(items: FabricRenderTargetItem[]) {
    this.reconcileCalls.push({
      items: items.map((item) => ({ ...item, spec: { ...item.spec } })),
    });
  }

  selectObjects(selector: any = {}) {
    return this.objects.filter((object) => {
      if (
        selector.visible !== undefined &&
        object?.visible !== selector.visible
      ) {
        return false;
      }
      return true;
    });
  }

  getViewportSize() {
    return { width: 800, height: 600 };
  }

  getSceneScale() {
    return 1;
  }

  toScreenLength(value: number) {
    return value;
  }

  toScenePoint(point: { x: number; y: number }) {
    return point;
  }

  toSceneRect(rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  }) {
    return rect;
  }

  onCanvasEvent(event: string, handler: (...args: any[]) => void) {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  offCanvasEvent(event: string, handler: (...args: any[]) => void) {
    this.handlers.set(
      event,
      (this.handlers.get(event) ?? []).filter((item) => item !== handler),
    );
  }

  emitCanvasEvent(event: string, payload: any) {
    (this.handlers.get(event) ?? []).forEach((handler) => handler(payload));
  }
}

class FakeSceneLayoutService {
  private listeners = new Map<string, Set<(layout: any) => void>>();

  constructor(private layout: any = null) {}

  getLayout() {
    return this.layout;
  }

  onLayoutChange(surfaceId: string, listener: (layout: any) => void) {
    const listeners =
      this.listeners.get(surfaceId) ?? new Set<(layout: any) => void>();
    listeners.add(listener);
    this.listeners.set(surfaceId, listeners);
    return {
      dispose: () => {
        listeners.delete(listener);
      },
    };
  }
}

class FakeSurfaceFrameService {
  private listeners = new Set<(event: { surfaceId: string }) => void>();

  constructor(private framesBySurfaceId: Record<string, SurfaceSceneFrames>) {}

  listSurfaceIds() {
    return Object.keys(this.framesBySurfaceId);
  }

  getFrames(surfaceId: string) {
    return this.framesBySurfaceId[surfaceId] ?? null;
  }

  onAnyFramesChange(listener: (event: { surfaceId: string }) => void) {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }
}

class FakeBrowserSceneExportService {}
class FakeFabricRenderGraphAdapter {}

const TEST_SURFACE_FRAMES: SurfaceSceneFrames = {
  previewBounds: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
  productionFrame: { xMm: 10, yMm: 20, widthMm: 80, heightMm: 70 },
  exportFrame: { xMm: 5, yMm: 15, widthMm: 90, heightMm: 85 },
  viewportFocusFrame: { xMm: 10, yMm: 20, widthMm: 80, heightMm: 70 },
};

function createMutableConfig(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const listenersByKey = new Map<string, Set<(event: any) => void>>();
  return {
    get: <T,>(key: string, defaultValue?: T) =>
      values.has(key) ? (values.get(key) as T) : defaultValue,
    onDidChange: (key: string, listener: (event: any) => void) => {
      const listeners =
        listenersByKey.get(key) ?? new Set<(event: any) => void>();
      listeners.add(listener);
      listenersByKey.set(key, listeners);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    update: (key: string, value: unknown) => {
      const oldValue = values.get(key);
      values.set(key, value);
      if (oldValue !== value) {
        listenersByKey.get(key)?.forEach((listener) => {
          listener({ key, oldValue, value });
        });
      }
    },
  };
}

function createMutableSurfaceFrames(
  initial: Record<string, SurfaceSceneFrames> = {},
) {
  const frameMap = new Map<string, SurfaceSceneFrames>(Object.entries(initial));
  const frameListeners = new Set<(event: any) => void>();
  return {
    getFrames: (surfaceId?: string) => {
      const key = surfaceId || Array.from(frameMap.keys()).sort()[0];
      return key ? frameMap.get(key) ?? null : null;
    },
    listSurfaceIds: () => Array.from(frameMap.keys()).sort(),
    onAnyFramesChange: (listener: (event: any) => void) => {
      frameListeners.add(listener);
      return { dispose: () => frameListeners.delete(listener) };
    },
    setFrames: (surfaceId: string, frames: SurfaceSceneFrames) => {
      frameMap.set(surfaceId, frames);
      frameListeners.forEach((listener) => listener({ surfaceId, frames }));
    },
  };
}

class FakeFabricObject {
  data: Record<string, any> = {};
  type: string;
  visible = true;
  clipPath: unknown;
  __pooderEffectClipKey?: string;

  constructor(type: string, values: Record<string, any> = {}) {
    this.type = type;
    Object.assign(this, values);
  }

  set(values: Record<string, any>) {
    Object.assign(this, values);
  }

  async clone() {
    return new FakeFabricObject(this.type, {
      ...this,
      data: { ...this.data },
      visible: this.visible,
    });
  }

  setCoords() {}
}

class FakeRenderableCanvas {
  height = 100;
  width = 100;
  objects: FakeFabricObject[] = [];
  renderCalls = 0;
  preserveObjectStacking = false;
  _objectsToRender: FakeFabricObject[] | undefined;

  add(obj: FakeFabricObject) {
    this.objects.push(obj);
  }

  dispose() {}

  getObjects() {
    return this.objects;
  }

  moveObjectTo(obj: FakeFabricObject, index: number) {
    const current = this.objects.indexOf(obj);
    if (current < 0) return;
    this.objects.splice(current, 1);
    const target = Math.max(0, Math.min(index, this.objects.length));
    this.objects.splice(target, 0, obj);
  }

  on() {}

  remove(obj: FakeFabricObject) {
    const index = this.objects.indexOf(obj);
    if (index >= 0) this.objects.splice(index, 1);
  }

  requestRenderAll() {
    this.renderCalls += 1;
  }

  _onStackOrderChanged() {
    this._objectsToRender = undefined;
  }
}

function createCanvasServiceForReconcileTests() {
  const canvas = new FakeRenderableCanvas();
  const service = Object.create(CanvasService.prototype) as CanvasService & any;
  service.canvas = canvas;
  service.viewport = {
    offset: { x: 0, y: 0 },
    scale: 1,
    updateContainer() {},
  };
  service.createFabricObject = async (spec: any) => {
    const obj = new FakeFabricObject(spec.type, { src: spec.src });
    obj.set({
      ...(spec.props || {}),
      data: { ...(spec.data || {}), id: spec.id },
    });
    return obj;
  };
  return { canvas, service };
}

function createRuntime() {
  const registered = new Map<unknown, Service>();
  return {
    registered,
    runtime: {
      eventBus: {} as any,
      services: {
        get(identifier: unknown) {
          return registered.get(identifier) as any;
        },
        register(service: Service, identifier?: unknown) {
          registered.set(identifier ?? service.constructor.name, service);
          return true;
        },
        unregister(
          serviceOrIdentifier: Service | unknown,
          identifier?: unknown,
        ) {
          const key =
            identifier ??
            (serviceOrIdentifier && typeof serviceOrIdentifier === "object"
              ? serviceOrIdentifier.constructor.name
              : serviceOrIdentifier);
          return registered.delete(key);
        },
      },
    },
  };
}

async function testCanvasServicePreservesViewportLayout() {
  const service = Object.create(CanvasService.prototype) as CanvasService & any;
  service.viewport = new ViewportSystem(
    { width: 800, height: 600 },
    { width: 100, height: 120 },
    96,
  );

  service.setViewportLayout({
    height: 478.5,
    offsetX: 112.25,
    offsetY: 60.75,
    scale: 4.25,
    width: 697.5,
  });

  assertClose(
    service.getSceneScale(),
    4.25,
    "canvas viewport should keep provided scale",
  );
  assertDeepEqual(
    service.getSceneOffset(),
    { x: 112.25, y: 60.75 },
    "canvas viewport should keep provided offset",
  );
  assertDeepEqual(
    service.toScreenPoint({ x: 10, y: 20 }),
    { x: 154.75, y: 145.75 },
    "screen mapping should use the provided scale and offset together",
  );
}

function testAttachRegistersRenderGraphAdapter() {
  const { registered, runtime } = createRuntime();
  const canvasService = new FakeCanvasService();
  const sceneLayoutService = new FakeSceneLayoutService({
    bleedRect: {
      centerX: 110,
      centerY: 120,
      height: 140,
      left: 10,
      top: 20,
      width: 200,
    },
    cutRect: {
      centerX: 110,
      centerY: 120,
      height: 140,
      left: 10,
      top: 20,
      width: 200,
    },
    offsetX: 24,
    offsetY: 36,
    revision: 0,
    scale: 2,
    surfaceId: "front",
    trimRect: {
      centerX: 110,
      centerY: 120,
      height: 140,
      left: 10,
      top: 20,
      width: 200,
    },
  });
  const surfaceFrameService = new FakeSurfaceFrameService({
    front: TEST_SURFACE_FRAMES,
  });
  const browserSceneExportService = new FakeBrowserSceneExportService();
  const graphAdapter = new FakeFabricRenderGraphAdapter();
  let observerCallback: ResizeObserverCallback | null = null;
  let disconnected = false;
  registered.set(SURFACE_FRAME_SERVICE, surfaceFrameService as any);

  const attachment = attachBrowserHost(runtime, {
    container: {
      clientHeight: 180,
      clientWidth: 320,
    } as Element & { clientHeight: number; clientWidth: number },
    canvas: { height: 0, width: 0 } as HTMLCanvasElement,
    createCanvasService: () => canvasService as any,
    createBrowserSceneExportService: () => browserSceneExportService as any,
    createFabricRenderGraphAdapter: () => graphAdapter as any,
    createSceneLayoutService: () => sceneLayoutService as any,
    createResizeObserver: (callback) => {
      observerCallback = callback;
      return {
        disconnect() {
          disconnected = true;
        },
        observe() {},
      };
    },
  });

  assertEqual(
    registered.get(FABRIC_RENDER_GRAPH_ADAPTER),
    graphAdapter as any,
    "graph adapter should register",
  );
  assertEqual(
    attachment.fabricRenderGraphAdapter,
    graphAdapter as any,
    "graph adapter should be exposed",
  );
  assertDeepEqual(
    canvasService.viewportLayoutCalls[0],
    {
      scale: 2,
      offsetX: 24,
      offsetY: 36,
      width: TEST_SURFACE_FRAMES.previewBounds.widthMm * 2,
      height: TEST_SURFACE_FRAMES.previewBounds.heightMm * 2,
    },
    "host should apply existing scene layout to the canvas viewport on attach",
  );

  const callback = observerCallback as ResizeObserverCallback | null;
  assert(callback, "resize observer callback should be installed");
  callback(
    [{ contentRect: { height: 240, width: 480 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  assertEqual(
    canvasService.resizeCalls[0]?.width,
    480,
    "resize width forwards",
  );

  attachment.dispose();
  assert(disconnected, "dispose should disconnect resize observer");
  assert(!registered.has(CANVAS_SERVICE), "canvas service should unregister");
  assert(
    !registered.has(SCENE_LAYOUT_SERVICE),
    "layout service should unregister",
  );
  assert(
    !registered.has(SCENE_EXPORT_SERVICE),
    "export service should unregister",
  );
  assert(
    !registered.has(FABRIC_RENDER_GRAPH_ADAPTER),
    "graph adapter should unregister",
  );
}

async function testFabricRenderGraphAdapterBuildsDrawList() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  const renderIntentService = runtime.services.getOrThrow(
    RENDER_INTENT_SERVICE,
  );
  renderIntentService.setDocumentIntents([
    {
      id: "background",
      subject: {
        kind: "object",
        surfaceId: "s1",
        layerId: "bg",
        objectId: "bg",
      },
      visual: { type: "rect" },
      ordering: { layerId: "bg", stack: 0, layerOrder: 0 },
      props: { width: 10, height: 10 },
    },
    {
      id: "art",
      subject: {
        kind: "object",
        surfaceId: "s1",
        layerId: "art",
        objectId: "art",
      },
      visual: { type: "rect" },
      ordering: { layerId: "art", stack: 10, layerOrder: 0 },
      props: { width: 5, height: 5 },
      effects: [
        {
          type: "clipPath",
          id: "clip.art",
          source: {
            id: "clip-source",
            type: "rect",
            props: { width: 3, height: 3 },
          },
          coordinateMode: "absolute",
        },
      ],
    },
    {
      id: "hidden-export",
      subject: {
        kind: "object",
        surfaceId: "s1",
        layerId: "art",
        objectId: "hidden-export",
      },
      visual: { type: "rect" },
      ordering: { layerId: "art", stack: 10, layerOrder: 1 },
      export: { visible: false, tags: ["mockup"] },
      props: { width: 7, height: 8 },
    },
  ]);

  await adapter.flush();
  const last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  assert(last, "adapter should reconcile");
  assertEqual(
    last.items.length,
    3,
    "adapter should reconcile hidden exportable nodes",
  );
  assertEqual(
    last.items[0]?.layerId,
    "bg",
    "draw list should keep layer order",
  );
  const artItem = last.items.find((item) => item.key === "art");
  assertEqual(
    artItem?.spec.effects?.length,
    1,
    "adapter should attach clip effects to object specs",
  );
  assertEqual(
    last.items[2]?.spec.props.visible,
    false,
    "hidden graph nodes should stay hidden on the live canvas",
  );
  assertDeepEqual(
    last.items[2]?.spec.data?.tags,
    ["mockup"],
    "hidden graph nodes should keep export tags for scene export",
  );
  assertEqual(
    artItem?.spec.effects?.[0]?.id,
    "clip.art",
    "clip should stay local on the graph object spec",
  );

  await runtime.dispose();
}

async function testFabricRenderGraphAdapterRendersRenderableScenes() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  const scene = runtime.services.getOrThrow(SCENE_SERVICE);
  scene.addLayer({ id: "headless" });
  scene.addElement({
    id: "headless-rect",
    layerId: "headless",
    type: "rect",
    width: 1,
    height: 1,
  });
  scene.addScene({ id: "session-scene", renderable: true, transient: true });
  scene.addLayer({ id: "session-layer" }, { sceneId: "session-scene" });
  scene.addElement(
    {
      id: "session-rect",
      layerId: "session-layer",
      type: "rect",
      width: 10,
      height: 12,
      style: { fill: "red" },
      data: { exportKeys: ["session-export"] },
    },
    { sceneId: "session-scene" },
  );

  await adapter.flush();
  const last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  assert(last, "adapter should reconcile scene content");
  assertDeepEqual(
    last.items.map((item) => item.key),
    ["scene:session-scene:session-rect"],
    "adapter should render only renderable scenes from SceneService",
  );
  assertEqual(
    last.items[0]?.spec.data?.sceneId,
    "session-scene",
    "rendered scene object should expose its scene id",
  );
  assertDeepEqual(
    last.items[0]?.spec.data?.exportKeys,
    ["session-rect", "session-export"],
    "rendered scene object should expose element export keys",
  );

  scene.removeScene("session-scene");
  await adapter.flush();
  const cleared = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  assertEqual(
    cleared?.items.length,
    0,
    "removing a renderable scene should clear it",
  );

  await runtime.dispose();
}

async function testFabricRenderGraphAdapterStretchesImageToDocumentFrame() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  const renderIntentService = runtime.services.getOrThrow(
    RENDER_INTENT_SERVICE,
  );
  renderIntentService.setDocumentIntents([
    {
      id: "slot",
      subject: {
        kind: "object",
        surfaceId: "s1",
        layerId: "art",
        objectId: "slot",
        objectType: "image",
      },
      visual: {
        type: "image",
        replacement: {
          src: "data:image/png;base64,cropped",
          metadata: {
            derived: {
              width: 400,
              height: 320,
            },
          },
        },
      },
      placement: {
        frame: { x: 100, y: 120, width: 200, height: 160 },
        transform: {
          left: 200,
          top: 200,
          originX: "center",
          originY: "center",
          scaleX: 0.5,
          scaleY: 0.5,
        },
      },
      ordering: { layerId: "art", stack: 10, layerOrder: 0 },
    },
  ]);

  await adapter.flush();
  const last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  const image = last?.items.find((item) => item.spec.id === "image:slot")?.spec;
  assert(image, "adapter should draw the committed image replacement");
  assertEqual(
    image.props.width,
    200,
    "image replacements should render at the document frame width",
  );
  assertEqual(
    image.props.height,
    160,
    "image replacements should render at the document frame height",
  );
  assertEqual(
    image.props.scaleX,
    1,
    "image replacements should not depend on bitmap scale for frame sizing",
  );
  assertEqual(
    image.props.scaleY,
    1,
    "image replacements should not depend on bitmap scale for frame sizing",
  );

  await runtime.dispose();
}

async function testFabricRenderGraphAdapterResyncsOnViewportChange() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  runtime.services.getOrThrow(RENDER_INTENT_SERVICE).setDocumentIntents([
    {
      id: "art",
      subject: {
        kind: "object",
        surfaceId: "s1",
        layerId: "art",
        objectId: "art",
      },
      visual: { type: "rect" },
      ordering: { layerId: "art", stack: 10, layerOrder: 0 },
      props: { width: 5, height: 5 },
    },
  ]);

  await adapter.flush();
  const before = canvas.reconcileCalls.length;
  runtime.eventBus.emit("canvas:resized", {});
  await adapter.flush();

  assert(
    canvas.reconcileCalls.length > before,
    "adapter should resync screen-space Fabric props after viewport changes",
  );

  await runtime.dispose();
}

async function testSceneLayoutServiceUsesStableSnapshots() {
  const runtime = new Pooder();
  const viewportSize = { width: 800, height: 600 };
  const canvas = {
    getViewportSize: () => ({ ...viewportSize }),
  };
  const layoutService = new SceneLayoutService();
  const frameMap = new Map<string, SurfaceSceneFrames>();
  const frameListeners = new Set<(event: any) => void>();
  const surfaceFrames = {
    getFrames: (surfaceId?: string) => {
      const key = surfaceId || Array.from(frameMap.keys()).sort()[0];
      return key ? frameMap.get(key) ?? null : null;
    },
    listSurfaceIds: () => Array.from(frameMap.keys()).sort(),
    onAnyFramesChange: (listener: (event: any) => void) => {
      frameListeners.add(listener);
      return { dispose: () => frameListeners.delete(listener) };
    },
    setFrames: (surfaceId: string, frames: SurfaceSceneFrames) => {
      frameMap.set(surfaceId, frames);
      frameListeners.forEach((listener) => listener({ surfaceId, frames }));
    },
  };
  layoutService.init({
    eventBus: runtime.eventBus,
    get: ((identifier: unknown) => {
      if (identifier === CANVAS_SERVICE) return canvas;
      if (identifier === SURFACE_FRAME_SERVICE) return surfaceFrames;
      return undefined;
    }) as any,
    getOrThrow: (() => undefined) as any,
    has: () => false,
  });

  const changes: unknown[] = [];
  layoutService.onLayoutChange("front", (layout) => {
    changes.push(layout);
  });

  assertEqual(
    layoutService.getLayout("front"),
    null,
    "getLayout should not compute a missing snapshot",
  );
  assertEqual(changes.length, 0, "pure reads should not emit layout changes");

  surfaceFrames.setFrames("front", TEST_SURFACE_FRAMES);
  const first = layoutService.getLayout("front");
  assert(first, "frame invalidation should produce a layout snapshot");
  assertEqual(first.surfaceId, "front", "snapshot should carry its surface id");
  assertEqual(first.revision, 1, "first material snapshot should start revision");
  assertEqual(changes.length, 1, "frame invalidation should emit once");

  const second = layoutService.recomputeLayout("front");
  assert(second, "explicit recompute should return the stable snapshot");
  assertEqual(second.revision, 1, "unchanged recompute should keep revision");
  assertEqual(changes.length, 1, "unchanged recompute should not emit");

  layoutService.getLayout("front");
  layoutService.getLayout("front");
  assertEqual(changes.length, 1, "cached reads should remain side-effect free");

  viewportSize.width = 1000;
  runtime.eventBus.emit("canvas:resized", { width: 1000, height: 600 });
  const resized = layoutService.getLayout("front");
  assert(resized, "canvas resize should recompute the layout");
  assertEqual(resized.revision, 2, "changed resize layout should increment revision");
  assertEqual(changes.length, 2, "canvas resize should emit a real layout change");

  layoutService.dispose();
  await runtime.dispose();
}

async function testSceneLayoutServiceClearsRemovedSurfaceSnapshots() {
  const runtime = new Pooder();
  const canvas = {
    getViewportSize: () => ({ width: 800, height: 600 }),
  };
  const layoutService = new SceneLayoutService();
  const frameMap = new Map<string, SurfaceSceneFrames>();
  const frameListeners = new Set<(event: any) => void>();
  const surfaceFrames = {
    clear: () => {
      const previous = Array.from(frameMap.keys());
      frameMap.clear();
      previous.forEach((surfaceId) => {
        frameListeners.forEach((listener) =>
          listener({ surfaceId, frames: null }),
        );
      });
    },
    getFrames: (surfaceId?: string) => {
      const key = surfaceId || Array.from(frameMap.keys()).sort()[0];
      return key ? frameMap.get(key) ?? null : null;
    },
    listSurfaceIds: () => Array.from(frameMap.keys()).sort(),
    onAnyFramesChange: (listener: (event: any) => void) => {
      frameListeners.add(listener);
      return { dispose: () => frameListeners.delete(listener) };
    },
    setFrames: (surfaceId: string, frames: SurfaceSceneFrames) => {
      frameMap.set(surfaceId, frames);
      frameListeners.forEach((listener) => listener({ surfaceId, frames }));
    },
  };
  layoutService.init({
    eventBus: runtime.eventBus,
    get: ((identifier: unknown) => {
      if (identifier === CANVAS_SERVICE) return canvas;
      if (identifier === SURFACE_FRAME_SERVICE) return surfaceFrames;
      return undefined;
    }) as any,
    getOrThrow: (() => undefined) as any,
    has: () => false,
  });

  const changes: Array<unknown> = [];
  layoutService.onLayoutChange("front", (layout) => {
    changes.push(layout);
  });

  surfaceFrames.setFrames("front", TEST_SURFACE_FRAMES);
  assert(layoutService.getLayout("front"), "snapshot should exist before clear");

  surfaceFrames.clear();
  assertEqual(
    layoutService.getLayout("front"),
    null,
    "removed surface should clear its layout snapshot",
  );
  assertEqual(changes.length, 2, "clear should emit a null layout change");
  assertEqual(changes[1], null, "clear should publish a null layout");

  layoutService.dispose();
  await runtime.dispose();
}

async function testSceneLayoutServiceUsesConfiguredViewPadding() {
  const runtime = new Pooder();
  const canvas = {
    getViewportSize: () => ({ width: 800, height: 600 }),
  };
  const config = createMutableConfig({ "size.viewPadding": "10%" });
  const surfaceFrames = createMutableSurfaceFrames({
    front: TEST_SURFACE_FRAMES,
  });
  const layoutService = new SceneLayoutService();

  layoutService.init({
    eventBus: runtime.eventBus,
    get: ((identifier: unknown) => {
      if (identifier === CANVAS_SERVICE) return canvas;
      if (identifier === CONFIGURATION_SERVICE) return config;
      if (identifier === SURFACE_FRAME_SERVICE) return surfaceFrames;
      return undefined;
    }) as any,
    getOrThrow: (() => undefined) as any,
    has: () => false,
  });

  const layout = layoutService.getLayout("front");
  assert(layout, "configured padding layout should resolve");
  assertClose(
    layout.scale,
    4,
    "scene layout should use size.viewPadding from runtime config",
  );

  layoutService.dispose();
  await runtime.dispose();
}

async function testSceneLayoutServiceRecomputesOnViewPaddingChange() {
  const runtime = new Pooder();
  const canvas = {
    getViewportSize: () => ({ width: 800, height: 600 }),
  };
  const config = createMutableConfig({ "size.viewPadding": "16%" });
  const surfaceFrames = createMutableSurfaceFrames({
    front: TEST_SURFACE_FRAMES,
  });
  const layoutService = new SceneLayoutService();

  layoutService.init({
    eventBus: runtime.eventBus,
    get: ((identifier: unknown) => {
      if (identifier === CANVAS_SERVICE) return canvas;
      if (identifier === CONFIGURATION_SERVICE) return config;
      if (identifier === SURFACE_FRAME_SERVICE) return surfaceFrames;
      return undefined;
    }) as any,
    getOrThrow: (() => undefined) as any,
    has: () => false,
  });

  const initial = layoutService.getLayout("front");
  assert(initial, "initial layout should resolve");
  assertClose(initial.scale, 3.4, "initial layout should use 16% padding");
  assertEqual(initial.revision, 1, "initial layout should start revision");

  config.update("size.viewPadding", "10%");

  const updated = layoutService.getLayout("front");
  assert(updated, "updated layout should resolve");
  assertClose(updated.scale, 4, "updated layout should use new view padding");
  assertEqual(updated.revision, 2, "padding change should increment revision");

  layoutService.dispose();
  await runtime.dispose();
}

async function testFabricRenderGraphAdapterReportsSyncState() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  await adapter.flush();

  const states: ReturnType<FabricRenderGraphAdapter["getSyncState"]>[] = [];
  const stop = adapter.onSyncStateChange(
    (state) => {
      states.push(state);
    },
    { immediate: true },
  );

  runtime.services.getOrThrow(RENDER_INTENT_SERVICE).setDocumentIntents([
    {
      id: "background",
      subject: {
        kind: "object",
        surfaceId: "s1",
        layerId: "bg",
        objectId: "bg",
      },
      visual: { type: "rect" },
      ordering: { layerId: "bg", stack: 0, layerOrder: 0 },
      props: { width: 10, height: 10 },
    },
  ]);

  assert(
    states.some((state) => state.loading),
    "adapter should report loading while graph sync is pending",
  );

  await adapter.flush();
  const finalState = states[states.length - 1];
  assert(finalState, "adapter should report a final sync state");
  assertEqual(
    finalState.loading,
    false,
    "adapter should report idle after flush",
  );
  assertEqual(finalState.pending, 0, "adapter should clear pending sync count");
  assert(
    finalState.generation > 0,
    "adapter should expose a monotonic sync generation",
  );

  stop();
  await runtime.dispose();
}

async function testFabricRenderGraphAdapterPreservesScreenSpace() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  runtime.services.getOrThrow(RENDER_INTENT_SERVICE).setDocumentIntents([
    {
      id: "screen-overlay",
      subject: {
        kind: "object",
        surfaceId: "s1",
        layerId: "overlay",
        objectId: "screen-overlay",
      },
      visual: { type: "path" },
      coordinateSpace: "screen",
      ordering: { layerId: "overlay", stack: 100, layerOrder: 0 },
      props: { pathData: "M 0 0 L 10 0 L 10 10 Z" },
    },
  ]);

  await adapter.flush();
  const last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  assert(last, "adapter should reconcile screen-space nodes");
  assertEqual(
    last.items[0]?.spec.space,
    "screen",
    "adapter should preserve graph node coordinate space",
  );

  await runtime.dispose();
}

async function testFabricRenderGraphAdapterDoesNotSizePathFromFrame() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  runtime.services.getOrThrow(RENDER_INTENT_SERVICE).setDocumentIntents([
    {
      id: "cutline",
      subject: {
        kind: "object",
        surfaceId: "front",
        layerId: "front.dieline-overlay",
        objectId: "cutline",
      },
      visual: { type: "path" },
      placement: {
        frame: { x: 30, y: 30, width: 531, height: 531 },
        transform: { scaleX: 1, scaleY: 1 },
      },
      ordering: { layerId: "front.dieline-overlay", objectOrder: 0 },
      props: {
        fill: "transparent",
        pathData: "M0 0H531V531H0Z",
        stroke: "#ef4444",
        strokeWidth: 2,
      },
    },
  ]);

  await adapter.flush();
  const last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  const props = last?.items[0]?.spec.props ?? {};
  assert(last, "adapter should reconcile path nodes");
  assertEqual(props.left, 30, "path should still receive frame left placement");
  assertEqual(props.top, 30, "path should still receive frame top placement");
  assertEqual(
    props.width,
    undefined,
    "path placement should not overwrite path intrinsic width",
  );
  assertEqual(
    props.height,
    undefined,
    "path placement should not overwrite path intrinsic height",
  );

  await runtime.dispose();
}

async function testFabricRenderGraphAdapterDefaultsPathTransformOriginToTopLeft() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  runtime.services.getOrThrow(RENDER_INTENT_SERVICE).setDocumentIntents([
    {
      id: "detected-cutline",
      subject: {
        kind: "object",
        surfaceId: "front",
        layerId: "front.dieline-overlay",
        objectId: "detected-cutline",
      },
      visual: { type: "path" },
      placement: {
        frame: { x: 10, y: 12, width: 80, height: 40 },
        transform: { left: 10, scaleX: 2, scaleY: 2, top: 12 },
      },
      ordering: { layerId: "front.dieline-overlay", objectOrder: 0 },
      props: {
        pathData: "M0 0H40V20H0Z",
      },
    },
  ]);

  await adapter.flush();
  const last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  const props = last?.items[0]?.spec.props ?? {};
  assert(last, "adapter should reconcile transformed path nodes");
  assertEqual(props.left, 10, "path should keep explicit transform left");
  assertEqual(props.top, 12, "path should keep explicit transform top");
  assertEqual(
    props.originX,
    "left",
    "transformed paths should still default to left origin",
  );
  assertEqual(
    props.originY,
    "top",
    "transformed paths should still default to top origin",
  );

  await runtime.dispose();
}

async function testFabricRenderGraphAdapterKeepsDocumentGuidesAboveUploadOverlay() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  const renderIntentService =
    runtime.services.getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE);
  renderIntentService.setDocumentIntents([
    {
      id: "front.dieline.cutline",
      subject: {
        kind: "object",
        surfaceId: "front",
        layerId: "front.dieline-overlay",
        objectId: "front.dieline.cutline",
        objectType: "object",
      },
      visual: { type: "path" },
      placement: {
        frame: { x: 30, y: 30, width: 531, height: 531 },
      },
      ordering: {
        layerId: "front.dieline-overlay",
        layerOrder: 30,
        objectOrder: 0,
        stack: 0,
      },
      props: {
        fill: "transparent",
        pathData: "M0 0H531V531H0Z",
        stroke: "#ef4444",
        strokeWidth: 2,
      },
      data: {
        documentLayerRole: "guide",
      },
    },
  ]);
  renderIntentService.patchIntent("image-upload", {
    id: "upload:front.image.user",
    subject: {
      kind: "object",
      surfaceId: "front",
      layerId: "image.overlay",
      objectId: "front.image.user",
      objectType: "rect",
    },
    visual: { type: "rect" },
    ordering: {
      layerId: "image.overlay",
      layerOrder: 0,
      objectOrder: 0,
      stack: 800,
    },
    props: {
      fill: "rgba(22, 119, 255, 0.08)",
      height: 531,
      left: 30,
      stroke: "#1677ff",
      strokeDashArray: [12, 8],
      strokeWidth: 2,
      top: 30,
      width: 531,
    },
  });

  await adapter.flush();
  const last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  assert(last, "adapter should reconcile guide and upload overlay nodes");
  const guideOrder = last.items.find(
    (item) => item.key === "front.dieline.cutline",
  )?.order;
  const uploadOrder = last.items.find(
    (item) => item.key === "upload:front.image.user",
  )?.order;
  assert(
    typeof guideOrder === "number" &&
      typeof uploadOrder === "number" &&
      guideOrder > uploadOrder,
    "document guide nodes should render above image upload overlays",
  );

  await runtime.dispose();
}

async function testFabricRenderGraphAdapterMapsDeclarativeInteraction() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  const intents = runtime.services.getOrThrow(RENDER_INTENT_SERVICE);
  intents.setDocumentIntents([
    {
      id: "interactive",
      subject: {
        kind: "object",
        surfaceId: "s1",
        layerId: "art",
        objectId: "interactive",
      },
      visual: { type: "rect" },
      ordering: { layerId: "art", objectOrder: 0 },
      props: { width: 10, height: 10 },
      interaction: { drag: { enabled: true } },
    },
    {
      id: "constraint-only",
      subject: {
        kind: "object",
        surfaceId: "s1",
        layerId: "art",
        objectId: "constraint-only",
      },
      visual: { type: "rect" },
      ordering: { layerId: "art", objectOrder: 1 },
      props: { width: 10, height: 10 },
      interaction: {
        drag: {
          constraints: [
            {
              spec: {
                type: "rect.contain",
                params: { rect: { left: 0, top: 0, width: 100, height: 100 } },
              },
            },
          ],
        },
      },
    },
    {
      id: "conditional",
      subject: {
        kind: "object",
        surfaceId: "s1",
        layerId: "art",
        objectId: "conditional",
      },
      visual: { type: "rect" },
      ordering: { layerId: "art", objectOrder: 2 },
      props: { width: 10, height: 10 },
      interaction: {
        enabledWhen: {
          op: "truthy",
          ref: { source: "context", key: "can.interact" },
        },
        drag: {
          enabled: true,
          constraints: [
            {
              activeWhen: { op: "const", value: true },
              spec: { type: "grid.snap", params: { size: 5 } },
            },
          ],
        },
      },
    },
    {
      id: "runtime-evented",
      subject: {
        kind: "object",
        surfaceId: "s1",
        layerId: "art",
        objectId: "runtime-evented",
      },
      visual: { type: "rect" },
      ordering: { layerId: "art", objectOrder: 3 },
      props: {
        width: 10,
        height: 10,
        selectable: false,
        evented: true,
      },
    },
    {
      id: "transform-only",
      subject: {
        kind: "object",
        surfaceId: "s1",
        layerId: "art",
        objectId: "transform-only",
      },
      visual: { type: "rect" },
      ordering: { layerId: "art", objectOrder: 4 },
      props: { width: 10, height: 10 },
      interaction: { transform: { enabled: true } },
    },
  ]);

  await adapter.flush();
  let last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  assert(last, "adapter should reconcile declarative interaction");
  const interactive = last.items.find((item) => item.key === "interactive");
  const constraintOnly = last.items.find((item) => item.key === "constraint-only");
  const conditional = last.items.find((item) => item.key === "conditional");
  const runtimeEvented = last.items.find((item) => item.key === "runtime-evented");
  const transformOnly = last.items.find((item) => item.key === "transform-only");
  assertEqual(
    interactive?.spec.props.selectable,
    true,
    "interaction alone should enable Fabric selection",
  );
  assertEqual(
    interactive?.spec.props.evented,
    true,
    "interaction alone should enable Fabric events",
  );
  assertEqual(
    interactive?.spec.props.hasControls,
    false,
    "drag interaction alone should not expose transform controls",
  );
  assertEqual(
    interactive?.spec.props.lockMovementX,
    false,
    "drag interaction should unlock movement",
  );
  assertEqual(
    constraintOnly?.spec.props.selectable,
    false,
    "constraints alone should not enable Fabric selection",
  );
  assertEqual(
    constraintOnly?.spec.data?.interactionEnabled,
    false,
    "constraints alone should not mark the live object interactive",
  );
  assertEqual(
    conditional?.spec.props.visible,
    true,
    "interaction.enabledWhen should not affect object visibility",
  );
  assertEqual(
    conditional?.spec.props.selectable,
    false,
    "unmatched interaction.enabledWhen should disable interaction",
  );
  assertEqual(
    runtimeEvented?.spec.props.selectable,
    false,
    "runtime props should keep non-selectable graph objects non-selectable",
  );
  assertEqual(
    runtimeEvented?.spec.props.evented,
    true,
    "runtime props should keep graph objects targetable for canvas clicks",
  );
  assertEqual(
    runtimeEvented?.spec.data?.interactionEnabled,
    false,
    "runtime evented props should not opt into declarative drag handling",
  );
  assertEqual(
    transformOnly?.spec.props.selectable,
    true,
    "transform interaction should make objects selectable for controls",
  );
  assertEqual(
    transformOnly?.spec.props.hasControls,
    true,
    "transform interaction should expose transform controls",
  );
  assertEqual(
    transformOnly?.spec.props.lockMovementX,
    true,
    "transform-only interaction should keep movement locked",
  );
  assertEqual(
    transformOnly?.spec.data?.interactionEnabled,
    true,
    "transform interaction should mark the live object interactive",
  );

  intents.setRuntimeConditionValue("can.interact", true);
  await adapter.flush();
  last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  const enabledConditional = last.items.find(
    (item) => item.key === "conditional",
  );
  assertEqual(
    enabledConditional?.spec.props.selectable,
    true,
    "matched interaction.enabledWhen should enable interaction",
  );
  assertDeepEqual(
    enabledConditional?.spec.data?.interactionConstraints,
    [{ type: "grid.snap", params: { size: 5 } }],
    "matched constraint.activeWhen should expose active constraints to dragging",
  );

  await runtime.dispose();
}

async function testFabricRenderGraphAdapterConstrainsDragging() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  const target = {
    left: 95,
    top: 20,
    width: 10,
    height: 10,
    scaleX: 1,
    scaleY: 1,
    data: {
      renderTarget: "render-graph",
      subjectId: "constrained",
      renderIntentId: "constrained",
      interactionEnabled: true,
      interactionConstraints: [
        {
          type: "rect.contain",
          params: { rect: { left: 0, top: 0, width: 100, height: 100 } },
        },
      ],
    },
    getBoundingRect() {
      return {
        left: this.left,
        top: this.top,
        width: this.width,
        height: this.height,
      };
    },
    set(values: Record<string, unknown>) {
      Object.assign(this, values);
    },
    setCoords() {},
  };

  canvas.emitCanvasEvent("object:moving", { target });
  assertEqual(
    target.left,
    90,
    "rect interaction constraints should clamp graph objects",
  );
  let modifiedTransform: any;
  const transformListener = (event: any) => {
    modifiedTransform = event;
  };
  runtime.eventBus.on("render-graph:object-transform", transformListener);
  canvas.emitCanvasEvent("object:modified", { target });
  runtime.eventBus.off("render-graph:object-transform", transformListener);
  assertDeepEqual(
    modifiedTransform?.transform?.frame,
    { left: 90, top: 20, width: 10, height: 10 },
    "modified graph objects should emit the resolved transform result",
  );

  const constraintOnly = {
    ...target,
    left: 95,
    data: {
      ...target.data,
      subjectId: "constraint-only",
      renderIntentId: "constraint-only",
      interactionEnabled: false,
    },
  };
  canvas.emitCanvasEvent("object:moving", { target: constraintOnly });
  assertEqual(
    constraintOnly.left,
    95,
    "constraints without enabled interaction should not make objects draggable",
  );

  const reference = {
    left: 10,
    top: 10,
    width: 40,
    height: 40,
    visible: true,
    data: {
      renderTarget: "render-graph",
      subject: { objectId: "bounds" },
      subjectId: "bounds",
      renderIntentId: "bounds",
    },
    getBoundingRect() {
      return {
        left: this.left,
        top: this.top,
        width: this.width,
        height: this.height,
      };
    },
  };
  const objectConstrained = {
    ...target,
    left: 80,
    top: 20,
    data: {
      renderTarget: "render-graph",
      subjectId: "object-constrained",
      renderIntentId: "object-constrained",
      interactionEnabled: true,
      interactionConstraints: [
        {
          type: "object-frame.contain",
          source: { sourceId: "render-graph", geometryId: "bounds" },
          params: { target: "center" },
        },
      ],
    },
  };
  canvas.objects = [reference];
  canvas.emitCanvasEvent("object:moving", { target: objectConstrained });
  assertEqual(
    objectConstrained.left,
    45,
    "object-frame interaction constraints should use live object bounds",
  );
  canvas.emitCanvasEvent("object:modified", { target: objectConstrained });

  await runtime.dispose();
}

async function testCanvasReconcileRemovesStaleObjectsAndClearsClip() {
  const { canvas, service } = createCanvasServiceForReconcileTests();
  const stale = new FakeFabricObject("rect", {
    data: { renderTarget: "render-graph", renderKey: "stale" },
  });
  const clipped = new FakeFabricObject("rect", {
    data: {
      renderTarget: "render-graph",
      renderKey: "kept",
      layerId: "art",
      subjectId: "art",
    },
  });
  clipped.__pooderEffectClipKey = "old";
  clipped.clipPath = new FakeFabricObject("rect");
  canvas.objects.push(stale, clipped);

  await service.reconcileRenderGraphDrawList(
    [
      {
        key: "kept",
        layerId: "art",
        order: 0,
        spec: {
          id: "kept",
          type: "rect",
          props: { width: 10, height: 10 },
          data: { subjectId: "art" },
        },
      },
    ],
  );

  assert(
    !canvas.objects.includes(stale),
    "stale graph object should be removed",
  );
  assertEqual(
    canvas.objects.length,
    1,
    "only current graph object should remain",
  );
  assertEqual(
    canvas.objects[0]?.clipPath,
    undefined,
    "missing clip effect should clear managed clip path",
  );
}

async function testCanvasReconcileSortsByRenderOrder() {
  const { canvas, service } = createCanvasServiceForReconcileTests();

  await service.reconcileRenderGraphDrawList(
    [
      {
        key: "guide",
        layerId: "guide",
        order: 900,
        spec: {
          id: "guide",
          type: "path",
          props: { pathData: "M0 0H10V10H0Z" },
          data: { subjectId: "guide" },
        },
      },
      {
        key: "content",
        layerId: "content",
        order: 10,
        spec: {
          id: "content",
          type: "rect",
          props: { height: 10, width: 10 },
          data: { subjectId: "content" },
        },
      },
    ],
  );

  assertDeepEqual(
    canvas.objects.map((object) => object.data.renderKey),
    ["content", "guide"],
    "render graph objects should stack by resolved render order",
  );
}

function testCanvasServiceOmitsPathSourcePropsFromFabricProps() {
  const { service } = createCanvasServiceForReconcileTests();
  const props = (service as any).resolveObjectFabricProps(
    {},
    {
      id: "front.dieline.cutline",
      type: "path",
      props: {
        fill: "transparent",
        path: "M0 0H10V10H0Z",
        pathData: "M0 0H10V10H0Z",
        stroke: "#ef4444",
        strokeWidth: 2,
      },
    },
  );

  assertEqual(
    props.path,
    undefined,
    "path source data should not be written as a Fabric path property",
  );
  assertEqual(
    props.pathData,
    undefined,
    "pathData source data should not be written as a Fabric path property",
  );
  assertEqual(props.stroke, "#ef4444", "path stroke style should be preserved");
  assertEqual(props.strokeWidth, 2, "path stroke width should be preserved");
}

function testCanvasServiceScalesImagesToTargetFrame() {
  const { service } = createCanvasServiceForReconcileTests();
  const image: any = new FakeFabricObject("image", {
    height: 50,
    width: 100,
  });
  image.getElement = () => ({ naturalHeight: 50, naturalWidth: 100 });

  (service as any).patchFabricObject(image, {
    id: "image",
    type: "image",
    src: "/image.png",
    space: "scene",
    props: {
      height: 160,
      left: 0,
      scaleX: 1,
      scaleY: 1,
      top: 0,
      width: 200,
    },
  });

  assertEqual(
    image.width,
    100,
    "image target frame should not overwrite the source width",
  );
  assertEqual(
    image.height,
    50,
    "image target frame should not overwrite the source height",
  );
  assertClose(
    image.scaleX,
    2,
    "image target frame should convert width into x scale",
  );
  assertClose(
    image.scaleY,
    3.2,
    "image target frame should convert height into y scale",
  );
}

async function testCanvasReconcileAppliesInteractiveControlDefaults() {
  const { canvas, service } = createCanvasServiceForReconcileTests();

  await service.reconcileRenderGraphDrawList(
    [
      {
        key: "interactive",
        layerId: "art",
        order: 0,
        spec: {
          id: "interactive",
          type: "rect",
          props: {
            width: 10,
            height: 10,
            hasControls: true,
          },
          data: { subjectId: "interactive-subject" },
        },
      },
      {
        key: "non-interactive",
        layerId: "controls",
        order: 1,
        spec: {
          id: "non-interactive",
          type: "rect",
          props: {
            width: 10,
            height: 10,
            hasControls: false,
          },
          data: { subjectId: "non-interactive-subject" },
        },
      },
    ],
  );

  const interactive = canvas.objects.find(
    (object) => object.data?.id === "interactive",
  ) as any;
  const nonInteractive = canvas.objects.find(
    (object) => object.data?.id === "non-interactive",
  ) as any;

  assert(interactive, "interactive object should be reconciled");
  assert(nonInteractive, "non-interactive object should be reconciled");
  assertDeepEqual(
    Object.keys(interactive.controls || {}).sort(),
    ["bl", "br", "mtr", "tl", "tr"],
    "interactive controls should expose corner scale handles and the rotation handle",
  );
  assertEqual(
    interactive.controls.mtr.actionName,
    "rotate",
    "rotation control should use Fabric's default rotation handle",
  );
  ["tl", "tr", "bl", "br"].forEach((controlKey) => {
    assertEqual(
      interactive.controls[controlKey].actionName,
      "scale",
      `${controlKey} control should scale`,
    );
  });
  assertEqual(
    interactive.cornerStyle,
    "circle",
    "interactive controls should use circular corners",
  );
  assertEqual(
    interactive.transparentCorners,
    false,
    "interactive controls should be solid",
  );
  assertEqual(
    interactive.cornerSize,
    18,
    "interactive controls should use the prominent corner size",
  );
  assertEqual(
    interactive.touchCornerSize,
    32,
    "interactive controls should use the prominent touch size",
  );
  assertEqual(
    interactive.cornerColor,
    "#1677ff",
    "interactive controls should use the accent fill",
  );
  assertEqual(
    interactive.cornerStrokeColor,
    "#ffffff",
    "interactive controls should use a white outline",
  );
  assertEqual(
    interactive.borderColor,
    "#1677ff",
    "interactive border should match the accent fill",
  );
  assertEqual(
    interactive.borderScaleFactor,
    1.5,
    "interactive border should be more visible",
  );
  assertEqual(
    interactive.padding,
    2,
    "interactive controls should have a small visual gap",
  );
  assertEqual(
    nonInteractive.controls,
    undefined,
    "non-interactive objects should not receive custom controls",
  );
  assertEqual(
    nonInteractive.cornerStyle,
    undefined,
    "non-interactive objects should not receive custom control styling",
  );
}

async function testCanvasReconcileAppliesClipPath() {
  const { canvas, service } = createCanvasServiceForReconcileTests();
  await service.reconcileRenderGraphDrawList(
    [
      {
        key: "art-node",
        layerId: "art",
        order: 0,
        spec: {
          id: "art-node",
          type: "rect",
          props: { width: 10, height: 10 },
          data: { subjectId: "art-subject" },
          effects: [
            {
              type: "clipPath",
              id: "clip.art",
              source: {
                id: "clip-source",
                type: "rect",
                props: { width: 5, height: 5 },
              },
            },
          ],
        },
      },
    ],
  );

  assert(canvas.objects[0]?.clipPath, "clip path should be attached");
  assertEqual(
    (canvas.objects[0] as any).__pooderEffectClipKey,
    "clip.art",
    "managed clip key should be tracked",
  );
}

async function testCanvasReconcileAppliesImageClipPath() {
  const { canvas, service } = createCanvasServiceForReconcileTests();
  await service.reconcileRenderGraphDrawList(
    [
      {
        key: "art-node",
        layerId: "art",
        order: 0,
        spec: {
          id: "art-node",
          type: "rect",
          props: { width: 10, height: 10 },
          data: { subjectId: "art-subject" },
          effects: [
            {
              type: "clipPath",
              id: "clip.art",
              source: {
                id: "clip-source",
                type: "image",
                src: "data:image/png;base64,dieline",
                space: "screen",
                props: { left: 1, top: 2, width: 100, height: 80 },
              },
            },
          ],
        },
      },
    ],
  );

  const clipPath = canvas.objects[0]?.clipPath as any;
  assert(clipPath, "image clip path should be attached");
  assertEqual(
    clipPath.type,
    "image",
    "clip path should preserve image source type",
  );
  assertEqual(
    clipPath.src,
    "data:image/png;base64,dieline",
    "clip path should preserve image source url",
  );
  assertEqual(
    clipPath.left,
    1,
    "clip path should preserve image positioning props",
  );
  assertEqual(
    clipPath.absolutePositioned,
    true,
    "image clip path should be absolute-positioned like other clip sources",
  );
}

async function testSceneExportMatchesRenderGraphNodeIds() {
  const source = {
    data: {
      exportKeys: ["session-image:slot"],
      tags: ["mockup", "design"],
      layerId: "image.user.session.image",
    },
    visible: false,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    getCenterPoint() {
      return { x: 20, y: 30 };
    },
    async clone() {
      return {
        set(values: Record<string, unknown>) {
          Object.assign(this, values);
        },
        setCoords() {},
      };
    },
  };
  const exportCanvas = {
    objects: [] as any[],
    add(object: any) {
      this.objects.push(object);
    },
    dispose() {},
    renderAll() {},
    setDimensions() {},
    toDataURL() {
      return "data:image/png;base64,ok";
    },
  };
  const service = new BrowserSceneExportService() as any;
  service.canvasService = {
    selectObjects: () => [source],
    getSceneScale: () => 1,
    toScenePoint: (point: { x: number; y: number }) => point,
    toSceneRect: (rect: {
      left: number;
      top: number;
      width: number;
      height: number;
    }) => rect,
  };
  service.sceneLayoutService = {};
  service.createExportCanvas = () => exportCanvas;

  const result = await service.exportImage({
    crop: {
      type: "sceneRect",
      rect: { left: 0, top: 0, width: 100, height: 80 },
    },
    source: {
      elementIds: ["session-image:slot"],
      layerIds: ["image.user.session.image"],
      tags: ["mockup"],
    },
  });

  assertEqual(
    exportCanvas.objects.length,
    1,
    "export should include objects matched by render graph node id",
  );
  assertEqual(
    exportCanvas.objects[0]?.visible,
    true,
    "export should force matched clones visible",
  );
  assertEqual(
    result.source.elementIds[0],
    "session-image:slot",
    "export result should report render graph node id",
  );
  assertDeepEqual(
    result.source.tags,
    ["mockup", "design"],
    "export result should report matched export tags",
  );
}

async function testSceneExportCombinesSourceSelectorDimensions() {
  const createSource = (
    id: string,
    data: Record<string, unknown>,
    options: { excludeFromExport?: boolean; visible?: boolean } = {},
  ) => ({
    data: {
      exportKeys: [id],
      layerId: "image.user",
      tags: ["mockup"],
      ...data,
    },
    visible: options.visible ?? true,
    excludeFromExport: options.excludeFromExport,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    getCenterPoint() {
      return { x: 20, y: 30 };
    },
    async clone() {
      return {
        set(values: Record<string, unknown>) {
          Object.assign(this, values);
        },
        setCoords() {},
      };
    },
  });
  const exportCanvas = {
    objects: [] as any[],
    add(object: any) {
      this.objects.push(object);
    },
    dispose() {},
    renderAll() {},
    setDimensions() {},
    toDataURL() {
      return "data:image/png;base64,ok";
    },
  };
  const service = new BrowserSceneExportService() as any;
  service.canvasService = {
    selectObjects: () => [
      createSource("match", {}),
      createSource("wrong-tag", { tags: ["design"] }),
      createSource("wrong-layer", { layerId: "image.overlay" }),
      createSource("excluded", {}, { excludeFromExport: true }),
    ],
    getSceneScale: () => 1,
    toScenePoint: (point: { x: number; y: number }) => point,
    toSceneRect: (rect: {
      left: number;
      top: number;
      width: number;
      height: number;
    }) => rect,
  };
  service.sceneLayoutService = {};
  service.createExportCanvas = () => exportCanvas;

  const result = await service.exportImage({
    crop: {
      type: "sceneRect",
      rect: { left: 0, top: 0, width: 100, height: 80 },
    },
    source: {
      layerIds: ["image.user"],
      tags: ["mockup"],
    },
  });

  assertEqual(
    exportCanvas.objects.length,
    1,
    "export should require every populated source selector dimension to match",
  );
  assertDeepEqual(
    result.source.elementIds,
    ["match"],
    "export should report only objects that matched the combined selector",
  );
}

async function testSceneExportUsesCutFrameCrop() {
  const source = {
    data: {
      exportKeys: ["element"],
      layerId: "image.user",
    },
    visible: true,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    getCenterPoint() {
      return { x: 280, y: 220 };
    },
    async clone() {
      return {
        set(values: Record<string, unknown>) {
          Object.assign(this, values);
        },
        setCoords() {},
      };
    },
  };
  const exportCanvas = {
    objects: [] as any[],
    add(object: any) {
      this.objects.push(object);
    },
    dispose() {},
    renderAll() {},
    setDimensions() {},
    toDataURL() {
      return "data:image/png;base64,ok";
    },
  };
  const service = new BrowserSceneExportService() as any;
  const cutRect = { left: 125, top: 75, width: 300, height: 180 };
  service.canvasService = {
    selectObjects: () => [source],
    getSceneScale: () => 1,
    toScenePoint: (point: { x: number; y: number }) => point,
    toSceneRect: (rect: {
      left: number;
      top: number;
      width: number;
      height: number;
    }) => rect,
  };
  service.sceneLayoutService = {
    recomputeLayout: () => ({
      surfaceId: "legacy",
      revision: 1,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      cutRect,
      trimRect: cutRect,
      bleedRect: cutRect,
    }),
  };
  service.createExportCanvas = () => exportCanvas;

  const result = await service.exportImage({
    crop: { type: "frame", frame: "cut" },
    includeHidden: true,
    source: { layerIds: ["image.user"] },
  });

  assertDeepEqual(
    result.crop,
    cutRect,
    "frame export should crop from scene layout cut rect",
  );
  assertEqual(
    result.width,
    cutRect.width * 2,
    "frame export width should use cut crop",
  );
  assertEqual(
    result.height,
    cutRect.height * 2,
    "frame export height should use cut crop",
  );
}

async function testSceneExportClearsClipPathByDefault() {
  const exportCanvas = {
    objects: [] as any[],
    add(object: any) {
      this.objects.push(object);
    },
    dispose() {},
    renderAll() {},
    setDimensions() {},
    toDataURL() {
      return "data:image/png;base64,ok";
    },
  };
  const source = {
    data: {
      exportKeys: ["element"],
      layerId: "image.user",
    },
    visible: true,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    getCenterPoint() {
      return { x: 50, y: 40 };
    },
    async clone() {
      return {
        clipPath: { id: "clip" },
        set(values: Record<string, unknown>) {
          Object.assign(this, values);
        },
        setCoords() {},
      };
    },
  };
  const service = new BrowserSceneExportService() as any;
  service.canvasService = {
    selectObjects: () => [source],
    getSceneScale: () => 1,
    toScenePoint: (point: { x: number; y: number }) => point,
    toSceneRect: (rect: {
      left: number;
      top: number;
      width: number;
      height: number;
    }) => rect,
  };
  service.sceneLayoutService = {};
  service.createExportCanvas = () => exportCanvas;

  await service.exportImage({
    crop: {
      type: "sceneRect",
      rect: { left: 0, top: 0, width: 100, height: 80 },
    },
    source: { layerIds: ["image.user"] },
  });

  assertDeepEqual(
    exportCanvas.objects[0]?.clipPath,
    { id: "clip" },
    "export should preserve render effect clip paths by default",
  );
}

async function testSceneExportPreservesClipPathWhenRequested() {
  const clipPath = { id: "clip" };
  const exportCanvas = {
    objects: [] as any[],
    add(object: any) {
      this.objects.push(object);
    },
    dispose() {},
    renderAll() {},
    setDimensions() {},
    toDataURL() {
      return "data:image/png;base64,ok";
    },
  };
  const source = {
    data: {
      exportKeys: ["element"],
      layerId: "image.user",
    },
    visible: true,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    getCenterPoint() {
      return { x: 50, y: 40 };
    },
    async clone() {
      return {
        clipPath,
        set(values: Record<string, unknown>) {
          Object.assign(this, values);
        },
        setCoords() {},
      };
    },
  };
  const service = new BrowserSceneExportService() as any;
  service.canvasService = {
    selectObjects: () => [source],
    getSceneScale: () => 1,
    toScenePoint: (point: { x: number; y: number }) => point,
    toSceneRect: (rect: {
      left: number;
      top: number;
      width: number;
      height: number;
    }) => rect,
  };
  service.sceneLayoutService = {};
  service.createExportCanvas = () => exportCanvas;

  await service.exportImage({
    crop: {
      type: "sceneRect",
      rect: { left: 0, top: 0, width: 100, height: 80 },
    },
    preserveClipPaths: false,
    source: { layerIds: ["image.user"] },
  });

  assertEqual(
    exportCanvas.objects[0]?.clipPath,
    undefined,
    "export should clear clip paths when requested",
  );
}

function testOutputMaskAlphaHelpers() {
  const target = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 128]);
  const masked = applyAlphaMaskData(target, new Uint8ClampedArray([255, 0]));

  assertEqual(masked[3], 255, "alpha mask should keep covered pixels opaque");
  assertEqual(masked[7], 0, "alpha mask should clear uncovered pixels");
}

function testOutputMaskOutlineHelpers() {
  const width = 5;
  const height = 5;
  const data = new Uint8ClampedArray(width * height * 4);
  const setAlpha = (x: number, y: number) => {
    data[(y * width + x) * 4 + 3] = 255;
  };

  for (let index = 1; index <= 3; index += 1) {
    setAlpha(index, 1);
    setAlpha(index, 3);
    setAlpha(1, index);
    setAlpha(3, index);
  }

  const alpha = createBoundaryOutputMaskAlpha(data, width, height);
  assertEqual(alpha?.[2 * width + 2], 255, "outline mask should fill interior");
  assertEqual(alpha?.[0], 0, "outline mask should leave outside transparent");
}

function testOutputMaskOutlinePreservesFrameShape() {
  const width = 9;
  const height = 7;
  const data = new Uint8ClampedArray(width * height * 4);
  const setAlpha = (x: number, y: number) => {
    data[(y * width + x) * 4 + 3] = 255;
  };

  for (let x = 0; x < width; x += 1) {
    setAlpha(x, 0);
    setAlpha(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    setAlpha(0, y);
    setAlpha(width - 1, y);
  }

  const alpha = createBoundaryOutputMaskAlpha(data, width, height);
  assertEqual(
    alpha?.[1 * width + 1],
    255,
    "outline mask should preserve rectangular frame corners",
  );
  assertEqual(
    alpha?.[3 * width + 4],
    255,
    "outline mask should fill the frame center",
  );
}

function testOutputMaskTreatsNearWhiteAsTransparent() {
  const width = 5;
  const height = 5;
  const data = new Uint8ClampedArray(width * height * 4);
  const setPixel = (x: number, y: number, color: [number, number, number]) => {
    const index = (y * width + x) * 4;
    data[index] = color[0];
    data[index + 1] = color[1];
    data[index + 2] = color[2];
    data[index + 3] = 255;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(x, y, [255, 255, 255]);
    }
  }
  for (let index = 1; index <= 3; index += 1) {
    setPixel(index, 1, [254, 178, 191]);
    setPixel(index, 3, [254, 178, 191]);
    setPixel(1, index, [254, 178, 191]);
    setPixel(3, index, [254, 178, 191]);
  }

  const filtered = applyTransparentColorToAlpha(data, {
    red: 255,
    green: 255,
    blue: 255,
    tolerance: 8,
  });
  const alpha = createBoundaryOutputMaskAlpha(filtered, width, height);

  assertEqual(filtered[3], 0, "near-white pixels should become transparent");
  assertEqual(alpha?.[0], 0, "near-white outside should remain transparent");
  assertEqual(alpha?.[2 * width + 2], 255, "outline mask should fill interior");
}

async function testSceneExportAppliesOutputMask() {
  const source = {
    data: {
      exportKeys: ["element"],
      layerId: "image.user",
    },
    visible: true,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    getCenterPoint() {
      return { x: 50, y: 40 };
    },
    async clone() {
      return {
        set(values: Record<string, unknown>) {
          Object.assign(this, values);
        },
        setCoords() {},
      };
    },
  };
  const exportCanvas = {
    objects: [] as any[],
    add(object: any) {
      this.objects.push(object);
    },
    dispose() {},
    renderAll() {},
    setDimensions() {},
    toDataURL() {
      return "data:image/png;base64,raw";
    },
  };
  const service = new BrowserSceneExportService() as any;
  let outputMaskCall: any;
  service.canvasService = {
    selectObjects: () => [source],
    getSceneScale: () => 1,
    toScenePoint: (point: { x: number; y: number }) => point,
    toSceneRect: (rect: {
      left: number;
      top: number;
      width: number;
      height: number;
    }) => rect,
  };
  service.sceneLayoutService = {};
  service.createExportCanvas = () => exportCanvas;
  service.applyOutputMask = async (url: string, options: any) => {
    outputMaskCall = { options, url };
    return "data:image/png;base64,masked";
  };

  const result = await service.exportImage({
    crop: {
      type: "sceneRect",
      rect: { left: 0, top: 0, width: 100, height: 80 },
    },
    format: "jpeg",
    outputMask: { mode: "outline", sourceKey: "templateFrame" },
    source: { layerIds: ["image.user"] },
  });

  assertEqual(
    result.format,
    "png",
    "scene export should force png when output mask is requested",
  );
  assertEqual(
    result.url,
    "data:image/png;base64,masked",
    "scene export should return the masked output url",
  );
  assertEqual(
    outputMaskCall?.url,
    "data:image/png;base64,raw",
    "scene export should mask the rendered export image",
  );
  assertDeepEqual(
    outputMaskCall?.options.crop,
    { left: 0, top: 0, width: 100, height: 80 },
    "scene export should pass resolved crop to output mask",
  );
}

async function testSceneExportRejectsMissingOutputMaskSource() {
  const source = {
    data: {
      exportKeys: ["element"],
      layerId: "image.user",
    },
    visible: true,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    getCenterPoint() {
      return { x: 50, y: 40 };
    },
    async clone() {
      return {
        set(values: Record<string, unknown>) {
          Object.assign(this, values);
        },
        setCoords() {},
      };
    },
  };
  const exportCanvas = {
    add() {},
    dispose() {},
    renderAll() {},
    setDimensions() {},
    toDataURL() {
      return "data:image/png;base64,raw";
    },
  };
  const service = new BrowserSceneExportService() as any;
  service.canvasService = {
    selectObjects: () => [source],
    getSceneScale: () => 1,
    toScenePoint: (point: { x: number; y: number }) => point,
    toSceneRect: (rect: {
      left: number;
      top: number;
      width: number;
      height: number;
    }) => rect,
  };
  service.sceneLayoutService = {};
  service.createExportCanvas = () => exportCanvas;

  try {
    await service.exportImage({
      crop: {
        type: "sceneRect",
        rect: { left: 0, top: 0, width: 100, height: 80 },
      },
      outputMask: { sourceKey: "templateFrame" },
      source: { layerIds: ["image.user"] },
    });
    throw new Error("scene export should throw for missing output mask source");
  } catch (error) {
    assertEqual(
      error instanceof Error ? error.message : "",
      "browser-scene-export-output-mask-source-missing",
      "scene export should reject missing output mask source keys",
    );
  }
}

async function testSceneExportAllowsHiddenOutputMaskSource() {
  const source = {
    data: {
      exportKeys: ["element"],
      layerId: "image.user",
    },
    visible: true,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    getCenterPoint() {
      return { x: 50, y: 40 };
    },
    async clone() {
      return {
        set(values: Record<string, unknown>) {
          Object.assign(this, values);
        },
        setCoords() {},
      };
    },
  };
  const hiddenMask = {
    data: { outputMaskKeys: ["templateFrame"] },
    visible: false,
  };
  const exportCanvas = {
    add() {},
    dispose() {},
    renderAll() {},
    setDimensions() {},
    toDataURL() {
      return "data:image/png;base64,raw";
    },
  };
  const service = new BrowserSceneExportService() as any;
  service.canvasService = {
    selectObjects: () => [source, hiddenMask],
    getSceneScale: () => 1,
    toScenePoint: (point: { x: number; y: number }) => point,
    toSceneRect: (rect: {
      left: number;
      top: number;
      width: number;
      height: number;
    }) => rect,
  };
  service.sceneLayoutService = {};
  service.createExportCanvas = () => exportCanvas;
  service.applyOutputMask = async () => "data:image/png;base64,masked";

  const result = await service.exportImage({
    crop: {
      type: "sceneRect",
      rect: { left: 0, top: 0, width: 100, height: 80 },
    },
    outputMask: { sourceKey: "templateFrame" },
    source: { layerIds: ["image.user"] },
  });

  assertEqual(
    result.url,
    "data:image/png;base64,masked",
    "scene export should allow hidden output mask sources",
  );
}

async function main() {
  const tests: Array<[string, () => void | Promise<void>]> = [
    ["applies alpha mask data", testOutputMaskAlphaHelpers],
    ["fills outline output masks", testOutputMaskOutlineHelpers],
    [
      "preserves outline output mask frame shapes",
      testOutputMaskOutlinePreservesFrameShape,
    ],
    [
      "treats near-white output mask pixels as transparent",
      testOutputMaskTreatsNearWhiteAsTransparent,
    ],
    [
      "registers render graph adapter in browser host",
      testAttachRegistersRenderGraphAdapter,
    ],
    [
      "preserves explicit viewport layout",
      testCanvasServicePreservesViewportLayout,
    ],
    [
      "builds graph adapter draw list",
      testFabricRenderGraphAdapterBuildsDrawList,
    ],
    [
      "renders renderable SceneService scenes",
      testFabricRenderGraphAdapterRendersRenderableScenes,
    ],
    [
      "stretches image replacements to document frames",
      testFabricRenderGraphAdapterStretchesImageToDocumentFrame,
    ],
    [
      "resyncs graph adapter on layout change",
      testFabricRenderGraphAdapterResyncsOnViewportChange,
    ],
    [
      "keeps scene layout reads side-effect free",
      testSceneLayoutServiceUsesStableSnapshots,
    ],
    [
      "clears scene layout snapshots for removed surfaces",
      testSceneLayoutServiceClearsRemovedSurfaceSnapshots,
    ],
    [
      "uses configured scene view padding",
      testSceneLayoutServiceUsesConfiguredViewPadding,
    ],
    [
      "recomputes scene layout when view padding changes",
      testSceneLayoutServiceRecomputesOnViewPaddingChange,
    ],
    [
      "reports graph adapter sync state",
      testFabricRenderGraphAdapterReportsSyncState,
    ],
    [
      "preserves graph coordinate space",
      testFabricRenderGraphAdapterPreservesScreenSpace,
    ],
    [
      "does not size path nodes from frame dimensions",
      testFabricRenderGraphAdapterDoesNotSizePathFromFrame,
    ],
    [
      "defaults transformed path placement to top-left origin",
      testFabricRenderGraphAdapterDefaultsPathTransformOriginToTopLeft,
    ],
    [
      "keeps document guide nodes above upload overlays",
      testFabricRenderGraphAdapterKeepsDocumentGuidesAboveUploadOverlay,
    ],
    [
      "maps declarative interaction state",
      testFabricRenderGraphAdapterMapsDeclarativeInteraction,
    ],
    [
      "constrains render graph object dragging",
      testFabricRenderGraphAdapterConstrainsDragging,
    ],
    [
      "reconciles stale objects and clip cleanup",
      testCanvasReconcileRemovesStaleObjectsAndClearsClip,
    ],
    [
      "sorts reconciled render graph objects by render order",
      testCanvasReconcileSortsByRenderOrder,
    ],
    [
      "omits path source props from Fabric props",
      testCanvasServiceOmitsPathSourcePropsFromFabricProps,
    ],
    [
      "scales image target frames from source dimensions",
      testCanvasServiceScalesImagesToTargetFrame,
    ],
    [
      "applies interactive control defaults",
      testCanvasReconcileAppliesInteractiveControlDefaults,
    ],
    ["applies graph clip paths", testCanvasReconcileAppliesClipPath],
    ["applies graph image clip paths", testCanvasReconcileAppliesImageClipPath],
    [
      "exports by render graph node ids",
      testSceneExportMatchesRenderGraphNodeIds,
    ],
    [
      "combines source selector dimensions",
      testSceneExportCombinesSourceSelectorDimensions,
    ],
    [
      "exports frame crops from scene layout cut rect",
      testSceneExportUsesCutFrameCrop,
    ],
    [
      "preserves export clip paths by default",
      testSceneExportClearsClipPathByDefault,
    ],
    [
      "clears export clip paths when requested",
      testSceneExportPreservesClipPathWhenRequested,
    ],
    [
      "applies output masks during scene export",
      testSceneExportAppliesOutputMask,
    ],
    [
      "rejects missing output mask source",
      testSceneExportRejectsMissingOutputMaskSource,
    ],
    [
      "allows hidden output mask source",
      testSceneExportAllowsHiddenOutputMaskSource,
    ],
  ];

  for (const [name, run] of tests) {
    await run();
    console.log(`PASS ${name}`);
  }

  console.log("All platform-browser tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
