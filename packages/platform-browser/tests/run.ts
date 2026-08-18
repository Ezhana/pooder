import type { Service } from "@pooder/core";
import {
  CONFIGURATION_SERVICE,
  COMMAND_SERVICE,
  coordinateMatrix,
  createAffinePlacement,
  createStaticGeometrySource,
  createLocalToSceneMatrix,
  GEOMETRY_SOURCE_SERVICE,
  INTERACTION_SERVICE,
  Pooder,
  RENDER_INTENT_SERVICE,
  SCENE_SERVICE,
  SESSION_SERVICE,
  SCENE_FRAME_SERVICE,
  type RenderIntentService,
  type GeometrySourceService,
  type InteractionService,
  type SceneService,
  type SessionService,
} from "@pooder/core";
import type { SceneFrames } from "@pooder/core";
import {
  attachBrowserHost,
  BrowserObjectImageResolverService,
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
  createOutputMaskAlpha,
} from "../src";
import type {
  FabricRenderGraphReconcileOptions,
  FabricRenderTargetItem,
} from "../src/canvas-service";
import { ViewportSystem } from "../src/viewport-system";

declare const process: {
  env: Record<string, string | undefined>;
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

function createTestPlacement(
  left: number,
  top: number,
  width: number,
  height: number,
) {
  return createAffinePlacement({
    localBounds: { left: 0, top: 0, width, height },
    localToScene: coordinateMatrix("object-local", "scene", [
      1,
      0,
      0,
      1,
      left,
      top,
    ]),
  });
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
    options?: FabricRenderGraphReconcileOptions;
  }> = [];

  on(event: string, handler: (...args: any[]) => void) {
    const key = `typed:${event}`;
    const handlers = this.handlers.get(key) ?? [];
    handlers.push(handler);
    this.handlers.set(key, handlers);
    return {
      dispose: () => {
        this.handlers.set(
          key,
          (this.handlers.get(key) ?? []).filter((item) => item !== handler),
        );
      },
    };
  }

  emit(event: string, payload?: unknown) {
    this.handlers.get(`typed:${event}`)?.forEach((handler) => handler(payload));
  }

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

  async reconcileRenderGraphDrawList(
    items: FabricRenderTargetItem[],
    options?: FabricRenderGraphReconcileOptions,
  ) {
    this.reconcileCalls.push({
      items: items.map((item) => ({ ...item, spec: { ...item.spec } })),
      options,
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

  toScreenMatrix(matrix: any) {
    return { ...matrix, to: "screen", values: [...matrix.values] };
  }

  toSceneMatrix(matrix: any) {
    return { ...matrix, to: "scene", values: [...matrix.values] };
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
    const target = payload?.target;
    const typed =
      event === "object:moving"
        ? { event: "transform", payload: { kind: "move", target } }
        : event === "object:scaling"
          ? { event: "transform", payload: { kind: "resize", target } }
          : event === "object:rotating"
            ? { event: "transform", payload: { kind: "rotate", target } }
            : event === "object:modified"
              ? { event: "transform", payload: { kind: "commit", target } }
              : event === "mouse:down"
                ? { event: "pointer", payload: { kind: "down", target } }
                : event === "mouse:dblclick"
                  ? {
                      event: "pointer",
                      payload: { kind: "double-click", target },
                    }
                  : null;
    if (typed) {
      (this.handlers.get(`typed:${typed.event}`) ?? []).forEach((handler) =>
        handler(typed.payload),
      );
    }
  }
}

function createLayoutCanvas(
  getViewportSize: () => { width: number; height: number },
) {
  const resizeListeners = new Set<
    (event: { width: number; height: number }) => void
  >();
  return {
    getViewportSize,
    on: (event: string, listener: (payload: any) => void) => {
      if (event === "resized") resizeListeners.add(listener);
      return { dispose: () => resizeListeners.delete(listener) };
    },
    emitResize: () => {
      const size = getViewportSize();
      resizeListeners.forEach((listener) => listener(size));
    },
  };
}

class FakeSceneLayoutService {
  private listeners = new Map<string, Set<(layout: any) => void>>();

  constructor(private layout: any = null) {}

  getLayout() {
    return this.layout;
  }

  onLayoutChange(sceneId: string, listener: (layout: any) => void) {
    const listeners =
      this.listeners.get(sceneId) ?? new Set<(layout: any) => void>();
    listeners.add(listener);
    this.listeners.set(sceneId, listeners);
    return {
      dispose: () => {
        listeners.delete(listener);
      },
    };
  }
}

class FakeSceneFrameService {
  private listeners = new Set<(event: { sceneId: string }) => void>();
  private activeSceneId: string | null;

  constructor(private framesBySceneId: Record<string, SceneFrames>) {
    this.activeSceneId = Object.keys(framesBySceneId)[0] ?? null;
  }

  activateSurface(sceneId: string) {
    this.activeSceneId = sceneId;
  }

  getActiveSceneId() {
    return this.activeSceneId;
  }

  listSceneIds() {
    return Object.keys(this.framesBySceneId);
  }

  getFrames(sceneId?: string) {
    const key = sceneId || this.activeSceneId || this.listSceneIds()[0];
    return key ? (this.framesBySceneId[key] ?? null) : null;
  }

  onActiveSurfaceChange() {
    return { dispose() {} };
  }

  onAnyFramesChange(listener: (event: { sceneId: string }) => void) {
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

const TEST_SURFACE_FRAMES: SceneFrames = {
  preview: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
  production: { xMm: 10, yMm: 20, widthMm: 80, heightMm: 70 },
  export: { xMm: 5, yMm: 15, widthMm: 90, heightMm: 85 },
  viewportFocus: { xMm: 10, yMm: 20, widthMm: 80, heightMm: 70 },
};

function createMutableConfig(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const listenersByKey = new Map<string, Set<(event: any) => void>>();
  return {
    get: <T>(key: string, defaultValue?: T) =>
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

function createMutableSurfaceFrames(initial: Record<string, SceneFrames> = {}) {
  const frameMap = new Map<string, SceneFrames>(Object.entries(initial));
  const frameListeners = new Set<(event: any) => void>();
  return {
    getFrames: (sceneId?: string) => {
      const key = sceneId || Array.from(frameMap.keys())[0];
      return key ? (frameMap.get(key) ?? null) : null;
    },
    getActiveSceneId: () => Array.from(frameMap.keys())[0] ?? null,
    listSceneIds: () => Array.from(frameMap.keys()),
    onActiveSurfaceChange: () => ({ dispose() {} }),
    onAnyFramesChange: (listener: (event: any) => void) => {
      frameListeners.add(listener);
      return { dispose: () => frameListeners.delete(listener) };
    },
    setFrames: (sceneId: string, frames: SceneFrames) => {
      frameMap.set(sceneId, frames);
      frameListeners.forEach((listener) => listener({ sceneId, frames }));
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
    sceneToScreenMatrix: (matrix: any) => ({
      ...matrix,
      to: "screen",
    }),
    screenToSceneMatrix: (matrix: any) => ({
      ...matrix,
      to: "scene",
    }),
    sceneToScreenPoint: (point: any) => ({ ...point, space: "screen" }),
    screenToScenePoint: (point: any) => ({ ...point, space: "scene" }),
    sceneToScreenRect: (rect: any) => ({ ...rect, space: "screen" }),
    screenToSceneRect: (rect: any) => ({ ...rect, space: "scene" }),
    updateContainer() {},
  };
  service.applyAffinePlacement = () => {};
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
    service.toScreenPoint({ space: "scene", x: 0, y: 0 }),
    { x: 112.25, y: 60.75, space: "screen" },
    "canvas viewport should keep provided offset",
  );
  assertDeepEqual(
    service.toScreenPoint({ space: "scene", x: 10, y: 20 }),
    { x: 154.75, y: 145.75, space: "screen" },
    "screen mapping should use the provided scale and offset together",
  );
}

function testViewportProjectionRoundTripsWithoutResizeDrift() {
  const viewport = new ViewportSystem();
  const canonicalPoint = { space: "scene" as const, x: 12.5, y: -7.25 };
  const canonicalRect = {
    space: "scene" as const,
    left: -10,
    top: 20,
    width: 35,
    height: 45,
  };
  const canonicalMatrix = coordinateMatrix(
    "object-local",
    "scene",
    [1.5, 0.25, -0.5, 0.75, 18, -9],
  );
  const layouts = [
    { scale: 2, offsetX: 100, offsetY: 50, width: 400, height: 300 },
    { scale: 3.5, offsetX: -20, offsetY: 80, width: 700, height: 525 },
    { scale: 0.75, offsetX: 12, offsetY: -4, width: 150, height: 112.5 },
    { scale: 2, offsetX: 100, offsetY: 50, width: 400, height: 300 },
  ];

  for (const [index, layout] of layouts.entries()) {
    viewport.setLayout(layout);
    const screenPoint = viewport.sceneToScreenPoint(canonicalPoint);
    const scenePoint = viewport.screenToScenePoint(screenPoint);
    assertClose(scenePoint.x, canonicalPoint.x, `viewport point x ${index}`);
    assertClose(scenePoint.y, canonicalPoint.y, `viewport point y ${index}`);

    const screenRect = viewport.sceneToScreenRect(canonicalRect);
    const sceneRect = viewport.screenToSceneRect(screenRect);
    assertClose(
      sceneRect.left,
      canonicalRect.left,
      `viewport rect left ${index}`,
    );
    assertClose(sceneRect.top, canonicalRect.top, `viewport rect top ${index}`);
    assertClose(
      sceneRect.width,
      canonicalRect.width,
      `viewport rect width ${index}`,
    );
    assertClose(
      sceneRect.height,
      canonicalRect.height,
      `viewport rect height ${index}`,
    );

    const screenMatrix = viewport.sceneToScreenMatrix(canonicalMatrix);
    const sceneMatrix = viewport.screenToSceneMatrix(screenMatrix);
    canonicalMatrix.values.forEach((value, matrixIndex) =>
      assertClose(
        sceneMatrix.values[matrixIndex],
        value,
        `viewport matrix ${index}:${matrixIndex}`,
      ),
    );
  }
}

function testAttachRegistersRenderGraphAdapter() {
  const { registered, runtime } = createRuntime();
  const canvasService = new FakeCanvasService();
  const sceneLayoutService = new FakeSceneLayoutService({
    contentRect: {
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
    sceneId: "front",
  });
  const sceneFrameService = new FakeSceneFrameService({
    front: TEST_SURFACE_FRAMES,
  });
  const browserSceneExportService = new FakeBrowserSceneExportService();
  const graphAdapter = new FakeFabricRenderGraphAdapter();
  let observerCallback: ResizeObserverCallback | null = null;
  let disconnected = false;
  registered.set(SCENE_FRAME_SERVICE, sceneFrameService as any);
  registered.set(SCENE_SERVICE, {
    getActiveRoot: () => ({
      id: "front",
      owner: { type: "document", documentSceneId: "front" },
      composition: {
        entries: [{ source: "document-graph", sceneId: "front" }],
      },
    }),
    onRootChange: () => ({ dispose() {} }),
  } as any);

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
      width: TEST_SURFACE_FRAMES.preview.widthMm * 2,
      height: TEST_SURFACE_FRAMES.preview.heightMm * 2,
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
        sceneId: "s1",
        layerId: "bg",
        objectId: "bg",
      },
      visual: { type: "rect" },
      placement: createTestPlacement(0, 0, 10, 10),
      ordering: { layerId: "bg", layerOrder: 0, path: [0] },
      props: { width: 10, height: 10 },
    },
    {
      id: "art",
      subject: {
        kind: "object",
        sceneId: "s1",
        layerId: "art",
        objectId: "art",
      },
      visual: { type: "rect" },
      placement: createTestPlacement(0, 0, 5, 5),
      ordering: { layerId: "art", layerOrder: 1, path: [0] },
      props: { width: 5, height: 5 },
      effects: [
        {
          type: "clipPath",
          id: "clip.art",
          source: {
            id: "clip-source",
            type: "rect",
            space: "scene",
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
        sceneId: "s1",
        layerId: "art",
        objectId: "hidden-export",
      },
      visual: { type: "rect" },
      placement: createTestPlacement(0, 0, 7, 8),
      ordering: { layerId: "art", layerOrder: 1, path: [1] },
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

async function testSessionRootCompositionIsLocalOnly() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);
  runtime.services.getOrThrow(RENDER_INTENT_SERVICE).setDocumentIntents([
    {
      id: "document-node",
      subject: {
        kind: "object",
        sceneId: "front",
        layerId: "document",
        objectId: "document-node",
      },
      visual: { type: "rect" },
      placement: createTestPlacement(0, 0, 20, 20),
      ordering: { layerId: "document" },
      props: { width: 20, height: 20 },
      interaction: { selection: { enabled: true } },
    },
  ]);
  const session = await runtime.services.getOrThrow(SESSION_SERVICE).open({
    descriptor: {
      sessionId: "session-root",
      ownerId: "platform-test",
      scope: {},
      interactionMode: "cooperative",
      leavePolicy: "block",
    },
    initialDraft: {},
  });
  const scenes = runtime.services.getOrThrow(SCENE_SERVICE);
  const scene = scenes.createScene({
    id: "root",
    owner: { type: "session", sessionId: session.descriptor.sessionId },
    composition: {
      entries: [
        { source: "local", layerIds: ["underlay"] },
        { source: "local", layerIds: ["controls"] },
      ],
    },
  });
  session.own(scene);
  scene.addLayer({ id: "underlay" });
  scene.addLayer({ id: "controls" });
  scene.addElement({
    id: "underlay-node",
    layerId: "underlay",
    type: "rect",
    width: 10,
    height: 10,
  });
  scene.addElement({
    id: "session-image",
    layerId: "underlay",
    type: "image",
    src: "/working-image.png",
    transform: {
      left: 10,
      top: 10,
      scaleX: 0.5,
      scaleY: 0.5,
    },
    interaction: {
      selection: { enabled: true },
      manipulation: {
        move: { enabled: true },
        resize: { enabled: true },
        rotate: { enabled: true },
      },
    },
  });
  scene.addElement({
    id: "control-node",
    layerId: "controls",
    type: "rect",
    width: 10,
    height: 10,
    style: { selectable: false, lockScalingFlip: true },
    data: { renderProps: { evented: false, lockUniScaling: true } },
    interaction: { selection: { enabled: true } },
  });
  await adapter.flush();
  const items = canvas.reconcileCalls.at(-1)?.items ?? [];
  assertDeepEqual(
    items.map((item) => item.spec.id),
    ["underlay-node", "session-image", "control-node"],
    "composition entry order should be the render order",
  );
  const sessionImage = items.find(
    (item) => item.spec.id === "session-image",
  )?.spec;
  assertEqual(
    Object.hasOwn(sessionImage?.props ?? {}, "width"),
    false,
    "scene images without an explicit width should preserve their source width",
  );
  assertEqual(
    Object.hasOwn(sessionImage?.props ?? {}, "height"),
    false,
    "scene images without an explicit height should preserve their source height",
  );
  assertEqual(
    sessionImage?.props.selectable,
    true,
    "dimensionless scene images should remain selectable",
  );
  assertEqual(
    sessionImage?.props.evented,
    true,
    "dimensionless scene images should remain hit-testable",
  );
  const control = items.find((item) => item.spec.id === "control-node")?.spec;
  assertEqual(
    control?.props.selectable,
    true,
    "scene elements use InteractionSpec",
  );
  assertEqual(
    control?.props.evented,
    true,
    "scene elements use the shared resolver",
  );
  assertEqual(
    control?.props.lockScalingFlip,
    undefined,
    "scene style cannot inject Fabric interaction flags",
  );
  assertEqual(
    control?.props.lockUniScaling,
    undefined,
    "scene renderProps cannot inject Fabric interaction flags",
  );

  await session.cancel();
  await runtime.dispose();
}

async function testSessionRenderOverrideUsesIndependentProjectionId() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);
  const renderIntents = runtime.services.getOrThrow(RENDER_INTENT_SERVICE);
  renderIntents.setDocumentIntents([
    {
      id: "user-image",
      subject: {
        kind: "object",
        sceneId: "front",
        layerId: "art",
        objectId: "user-image",
      },
      visual: { type: "image", src: "/user.png" },
      ordering: { layerId: "art" },
      placement: createTestPlacement(0, 0, 100, 80),
    },
  ]);
  const session = await runtime.services.getOrThrow(SESSION_SERVICE).open({
    descriptor: {
      sessionId: "image-session",
      ownerId: "platform-test",
      scope: { subjectId: "user-image" },
      interactionMode: "exclusive",
      leavePolicy: "block",
    },
    initialDraft: {},
  });
  const scope = session.own(
    renderIntents.createSessionRenderScope(session.descriptor.sessionId),
  );
  const createWorkingOverride = (left: number) =>
    ({
      role: "override",
      sessionId: session.descriptor.sessionId,
      subjectId: "user-image",
      sceneId: "front",
      provenance: "platform-test:working-image",
      priority: 100,
      replacementTarget: {
        subjectId: "user-image",
        projectionId: "user-image",
      },
      projection: {
        id: "working-user-image",
        subject: {
          kind: "object",
          sceneId: "front",
          layerId: "art",
          objectId: "user-image",
        },
        visual: { type: "image", src: "/working-user.png" },
        ordering: { layerId: "art" },
        placement: createTestPlacement(left, 0, 100, 80),
        interaction: { selection: { enabled: true } },
      },
    }) as const;
  scope.replace([createWorkingOverride(0)]);
  await adapter.flush();
  const workingItems = canvas.reconcileCalls.at(-1)?.items ?? [];
  const openingInvalidations =
    canvas.reconcileCalls.at(-1)?.options?.invalidations ?? [];
  assert(
    openingInvalidations.every(
      (invalidation) => invalidation.type !== "full",
    ) &&
      openingInvalidations.some(
        (invalidation) =>
          invalidation.type === "render-intents" &&
          invalidation.intentIds.includes("working-user-image"),
      ),
    "opening a session override should use projection-scoped invalidations",
  );
  assertEqual(
    workingItems.find((item) => item.spec.id === "working-user-image")?.key,
    "working-user-image",
    "session projection should keep its independent runtime key",
  );
  assertEqual(
    workingItems.some((item) => item.key === "user-image"),
    false,
    "active override should suppress the targeted document projection",
  );
  assertEqual(
    workingItems.find((item) => item.key === "working-user-image")?.spec.data
      ?.subjectId,
    "user-image",
    "runtime hits should carry the business subject id directly",
  );

  scope.replace([createWorkingOverride(24)]);
  await adapter.flush();
  assertDeepEqual(
    canvas.reconcileCalls.at(-1)?.options?.invalidations,
    [
      {
        type: "render-intents",
        intentIds: ["working-user-image"],
      },
    ],
    "updating a working projection should not trigger a full canvas reconcile",
  );

  const reconcileCount = canvas.reconcileCalls.length;
  await session.validate();
  await adapter.flush();
  assertEqual(
    canvas.reconcileCalls.length,
    reconcileCount,
    "session phase-only changes should not reconcile the canvas",
  );

  scope.clear();
  await adapter.flush();
  const clearingInvalidations =
    canvas.reconcileCalls.at(-1)?.options?.invalidations ?? [];
  assert(
    clearingInvalidations.length > 0 &&
      clearingInvalidations.every(
        (invalidation) => invalidation.type !== "full",
      ),
    "clearing an override should use projection-scoped handoff invalidations",
  );
  assertEqual(
    canvas.reconcileCalls
      .at(-1)
      ?.items.find((item) => item.key === "user-image")?.spec.id,
    "user-image",
    "clearing the override should restore the document projection",
  );
  await session.cancel();
  await runtime.dispose();
}

async function testSceneExportReadsOnlyDocumentProjections() {
  const runtime = new Pooder();
  const renderIntents = runtime.services.getOrThrow(RENDER_INTENT_SERVICE);
  renderIntents.setDocumentIntents([
    {
      id: "document-export-node",
      subject: {
        kind: "object",
        sceneId: "front",
        layerId: "art",
        objectId: "export-subject",
      },
      visual: { type: "rect" },
      placement: createTestPlacement(0, 0, 20, 20),
      ordering: { layerId: "art" },
    },
  ]);
  const scope = renderIntents.createSessionRenderScope("session:export-test");
  scope.replace([
    {
      role: "override",
      sessionId: scope.sessionId,
      subjectId: "export-subject",
      sceneId: "front",
      provenance: "test:working",
      priority: 100,
      replacementTarget: {
        subjectId: "export-subject",
        projectionId: "document-export-node",
      },
      projection: {
        id: "session-export-node",
        subject: {
          kind: "object",
          sceneId: "front",
          layerId: "art",
          objectId: "export-subject",
        },
        visual: { type: "rect" },
        placement: createTestPlacement(0, 0, 20, 20),
        ordering: { layerId: "art" },
      },
    },
  ]);

  const exportService = new BrowserSceneExportService() as any;
  exportService.renderIntentService = renderIntents;
  exportService.renderGraphAdapter = {
    createExportRenderObjectSpec: (_layer: unknown, node: { id: string }) => ({
      id: node.id,
    }),
  };
  const entries = exportService.selectEntries({});
  assertDeepEqual(
    entries.map((entry: { node: { id: string } }) => entry.node.id),
    ["document-export-node"],
    "export should ignore active session overrides and auxiliary projections",
  );
  scope.dispose();
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
        sceneId: "s1",
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
      placement: createTestPlacement(100, 120, 200, 160),
      ordering: { layerId: "art", path: [0] },
    },
    {
      id: "resolved-slot",
      subject: {
        kind: "object",
        sceneId: "s1",
        layerId: "art",
        objectId: "resolved-slot",
        objectType: "image",
      },
      visual: { type: "image", src: "data:image/png;base64,resolved" },
      placement: createAffinePlacement({
        localBounds: { left: 0, top: 0, width: 400, height: 320 },
        localToScene: createLocalToSceneMatrix({
          position: { x: 220, y: 210 },
          pivot: { x: 200, y: 160 },
          scaleX: 0.75,
          scaleY: 0.6,
          rotation: 15,
        }),
      }),
      ordering: { layerId: "art", path: [0, 1] },
    },
  ]);

  await adapter.flush();
  const last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  const imageItem = last?.items.find((item) => item.spec.id === "image:slot");
  const image = imageItem?.spec;
  assert(image, "adapter should draw the committed image replacement");
  assertDeepEqual(
    imageItem?.origin,
    { type: "render-intent", intentId: "slot" },
    "replacement nodes should retain their declarative render intent origin",
  );
  assertEqual(
    image.placement?.localBounds.width,
    200,
    "image replacements should render at the document frame width",
  );
  assertEqual(
    image.placement?.localBounds.height,
    160,
    "image replacements should render at the document frame height",
  );
  assertEqual(
    image.placement?.localToScene.values[0],
    1,
    "image replacements should not depend on bitmap scale for frame sizing",
  );
  assertEqual(
    image.placement?.localToScene.values[3],
    1,
    "image replacements should not depend on bitmap scale for frame sizing",
  );
  const resolvedImage = last?.items.find(
    (item) => item.spec.id === "resolved-slot",
  )?.spec;
  assertEqual(
    resolvedImage?.placement?.localBounds.width,
    400,
    "resolved images should preserve intrinsic width",
  );
  assertEqual(
    resolvedImage?.placement?.localBounds.height,
    320,
    "resolved images should preserve intrinsic height",
  );
  assertEqual(
    resolvedImage?.placement
      ? Math.hypot(
          resolvedImage.placement.localToScene.values[0],
          resolvedImage.placement.localToScene.values[1],
        )
      : undefined,
    0.75,
    "resolved images should preserve horizontal placement scale",
  );
  assertEqual(
    resolvedImage?.placement
      ? Math.hypot(
          resolvedImage.placement.localToScene.values[2],
          resolvedImage.placement.localToScene.values[3],
        )
      : undefined,
    0.6,
    "resolved images should preserve vertical placement scale",
  );

  renderIntentService.patchIntent("template-switch", {
    id: "slot",
    visual: {
      type: "image",
      replacement: { src: "data:image/png;base64,next-template" },
    },
  });
  await adapter.flush();
  const switched = canvas.reconcileCalls.at(-1);
  assertDeepEqual(
    switched?.options?.invalidations,
    [{ type: "render-intents", intentIds: ["slot"] }],
    "resource switches should invalidate the declarative intent id",
  );
  assertEqual(
    switched?.items.find((item) => item.key === "image:slot")?.spec.src,
    "data:image/png;base64,next-template",
    "resource switches should publish the next replacement source",
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
        sceneId: "s1",
        layerId: "art",
        objectId: "art",
      },
      visual: { type: "rect" },
      ordering: { layerId: "art", path: [0] },
      props: { width: 5, height: 5 },
    },
  ]);

  await adapter.flush();
  const before = canvas.reconcileCalls.length;
  canvas.emit("resized", {});
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
  const canvas = createLayoutCanvas(() => ({ ...viewportSize }));
  const layoutService = new SceneLayoutService();
  const frameMap = new Map<string, SceneFrames>();
  const frameListeners = new Set<(event: any) => void>();
  const sceneFrames = {
    getFrames: (sceneId?: string) => {
      const key = sceneId || Array.from(frameMap.keys())[0];
      return key ? (frameMap.get(key) ?? null) : null;
    },
    getActiveSceneId: () => Array.from(frameMap.keys())[0] ?? null,
    listSceneIds: () => Array.from(frameMap.keys()),
    onActiveSurfaceChange: () => ({ dispose() {} }),
    onAnyFramesChange: (listener: (event: any) => void) => {
      frameListeners.add(listener);
      return { dispose: () => frameListeners.delete(listener) };
    },
    setFrames: (sceneId: string, frames: SceneFrames) => {
      frameMap.set(sceneId, frames);
      frameListeners.forEach((listener) => listener({ sceneId, frames }));
    },
  };
  layoutService.init({
    eventBus: runtime.eventBus,
    get: ((identifier: unknown) => {
      if (identifier === CANVAS_SERVICE) return canvas;
      if (identifier === SCENE_FRAME_SERVICE) return sceneFrames;
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

  sceneFrames.setFrames("front", TEST_SURFACE_FRAMES);
  const first = layoutService.getLayout("front");
  assert(first, "frame invalidation should produce a layout snapshot");
  assertEqual(first.sceneId, "front", "snapshot should carry its surface id");
  assertEqual(
    first.revision,
    1,
    "first material snapshot should start revision",
  );
  assertEqual(changes.length, 1, "frame invalidation should emit once");

  const second = layoutService.recomputeLayout("front");
  assert(second, "explicit recompute should return the stable snapshot");
  assertEqual(second.revision, 1, "unchanged recompute should keep revision");
  assertEqual(changes.length, 1, "unchanged recompute should not emit");

  layoutService.getLayout("front");
  layoutService.getLayout("front");
  assertEqual(changes.length, 1, "cached reads should remain side-effect free");

  viewportSize.width = 1000;
  canvas.emitResize();
  const resized = layoutService.getLayout("front");
  assert(resized, "canvas resize should recompute the layout");
  assertEqual(
    resized.revision,
    2,
    "changed resize layout should increment revision",
  );
  assertEqual(
    changes.length,
    2,
    "canvas resize should emit a real layout change",
  );

  layoutService.dispose();
  await runtime.dispose();
}

async function testSceneLayoutServiceClearsRemovedSurfaceSnapshots() {
  const runtime = new Pooder();
  const canvas = createLayoutCanvas(() => ({ width: 800, height: 600 }));
  const layoutService = new SceneLayoutService();
  const frameMap = new Map<string, SceneFrames>();
  const frameListeners = new Set<(event: any) => void>();
  const sceneFrames = {
    clear: () => {
      const previous = Array.from(frameMap.keys());
      frameMap.clear();
      previous.forEach((sceneId) => {
        frameListeners.forEach((listener) =>
          listener({ sceneId, frames: null }),
        );
      });
    },
    getFrames: (sceneId?: string) => {
      const key = sceneId || Array.from(frameMap.keys())[0];
      return key ? (frameMap.get(key) ?? null) : null;
    },
    getActiveSceneId: () => Array.from(frameMap.keys())[0] ?? null,
    listSceneIds: () => Array.from(frameMap.keys()),
    onActiveSurfaceChange: () => ({ dispose() {} }),
    onAnyFramesChange: (listener: (event: any) => void) => {
      frameListeners.add(listener);
      return { dispose: () => frameListeners.delete(listener) };
    },
    setFrames: (sceneId: string, frames: SceneFrames) => {
      frameMap.set(sceneId, frames);
      frameListeners.forEach((listener) => listener({ sceneId, frames }));
    },
  };
  layoutService.init({
    eventBus: runtime.eventBus,
    get: ((identifier: unknown) => {
      if (identifier === CANVAS_SERVICE) return canvas;
      if (identifier === SCENE_FRAME_SERVICE) return sceneFrames;
      return undefined;
    }) as any,
    getOrThrow: (() => undefined) as any,
    has: () => false,
  });

  const changes: Array<unknown> = [];
  layoutService.onLayoutChange("front", (layout) => {
    changes.push(layout);
  });

  sceneFrames.setFrames("front", TEST_SURFACE_FRAMES);
  assert(
    layoutService.getLayout("front"),
    "snapshot should exist before clear",
  );

  sceneFrames.clear();
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
  const canvas = createLayoutCanvas(() => ({ width: 800, height: 600 }));
  const config = createMutableConfig({ "size.viewPadding": "10%" });
  const sceneFrames = createMutableSurfaceFrames({
    front: TEST_SURFACE_FRAMES,
  });
  const layoutService = new SceneLayoutService();

  layoutService.init({
    eventBus: runtime.eventBus,
    get: ((identifier: unknown) => {
      if (identifier === CANVAS_SERVICE) return canvas;
      if (identifier === CONFIGURATION_SERVICE) return config;
      if (identifier === SCENE_FRAME_SERVICE) return sceneFrames;
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
  const canvas = createLayoutCanvas(() => ({ width: 800, height: 600 }));
  const config = createMutableConfig({ "size.viewPadding": "16%" });
  const sceneFrames = createMutableSurfaceFrames({
    front: TEST_SURFACE_FRAMES,
  });
  const layoutService = new SceneLayoutService();

  layoutService.init({
    eventBus: runtime.eventBus,
    get: ((identifier: unknown) => {
      if (identifier === CANVAS_SERVICE) return canvas;
      if (identifier === CONFIGURATION_SERVICE) return config;
      if (identifier === SCENE_FRAME_SERVICE) return sceneFrames;
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
        sceneId: "s1",
        layerId: "bg",
        objectId: "bg",
      },
      visual: { type: "rect" },
      ordering: { layerId: "bg", path: [0] },
      props: { width: 10, height: 10 },
    },
  ]);

  assert(
    states.some(
      (state) =>
        state.syncing &&
        state.causes.some((cause) => cause.type === "base-replaced") &&
        state.invalidations.some(
          (invalidation) => invalidation.type === "full",
        ),
    ),
    "adapter should report the document cause and full invalidation while graph sync is pending",
  );

  await adapter.flush();
  const finalState = states[states.length - 1];
  assert(finalState, "adapter should report a final sync state");
  assertEqual(
    finalState.syncing,
    false,
    "adapter should report idle after flush",
  );
  assertEqual(finalState.pending, 0, "adapter should clear pending sync count");
  assert(
    finalState.generation > 0,
    "adapter should expose a monotonic sync generation",
  );
  const flushedGeneration = finalState.generation;
  await adapter.flush();
  assertEqual(
    adapter.getSyncState().generation,
    flushedGeneration,
    "flush should wait for consistency without creating a new sync generation",
  );

  const sessions = runtime.services.getOrThrow<SessionService>(SESSION_SERVICE);
  const session = await sessions.open({
    descriptor: {
      sessionId: "image:front",
      ownerId: "image-placement",
      scope: { channel: "image-placement", subjectId: "front.image" },
      interactionMode: "exclusive",
      leavePolicy: "block",
    },
    initialDraft: { left: 0.5 },
  });
  const scenes = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
  const sessionScene = scenes.createScene({
    id: "image:front:scene",
    owner: { type: "session", sessionId: "image:front" },
    composition: {
      entries: [{ source: "local", layerIds: ["controls"] }],
    },
  });
  session.own(sessionScene);
  sessionScene.addLayer({ id: "controls" });
  await adapter.flush();
  states.length = 0;
  scenes.transaction(
    {
      cause: {
        type: "interaction-preview",
        sessionId: "image:front",
        toolId: "image-placement",
      },
    },
    () =>
      sessionScene.addElement({
        id: "snap-line",
        layerId: "controls",
        type: "rect",
        width: 1,
        height: 20,
      }),
  );
  assert(
    states.some(
      (state) =>
        state.causes.some(
          (cause) =>
            cause.type === "interaction-preview" &&
            cause.sessionId === "image:front",
        ) &&
        state.invalidations.some(
          (invalidation) =>
            invalidation.type === "scene-elements" &&
            invalidation.sceneId === "image:front:scene" &&
            invalidation.elementIds.includes("snap-line"),
        ),
    ),
    "adapter should preserve interaction preview provenance and element invalidation",
  );
  await adapter.flush();
  assertDeepEqual(
    canvas.reconcileCalls.at(-1)?.options?.invalidations,
    [
      {
        type: "scene-elements",
        sceneId: "image:front:scene",
        elementIds: ["snap-line"],
      },
    ],
    "adapter should pass precise scene invalidations to the backend",
  );
  const sessionStateGeneration = adapter.getSyncState().generation;
  session.updateDraft({ left: 0.6 });
  session.setDirty(true);
  await adapter.flush();
  assertEqual(
    adapter.getSyncState().generation,
    sessionStateGeneration,
    "session draft and dirty changes should not invalidate render conditions",
  );
  await session.cancel();
  await adapter.flush();

  stop();
  await runtime.dispose();
}

async function testFabricRenderGraphAdapterConsumesSceneSpace() {
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
        sceneId: "s1",
        layerId: "overlay",
        objectId: "screen-overlay",
      },
      visual: { type: "path" },
      coordinateSpace: "scene",
      placement: createTestPlacement(0, 0, 10, 10),
      ordering: { layerId: "overlay", path: [0] },
      props: { pathData: "M 0 0 L 10 0 L 10 10 Z" },
    },
  ]);

  await adapter.flush();
  const last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  assert(last, "adapter should reconcile scene-space nodes");
  assertEqual(
    last.items[0]?.spec.space,
    "scene",
    "adapter should consume the formal graph scene coordinate space",
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
        sceneId: "front",
        layerId: "front.dieline-overlay",
        objectId: "cutline",
      },
      visual: { type: "path" },
      placement: createTestPlacement(30, 30, 531, 531),
      ordering: { layerId: "front.dieline-overlay", path: [0] },
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
  const spec = last?.items[0]?.spec;
  const props = spec?.props ?? {};
  assert(last, "adapter should reconcile path nodes");
  assertEqual(
    spec?.placement?.localToScene.values[4],
    30,
    "path should retain affine left placement",
  );
  assertEqual(
    spec?.placement?.localToScene.values[5],
    30,
    "path should retain affine top placement",
  );
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
        sceneId: "front",
        layerId: "front.dieline-overlay",
        objectId: "detected-cutline",
      },
      visual: { type: "path" },
      placement: createAffinePlacement({
        localBounds: { left: 0, top: 0, width: 40, height: 20 },
        localToScene: coordinateMatrix(
          "object-local",
          "scene",
          [2, 0, 0, 2, 10, 12],
        ),
      }),
      ordering: { layerId: "front.dieline-overlay", path: [0] },
      props: {
        pathData: "M0 0H40V20H0Z",
      },
    },
  ]);

  await adapter.flush();
  const last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  const placement = last?.items[0]?.spec.placement;
  assert(last, "adapter should reconcile transformed path nodes");
  assertEqual(
    placement?.localToScene.values[4],
    10,
    "path should keep explicit affine left transform",
  );
  assertEqual(
    placement?.localToScene.values[5],
    12,
    "path should keep explicit affine top transform",
  );

  await runtime.dispose();
}

