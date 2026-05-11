import type { Service } from "@pooder/core";
import { Pooder, SCENE_SERVICE } from "@pooder/core";
import {
  attachBrowserHost,
  CANVAS_SERVICE,
  CanvasService,
  FABRIC_SCENE_ADAPTER,
  FabricSceneAdapter,
  resolveViewPaddingPx,
  SCENE_RENDER_SCOPE,
  SCENE_LAYOUT_SERVICE,
} from "../src";
import type {
  CanvasPassStackingMeta,
  RenderObjectSpec,
  RenderPassSpec,
} from "../src";

declare const process: {
  exit(code: number): never;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
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
  passCalls: Array<{
    passId: string;
    specs: RenderObjectSpec[];
    options: { render?: boolean; replace?: boolean; scope?: string };
  }> = [];
  stackingCalls: CanvasPassStackingMeta[][] = [];
  renderCalls = 0;

  resize(width: number, height: number) {
    this.resizeCalls.push({ width, height });
  }

  async applyObjectSpecsToPass(
    passId: string,
    specs: RenderObjectSpec[],
    options: { render?: boolean; replace?: boolean; scope?: string } = {},
  ) {
    this.passCalls.push({ passId, specs, options });
  }

  syncPassStacking(passes: CanvasPassStackingMeta[]) {
    this.stackingCalls.push(passes.map((pass) => ({ ...pass })));
  }

  requestRenderAll() {
    this.renderCalls += 1;
  }
}

class FakeSceneLayoutService {}
class FakeFabricSceneAdapter {}

class FakeFabricObject {
  data: Record<string, any> = {};
  type: string;
  visible = true;

  constructor(type: string) {
    this.type = type;
  }

  set(values: Record<string, any>) {
    Object.assign(this, values);
  }

  setCoords() {}
}

class FakeRenderableCanvas {
  height = 100;
  width = 100;
  objects: FakeFabricObject[] = [];
  renderCalls = 0;

  add(obj: FakeFabricObject) {
    this.objects.push(obj);
  }

  bringObjectToFront(obj: FakeFabricObject) {
    this.moveObjectTo(obj, this.objects.length - 1);
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
    if (index >= 0) {
      this.objects.splice(index, 1);
    }
  }

  requestRenderAll() {
    this.renderCalls += 1;
  }

  setDimensions(size: { height: number; width: number }) {
    this.height = size.height;
    this.width = size.width;
  }
}

function createCanvasServiceForRenderTests() {
  const canvas = new FakeRenderableCanvas();
  const service = Object.create(CanvasService.prototype) as CanvasService & any;

  service.canvas = canvas;
  service.viewport = {
    offset: { x: 0, y: 0 },
    scale: 1,
    updateContainer() {},
  };
  service.renderProducers = new Map();
  service.producerOrder = 0;
  service.producerFlushRequested = false;
  service.producerLoopPending = false;
  service.producerLoopPromise = null;
  service.producerApplyInProgress = false;
  service.visibilityRefreshScheduled = false;
  service.managedProducerPassIds = new Set();
  service.managedPassMetas = new Map();
  service.managedPassEffects = [];
  service.layerStackingMetas = new Map();
  service.createFabricObject = async (spec: RenderObjectSpec) => {
    const obj = new FakeFabricObject(spec.type);
    obj.set({
      ...(spec.props || {}),
      data: { ...(spec.data || {}), id: spec.id },
    });
    return obj;
  };

  return { canvas, service };
}

function rectSpec(
  id: string,
  props: Record<string, any> = {},
  data: Record<string, any> = {},
): RenderObjectSpec {
  return {
    id,
    type: "rect",
    data,
    props: {
      height: 1,
      width: 1,
      ...props,
    },
  };
}

function createRuntime() {
  const registered = new Map<unknown, Service>();
  const events: string[] = [];

  return {
    events,
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
          events.push(`unregister:${String(key)}`);
          return registered.delete(key);
        },
      },
    },
  };
}

