import type { Service } from "@pooder/core";
import { Pooder, RENDER_INTENT_SERVICE } from "@pooder/core";
import {
  attachBrowserHost,
  BrowserSceneExportService,
  CANVAS_SERVICE,
  CanvasService,
  FABRIC_RENDER_GRAPH_ADAPTER,
  FabricRenderGraphAdapter,
  SCENE_EXPORT_SERVICE,
  SCENE_LAYOUT_SERVICE,
} from "../src";
import type {
  FabricRenderTargetClipEffect,
  FabricRenderTargetItem,
} from "../src/canvas-service";

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

function assertDeepEqual(actual: unknown, expected: unknown, message: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message} (expected ${expectedJson}, got ${actualJson})`);
  }
}

class FakeCanvasService {
  resizeCalls: Array<{ height: number; width: number }> = [];
  renderCalls = 0;
  reconcileCalls: Array<{
    items: FabricRenderTargetItem[];
    effects: FabricRenderTargetClipEffect[];
  }> = [];

  resize(width: number, height: number) {
    this.resizeCalls.push({ width, height });
  }

  requestRenderAll() {
    this.renderCalls += 1;
  }

  async reconcileRenderGraphDrawList(
    items: FabricRenderTargetItem[],
    effects: FabricRenderTargetClipEffect[] = [],
  ) {
    this.reconcileCalls.push({
      items: items.map((item) => ({ ...item, spec: { ...item.spec } })),
      effects: effects.map((effect) => ({ ...effect })),
    });
  }

  getObjects() {
    return [];
  }

  getViewportSize() {
    return { width: 800, height: 600 };
  }

  getSceneScale() {
    return 1;
  }

  toScenePoint(point: { x: number; y: number }) {
    return point;
  }

  toSceneRect(rect: { left: number; top: number; width: number; height: number }) {
    return rect;
  }
}

class FakeSceneLayoutService {}
class FakeBrowserSceneExportService {}
class FakeFabricRenderGraphAdapter {}

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
    const obj = new FakeFabricObject(spec.type);
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

function testAttachRegistersRenderGraphAdapter() {
  const { registered, runtime } = createRuntime();
  const canvasService = new FakeCanvasService();
  const sceneLayoutService = new FakeSceneLayoutService();
  const browserSceneExportService = new FakeBrowserSceneExportService();
  const graphAdapter = new FakeFabricRenderGraphAdapter();
  let observerCallback: ResizeObserverCallback | null = null;
  let disconnected = false;

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

  const callback = observerCallback as ResizeObserverCallback | null;
  assert(callback, "resize observer callback should be installed");
  callback(
    [{ contentRect: { height: 240, width: 480 } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  assertEqual(canvasService.resizeCalls[0]?.width, 480, "resize width forwards");

  attachment.dispose();
  assert(disconnected, "dispose should disconnect resize observer");
  assert(!registered.has(CANVAS_SERVICE), "canvas service should unregister");
  assert(!registered.has(SCENE_LAYOUT_SERVICE), "layout service should unregister");
  assert(!registered.has(SCENE_EXPORT_SERVICE), "export service should unregister");
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

  const renderIntentService = runtime.services.getOrThrow(RENDER_INTENT_SERVICE);
  renderIntentService.setDocumentIntents([
    {
      id: "background",
      subject: { kind: "object", surfaceId: "s1", layerId: "bg", objectId: "bg" },
      visual: { type: "rect" },
      ordering: { layerId: "bg", stack: 0, layerOrder: 0 },
      props: { width: 10, height: 10 },
    },
    {
      id: "art",
      subject: { kind: "object", surfaceId: "s1", layerId: "art", objectId: "art" },
      visual: { type: "rect" },
      ordering: { layerId: "art", stack: 10, layerOrder: 0 },
      props: { width: 5, height: 5 },
      clipping: {
        effects: [
          {
            type: "clipPath",
            id: "clip.art",
            source: {
              id: "clip-source",
              type: "rect",
              props: { width: 3, height: 3 },
            },
            targetSubjectIds: ["art"],
          },
        ],
      },
    },
  ]);

  await adapter.flush();
  const last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  assert(last, "adapter should reconcile");
  assertEqual(last.items.length, 2, "adapter should draw visible nodes");
  assertEqual(last.items[0]?.layerId, "bg", "draw list should keep layer order");
  assertEqual(last.effects.length, 1, "adapter should forward clip effects");
  assertEqual(
    last.effects[0]?.targetSubjectIds?.[0],
    "art",
    "clip should target graph subject ids",
  );

  await runtime.dispose();
}

async function testFabricRenderGraphAdapterUsesDerivedImageDimensions() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  const renderIntentService = runtime.services.getOrThrow(RENDER_INTENT_SERVICE);
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
    undefined,
    "derived-size images should not be rewritten to the slot frame width",
  );
  assertEqual(
    image.props.height,
    undefined,
    "derived-size images should not be rewritten to the slot frame height",
  );
  assertEqual(
    image.props.scaleX,
    0.5,
    "derived-size images should keep the committed bitmap scale",
  );
  assertEqual(
    image.props.scaleY,
    0.5,
    "derived-size images should keep the committed bitmap scale",
  );

  await runtime.dispose();
}

async function testFabricRenderGraphAdapterResyncsOnLayoutChange() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);

  runtime.services.getOrThrow(RENDER_INTENT_SERVICE).setDocumentIntents([
    {
      id: "art",
      subject: { kind: "object", surfaceId: "s1", layerId: "art", objectId: "art" },
      visual: { type: "rect" },
      ordering: { layerId: "art", stack: 10, layerOrder: 0 },
      props: { width: 5, height: 5 },
    },
  ]);

  await adapter.flush();
  const before = canvas.reconcileCalls.length;
  runtime.eventBus.emit("scene:layout:change", {});
  await adapter.flush();

  assert(
    canvas.reconcileCalls.length > before,
    "adapter should resync screen-space Fabric props after scene layout changes",
  );

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
  const stop = adapter.onSyncStateChange((state) => {
    states.push(state);
  }, { immediate: true });

  runtime.services.getOrThrow(RENDER_INTENT_SERVICE).setDocumentIntents([
    {
      id: "background",
      subject: { kind: "object", surfaceId: "s1", layerId: "bg", objectId: "bg" },
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
  assertEqual(finalState.loading, false, "adapter should report idle after flush");
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

async function testProjectionSuppressesSourceInGraphOnly() {
  const runtime = new Pooder();
  const canvas = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  const sourceFabricObject = new FakeFabricObject("rect", {
    data: { id: "source" },
    visible: true,
  });

  runtime.services.register(canvas as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);
  runtime.services.getOrThrow(RENDER_INTENT_SERVICE).setDocumentIntents([
    {
      id: "source",
      subject: {
        kind: "object",
        surfaceId: "s1",
        layerId: "art",
        objectId: "source-subject",
      },
      visual: { type: "rect" },
      ordering: { layerId: "art", stack: 0, objectOrder: 0 },
      props: { width: 10, height: 10 },
    },
    {
      id: "projection",
      subject: { kind: "layer", surfaceId: "s1", layerId: "overlay" },
      projection: {
        sourceSubjectIds: ["source-subject"],
        suppressSource: true,
      },
      ordering: { layerId: "overlay", stack: 1, objectOrder: 0 },
    },
  ]);

  await adapter.flush();
  const last = canvas.reconcileCalls[canvas.reconcileCalls.length - 1];
  assert(last, "projection should reconcile");
  assertEqual(last.items.length, 1, "source node should be omitted from draw list");
  assert(
    last.items[0]?.key.startsWith("projection:"),
    "projection node should be drawn",
  );
  assertEqual(
    sourceFabricObject.visible,
    true,
    "projection suppression should not mutate existing Fabric source objects",
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
    [],
  );

  assert(!canvas.objects.includes(stale), "stale graph object should be removed");
  assertEqual(canvas.objects.length, 1, "only current graph object should remain");
  assertEqual(
    canvas.objects[0]?.clipPath,
    undefined,
    "missing clip effect should clear managed clip path",
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
        },
      },
    ],
    [
      {
        key: "clip.art",
        source: {
          id: "clip-source",
          type: "rect",
          props: { width: 5, height: 5 },
        },
        targetSubjectIds: ["art-subject"],
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

async function testSceneExportMatchesRenderGraphNodeIds() {
  const source = {
    data: {
      exportKeys: ["session-image:slot"],
      layerId: "image.user.session.image",
    },
    visible: true,
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
    getObjects: () => [source],
    getSceneScale: () => 1,
    toScenePoint: (point: { x: number; y: number }) => point,
    toSceneRect: (rect: { left: number; top: number; width: number; height: number }) =>
      rect,
  };
  service.sceneLayoutService = {};
  service.createExportCanvas = () => exportCanvas;

  const result = await service.exportImage({
    crop: { type: "sceneRect", rect: { left: 0, top: 0, width: 100, height: 80 } },
    includeHidden: true,
    sourceElementIds: ["session-image:slot"],
    sourceLayerIds: ["image.user.session.image"],
  });

  assertEqual(
    exportCanvas.objects.length,
    1,
    "export should include objects matched by render graph node id",
  );
  assertEqual(
    result.sourceElementIds[0],
    "session-image:slot",
    "export result should report render graph node id",
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
    getObjects: () => [source],
    getSceneScale: () => 1,
    toScenePoint: (point: { x: number; y: number }) => point,
    toSceneRect: (rect: { left: number; top: number; width: number; height: number }) =>
      rect,
  };
  service.sceneLayoutService = {
    getLayout: () => ({
      cutRect,
      trimRect: cutRect,
      bleedRect: cutRect,
    }),
  };
  service.createExportCanvas = () => exportCanvas;

  const result = await service.exportImage({
    crop: { type: "frame", frame: "cut" },
    includeHidden: true,
    sourceLayerIds: ["image.user"],
  });

  assertDeepEqual(
    result.crop,
    cutRect,
    "frame export should crop from scene layout cut rect",
  );
  assertEqual(result.width, cutRect.width * 2, "frame export width should use cut crop");
  assertEqual(result.height, cutRect.height * 2, "frame export height should use cut crop");
}

async function main() {
  const tests: Array<[string, () => void | Promise<void>]> = [
    ["registers render graph adapter in browser host", testAttachRegistersRenderGraphAdapter],
    ["builds graph adapter draw list", testFabricRenderGraphAdapterBuildsDrawList],
    [
      "uses derived image dimensions for committed replacements",
      testFabricRenderGraphAdapterUsesDerivedImageDimensions,
    ],
    ["resyncs graph adapter on layout change", testFabricRenderGraphAdapterResyncsOnLayoutChange],
    ["reports graph adapter sync state", testFabricRenderGraphAdapterReportsSyncState],
    ["preserves graph coordinate space", testFabricRenderGraphAdapterPreservesScreenSpace],
    ["projects without mutating source Fabric objects", testProjectionSuppressesSourceInGraphOnly],
    ["reconciles stale objects and clip cleanup", testCanvasReconcileRemovesStaleObjectsAndClearsClip],
    ["applies graph clip paths", testCanvasReconcileAppliesClipPath],
    ["exports by render graph node ids", testSceneExportMatchesRenderGraphNodeIds],
    ["exports frame crops from scene layout cut rect", testSceneExportUsesCutFrameCrop],
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