async function testFabricRenderGraphAdapterRespectsLayerArrayOrder() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  const renderIntentService = runtime.services.getOrThrow<RenderIntentService>(
    RENDER_INTENT_SERVICE,
  );
  renderIntentService.setDocumentIntents([
    {
      id: "front.dieline.cutline",
      subject: {
        kind: "object",
        sceneId: "front",
        layerId: "front.dieline-overlay",
        objectId: "front.dieline.cutline",
        objectType: "object",
      },
      visual: { type: "path" },
      placement: createTestPlacement(30, 30, 531, 531),
      ordering: {
        layerId: "front.dieline-overlay",
        path: [30, 0],
      },
      props: {
        fill: "transparent",
        pathData: "M0 0H531V531H0Z",
        stroke: "#ef4444",
        strokeWidth: 2,
      },
    },
  ]);
  renderIntentService.patchIntent("image-upload", {
    id: "upload:front.image.user",
    subject: {
      kind: "object",
      sceneId: "front",
      layerId: "image.overlay",
      objectId: "front.image.user",
      objectType: "rect",
    },
    visual: { type: "rect" },
    placement: createTestPlacement(30, 30, 531, 531),
    ordering: {
      layerId: "image.overlay",
      path: [31, 0],
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
      uploadOrder > guideOrder,
    "later render graph layer orders should render above earlier layers",
  );

  await runtime.dispose();
}

async function testFabricRenderGraphAdapterMapsDeclarativeInteraction() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);
  runtime.services
    .getOrThrow<GeometrySourceService>(GEOMETRY_SOURCE_SERVICE)
    .registerSource(
      createStaticGeometrySource({
        sourceId: "test-container",
        geometries: [
          {
            kind: "rect",
            ref: { sourceId: "test-container", geometryId: "placed-slot" },
            space: "object-local",
            bounds: { left: 0, top: 0, width: 40, height: 30 },
            rect: { left: 0, top: 0, width: 40, height: 30 },
            localToScene: coordinateMatrix(
              "object-local",
              "scene",
              [1, 0, 0, 1, 100, 200],
            ),
          },
          {
            kind: "rect",
            ref: {
              sourceId: "test-container",
              geometryId: "placed-export",
              purpose: "export",
            },
            space: "object-local",
            bounds: { left: 0, top: 0, width: 70, height: 50 },
            rect: { left: 0, top: 0, width: 70, height: 50 },
            localToScene: coordinateMatrix(
              "object-local",
              "scene",
              [1, 0, 0, 1, 300, 400],
            ),
          },
        ],
      }),
    );

  const intents = runtime.services.getOrThrow(RENDER_INTENT_SERVICE);
  intents.setDocumentIntents([
    {
      id: "interactive",
      subject: {
        kind: "object",
        sceneId: "s1",
        layerId: "art",
        objectId: "interactive",
      },
      visual: { type: "rect" },
      placement: createTestPlacement(0, 0, 10, 10),
      ordering: { layerId: "art", path: [0] },
      props: { width: 10, height: 10 },
      interaction: { manipulation: { move: { enabled: true } } },
    },
    {
      id: "constraint-only",
      subject: {
        kind: "object",
        sceneId: "s1",
        layerId: "art",
        objectId: "constraint-only",
      },
      visual: { type: "rect" },
      placement: createTestPlacement(20, 0, 10, 10),
      ordering: { layerId: "art", path: [1] },
      props: { width: 10, height: 10 },
      interaction: {
        manipulation: {
          move: {
            enabled: false,
            constraints: [
              {
                spec: {
                  type: "rect.contain",
                  params: {
                    rect: { left: 0, top: 0, width: 100, height: 100 },
                  },
                },
              },
            ],
          },
        },
      },
    },
    {
      id: "conditional",
      subject: {
        kind: "object",
        sceneId: "s1",
        layerId: "art",
        objectId: "conditional",
      },
      visual: { type: "rect" },
      placement: createTestPlacement(40, 0, 10, 10),
      ordering: { layerId: "art", path: [2] },
      props: { width: 10, height: 10 },
      interaction: {
        enabledWhen: {
          op: "truthy",
          ref: { source: "context", key: "can.interact" },
        },
        manipulation: {
          move: {
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
    },
    {
      id: "runtime-evented",
      subject: {
        kind: "object",
        sceneId: "s1",
        layerId: "art",
        objectId: "runtime-evented",
      },
      visual: { type: "rect" },
      placement: createTestPlacement(60, 0, 10, 10),
      ordering: { layerId: "art", path: [3] },
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
        sceneId: "s1",
        layerId: "art",
        objectId: "transform-only",
      },
      visual: { type: "rect" },
      placement: createTestPlacement(80, 0, 10, 10),
      ordering: { layerId: "art", path: [4] },
      props: { width: 10, height: 10 },
      interaction: {
        manipulation: {
          resize: { enabled: true },
          rotate: { enabled: true },
        },
      },
    },
    {
      id: "activation-only",
      subject: {
        kind: "object",
        sceneId: "s1",
        layerId: "art",
        objectId: "activation-only",
      },
      visual: { type: "rect" },
      placement: createTestPlacement(100, 0, 10, 10),
      ordering: { layerId: "art", path: [5] },
      props: { width: 10, height: 10 },
      interaction: {
        activation: {
          action: { commandId: "test.open" },
          trigger: "primary-pointer",
        },
      },
    },
    {
      id: "empty-slot",
      subject: {
        kind: "object",
        sceneId: "s1",
        layerId: "art",
        objectId: "empty-slot",
      },
      visual: { type: "image" },
      placement: createTestPlacement(12, 24, 80, 60),
      ordering: { layerId: "art", path: [6] },
      interaction: {
        hitRegion: { type: "frame", space: "scene" },
        activation: { action: { commandId: "test.open" } },
      },
    },
    {
      id: "placed-slot",
      subject: {
        kind: "object",
        sceneId: "s1",
        layerId: "art",
        objectId: "placed-slot",
      },
      visual: { type: "image", src: "/placed.png" },
      placement: createTestPlacement(12, 24, 80, 60),
      containerGeometryRef: {
        sourceId: "test-container",
        geometryId: "placed-slot",
      },
      exportGeometryRef: {
        sourceId: "test-container",
        geometryId: "placed-export",
        purpose: "export",
      },
      ordering: { layerId: "art", path: [7] },
      interaction: {
        hitRegion: { type: "frame", space: "scene" },
        manipulation: { move: { enabled: true } },
      },
    },
  ]);

  await adapter.flush();
  let last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  assert(last, "adapter should reconcile declarative interaction");
  const interactive = last.items.find((item) => item.key === "interactive");
  const constraintOnly = last.items.find(
    (item) => item.key === "constraint-only",
  );
  const conditional = last.items.find((item) => item.key === "conditional");
  const runtimeEvented = last.items.find(
    (item) => item.key === "runtime-evented",
  );
  const transformOnly = last.items.find(
    (item) => item.key === "transform-only",
  );
  const activationOnly = last.items.find(
    (item) => item.key === "activation-only",
  );
  const emptySlotHitTarget = last.items.find(
    (item) => item.key === "empty-slot:frame-hit-target",
  );
  const placedSlot = last.items.find((item) => item.key === "placed-slot");
  const placedSlotHitTarget = last.items.find(
    (item) => item.key === "placed-slot:frame-hit-target",
  );
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
    constraintOnly?.spec.props.lockMovementX,
    true,
    "disabled move constraints should keep movement locked",
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
    runtimeEvented?.spec.data?.interactionSpec,
    undefined,
    "runtime evented props should not create declarative interaction state",
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
    transformOnly?.spec.props.lockRotation,
    false,
    "rotate interaction should unlock rotation controls",
  );
  assertEqual(
    activationOnly?.spec.props.selectable,
    false,
    "activation-only objects should not become selectable",
  );
  assertEqual(
    activationOnly?.spec.props.evented,
    true,
    "activation-only objects should remain pointer targets",
  );
  assertEqual(
    activationOnly?.spec.data?.interactionSpec?.activation?.action.commandId,
    "test.open",
    "activation declarations should be attached to the render target",
  );
  assertEqual(
    emptySlotHitTarget?.spec.props.visible,
    true,
    "empty image slots should keep their frame hit target visible",
  );
  assertEqual(
    emptySlotHitTarget?.spec.props.evented,
    true,
    "empty image slot frame hit targets should receive pointer events",
  );
  assertDeepEqual(
    placedSlot?.spec.placement?.localToScene.values,
    [1, 0, 0, 1, 12, 24],
    "image preview should use final visual geometry",
  );
  assertDeepEqual(
    placedSlotHitTarget?.spec.placement?.localToScene.values,
    [1, 0, 0, 1, 100, 200],
    "frame hit targets should use container geometry independently",
  );
  assertDeepEqual(
    {
      width: placedSlotHitTarget?.spec.props.width,
      height: placedSlotHitTarget?.spec.props.height,
    },
    { width: 40, height: 30 },
    "frame hit target bounds should not reuse bitmap bounds",
  );
  const graph = intents.getGraph();
  const placedSlotLayer = graph.layers.find((layer) => layer.id === "art");
  const placedSlotNode = placedSlotLayer?.nodes.find(
    (node) => node.id === "placed-slot",
  );
  const exportSpec =
    placedSlotLayer && placedSlotNode
      ? adapter.createExportRenderObjectSpec(placedSlotLayer, placedSlotNode)
      : null;
  assertDeepEqual(
    exportSpec?.placement?.localToScene.values,
    [1, 0, 0, 1, 300, 400],
    "export projection should use export geometry only",
  );

  let activationEvent: any;
  let activationPayload: any;
  runtime.eventBus.on("interaction:activate", (event) => {
    activationEvent = event;
  });
  runtime.services
    .getOrThrow(COMMAND_SERVICE)
    .registerCommand("test.open", (payload) => {
      activationPayload = payload;
      return "opened";
    });
  canvas.emitCanvasEvent("mouse:down", {
    target: {
      data: {
        ...activationOnly?.spec.data,
        renderTarget: "render-graph",
      },
    },
  });
  await Promise.resolve();
  assertEqual(
    activationPayload?.subjectId,
    "activation-only",
    "primary pointer activation should dispatch the Core command",
  );
  assertEqual(
    activationEvent,
    undefined,
    "primary pointer activation should not emit a raw interaction event",
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
  assertEqual(
    enabledConditional?.spec.props.lockMovementX,
    false,
    "matched constraint.activeWhen should enable movement",
  );

  await runtime.dispose();
}

async function testFabricRenderGraphAdapterConstrainsDragging() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  const interactionSpec = {
    manipulation: {
      move: {
        enabled: true,
        constraints: [
          {
            spec: {
              type: "rect.contain",
              params: {
                rect: { left: 0, top: 0, width: 100, height: 100 },
              },
            },
          },
        ],
      },
    },
  };
  runtime.services.getOrThrow(RENDER_INTENT_SERVICE).setDocumentIntents([
    {
      id: "constrained",
      subject: {
        kind: "object",
        sceneId: "s1",
        layerId: "art",
        objectId: "constrained",
      },
      visual: { type: "rect" },
      placement: createTestPlacement(95, 20, 10, 10),
      ordering: { layerId: "art" },
      interaction: interactionSpec,
    },
  ]);
  await adapter.flush();
  const constrainedSpec = canvas.reconcileCalls
    .at(-1)
    ?.items.find((item) => item.key === "constrained")?.spec;
  assert(constrainedSpec, "constrained graph projection should render");

  const target = {
    left: 95,
    top: 20,
    width: 10,
    height: 10,
    scaleX: 1,
    scaleY: 1,
    data: {
      ...constrainedSpec.data,
      affinePlacement: constrainedSpec.placement,
      renderTarget: "render-graph",
      interactionSpec,
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
  assertEqual(
    (target.data as any).renderOwnership.phase,
    "active",
    "moving a graph object should claim active interaction ownership",
  );
  let modifiedTransform: any;
  const rawTransformListener = (event: any) => {
    modifiedTransform = event;
  };
  const committedKinds: string[] = [];
  runtime.services
    .getOrThrow<InteractionService>(INTERACTION_SERVICE)
    .onDidCommitManipulation((event) => committedKinds.push(event.kind));
  runtime.eventBus.on("render-graph:object-transform", rawTransformListener);
  canvas.emitCanvasEvent("object:modified", { target });
  runtime.eventBus.off("render-graph:object-transform", rawTransformListener);
  assertEqual(
    modifiedTransform,
    undefined,
    "modified graph objects should not emit raw transform events",
  );
  assertDeepEqual(
    committedKinds,
    ["move"],
    "modified graph objects should commit through InteractionService",
  );
  assertEqual(
    (target.data as any).renderOwnership.phase,
    "committing",
    "commit should retain ownership until declarative state catches up",
  );
  (target.data as any).interactionSpec = {
    manipulation: {
      resize: { enabled: true },
      rotate: { enabled: true },
    },
  };
  canvas.emitCanvasEvent("object:scaling", { target });
  canvas.emitCanvasEvent("object:modified", { target });
  canvas.emitCanvasEvent("object:rotating", { target });
  canvas.emitCanvasEvent("object:modified", { target });
  assertDeepEqual(
    committedKinds,
    ["move", "resize", "rotate"],
    "moving, scaling, and rotating should map to Core operation kinds",
  );

  const constraintOnly = {
    ...target,
    left: 95,
    data: {
      ...target.data,
      subjectId: "constraint-only",
      renderIntentId: "constraint-only",
      interactionSpec: {
        manipulation: { move: { enabled: false } },
      },
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
      interactionSpec: {
        manipulation: {
          move: {
            enabled: true,
            constraints: [
              {
                spec: {
                  type: "object-frame.contain",
                  source: { sourceId: "render-graph", geometryId: "bounds" },
                  params: { target: "center" },
                },
              },
            ],
          },
        },
      },
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

async function testFabricRenderGraphAdapterMovesLogicalSubjectProjections() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);
  const intents = runtime.services.getOrThrow(RENDER_INTENT_SERVICE);
  const interaction =
    runtime.services.getOrThrow<InteractionService>(INTERACTION_SERVICE);
  const interactionSpec = { manipulation: { move: { enabled: true } } };
  intents.setDocumentIntents([
    {
      id: "subject:fill",
      subject: {
        kind: "object",
        sceneId: "front",
        layerId: "art",
        objectId: "subject",
      },
      visual: { type: "rect" },
      placement: createTestPlacement(10, 20, 10, 10),
      ordering: { layerId: "art", path: [0] },
      interaction: interactionSpec,
    },
    {
      id: "subject:outline",
      subject: {
        kind: "object",
        sceneId: "front",
        layerId: "art",
        objectId: "subject",
      },
      visual: { type: "rect" },
      placement: createTestPlacement(50, 20, 10, 10),
      ordering: { layerId: "art", path: [1] },
      interaction: interactionSpec,
    },
  ]);
  await adapter.flush();

  const createTarget = (
    renderNodeId: string,
    placement: ReturnType<typeof createTestPlacement>,
    left: number,
  ) => ({
    left,
    top: 20,
    width: 10,
    height: 10,
    scaleX: 1,
    scaleY: 1,
    data: {
      affinePlacement: placement,
      interactionSpec,
      renderKey: renderNodeId,
      renderNodeId,
      renderTarget: "render-graph",
      subjectId: "subject",
      sceneId: "front",
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
  });
  const active = createTarget(
    "subject:fill",
    createTestPlacement(10, 20, 10, 10),
    15,
  );
  const sibling = createTarget(
    "subject:outline",
    createTestPlacement(50, 20, 10, 10),
    50,
  );
  canvas.objects = [active, sibling];

  const liveProjectionGeometry = runtime.services
    .getOrThrow<GeometrySourceService>(GEOMETRY_SOURCE_SERVICE)
    .getSnapshot({
      sourceId: "render-graph",
      geometryId: "subject:fill",
      purpose: "preview",
    }).value;
  assertDeepEqual(
    liveProjectionGeometry?.localToScene.values,
    active.data.affinePlacement.localToScene.values,
    "live projection geometry should preserve its declarative affine placement",
  );

  canvas.emit("selection", { kind: "created", target: active });
  assertDeepEqual(
    interaction.getSelectedSubject(),
    {
      subjectId: "subject",
      sceneId: "front",
      projectionTargets: [
        {
          projectionId: "subject:fill",
          geometryRef: {
            sourceId: "render-intent",
            geometryId: "subject:fill",
            purpose: "preview",
          },
        },
        {
          projectionId: "subject:outline",
          geometryRef: {
            sourceId: "render-intent",
            geometryId: "subject:outline",
            purpose: "preview",
          },
        },
      ],
    },
    "Fabric selection should resolve to the logical subject membership",
  );

  let committedPatch: unknown;
  interaction.onDidCommitManipulation((event) => {
    committedPatch = event.result.documentPatch;
  });
  canvas.emitCanvasEvent("object:moving", { target: active });
  assertEqual(
    sibling.left,
    55,
    "temporary dragging should translate every derived subject projection",
  );
  canvas.emitCanvasEvent("object:modified", { target: active });
  assertDeepEqual(
    committedPatch,
    {
      type: "translate",
      coordinateSpace: "scene",
      delta: { space: "scene", x: 5, y: 0 },
    },
    "commit should emit a scene-space transform patch from the canonical projection",
  );

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

  await service.reconcileRenderGraphDrawList([
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
  ]);

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

  await service.reconcileRenderGraphDrawList([
    {
      key: "guide",
      layerId: "guide",
      order: 1,
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
      order: 0,
      spec: {
        id: "content",
        type: "rect",
        props: { height: 10, width: 10 },
        data: { subjectId: "content" },
      },
    },
  ]);

  assertDeepEqual(
    canvas.objects.map((object) => object.data.renderKey),
    ["content", "guide"],
    "render graph objects should stack by resolved render order",
  );
}

async function testCanvasReconcileUsesInvalidationAndInteractionOwnership() {
  const { canvas, service } = createCanvasServiceForReconcileTests();
  const workingImage: FabricRenderTargetItem = {
    key: "working-image",
    layerId: "image.session.image",
    origin: {
      type: "render-intent",
      intentId: "working-image",
    },
    order: 0,
    spec: {
      id: "working-image",
      type: "image",
      src: "/working-image.png",
      props: { left: 100, top: 100, width: 50, height: 50 },
      data: { source: "working" },
    },
  };

  await service.reconcileRenderGraphDrawList([workingImage], {
    invalidations: [{ type: "full" }],
  });
  const image = canvas.objects[0] as any;
  image.left = 137;
  image.top = 142;

  await service.reconcileRenderGraphDrawList(
    [
      workingImage,
      {
        key: "snap-guide",
        layerId: "image.session.controls",
        origin: {
          type: "render-intent",
          intentId: "snap-guide",
        },
        order: 1,
        spec: {
          id: "snap-guide",
          type: "path",
          props: { pathData: "M100 0L100 200" },
        },
      },
    ],
    {
      invalidations: [
        {
          type: "render-intents",
          intentIds: ["snap-guide"],
        },
      ],
    },
  );

  assertEqual(
    image.left,
    137,
    "adding a snap guide should not reset the live image x position",
  );
  assertEqual(
    image.top,
    142,
    "adding a snap guide should not reset the live image y position",
  );

  const movedWorkingImage: FabricRenderTargetItem = {
    ...workingImage,
    spec: {
      ...workingImage.spec,
      props: { ...workingImage.spec.props, left: 120 },
    },
  };
  await service.reconcileRenderGraphDrawList([movedWorkingImage], {
    invalidations: [
      {
        type: "render-intents",
        intentIds: ["working-image"],
      },
    ],
  });

  assertEqual(
    image.left,
    120,
    "a changed image spec should still replace the live transform",
  );

  image.left = 145;
  image.data.renderOwnership = {
    type: "interaction",
    interactionId: "working-image:1",
    phase: "active",
  };
  await service.reconcileRenderGraphDrawList([workingImage], {
    invalidations: [
      {
        type: "render-intents",
        intentIds: ["working-image"],
      },
    ],
  });
  assertEqual(
    image.left,
    145,
    "an active interaction should retain transform ownership",
  );

  image.data.renderOwnership = {
    type: "interaction",
    interactionId: "working-image:1",
    phase: "committing",
  };
  await service.reconcileRenderGraphDrawList([workingImage], {
    invalidations: [
      {
        type: "render-intents",
        intentIds: ["working-image"],
      },
    ],
  });
  assertEqual(
    image.left,
    100,
    "a committing interaction should yield to the next declarative update",
  );
  assertEqual(
    image.data.renderOwnership.type,
    "declarative",
    "a declarative update should release interaction ownership",
  );
}

async function testCanvasReconcileReplacesInvalidatedRenderIntentImage() {
  const { canvas, service } = createCanvasServiceForReconcileTests();
  const createTemplateItem = (src: string): FabricRenderTargetItem => ({
    key: "image:template-slot",
    layerId: "template-visuals",
    order: 0,
    origin: { type: "render-intent", intentId: "template-slot" },
    spec: {
      id: "image:template-slot",
      type: "image",
      src,
      props: { left: 0, top: 0, width: 100, height: 80 },
    },
  });

  await service.reconcileRenderGraphDrawList(
    [createTemplateItem("/template-one.png")],
    { invalidations: [{ type: "full" }] },
  );
  const firstImage = canvas.objects[0] as any;

  await service.reconcileRenderGraphDrawList(
    [createTemplateItem("/template-two.png")],
    {
      invalidations: [{ type: "render-intents", intentIds: ["template-slot"] }],
    },
  );

  assert(
    canvas.objects[0] !== firstImage,
    "changing an invalidated render intent image source should recreate the backend object",
  );
  assertEqual(
    (canvas.objects[0] as any).src,
    "/template-two.png",
    "changing a template resource should render the new image source",
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

function testCanvasServicePreservesIntrinsicImageSize() {
  const { service } = createCanvasServiceForReconcileTests();
  const image: any = new FakeFabricObject("image", {
    height: 480,
    width: 640,
  });

  (service as any).patchFabricObject(image, {
    id: "working-image",
    type: "image",
    src: "/working-image.png",
    space: "scene",
    props: {
      height: undefined,
      left: 10,
      scaleX: 0.5,
      scaleY: 0.5,
      top: 10,
      width: undefined,
    },
  });

  assertEqual(
    image.width,
    640,
    "undefined target width should not overwrite the intrinsic image width",
  );
  assertEqual(
    image.height,
    480,
    "undefined target height should not overwrite the intrinsic image height",
  );
}

async function testCanvasReconcileAppliesInteractiveControlDefaults() {
  const { canvas, service } = createCanvasServiceForReconcileTests();

  await service.reconcileRenderGraphDrawList([
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
  ]);

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
  await service.reconcileRenderGraphDrawList([
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
  ]);

  assert(canvas.objects[0]?.clipPath, "clip path should be attached");
  assertEqual(
    (canvas.objects[0] as any).__pooderEffectClipKey,
    "clip.art",
    "managed clip key should be tracked",
  );
}

async function testCanvasReconcileAppliesPlacedRectClipPath() {
  const { canvas, service } = createCanvasServiceForReconcileTests();
  await service.reconcileRenderGraphDrawList([
    {
      key: "placed-art-node",
      layerId: "art",
      order: 0,
      spec: {
        id: "placed-art-node",
        type: "rect",
        props: { width: 10, height: 10 },
        data: { subjectId: "placed-art-subject" },
        effects: [
          {
            type: "clipPath",
            id: "clip.placed",
            coordinateMode: "absolute",
            source: {
              id: "placed-clip-source",
              type: "rect",
              space: "scene",
              placement: createAffinePlacement({
                localBounds: { left: 0, top: 0, width: 5, height: 6 },
                localToScene: coordinateMatrix(
                  "object-local",
                  "scene",
                  [1, 0, 0, 1, 2, 3],
                ),
              }),
              props: { fill: "#000" },
            },
          },
        ],
      },
    },
  ]);

  const clipPath = canvas.objects[0]?.clipPath as any;
  assert(clipPath, "placed clip path should be attached");
  assertEqual(
    clipPath.width,
    5,
    "placed clip should consume local bounds width",
  );
  assertEqual(
    clipPath.height,
    6,
    "placed clip should consume local bounds height",
  );
  assertEqual(
    clipPath.absolutePositioned,
    true,
    "placed scene clip should remain absolute-positioned",
  );
}

async function testCanvasReconcileAppliesImageClipPath() {
  const { canvas, service } = createCanvasServiceForReconcileTests();
  await service.reconcileRenderGraphDrawList([
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
  ]);

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

async function testSceneExportUsesThePreviewClipContract() {
  const clipEffect = {
    type: "clipPath" as const,
    id: "clip.contract",
    coordinateMode: "absolute" as const,
    source: {
      id: "clip-source",
      type: "rect" as const,
      space: "scene" as const,
      props: { width: 50, height: 40 },
    },
  };
  const capturedSpecs: any[] = [];
  const createExportCanvas = () => ({
    add() {},
    dispose() {},
    renderAll() {},
    toDataURL() {
      return "data:image/png;base64,contract";
    },
  });
  const service = new BrowserSceneExportService() as any;
  service.canvasService = {
    async createDetachedRenderObject(spec: unknown) {
      capturedSpecs.push(spec);
      return {};
    },
  };
  service.geometrySource = {};
  service.renderIntentService = {
    getGraph: () => ({
      layers: [
        {
          id: "artwork",
          sceneId: "front",
          visible: true,
          nodes: [
            {
              id: "shape",
              visible: true,
              exportKeys: ["shape"],
              tags: ["contract"],
              props: {},
              effects: [clipEffect],
            },
          ],
        },
      ],
    }),
  };
  service.renderGraphAdapter = {
    createExportRenderObjectSpec: () => ({
      id: "shape",
      type: "rect",
      props: { width: 100, height: 80 },
      effects: [clipEffect],
    }),
  };
  service.createExportCanvas = createExportCanvas;

  await service.exportImage({
    sceneId: "front",
    crop: {
      type: "sceneRect",
      rect: { left: 0, top: 0, width: 100, height: 80 },
    },
  });
  assertDeepEqual(
    capturedSpecs[0]?.effects,
    [clipEffect],
    "export should consume the same clip effect contract as preview",
  );

  await service.exportImage({
    sceneId: "front",
    crop: {
      type: "sceneRect",
      rect: { left: 0, top: 0, width: 100, height: 80 },
    },
    preserveClipPaths: false,
  });
  assertDeepEqual(
    capturedSpecs[1]?.effects,
    [],
    "clip removal should require an explicit export option",
  );
}

async function testSceneExportRequiresOneExplicitScenePerCall() {
  const createExportCanvas = () => ({
    add() {},
    dispose() {},
    renderAll() {},
    toDataURL() {
      return "data:image/png;base64,surface";
    },
  });
  const service = new BrowserSceneExportService() as any;
  service.canvasService = {
    async createDetachedRenderObject() {
      return {};
    },
  };
  service.renderIntentService = {
    getGraph: () => ({
      layers: [
        {
          id: "art-front",
          sceneId: "front",
          visible: true,
          nodes: [
            {
              id: "front-shape",
              visible: true,
              exportKeys: ["front-shape"],
              tags: ["export:design"],
              props: {},
              effects: [],
            },
          ],
        },
        {
          id: "art-back",
          sceneId: "back",
          visible: true,
          nodes: [
            {
              id: "back-shape",
              visible: true,
              exportKeys: ["back-shape"],
              tags: ["export:design"],
              props: {},
              effects: [],
            },
          ],
        },
      ],
    }),
  };
  service.renderGraphAdapter = {
    createExportRenderObjectSpec: (_layer: unknown, node: { id: string }) => ({
      id: node.id,
      type: "rect",
      props: { width: 10, height: 10 },
      effects: [],
    }),
  };
  service.createExportCanvas = createExportCanvas;

  const crop = {
    type: "sceneRect" as const,
    rect: { left: 0, top: 0, width: 10, height: 10 },
  };
  const front = await service.exportImage({
    crop,
    includeHidden: true,
    sceneId: "front",
  });
  const back = await service.exportImage({
    crop,
    includeHidden: true,
    sceneId: "back",
  });
  assertEqual(
    front.sceneId,
    "front",
    "first call should export only the requested scene",
  );
  assertEqual(
    back.sceneId,
    "back",
    "second call should export only the requested scene",
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
      sceneId: "legacy",
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

function testOutputMaskKeepsArtDrawnInTheTransparentColor() {
  const width = 5;
  const height = 5;
  const data = new Uint8ClampedArray(width * height * 4);
  const setPixel = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 255;
  };

  for (let index = 1; index <= 3; index += 1) {
    setPixel(index, 1);
    setPixel(index, 3);
    setPixel(1, index);
    setPixel(3, index);
  }

  const alpha = createOutputMaskAlpha(data, width, height, "outline", {
    red: 255,
    green: 255,
    blue: 255,
    tolerance: 8,
  });

  assertEqual(
    alpha?.[2 * width + 2],
    255,
    "outline mask should ignore the transparent color when it would erase the whole mask",
  );
  assertEqual(alpha?.[0], 0, "fallback mask should leave outside transparent");
}

async function testSceneExportFallsBackToTheUnmaskedImage() {
  const service = new BrowserSceneExportService() as any;
  service.canvasService = {
    async createDetachedRenderObject() {
      return {};
    },
  };
  service.geometrySource = {};
  service.renderIntentService = {
    getGraph: () => ({
      layers: [
        {
          id: "artwork",
          sceneId: "front",
          visible: true,
          nodes: [
            {
              id: "shape",
              visible: true,
              exportKeys: ["shape"],
              tags: ["mockup"],
              props: {},
              data: {},
            },
          ],
        },
      ],
    }),
  };
  service.renderGraphAdapter = {
    createExportRenderObjectSpec: () => ({ id: "shape", type: "rect" }),
  };
  service.createExportCanvas = () => ({
    add() {},
    dispose() {},
    renderAll() {},
    toDataURL() {
      return "data:image/png;base64,raw";
    },
  });
  service.applyOutputMask = async () => {
    throw new Error("browser-scene-export-output-mask-invalid");
  };

  const originalWarn = console.warn;
  let warning: unknown[] | null = null;
  console.warn = (...args: unknown[]) => {
    warning = args;
  };

  try {
    const result = await service.exportImage({
      sceneId: "front",
      crop: {
        type: "sceneRect",
        rect: { left: 0, top: 0, width: 100, height: 80 },
      },
      outputMask: { mode: "outline", sourceKey: "templateFrame" },
    });

    assertEqual(
      result.url,
      "data:image/png;base64,raw",
      "scene export should fall back to the unmasked export when the mask is invalid",
    );
    assert(
      String(warning?.[0] || "").includes("Output mask is invalid"),
      "scene export should warn when falling back from an invalid output mask",
    );
  } finally {
    console.warn = originalWarn;
  }
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

async function testObjectImageResolverCachesCommittedVisuals() {
  let notifyRenderChange: (() => void) | undefined;
  let effects: unknown[] = [{}];
  let exportCalls = 0;
  let lastExportOptions: Record<string, unknown> | undefined;
  const renderIntentService = {
    getGraph: () => ({
      layers: [
        {
          nodes: [
            {
              data: {
                imageGeometry: {
                  fit: "cover",
                  frame: { height: 50, left: 0, top: 0, width: 80 },
                  source: {
                    size: { height: 200, width: 300 },
                    src: "https://example.com/original.png",
                  },
                },
              },
              effects,
              exportKeys: ["image-slot"],
              id: "render-image-slot",
              placement: createTestPlacement(10, 20, 80, 50),
              props: {},
              subjectId: "image-slot",
              type: "image",
            },
          ],
        },
      ],
    }),
    onDidChange: (listener: () => void) => {
      notifyRenderChange = listener;
      return { dispose() {} };
    },
  };
  const sceneExportService = {
    exportImage: async (options: Record<string, unknown>) => {
      exportCalls += 1;
      lastExportOptions = options;
      return {
        crop: { height: 50, left: 10, top: 20, width: 80 },
        format: "png" as const,
        height: 100,
        url: `data:image/png;base64,resolved-${exportCalls}`,
        width: 160,
      };
    },
  };
  const resolver = new BrowserObjectImageResolverService();
  resolver.init({
    eventBus: {} as any,
    get: () => undefined,
    getOrThrow: (token: unknown) =>
      token === RENDER_INTENT_SERVICE
        ? (renderIntentService as any)
        : (sceneExportService as any),
    has: () => true,
  });

  const first = await resolver.resolve({ objectId: "image-slot" });
  const second = await resolver.resolve({ objectId: "image-slot" });
  assertEqual(first.url, second.url, "resolved visuals should be cached");
  assertEqual(exportCalls, 1, "cached visual should not be exported twice");
  assertEqual(
    (lastExportOptions?.preserveClipPaths as boolean) ?? false,
    true,
    "committed visual export should preserve clipping",
  );
  assertDeepEqual(
    first.sceneBounds,
    { height: 50, left: 10, top: 20, width: 80 },
    "resolved visual should retain its scene-space bounds",
  );

  const original = await resolver.resolve({
    objectId: "image-slot",
    representation: "original-resource",
  });
  assertEqual(
    original.url,
    "https://example.com/original.png",
    "original representation should retain the editable resource",
  );
  assertEqual(
    original.derived,
    false,
    "original resource should not be derived",
  );
  assertEqual(exportCalls, 1, "original resource should bypass scene export");

  notifyRenderChange?.();
  const refreshed = await resolver.resolve({ objectId: "image-slot" });
  assertEqual(exportCalls, 2, "render changes should invalidate visual cache");
  assertEqual(
    refreshed.revision,
    1,
    "resolved revision should track invalidation",
  );

  effects = [];
  notifyRenderChange?.();
  const unchanged = await resolver.resolve({ objectId: "image-slot" });
  assertEqual(
    unchanged.url,
    "https://example.com/original.png",
    "an unprocessed committed visual should reuse its original resource",
  );
  assertEqual(
    unchanged.derived,
    false,
    "identity resolution should not be derived",
  );
  assertEqual(exportCalls, 2, "identity resolution should bypass scene export");
  resolver.dispose();
}

async function testObjectImageResolverCropsCommittedVisualToClip() {
  let lastExportOptions: Record<string, unknown> | undefined;
  const clipPlacement = createTestPlacement(100, 200, 80, 50);
  const renderIntentService = {
    getGraph: () => ({
      layers: [
        {
          nodes: [
            {
              data: {
                imageGeometry: {
                  clip: { height: 50, left: 0, top: 0, width: 80 },
                  fit: "cover",
                  frame: { height: 50, left: 0, top: 0, width: 80 },
                  source: {
                    size: { height: 200, width: 300 },
                    src: "https://example.com/original.png",
                  },
                  transform: { zoom: 2 },
                },
              },
              effects: [
                {
                  coordinateMode: "absolute",
                  source: {
                    placement: clipPlacement,
                    space: "scene",
                    type: "rect",
                  },
                  type: "clipPath",
                },
              ],
              exportKeys: ["image-slot"],
              id: "render-image-slot",
              // Oversized source placement that overflows the clip frame.
              placement: createTestPlacement(60, 160, 160, 120),
              props: {},
              subjectId: "image-slot",
              type: "image",
            },
          ],
        },
      ],
    }),
    onDidChange: () => ({ dispose() {} }),
  };
  const sceneExportService = {
    exportImage: async (options: Record<string, unknown>) => {
      lastExportOptions = options;
      return {
        crop: { height: 50, left: 100, space: "scene", top: 200, width: 80 },
        format: "png" as const,
        height: 100,
        url: "data:image/png;base64,clipped",
        width: 160,
      };
    },
  };
  const resolver = new BrowserObjectImageResolverService();
  resolver.init({
    eventBus: {} as any,
    get: () => undefined,
    getOrThrow: (token: unknown) =>
      token === RENDER_INTENT_SERVICE
        ? (renderIntentService as any)
        : (sceneExportService as any),
    has: () => true,
  });

  const resolved = await resolver.resolve({ objectId: "image-slot" });
  const exportCrop = lastExportOptions?.crop as
    | { type?: string; rect?: Record<string, number | string> }
    | undefined;
  assertEqual(
    exportCrop?.type,
    "sceneRect",
    "committed visual should crop with sceneRect",
  );
  assertDeepEqual(
    {
      height: Number(exportCrop?.rect?.height),
      left: Number(exportCrop?.rect?.left),
      top: Number(exportCrop?.rect?.top),
      width: Number(exportCrop?.rect?.width),
    },
    { height: 50, left: 100, top: 200, width: 80 },
    "committed visual should crop to the clip region instead of element bounds",
  );
  assertEqual(
    (lastExportOptions?.preserveClipPaths as boolean) ?? false,
    true,
    "committed visual export should preserve clipping",
  );
  assertEqual(resolved.derived, true, "clipped committed visual is derived");
  assertDeepEqual(
    {
      height: resolved.sceneBounds.height,
      left: resolved.sceneBounds.left,
      top: resolved.sceneBounds.top,
      width: resolved.sceneBounds.width,
    },
    { height: 50, left: 100, top: 200, width: 80 },
    "committed visual scene bounds should match the clip region",
  );
  assertDeepEqual(
    {
      height: resolved.placement.localBounds.height,
      left: resolved.placement.localBounds.left,
      top: resolved.placement.localBounds.top,
      width: resolved.placement.localBounds.width,
    },
    { height: 100, left: 0, top: 0, width: 160 },
    "committed visual placement should use the clipped export pixel bounds",
  );
  resolver.dispose();
}

async function main() {
  const tests: Array<[string, () => void | Promise<void>]> = [
    ["applies alpha mask data", testOutputMaskAlphaHelpers],
    [
      "resolves and caches committed object visuals",
      testObjectImageResolverCachesCommittedVisuals,
    ],
    [
      "crops committed visuals to clip bounds",
      testObjectImageResolverCropsCommittedVisualToClip,
    ],
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
      "keeps output mask art drawn in the transparent color",
      testOutputMaskKeepsArtDrawnInTheTransparentColor,
    ],
    [
      "falls back to the unmasked export when the output mask is invalid",
      testSceneExportFallsBackToTheUnmaskedImage,
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
      "round-trips scene and screen projections without resize drift",
      testViewportProjectionRoundTripsWithoutResizeDrift,
    ],
    [
      "builds graph adapter draw list",
      testFabricRenderGraphAdapterBuildsDrawList,
    ],
    [
      "composes local-only session roots",
      testSessionRootCompositionIsLocalOnly,
    ],
    [
      "uses independent session projection ids and direct subject ids",
      testSessionRenderOverrideUsesIndependentProjectionId,
    ],
    [
      "exports only persistent document projections during sessions",
      testSceneExportReadsOnlyDocumentProjections,
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
      testFabricRenderGraphAdapterConsumesSceneSpace,
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
      "uses render graph layer array order for graph stacking",
      testFabricRenderGraphAdapterRespectsLayerArrayOrder,
    ],
    [
      "maps declarative interaction state",
      testFabricRenderGraphAdapterMapsDeclarativeInteraction,
    ],
    [
      "moves every projection of a logical subject",
      testFabricRenderGraphAdapterMovesLogicalSubjectProjections,
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
      "reconciles by invalidation and interaction ownership",
      testCanvasReconcileUsesInvalidationAndInteractionOwnership,
    ],
    [
      "replaces invalidated render intent image resources",
      testCanvasReconcileReplacesInvalidatedRenderIntentImage,
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
      "preserves intrinsic image dimensions when target size is omitted",
      testCanvasServicePreservesIntrinsicImageSize,
    ],
    [
      "applies interactive control defaults",
      testCanvasReconcileAppliesInteractiveControlDefaults,
    ],
    ["applies graph clip paths", testCanvasReconcileAppliesClipPath],
    [
      "applies placed graph rect clip paths",
      testCanvasReconcileAppliesPlacedRectClipPath,
    ],
    ["applies graph image clip paths", testCanvasReconcileAppliesImageClipPath],
    [
      "uses the preview clip contract during export",
      testSceneExportUsesThePreviewClipContract,
    ],
    [
      "requires one explicit scene per export call",
      testSceneExportRequiresOneExplicitScenePerCall,
    ],
  ];

  const filter = String(process.env.POODER_TEST_FILTER || "")
    .trim()
    .toLowerCase();
  const foundationNames = new Set([
    "round-trips scene and screen projections without resize drift",
    "applies graph clip paths",
    "applies placed graph rect clip paths",
    "applies graph image clip paths",
    "uses the preview clip contract during export",
  ]);
  const selectedTests =
    filter === "foundation"
      ? tests.filter(([name]) => foundationNames.has(name))
      : filter
        ? tests.filter(([name]) => name.toLowerCase().includes(filter))
        : tests;
  if (selectedTests.length === 0) {
    throw new Error(`No platform-browser tests match "${filter}".`);
  }

  for (const [name, run] of selectedTests) {
    await run();
    console.log(`PASS ${name}`);
  }

  console.log("All platform-browser tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