function testAttachAndDetach() {
  const { registered, runtime } = createRuntime();
  const canvasService = new FakeCanvasService();
  const sceneLayoutService = new FakeSceneLayoutService();
  const fabricSceneAdapter = new FakeFabricSceneAdapter();
  let observerCallback: ResizeObserverCallback | null = null;
  let disconnected = false;
  let observedTarget: Element | null = null;

  const container = {
    clientHeight: 180,
    clientWidth: 320,
  } as Element & { clientHeight: number; clientWidth: number };
  const canvas = { height: 0, width: 0 } as HTMLCanvasElement;

  const attachment = attachBrowserHost(runtime, {
    container,
    canvas,
    createCanvasService: () => canvasService as any,
    createFabricSceneAdapter: () => fabricSceneAdapter as any,
    createSceneLayoutService: () => sceneLayoutService as any,
    createResizeObserver: (callback) => {
      observerCallback = callback;
      return {
        disconnect() {
          disconnected = true;
        },
        observe(target) {
          observedTarget = target;
        },
      };
    },
  });

  assert(
    canvas.width === 320,
    "canvas width should be initialized from container",
  );
  assert(
    canvas.height === 180,
    "canvas height should be initialized from container",
  );
  assert(
    attachment.canvasService === (canvasService as any),
    "canvas service should be exposed",
  );
  assert(
    attachment.sceneLayoutService === (sceneLayoutService as any),
    "scene layout service should be exposed",
  );
  assert(
    attachment.fabricSceneAdapter === (fabricSceneAdapter as any),
    "fabric scene adapter should be exposed",
  );
  assert(
    registered.get(CANVAS_SERVICE) === (canvasService as any),
    "canvas service should register",
  );
  assert(
    registered.get(SCENE_LAYOUT_SERVICE) === (sceneLayoutService as any),
    "scene layout service should register",
  );
  assert(
    registered.get(FABRIC_SCENE_ADAPTER) === (fabricSceneAdapter as any),
    "fabric scene adapter should register",
  );
  assert(
    observedTarget === container,
    "resize observer should watch host container",
  );
  const callback = observerCallback;
  if (!callback) {
    throw new Error("resize observer callback should be installed");
  }

  (callback as ResizeObserverCallback)(
    [
      {
        contentRect: {
          height: 240,
          width: 480,
        },
      } as ResizeObserverEntry,
    ],
    {} as ResizeObserver,
  );

  assert(
    canvasService.resizeCalls.length === 1 &&
      canvasService.resizeCalls[0]?.width === 480 &&
      canvasService.resizeCalls[0]?.height === 240,
    "resize callback should forward host size changes",
  );

  attachment.dispose();

  assert(disconnected, "dispose should disconnect the resize observer");
  assert(
    !registered.has(CANVAS_SERVICE),
    "dispose should unregister the canvas service",
  );
  assert(
    !registered.has(SCENE_LAYOUT_SERVICE),
    "dispose should unregister the scene layout service",
  );
  assert(
    !registered.has(FABRIC_SCENE_ADAPTER),
    "dispose should unregister the fabric scene adapter",
  );
}

function testFailedLayoutRegistrationRollsBackCanvasService() {
  const registered = new Map<unknown, Service>();
  const runtime = {
    eventBus: {} as any,
    services: {
      register(service: Service, identifier?: unknown) {
        if (identifier === SCENE_LAYOUT_SERVICE) {
          return false;
        }
        registered.set(identifier ?? service.constructor.name, service);
        return true;
      },
      unregister(serviceOrIdentifier: Service | unknown, identifier?: unknown) {
        const key =
          identifier ??
          (serviceOrIdentifier && typeof serviceOrIdentifier === "object"
            ? serviceOrIdentifier.constructor.name
            : serviceOrIdentifier);
        return registered.delete(key);
      },
    },
  };

  let threw = false;
  try {
    attachBrowserHost(runtime as any, {
      container: {
        clientHeight: 50,
        clientWidth: 50,
      } as any,
      canvas: { height: 0, width: 0 } as any,
      createCanvasService: () => new FakeCanvasService() as any,
      createFabricSceneAdapter: () => new FakeFabricSceneAdapter() as any,
      createSceneLayoutService: () => new FakeSceneLayoutService() as any,
      createResizeObserver: () => ({
        disconnect() {},
        observe() {},
      }),
    });
  } catch (error) {
    threw = true;
  }

  assert(threw, "failed scene layout registration should throw");
  assert(
    !registered.has(CANVAS_SERVICE),
    "failed attach should roll back canvas service",
  );
}

