import type { Service } from "@pooder/core";
import { Pooder, RENDER_INTENT_SERVICE, SCENE_SERVICE } from "@pooder/core";
import {
  attachBrowserHost,
  SCENE_EXPORT_SERVICE,
  BrowserSceneExportService,
  CANVAS_SERVICE,
  CanvasService,
  evaluateVisibilityExpr,
  FABRIC_SCENE_ADAPTER,
  FabricRenderGraphAdapter,
  FabricSceneAdapter,
  resolveViewPaddingPx,
  SCENE_RENDER_SCOPE,
  SCENE_LAYOUT_SERVICE,
} from "../src";
import type {
  CanvasPassStackingMeta,
  RenderObjectSpec,
  RenderPassSpec,
  VisibilityExpr,
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

function imagePlacementCommittedVisibility(slotId: string): VisibilityExpr {
  return {
    op: "not",
    expr: {
      op: "all",
      exprs: [
        { op: "sessionActive", toolId: "pooder.kit.image-placement" },
        {
          op: "contextTruthy",
          key: `pooder.kit.image-placement.image-placement.active-slot.${slotId}`,
        },
      ],
    },
  };
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

  async applyPassSpec(
    pass: {
      id: string;
      objects: RenderObjectSpec[];
      replace?: boolean;
    },
    options: { render?: boolean } = {},
  ) {
    this.passCalls.push({
      passId: pass.id,
      specs: pass.objects,
      options: { render: options.render, replace: pass.replace },
    });
  }

  syncPassStacking(passes: CanvasPassStackingMeta[]) {
    this.stackingCalls.push(passes.map((pass) => ({ ...pass })));
  }

  requestRenderAll() {
    this.renderCalls += 1;
  }
}

class FakeSceneLayoutService {}
class FakeBrowserSceneExportService {}
class FakeFabricSceneAdapter {}

class FakeFabricObject {
  data: Record<string, any> = {};
  type: string;
  visible = true;
  left = 0;
  top = 0;
  width = 1;
  height = 1;
  scaleX = 1;
  scaleY = 1;
  angle = 0;
  opacity = 1;
  excludeFromExport = false;
  selectable = false;
  evented = false;

  constructor(type: string, values: Record<string, any> = {}) {
    this.type = type;
    Object.assign(this, values);
  }

  set(values: Record<string, any>) {
    Object.assign(this, values);
  }

  async clone() {
    return new FakeFabricObject(this.type, {
      angle: this.angle,
      data: { ...this.data },
      excludeFromExport: this.excludeFromExport,
      height: this.height,
      left: this.left,
      opacity: this.opacity,
      scaleX: this.scaleX,
      scaleY: this.scaleY,
      top: this.top,
      visible: this.visible,
      width: this.width,
    });
  }

  getBoundingRect() {
    return {
      left: this.left - this.width / 2,
      top: this.top - this.height / 2,
      width: this.width,
      height: this.height,
    };
  }

  getCenterPoint() {
    return { x: this.left, y: this.top };
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
  service.visibilityContextValues = new Map();
  service.projectionHiddenSources = new Map();
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

function createExportServiceForTests(options: {
  layout?: {
    cutRect: { left: number; top: number; width: number; height: number };
    trimRect: { left: number; top: number; width: number; height: number };
    bleedRect: { left: number; top: number; width: number; height: number };
  } | null;
  objects: FakeFabricObject[];
}) {
  const exportCanvases: Array<{
    added: FakeFabricObject[];
    height: number;
    width: number;
    format?: string;
  }> = [];
  const service = new BrowserSceneExportService() as BrowserSceneExportService &
    any;

  service.canvasService = {
    canvas: {
      getObjects: () => options.objects,
    },
    flushRenderFromProducers: async () => {},
    getSceneScale: () => 2,
    toScenePoint: (point: { x: number; y: number }) => ({
      x: point.x / 2,
      y: point.y / 2,
    }),
    toSceneRect: (rect: {
      left: number;
      top: number;
      width: number;
      height: number;
    }) => ({
      left: rect.left / 2,
      top: rect.top / 2,
      width: rect.width / 2,
      height: rect.height / 2,
    }),
  };
  service.sceneLayoutService = {
    getLayout: () => options.layout ?? null,
  };
  service.createExportCanvas = (width: number, height: number) => {
    const record = {
      added: [] as FakeFabricObject[],
      height,
      width,
      format: undefined as string | undefined,
    };
    exportCanvases.push(record);
    return {
      add(object: FakeFabricObject) {
        record.added.push(object);
      },
      dispose() {},
      renderAll() {},
      setDimensions(size: { height: number; width: number }) {
        record.height = size.height;
        record.width = size.width;
      },
      toDataURL(args: { format: string }) {
        record.format = args.format;
        return `data:image/${args.format};base64,test`;
      },
    };
  };

  return { exportCanvases, service };
}

function testAttachAndDetach() {
  const { registered, runtime } = createRuntime();
  const canvasService = new FakeCanvasService();
  const sceneLayoutService = new FakeSceneLayoutService();
  const browserSceneExportService = new FakeBrowserSceneExportService();
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
    createBrowserSceneExportService: () => browserSceneExportService as any,
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
    attachment.browserSceneExportService ===
      (browserSceneExportService as any),
    "browser scene export service should be exposed",
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
    registered.get(SCENE_EXPORT_SERVICE) ===
      (browserSceneExportService as any),
    "browser scene export service should register",
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
    !registered.has(SCENE_EXPORT_SERVICE),
    "dispose should unregister the browser scene export service",
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
      createBrowserSceneExportService: () =>
        new FakeBrowserSceneExportService() as any,
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
      createBrowserSceneExportService: () =>
        new FakeBrowserSceneExportService() as any,
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
  assert(
    !registered.has(SCENE_EXPORT_SERVICE),
    "failed scene adapter attach should roll back browser scene export service",
  );
}

async function testBrowserSceneExportSelectedLayerWithSceneCrop() {
  const artwork = new FakeFabricObject("rect", {
    data: { id: "artwork-1", layerId: "app.artwork" },
    height: 30,
    left: 60,
    top: 80,
    width: 20,
  });
  const hidden = new FakeFabricObject("rect", {
    data: { id: "hidden", layerId: "app.artwork" },
    visible: false,
  });
  const background = new FakeFabricObject("rect", {
    data: { id: "background", layerId: "app.background" },
  });
  const { exportCanvases, service } = createExportServiceForTests({
    layout: null,
    objects: [background, hidden, artwork],
  });

  const result = await service.exportImage({
    crop: {
      type: "sceneRect",
      rect: { left: 10, top: 20, width: 50, height: 40 },
    },
    format: "jpeg",
    multiplier: 3,
    sourceLayerIds: ["app.artwork"],
  });

  assertEqual(
    result.url,
    "data:image/jpeg;base64,test",
    "export should return data url",
  );
  assertEqual(result.width, 150, "scene crop width should scale by multiplier");
  assertEqual(result.height, 120, "scene crop height should scale by multiplier");
  assertDeepEqual(
    result.sourceLayerIds,
    ["app.artwork"],
    "export should report selected source layers",
  );
  assertDeepEqual(
    exportCanvases[0]?.added.map((object) => object.data.id),
    ["artwork-1"],
    "export should include visible objects from selected layers only",
  );
  assertEqual(
    exportCanvases[0]?.added[0]?.left,
    60,
    "exported object should be translated into crop coordinates",
  );
}

async function testBrowserSceneExportElementBoundsCrop() {
  const first = new FakeFabricObject("rect", {
    data: { id: "first", layerId: "app.artwork", sceneElementId: "scene-a" },
    height: 20,
    left: 20,
    top: 30,
    width: 20,
  });
  const second = new FakeFabricObject("rect", {
    data: { id: "second", layerId: "app.artwork", sceneElementId: "scene-b" },
    height: 10,
    left: 70,
    top: 40,
    width: 10,
  });
  const { service } = createExportServiceForTests({
    layout: null,
    objects: [first, second],
  });

  const result = await service.exportImage({
    crop: { type: "elementBounds" },
    multiplier: 2,
    sourceElementIds: ["scene-a", "scene-b"],
  });

  assertDeepEqual(
    result.crop,
    { left: 5, top: 10, width: 32.5, height: 12.5 },
    "element bounds crop should be resolved in scene coordinates",
  );
  assertDeepEqual(
    result.sourceElementIds,
    ["scene-a", "scene-b"],
    "export should report selected source elements",
  );
}

async function testBrowserSceneExportFrameCrop() {
  const object = new FakeFabricObject("rect", {
    data: { id: "frame-object", layerId: "app.artwork" },
  });
  const { service } = createExportServiceForTests({
    layout: {
      bleedRect: { left: 0, top: 0, width: 240, height: 180 },
      cutRect: { left: 20, top: 30, width: 200, height: 100 },
      trimRect: { left: 40, top: 50, width: 120, height: 80 },
    },
    objects: [object],
  });

  const result = await service.exportImage({
    crop: { type: "frame", frame: "trim" },
    multiplier: 1,
  });

  assertDeepEqual(
    result.crop,
    { left: 20, top: 25, width: 60, height: 40 },
    "frame crop should resolve through SceneLayoutService and scene coordinates",
  );
  assertEqual(result.width, 60, "frame crop width should be exported");
  assertEqual(result.height, 40, "frame crop height should be exported");
}

async function testFabricRenderGraphAdapterUsesSlotFrameForCommittedImages() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  const adapter = new FabricRenderGraphAdapter();

  runtime.services.register(canvasService as any, CANVAS_SERVICE);
  runtime.services.register(adapter);
  await adapter.flush();
  canvasService.passCalls = [];

  const renderIntentService = runtime.services.getOrThrow(RENDER_INTENT_SERVICE);
  renderIntentService.setDocumentIntents([
    {
      id: "slot",
      subject: {
        kind: "object",
        surfaceId: "front",
        layerId: "artwork",
        objectId: "slot",
        objectType: "image",
      },
      visual: {
        type: "image",
        replacement: {
          src: "data:image/png;base64,cropped-slot",
          metadata: {
            width: 400,
            height: 320,
            sourceSrc: "/photo.png",
            sourceTransform: {
              left: 0.6,
              top: 0.4,
              scale: 1.3,
              angle: 22,
              opacity: 1,
            },
          },
        },
      },
      placement: {
        frame: { x: 100, y: 120, width: 200, height: 160 },
      },
      props: {
        originX: "center",
        originY: "center",
      },
      ordering: {
        layerId: "artwork",
        objectOrder: 10,
      },
      export: {
        visibility: imagePlacementCommittedVisibility("slot"),
      },
      interaction: {
        imagePlacement: {
          enabled: true,
          slotId: "slot",
          image: {
            src: "data:image/png;base64,cropped-slot",
            left: 0.5,
            top: 0.5,
            scale: 1,
            angle: 0,
            metadata: {
              sourceSrc: "/photo.png",
              sourceTransform: {
                left: 0.6,
                top: 0.4,
                scale: 1.3,
                angle: 22,
                opacity: 1,
              },
            },
          },
        },
      },
    },
  ]);
  await adapter.flush();

  const artworkPass = canvasService.passCalls.find(
    (call) => call.passId === "artwork",
  );
  assert(artworkPass, "render graph layer should sync to a canvas pass");

  const imageSpec = artworkPass.specs.find((spec) => spec.id === "image:slot");
  assert(imageSpec, "committed replacement image should render as image:slot");
  assertEqual(
    imageSpec.props.left,
    200,
    "committed image should be centered in the slot frame, not use editable source x",
  );
  assertEqual(
    imageSpec.props.top,
    200,
    "committed image should be centered in the slot frame, not use editable source y",
  );
  assertEqual(
    imageSpec.props.originX,
    "center",
    "committed image should render from its center",
  );
  assertEqual(
    imageSpec.props.originY,
    "center",
    "committed image should render from its center",
  );
  assertEqual(
    imageSpec.props.scaleX,
    0.5,
    "committed image should scale cropped bitmap width into the slot frame",
  );
  assertEqual(
    imageSpec.props.scaleY,
    0.5,
    "committed image should scale cropped bitmap height into the slot frame",
  );
  assert(
    imageSpec.props.angle === undefined,
    "committed image should not reuse editable source rotation",
  );
  assertEqual(
    imageSpec.props.selectable,
    false,
    "committed image should not remain directly editable after session commit",
  );
  assertEqual(
    imageSpec.props.evented,
    true,
    "committed image should still receive clicks for reopening the image session",
  );
  assertDeepEqual(
    imageSpec.visibility,
    imagePlacementCommittedVisibility("slot"),
    "committed image should carry its declarative session visibility",
  );
  assertDeepEqual(
    {
      slotId: imageSpec.data?.slotId,
      source: imageSpec.data?.source,
      type: imageSpec.data?.type,
    },
    {
      slotId: "slot",
      source: "committed",
      type: "image-placement-image",
    },
    "committed image should preserve the image-placement interaction contract",
  );

  await runtime.dispose();
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

async function testFabricSceneAdapterStacksDocumentOverlayAboveManagedImages() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  const adapter = new FabricSceneAdapter();

  runtime.services.register(canvasService as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_SCENE_ADAPTER);
  await adapter.flush();
  canvasService.stackingCalls = [];

  const scene = runtime.services.getOrThrow(SCENE_SERVICE);
  scene.transaction(() => {
    scene.addLayer({ id: "front.image.user", order: 10, metadata: { documentLayerRole: "content" } });
    scene.addLayer({ id: "front.template-overlay", order: 20, metadata: { documentLayerRole: "overlay" } });
  });

  await adapter.flush();

  assertDeepEqual(
    canvasService.stackingCalls[canvasService.stackingCalls.length - 1],
    [
      { id: "front.image.user", stack: 0, order: 10 },
      { id: "front.template-overlay", stack: 780, order: 20 },
    ],
    "document overlay layers should stack above image placement producer output",
  );

  await runtime.dispose();
}

async function testFabricSceneAdapterMapsSceneElementContracts() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  const adapter = new FabricSceneAdapter();

  runtime.services.register(canvasService as any, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_SCENE_ADAPTER);
  await adapter.flush();
  canvasService.passCalls = [];

  const scene = runtime.services.getOrThrow(SCENE_SERVICE);
  scene.transaction(() => {
    scene.addLayer({ id: "primary", order: 2 });
    scene.addLayer({ id: "overlay", order: 1, visible: false });
    scene.addElement({
      id: "image",
      layerId: "primary",
      type: "image",
      src: "image.png",
      width: 120,
      height: 80,
      order: 1,
      metadata: { source: "contract" },
      data: { role: "artwork" },
      transform: { left: 10, top: 20, angle: 15 },
    });
    scene.addElement({
      id: "path",
      layerId: "primary",
      type: "path",
      path: "M0 0 L10 10",
      order: 2,
      style: { stroke: "#111111" },
    });
    scene.addElement({
      id: "rect",
      layerId: "primary",
      type: "rect",
      width: 30,
      height: 40,
      order: 3,
      visible: false,
    });
    scene.addElement({
      id: "text",
      layerId: "overlay",
      type: "text",
      text: "Hidden",
      order: 1,
    });
  });

  await adapter.flush();

  const primaryPass = canvasService.passCalls.find(
    (call) => call.passId === "primary",
  );
  const overlayPass = canvasService.passCalls.find(
    (call) => call.passId === "overlay",
  );
  assert(primaryPass, "primary layer should sync");
  assert(overlayPass, "overlay layer should sync");
  assertDeepEqual(
    primaryPass.specs.map((spec) => spec.id),
    ["image", "path", "rect"],
    "scene elements should sync in element order",
  );

  const specs = new Map(primaryPass.specs.map((spec) => [spec.id, spec]));
  assertEqual(
    specs.get("image")?.src,
    "image.png",
    "image element src should map to render spec",
  );
  assertEqual(
    specs.get("image")?.props.width,
    120,
    "image element width should map to render props",
  );
  assertEqual(
    specs.get("image")?.props.angle,
    15,
    "image transform should map to render props",
  );
  assertDeepEqual(
    specs.get("image")?.data,
    {
      role: "artwork",
      sceneElementId: "image",
      sceneLayerId: "primary",
      sceneMetadata: { source: "contract" },
    },
    "scene element data and metadata should map to render data",
  );
  assertEqual(
    specs.get("path")?.props.path,
    "M0 0 L10 10",
    "path element data should map to render props",
  );
  assertEqual(
    specs.get("path")?.props.stroke,
    "#111111",
    "path style should map to render props",
  );
  assertEqual(
    specs.get("rect")?.props.visible,
    false,
    "hidden scene elements should sync as invisible",
  );
  assertEqual(
    overlayPass.specs[0]?.props.text,
    "Hidden",
    "text element content should map to render props",
  );
  assertEqual(
    overlayPass.specs[0]?.props.visible,
    false,
    "hidden scene layers should sync contained elements as invisible",
  );

  canvasService.passCalls = [];
  scene.updateElement("image", { src: "updated.png", width: 140 });
  scene.removeElement("path");
  await adapter.flush();

  const updatedPrimaryPass = canvasService.passCalls.find(
    (call) => call.passId === "primary",
  );
  assert(updatedPrimaryPass, "updated primary layer should sync");
  assertDeepEqual(
    updatedPrimaryPass.specs.map((spec) => spec.id),
    ["image", "rect"],
    "removed scene elements should be omitted from the next scoped pass",
  );
  assertEqual(
    updatedPrimaryPass.specs[0]?.src,
    "updated.png",
    "updated image src should sync",
  );
  assertEqual(
    updatedPrimaryPass.specs[0]?.props.width,
    140,
    "updated image width should sync",
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

async function testSceneStackingKeepsSessionPassAboveBusinessLayers() {
  const { canvas, service } = createCanvasServiceForRenderTests();
  let sessionObjects = [rectSpec("session-image")];

  await service.applyObjectSpecsToPass(
    "front.image.user",
    [rectSpec("business-image")],
    { render: false, replace: true, scope: SCENE_RENDER_SCOPE },
  );
  await service.applyObjectSpecsToPass(
    "front.template-overlay",
    [rectSpec("frame-overlay")],
    { render: false, replace: true, scope: SCENE_RENDER_SCOPE },
  );
  service.registerRenderProducer("pooder.kit.image-placement", () => ({
    passes: [
      {
        id: "image.user.session",
        stack: 800,
        order: 0,
        objects: sessionObjects,
      },
    ],
  }));
  await service.flushRenderFromProducers();

  service.syncPassStacking([
    { id: "front.image.user", stack: 0, order: 10 },
    { id: "front.template-overlay", stack: 780, order: 20 },
  ]);

  const stackedIds = canvas.objects.map((obj) => obj.data.id);
  assert(
    stackedIds.indexOf("business-image") < stackedIds.indexOf("frame-overlay"),
    "business image layer should stay below template overlay",
  );
  assert(
    stackedIds.indexOf("frame-overlay") < stackedIds.indexOf("session-image"),
    "framework session image should stay above all business layers",
  );

  sessionObjects = [];
  await service.flushRenderFromProducers();

  assert(
    !canvas.objects.some((obj) => obj.data.id === "session-image"),
    "empty session producer pass should clear framework session objects",
  );
}

async function testRenderProducerProjectionClonesBusinessObjects() {
  const { canvas, service } = createCanvasServiceForRenderTests();
  let projections: RenderPassSpec["projections"] = [
    {
      id: "template-overlay",
      sourceElementIds: ["front.template.normal"],
      opacity: 0.5,
    },
  ];
  let visible = false;

  await service.applyObjectSpecsToPass(
    "front.template-overlay",
    [
      rectSpec(
        "template-source",
        {
          evented: true,
          opacity: 0.6,
          selectable: true,
        },
        {
          sceneElementId: "front.template.normal",
          sceneLayerId: "front.template-overlay",
        },
      ),
    ],
    { render: false, replace: true, scope: SCENE_RENDER_SCOPE },
  );
  service.registerRenderProducer("pooder.kit.image-placement", () => ({
    passes: [
      {
        id: "image.user.session.overlay",
        stack: 800,
        order: 2,
        visibility: { op: "const", value: visible },
        projections,
        objects: [],
      },
    ],
  }));
  await service.flushRenderFromProducers();

  const source = canvas.objects.find((obj) => obj.data.id === "template-source");
  assert(source, "projection source should remain in the business pass");
  assertEqual(
    source.visible,
    true,
    "inactive projection pass should not hide its source",
  );
  assert(
    !canvas.objects.some(
      (obj) => obj.data.id === "projection:template-overlay:front.template.normal",
    ),
    "inactive projection pass should not render a clone",
  );

  visible = true;
  await service.flushRenderFromProducers();

  const clone = canvas.objects.find(
    (obj) => obj.data.id === "projection:template-overlay:front.template.normal",
  );
  assert(clone, "projection clone should render into the session pass");
  assertEqual(source.visible, false, "active projection should hide its source");
  assertEqual(
    clone?.data.passId,
    "image.user.session.overlay",
    "projection clone should target the session pass",
  );
  assertEqual(clone?.selectable, false, "projection clone should be non-selectable");
  assertEqual(clone?.evented, false, "projection clone should be non-evented");
  assertEqual(
    clone?.excludeFromExport,
    true,
    "projection clone should be excluded from export",
  );
  assertEqual(clone?.opacity, 0.3, "projection opacity should multiply source opacity");

  projections = [];
  await service.flushRenderFromProducers();

  assertEqual(
    source.visible,
    true,
    "cleared projection should restore source visibility",
  );
  assert(
    !canvas.objects.some((obj) => obj.data.id === clone?.data.id),
    "cleared projection should remove the session clone",
  );
}

async function testSessionProjectionAboveStacksOverSessionImage() {
  const { canvas, service } = createCanvasServiceForRenderTests();

  await service.applyObjectSpecsToPass(
    "front.image.user",
    [
      rectSpec(
        "business-image",
        {},
        {
          sceneElementId: "front.image.user",
          sceneLayerId: "front.image.user",
        },
      ),
    ],
    { render: false, replace: true, scope: SCENE_RENDER_SCOPE },
  );
  await service.applyObjectSpecsToPass(
    "front.template-overlay",
    [
      rectSpec(
        "template-overlay-source",
        {},
        {
          sceneElementId: "front.template.normal",
          sceneLayerId: "front.template-overlay",
        },
      ),
    ],
    { render: false, replace: true, scope: SCENE_RENDER_SCOPE },
  );
  service.syncPassStacking([
    { id: "front.image.user", stack: 0, order: 10 },
    { id: "front.template-overlay", stack: 780, order: 20 },
  ]);
  service.registerRenderProducer("pooder.kit.image-placement", () => ({
    passes: [
      {
        id: "image.user.session.image",
        stack: 800,
        order: 1,
        visibility: { op: "const", value: true },
        objects: [rectSpec("session-image")],
      },
      {
        id: "image.user.session.overlay",
        stack: 800,
        order: 2,
        visibility: { op: "const", value: true },
        projections: [
          {
            id: "template-overlay",
            sourceLayerIds: ["front.template-overlay"],
            hideSource: true,
          },
        ],
        objects: [],
      },
    ],
  }));

  await service.flushRenderFromProducers();

  const stackedIds = canvas.objects.map((obj) => obj.data.id);
  assert(
    stackedIds.indexOf("session-image") <
      stackedIds.indexOf("projection:template-overlay:front.template.normal"),
    "above session projection should stack over the working image",
  );
}

async function testRenderObjectsAreNonInteractiveByDefault() {
  const { canvas, service } = createCanvasServiceForRenderTests();

  await service.applyObjectSpecsToPass(
    "app.artwork",
    [
      rectSpec("plain"),
      rectSpec("interactive", {
        evented: true,
        selectable: true,
      }),
    ],
    { render: false, replace: true, scope: SCENE_RENDER_SCOPE },
  );

  const plain = canvas.objects.find((obj) => obj.data.id === "plain");
  const interactive = canvas.objects.find(
    (obj) => obj.data.id === "interactive",
  );

  assert(plain, "plain object should render");
  assert(interactive, "interactive object should render");
  assertEqual(
    plain.selectable,
    false,
    "render objects should not be selectable by default",
  );
  assertEqual(
    plain.evented,
    false,
    "render objects should not receive events by default",
  );
  assertEqual(
    interactive.selectable,
    true,
    "capability-owned specs should be able to opt into selection",
  );
  assertEqual(
    interactive.evented,
    true,
    "capability-owned specs should be able to opt into events",
  );
}

async function testRenderObjectVisibilityUsesSessionExpressions() {
  const { canvas, service } = createCanvasServiceForRenderTests();
  let activeSessionId: string | null = null;
  (service as any).toolSessionService = {
    getState: (toolId: string) => ({
      id: toolId,
      status: toolId === activeSessionId ? "active" : "idle",
      dirty: false,
    }),
    hasAnyActiveSession: () => activeSessionId !== null,
  };

  await service.applyObjectSpecsToPass(
    "app.artwork",
    [
      rectSpec("committed-image", {}, {
        slotId: "slot",
      }),
      rectSpec("other-committed-image", {}, {
        slotId: "other-slot",
      }),
    ].map((spec) => ({
      ...spec,
      visibility: {
        op: "not" as const,
        expr: {
          op: "all" as const,
          exprs: [
            { op: "sessionActive" as const, toolId: "pooder.kit.image" },
            {
              op: "contextTruthy" as const,
              key: `pooder.kit.image.active-slot.${(spec.data as any).slotId}`,
            },
          ],
        },
      },
    })),
    { render: false, replace: true, scope: SCENE_RENDER_SCOPE },
  );

  const object = canvas.objects.find((obj) => obj.data.id === "committed-image");
  const otherObject = canvas.objects.find(
    (obj) => obj.data.id === "other-committed-image",
  );
  assert(object, "visibility-gated object should render");
  assert(otherObject, "other visibility-gated object should render");
  assertEqual(
    object.visible,
    true,
    "committed image should be visible outside the image session",
  );

  activeSessionId = "pooder.kit.image";
  service.setVisibilityContextValue("pooder.kit.image.active-slot.slot", true, {
    render: false,
  });
  (service as any).refreshManagedVisibility({ render: false });
  assertEqual(
    object.visible,
    false,
    "committed image should hide while its image session slot is active",
  );
  assertEqual(
    otherObject.visible,
    true,
    "other committed images should remain visible while another slot is active",
  );

  service.deleteVisibilityContextValue("pooder.kit.image.active-slot.slot", {
    render: false,
  });
  (service as any).refreshManagedVisibility({ render: false });
  assertEqual(
    object.visible,
    true,
    "committed image should stay visible when the image session belongs to another slot",
  );

  activeSessionId = null;
  (service as any).refreshManagedVisibility({ render: false });
  assertEqual(
    object.visible,
    true,
    "committed image should reappear after the image session ends",
  );
}

function testVisibilityDslSupportsWorkflowAndContextPredicates() {
  const context = {
    contextValues: new Map<string, unknown>([
      ["workflow.mode", "image-edit"],
      ["toolbar.visible", true],
    ]),
    hasAnyActiveWorkflowSession: () => true,
    isWorkflowSessionActive: (workflowId: string) =>
      workflowId === "app.image-edit",
    layers: new Map<string, { exists: boolean; objectCount: number }>(),
  };

  assert(
    evaluateVisibilityExpr(
      { op: "contextEquals", key: "workflow.mode", value: "image-edit" },
      context,
    ) === true,
    "contextEquals true failed",
  );
  assert(
    evaluateVisibilityExpr(
      { op: "contextTruthy", key: "toolbar.visible" },
      context,
    ) === true,
    "contextTruthy true failed",
  );
  assert(
    evaluateVisibilityExpr(
      { op: "workflowSessionActive", workflowId: "app.image-edit" },
      context,
    ) === true,
    "workflowSessionActive true failed",
  );
  assert(
    evaluateVisibilityExpr({ op: "anyWorkflowSessionActive" }, context) ===
      true,
    "anyWorkflowSessionActive true failed",
  );
  assert(
    evaluateVisibilityExpr(
      { op: "workflowSessionActive", workflowId: "pooder.kit.image" },
      context,
    ) === false,
    "workflowSessionActive false failed",
  );
}

async function testRenderProducerVisibilityUsesContextValues() {
  const { canvas, service } = createCanvasServiceForRenderTests();

  service.registerRenderProducer("pooder.kit.test", () => ({
    passes: [
      {
        id: "context.render",
        visibility: {
          op: "contextEquals",
          key: "workflow.mode",
          value: "image-edit",
        },
        objects: [rectSpec("context-rect")],
      },
    ],
  }));
  await service.flushRenderFromProducers();

  const object = canvas.objects.find((obj) => obj.data.id === "context-rect");
  assert(object, "context-gated object should render");
  assertEqual(
    object.visible,
    false,
    "missing visibility context value should hide producer output",
  );

  service.setVisibilityContextValue("workflow.mode", "image-edit", {
    render: false,
  });
  assertEqual(
    object.visible,
    true,
    "matching visibility context value should show producer output",
  );

  service.deleteVisibilityContextValue("workflow.mode", { render: false });
  assertEqual(
    object.visible,
    false,
    "deleted visibility context value should hide producer output",
  );
}

async function testRenderProducerVisibilityUsesWorkflowSessions() {
  const { canvas, service } = createCanvasServiceForRenderTests();
  let activeWorkflowId: string | null = null;
  (service as any).workflowSessionService = {
    hasActiveSession: (workflowId: string) => workflowId === activeWorkflowId,
    hasAnyActiveSession: () => activeWorkflowId !== null,
  };

  service.registerRenderProducer("pooder.kit.test", () => ({
    passes: [
      {
        id: "workflow.render",
        visibility: {
          op: "workflowSessionActive",
          workflowId: "app.image-edit",
        },
        objects: [rectSpec("workflow-rect")],
      },
    ],
  }));
  await service.flushRenderFromProducers();

  const object = canvas.objects.find((obj) => obj.data.id === "workflow-rect");
  assert(object, "workflow-gated object should render");
  assertEqual(
    object.visible,
    false,
    "inactive workflow session should hide producer output",
  );

  activeWorkflowId = "app.image-edit";
  await service.flushRenderFromProducers();
  assertEqual(
    object.visible,
    true,
    "active workflow session should show producer output",
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

async function testClipPathEffectTargetsMatchingElementsOnly() {
  const { canvas, service } = createCanvasServiceForRenderTests();

  service.registerRenderProducer("pooder.kit.test", () => ({
    passes: [
      {
        id: "artwork.render",
        targetLayerId: "app.artwork",
        objects: [
          rectSpec("first", {}, { sceneElementId: "scene-a" }),
          rectSpec("second", {}, { sceneElementId: "scene-b" }),
        ],
        effects: [
          {
            type: "clipPath",
            source: {
              id: "clip-source",
              type: "path",
              space: "scene",
              props: { pathData: "M 0 0 L 10 0 L 10 10 Z" },
            },
            targetPassIds: ["app.artwork"],
            targetElementIds: ["scene-a"],
          },
        ],
      },
    ],
  }));
  await service.flushRenderFromProducers();

  const first = canvas.objects.find((object) => object.data.id === "first") as any;
  const second = canvas.objects.find((object) => object.data.id === "second") as any;

  assert(first?.clipPath, "matching scene element should receive a clipPath");
  assert(!second?.clipPath, "non-matching scene element should not be clipped");
}

async function testClipPathEffectKeepsLegacyPassLevelBehavior() {
  const { canvas, service } = createCanvasServiceForRenderTests();

  service.registerRenderProducer("pooder.kit.test", () => ({
    passes: [
      {
        id: "artwork.render",
        targetLayerId: "app.artwork",
        objects: [rectSpec("first"), rectSpec("second")],
        effects: [
          {
            type: "clipPath",
            source: {
              id: "clip-source",
              type: "path",
              space: "scene",
              props: { pathData: "M 0 0 L 10 0 L 10 10 Z" },
            },
            targetPassIds: ["app.artwork"],
          },
        ],
      },
    ],
  }));
  await service.flushRenderFromProducers();

  const first = canvas.objects.find((object) => object.data.id === "first") as any;
  const second = canvas.objects.find((object) => object.data.id === "second") as any;

  assert(first?.clipPath, "legacy pass-level clip should apply to first object");
  assert(second?.clipPath, "legacy pass-level clip should apply to second object");
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
  await testBrowserSceneExportSelectedLayerWithSceneCrop();
  await testBrowserSceneExportElementBoundsCrop();
  await testBrowserSceneExportFrameCrop();
  await testFabricRenderGraphAdapterUsesSlotFrameForCommittedImages();
  await testFabricSceneAdapterSyncsCoreSceneToScopedPasses();
  await testFabricSceneAdapterStacksDocumentOverlayAboveManagedImages();
  await testFabricSceneAdapterMapsSceneElementContracts();
  await testRenderProducerTargetsCallerLayerWithoutReplacingSceneScope();
  await testRenderProducerVisibilityIsSourceScoped();
  await testSceneStackingKeepsSessionPassAboveBusinessLayers();
  await testRenderProducerProjectionClonesBusinessObjects();
  await testSessionProjectionAboveStacksOverSessionImage();
  await testRenderObjectsAreNonInteractiveByDefault();
  await testRenderObjectVisibilityUsesSessionExpressions();
  testVisibilityDslSupportsWorkflowAndContextPredicates();
  await testRenderProducerVisibilityUsesContextValues();
  await testRenderProducerVisibilityUsesWorkflowSessions();
  await testRenderProducerTargetLayerUsesStoredLayerOrder();
  await testClipPathEffectTargetsMatchingElementsOnly();
  await testClipPathEffectKeepsLegacyPassLevelBehavior();
  testViewPaddingResolvesResponsively();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
