import type { Service } from "@pooder/core";
import { Pooder, RENDER_INTENT_SERVICE, SCENE_SERVICE } from "@pooder/core";
import {
  attachBrowserHost,
  BrowserSceneExportService,
  CANVAS_SERVICE,
  CanvasService,
  FABRIC_RENDER_GRAPH_ADAPTER,
  FabricRenderGraphAdapter,
  SCENE_EXPORT_SERVICE,
  SCENE_LAYOUT_SERVICE,
  applyAlphaMaskData,
  applyTransparentColorToAlpha,
  createBoundaryOutputMaskAlpha,
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
  objects: any[] = [];
  handlers = new Map<string, Array<(...args: any[]) => void>>();
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
  assertEqual(last.effects.length, 1, "adapter should forward clip effects");
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
    last.effects[0]?.targetSubjectIds?.[0],
    "art",
    "clip should target graph subject ids",
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

async function testFabricRenderGraphAdapterUsesDerivedImageDimensions() {
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
      dragConstraints: [
        {
          type: "rect",
          rect: { left: 0, top: 0, width: 100, height: 100 },
          target: "frame",
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
    "rect drag constraints should clamp graph objects",
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
      dragConstraints: [
        {
          type: "object",
          objectId: "bounds",
          fallbackFrame: { left: 0, top: 0, width: 10, height: 10 },
          target: "center",
        },
      ],
    },
  };
  canvas.objects = [reference];
  canvas.emitCanvasEvent("object:moving", { target: objectConstrained });
  assertEqual(
    objectConstrained.left,
    45,
    "object constraints should use live object bounds when available",
  );

  objectConstrained.left = 80;
  objectConstrained.data.dragConstraints[0].objectId = "missing";
  canvas.objects = [];
  canvas.emitCanvasEvent("object:moving", { target: objectConstrained });
  assertEqual(
    objectConstrained.left,
    5,
    "object constraints should fall back to compiled frames",
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
        },
      },
    ],
    [
      {
        key: "clip.art",
        source: {
          id: "clip-source",
          type: "image",
          src: "data:image/png;base64,dieline",
          space: "screen",
          props: { left: 1, top: 2, width: 100, height: 80 },
        },
        targetSubjectIds: ["art-subject"],
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

  assertEqual(
    exportCanvas.objects[0]?.clipPath,
    undefined,
    "export should clear clip paths by default",
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
    preserveClipPaths: true,
    source: { layerIds: ["image.user"] },
  });

  assertEqual(
    exportCanvas.objects[0]?.clipPath,
    clipPath,
    "export should preserve clip paths when requested",
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
      "builds graph adapter draw list",
      testFabricRenderGraphAdapterBuildsDrawList,
    ],
    [
      "renders renderable SceneService scenes",
      testFabricRenderGraphAdapterRendersRenderableScenes,
    ],
    [
      "uses derived image dimensions for committed replacements",
      testFabricRenderGraphAdapterUsesDerivedImageDimensions,
    ],
    [
      "resyncs graph adapter on layout change",
      testFabricRenderGraphAdapterResyncsOnLayoutChange,
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
      "constrains render graph object dragging",
      testFabricRenderGraphAdapterConstrainsDragging,
    ],
    [
      "reconciles stale objects and clip cleanup",
      testCanvasReconcileRemovesStaleObjectsAndClearsClip,
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
      "clears export clip paths by default",
      testSceneExportClearsClipPathByDefault,
    ],
    [
      "preserves export clip paths when requested",
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