function testFailedSceneAdapterRegistrationRollsBackHostServices() {
  const registered = new Map<unknown, Service>();
  const runtime = {
    eventBus: {} as any,
    services: {
      register(service: Service, identifier?: unknown) {
        if (identifier === FABRIC_SCENE_ADAPTER) {
          return false;
        }
        registered.set(identifier ?? service.constructor.name, service);
        return true;
      },
      unregister(serviceOrIdentifier: Service | unknown, identifier?: unknown) {
        const key =
          identifier ??
          (serviceOrIdentifier && typeof serviceOrIdentifier === "object"
            ? serviceOrIdentifier.constructor.name
            : serviceOrIdentifier);
        return registered.delete(key);
      },
    },
  };

  let threw = false;
  try {
    attachBrowserHost(runtime as any, {
      container: {
        clientHeight: 50,
        clientWidth: 50,
      } as any,
      canvas: { height: 0, width: 0 } as any,
      createCanvasService: () => new FakeCanvasService() as any,
      createFabricSceneAdapter: () => new FakeFabricSceneAdapter() as any,
      createSceneLayoutService: () => new FakeSceneLayoutService() as any,
      createResizeObserver: () => ({
        disconnect() {},
        observe() {},
      }),
    });
  } catch {
    threw = true;
  }

  assert(threw, "failed fabric scene adapter registration should throw");
  assert(
    !registered.has(CANVAS_SERVICE),
    "failed scene adapter attach should roll back canvas service",
  );
  assert(
    !registered.has(SCENE_LAYOUT_SERVICE),
    "failed scene adapter attach should roll back scene layout service",
  );
}

async function testFabricSceneAdapterSyncsCoreSceneToScopedPasses() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  const adapter = new FabricSceneAdapter();

  runtime.services.register(canvasService as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_SCENE_ADAPTER);
  await adapter.flush();
  canvasService.passCalls = [];
  canvasService.stackingCalls = [];
  canvasService.renderCalls = 0;

  const scene = runtime.services.getOrThrow(SCENE_SERVICE);
  scene.transaction(() => {
    scene.addLayer({ id: "background", order: 1 });
    scene.addLayer({ id: "artwork", order: 2, visible: false });
    scene.addElement({
      id: "rect-1",
      layerId: "background",
      type: "rect",
      width: 100,
      height: 50,
      transform: { left: 10, top: 20 },
      style: { fill: "red" },
    });
    scene.addElement({
      id: "label-1",
      layerId: "artwork",
      type: "text",
      text: "Hidden",
    });
  });

  await adapter.flush();

  const backgroundPass = canvasService.passCalls.find(
    (call) => call.passId === "background",
  );
  const artworkPass = canvasService.passCalls.find(
    (call) => call.passId === "artwork",
  );

  assert(backgroundPass, "background layer should sync to a pass");
  assert(artworkPass, "artwork layer should sync to a pass");
  assertEqual(
    backgroundPass.options.scope,
    SCENE_RENDER_SCOPE,
    "scene adapter should use a scoped render pass",
  );
  assertEqual(
    backgroundPass.specs[0]?.type,
    "rect",
    "rect scene element should become a rect render spec",
  );
  assertEqual(
    backgroundPass.specs[0]?.props.fill,
    "red",
    "scene element style should map to render props",
  );
  assertEqual(
    backgroundPass.specs[0]?.props.left,
    10,
    "scene element transform should map to render props",
  );
  assertEqual(
    artworkPass.specs[0]?.props.visible,
    false,
    "hidden scene layer should hide contained render objects",
  );
  assertDeepEqual(
    canvasService.stackingCalls[canvasService.stackingCalls.length - 1],
    [
      { id: "background", stack: 0, order: 1 },
      { id: "artwork", stack: 0, order: 2 },
    ],
    "scene layer order should sync to pass stacking",
  );
  assertEqual(canvasService.renderCalls, 1, "scene sync should request render");

  canvasService.passCalls = [];
  scene.removeLayer("artwork");
  await adapter.flush();

  const clearedArtwork = canvasService.passCalls.find(
    (call) => call.passId === "artwork",
  );
  assert(clearedArtwork, "removed scene layer should clear its pass");
  assertEqual(
    clearedArtwork.specs.length,
    0,
    "removed scene layer should clear scoped objects",
  );
  assertEqual(
    clearedArtwork.options.scope,
    SCENE_RENDER_SCOPE,
    "removed scene layer should only clear scene-scoped objects",
  );

  await runtime.dispose();
}

async function testRenderProducerTargetsCallerLayerWithoutReplacingSceneScope() {
  const { canvas, service } = createCanvasServiceForRenderTests();
  let passes: RenderPassSpec[] = [
    {
      id: "capability.render",
      targetLayerId: "app.artwork",
      objects: [rectSpec("producer-rect", { fill: "blue" })],
    },
  ];

  await service.applyObjectSpecsToPass(
    "app.artwork",
    [rectSpec("scene-rect", { fill: "red" })],
    { render: false, replace: true, scope: SCENE_RENDER_SCOPE },
  );
  service.registerRenderProducer("pooder.kit.test", () => ({ passes }));
  await service.flushRenderFromProducers();

  const sceneObject = canvas.objects.find(
    (obj) => obj.data.id === "scene-rect",
  );
  const producerObject = canvas.objects.find(
    (obj) => obj.data.id === "producer-rect",
  );

  assert(sceneObject, "scene-scoped object should remain in the target layer");
  assert(producerObject, "producer object should render into target layer");
  assertEqual(
    producerObject.data.passId,
    "app.artwork",
    "producer object should use the caller-provided target layer",
  );
  assertEqual(
    producerObject.data.__renderScope,
    "render-producer:pooder.kit.test:capability.render",
    "producer object should be source scoped",
  );

  passes = [];
  await service.flushRenderFromProducers();

  assert(
    canvas.objects.some((obj) => obj.data.id === "scene-rect"),
    "clearing producer output should not remove scene-scoped objects",
  );
  assert(
    !canvas.objects.some((obj) => obj.data.id === "producer-rect"),
    "producer output should be removed when its source pass disappears",
  );
}

async function testRenderProducerVisibilityIsSourceScoped() {
  const { canvas, service } = createCanvasServiceForRenderTests();

  await service.applyObjectSpecsToPass(
    "app.artwork",
    [rectSpec("scene-rect", { fill: "red" })],
    { render: false, replace: true, scope: SCENE_RENDER_SCOPE },
  );
  service.registerRenderProducer("pooder.kit.test", () => ({
    passes: [
      {
        id: "capability.render",
        targetLayerId: "app.artwork",
        visibility: { op: "const", value: false },
        objects: [rectSpec("producer-rect", { fill: "blue" })],
      },
    ],
  }));
  await service.flushRenderFromProducers();

  const sceneObject = canvas.objects.find(
    (obj) => obj.data.id === "scene-rect",
  );
  const producerObject = canvas.objects.find(
    (obj) => obj.data.id === "producer-rect",
  );

  assert(sceneObject, "scene object should exist");
  assert(producerObject, "producer object should exist");
  assertEqual(
    sceneObject.visible,
    true,
    "producer visibility should not hide scene-scoped objects",
  );
  assertEqual(
    producerObject.visible,
    false,
    "producer visibility should apply to the producer source scope",
  );
}

async function testRenderProducerTargetLayerUsesStoredLayerOrder() {
  const { canvas, service } = createCanvasServiceForRenderTests();

  await service.applyObjectSpecsToPass(
    "app.artwork",
    [rectSpec("artwork-scene")],
    { render: false, replace: true, scope: SCENE_RENDER_SCOPE },
  );
  service.syncPassStacking([
    { id: "app.background", order: 1 },
    { id: "app.artwork", order: 2 },
  ]);
  service.registerRenderProducer("pooder.kit.test", () => ({
    passes: [
      {
        id: "background.render",
        targetLayerId: "app.background",
        objects: [rectSpec("producer-background")],
      },
    ],
  }));
  await service.flushRenderFromProducers();

  assertDeepEqual(
    canvas.objects.map((obj) => obj.data.id),
    ["producer-background", "artwork-scene"],
    "producer output should follow caller-owned layer order",
  );
}

function testViewPaddingResolvesResponsively() {
  assertEqual(
    resolveViewPaddingPx("10%", 320, 480),
    32,
    "percentage padding should use the short side",
  );
  assertEqual(
    resolveViewPaddingPx(140, 320, 480),
    38.4,
    "fixed padding should shrink on compact canvases",
  );
  assertEqual(
    resolveViewPaddingPx("90%", 320, 480),
    80,
    "padding should preserve a minimum content area",
  );
  assertEqual(
    resolveViewPaddingPx("", 320, 480),
    0,
    "empty padding should be ignored",
  );
}

async function main() {
  testAttachAndDetach();
  testFailedLayoutRegistrationRollsBackCanvasService();
  testFailedSceneAdapterRegistrationRollsBackHostServices();
  await testFabricSceneAdapterSyncsCoreSceneToScopedPasses();
  await testRenderProducerTargetsCallerLayerWithoutReplacingSceneScope();
  await testRenderProducerVisibilityIsSourceScoped();
  await testRenderProducerTargetLayerUsesStoredLayerOrder();
  testViewPaddingResolvesResponsively();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
