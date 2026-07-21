import {
  CAPABILITY_REGISTRY_SERVICE,
  COMMAND_SERVICE,
  CONSTRAINT_RESOLVER_SERVICE,
  EventBus,
  GEOMETRY_SOURCE_SERVICE,
  INTERACTION_SERVICE,
  Pooder,
  RENDER_INTENT_SERVICE,
  SCENE_SERVICE,
  SESSION_SERVICE,
  computeSceneLayout,
  computeDragInteraction,
  containsPoint,
  containsRect,
  coordinateMatrix,
  createStaticGeometrySource,
  ConstraintResolverService,
  DefaultSurfaceFrameService,
  GeometrySourceService,
  createRectSnapLines,
  intersectRects,
  mergeRenderIntentPatchDraft,
  normalizeRect,
  projectRectIntoRect,
  readSizeState,
  resolveImageGeometry,
  resolveImageFitScale,
  resolveViewPaddingPx,
  createServiceToken,
  type CanvasService,
  type ExtensionDefinition,
  type InteractionService,
  type RenderIntentChangeEvent,
  type RenderIntentService,
  type SceneChangeEvent,
  type SceneService,
  type Service,
  type SessionChangeEvent,
  type SessionService,
  SessionConflictError,
} from "../src";

declare const process: {
  exit(code: number): never;
};

class DeferredDependencyService implements Service {}

const REQUIRED_SERVICE = createServiceToken<DeferredDependencyService>(
  "DeferredDependencyService",
);

class FakeLayoutCanvasService implements CanvasService {
  private readonly width: number;
  private readonly height: number;

  constructor(width = 800, height = 600) {
    this.width = width;
    this.height = height;
  }

  on() {
    return { dispose() {} };
  }

  requestRenderAll() {}
  resize() {}
  getViewportSize() {
    return { width: this.width, height: this.height };
  }
  updateViewportLayout(options: {
    containerWidth: number;
    containerHeight: number;
    padding: number;
    widthMm: number;
    heightMm: number;
    offsetX?: number;
    offsetY?: number;
  }) {
    const availableWidth = Math.max(
      0,
      options.containerWidth - options.padding * 2,
    );
    const availableHeight = Math.max(
      0,
      options.containerHeight - options.padding * 2,
    );
    const scale = Math.min(
      availableWidth / options.widthMm,
      availableHeight / options.heightMm,
    );
    const width = options.widthMm * scale;
    const height = options.heightMm * scale;
    return {
      scale,
      offsetX: Number.isFinite(options.offsetX)
        ? Number(options.offsetX)
        : (options.containerWidth - width) / 2,
      offsetY: Number.isFinite(options.offsetY)
        ? Number(options.offsetY)
        : (options.containerHeight - height) / 2,
      width,
      height,
    };
  }
  setViewportLayout() {}
  selectObjects() {
    return [];
  }
  selectOneObject() {
    return undefined;
  }
  getActiveObject() {
    return undefined;
  }
  setActiveObject() {
    return false;
  }
  discardActiveObject() {
    return false;
  }
  onCanvasEvent() {}
  offCanvasEvent() {}
  getTopContext() {
    return undefined;
  }
  clearTopContext() {}
  getSceneScale() {
    return 1;
  }
  getSceneOffset() {
    return { x: 0, y: 0 };
  }
  toScreenPoint(point: { x: number; y: number }) {
    return point;
  }
  toScenePoint(point: { x: number; y: number }) {
    return point;
  }
  toScreenLength(value: number) {
    return value;
  }
  toSceneLength(value: number) {
    return value;
  }
  toScreenRect(rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  }) {
    return rect;
  }
  toSceneRect(rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  }) {
    return rect;
  }
  getSceneViewportRect() {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
  getScreenViewportRect() {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
  async loadImageSize() {
    return null;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(
      message ?? `Expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message?: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      message ??
        `Expected ${expectedJson ?? String(expected)}, got ${actualJson ?? String(actual)}`,
    );
  }
}

function assertClose(
  actual: number,
  expected: number,
  message?: string,
  epsilon = 0.000001,
) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(
      message ?? `Expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

function computeTestSceneLayout(canvas: FakeLayoutCanvasService, state: any) {
  return computeSceneLayout({
    frames: state.sceneFrames,
    fitOptions: { viewPadding: state.viewPadding ?? "16%" },
    viewportSize: canvas.getViewportSize(),
  });
}

function assertThrows(run: () => void, message: string) {
  try {
    run();
  } catch (error) {
    assertEqual((error as Error).message, message);
    return;
  }

  throw new Error(`Expected error: ${message}`);
}

function createCommandExtension(
  id: string,
  commandId: string,
  value: string,
  options: {
    activation?: ExtensionDefinition["activation"];
    onActivate?: () => void;
    contribute?: ExtensionDefinition["contribute"];
  } = {},
): ExtensionDefinition {
  return {
    id,
    activation: options.activation,
    contribute:
      options.contribute ??
      (() => ({
        commands: [
          {
            id: commandId,
            command: commandId,
            title: commandId,
            handler: () => value,
          },
        ],
      })),
    activate() {
      options.onActivate?.();
    },
  };
}

async function withRuntime(run: (runtime: Pooder) => Promise<void>) {
  const runtime = new Pooder();
  try {
    await run(runtime);
  } finally {
    await runtime.dispose();
  }
}

async function testOutOfOrderActivation() {
  await withRuntime(async (runtime) => {
    const activationOrder: string[] = [];
    const alpha = createCommandExtension("alpha", "alpha.command", "alpha", {
      onActivate: () => activationOrder.push("alpha"),
    });
    const beta = createCommandExtension("beta", "beta.command", "beta", {
      activation: {
        requiresExtensions: ["alpha"],
        after: ["alpha"],
      },
      onActivate: () => activationOrder.push("beta"),
    });

    runtime.extensions.register(beta);
    runtime.extensions.register(alpha);

    assertEqual(
      runtime.services.getOrThrow(COMMAND_SERVICE).getCommand("beta.command"),
      undefined,
    );

    await runtime.extensions.flushActivation();

    assertDeepEqual(activationOrder, ["alpha", "beta"]);
    assertEqual(runtime.extensions.getState("alpha")?.state, "active");
    assertEqual(runtime.extensions.getState("beta")?.state, "active");
    assertEqual(await runtime.commands.execute("beta.command"), "beta");
  });
}

async function testPendingUntilRequiredServiceArrives() {
  await withRuntime(async (runtime) => {
    let activations = 0;
    runtime.extensions.register(
      createCommandExtension(
        "dependent-service",
        "dependent.command",
        "ready",
        {
          activation: {
            requiresServices: [REQUIRED_SERVICE],
          },
          onActivate: () => {
            activations += 1;
          },
        },
      ),
    );

    await runtime.extensions.flushActivation();

    assertDeepEqual(runtime.extensions.getState("dependent-service"), {
      id: "dependent-service",
      state: "pending",
      reason: "missing-required-services",
      message: undefined,
      missingExtensions: undefined,
      missingServices: [REQUIRED_SERVICE.name],
      waitingFor: undefined,
      cycle: undefined,
    });
    assertEqual(
      runtime.services
        .getOrThrow(COMMAND_SERVICE)
        .getCommand("dependent.command"),
      undefined,
    );

    runtime.services.register(
      new DeferredDependencyService(),
      REQUIRED_SERVICE,
    );
    await runtime.extensions.flushActivation();

    assertEqual(activations, 1);
    assertEqual(
      runtime.extensions.getState("dependent-service")?.state,
      "active",
    );
    assertEqual(await runtime.commands.execute("dependent.command"), "ready");
  });
}

async function testCycleDetection() {
  await withRuntime(async (runtime) => {
    runtime.extensions.register(
      createCommandExtension("cycle-a", "cycle.a", "a", {
        activation: { requiresExtensions: ["cycle-b"] },
      }),
    );
    runtime.extensions.register(
      createCommandExtension("cycle-b", "cycle.b", "b", {
        activation: { requiresExtensions: ["cycle-a"] },
      }),
    );

    await runtime.extensions.flushActivation();

    const cycleA = runtime.extensions.getState("cycle-a");
    const cycleB = runtime.extensions.getState("cycle-b");
    assertEqual(cycleA?.state, "failed");
    assertEqual(cycleB?.state, "failed");
    assertEqual(cycleA?.reason, "cycle-detected");
    assertDeepEqual(cycleA?.cycle, ["cycle-a", "cycle-b"]);
    assertEqual(
      runtime.services.getOrThrow(COMMAND_SERVICE).getCommand("cycle.a"),
      undefined,
    );
  });
}

async function testActivationFailureDoesNotLeakDynamicContributions() {
  await withRuntime(async (runtime) => {
    const activationOrder: string[] = [];
    let capabilityRegistrations = 0;
    let capabilityUnregistrations = 0;
    const good = createCommandExtension("good", "good.command", "good", {
      onActivate: () => activationOrder.push("good"),
    });

    const bad: ExtensionDefinition = {
      id: "bad",
      contribute() {
        return {
          capabilities: [
            {
              id: "bad.capability",
              onRegister: () => {
                capabilityRegistrations += 1;
              },
              onUnregister: () => {
                capabilityUnregistrations += 1;
              },
            },
            {
              id: "bad.capability",
            },
          ],
          commands: [
            {
              id: "bad.command",
              command: "bad.command",
              title: "bad.command",
              handler: () => "bad",
            },
          ],
        };
      },
      activate() {
        activationOrder.push("bad");
      },
    };

    runtime.extensions.registerMany([bad, good]);
    await runtime.extensions.flushActivation();

    assertDeepEqual(activationOrder, ["bad", "good"]);
    assertEqual(runtime.extensions.getState("bad")?.state, "failed");
    assertEqual(runtime.extensions.getState("good")?.state, "active");
    assertEqual(capabilityRegistrations, 1);
    assertEqual(capabilityUnregistrations, 1);
    assertEqual(
      runtime.services
        .getOrThrow(CAPABILITY_REGISTRY_SERVICE)
        .hasCapability("bad.capability"),
      false,
    );
    assertEqual(
      runtime.services.getOrThrow(COMMAND_SERVICE).getCommand("bad.command"),
      undefined,
    );
    assertEqual(await runtime.commands.execute("good.command"), "good");
  });
}

async function testCapabilityContributionWithoutTool() {
  await withRuntime(async (runtime) => {
    const facade = {
      describe: () => "capability-ready",
    };

    runtime.extensions.register({
      id: "capability-only",
      contribute() {
        return {
          capabilities: [
            {
              id: "pooder.test.capability-only",
              metadata: {
                name: "Capability Only",
                tags: ["test"],
              },
              commands: [
                "capabilityOnly.execute",
                {
                  id: "capabilityOnly.inspect",
                  title: "Inspect Capability",
                },
              ],
              facade,
            },
          ],
        };
      },
      activate() {},
    });

    await runtime.extensions.flushActivation();

    const capabilityRegistry = runtime.services.getOrThrow(
      CAPABILITY_REGISTRY_SERVICE,
    );
    const capability = capabilityRegistry.getCapability<{
      describe(): string;
    }>("pooder.test.capability-only");

    assertEqual(
      runtime.extensions.getState("capability-only")?.state,
      "active",
    );
    assertEqual(capability?.extensionId, "capability-only");
    assertEqual(capability?.metadata?.tags?.[0], "test");
    assertEqual(
      capabilityRegistry
        .getFacade<typeof facade>("pooder.test.capability-only")
        ?.describe(),
      "capability-ready",
    );
  });
}

async function testRuntimeCapabilityFacadeApiKeepsCommandBridge() {
  await withRuntime(async (runtime) => {
    type MathCapabilityApi = {
      add(left: number, right: number): number;
    };
    const changes: Array<{ added: string[]; removed: string[] }> = [];

    const subscription = runtime.capabilities.onDidChange((event) => {
      changes.push({
        added: event.added.slice(),
        removed: event.removed.slice(),
      });
    });

    runtime.extensions.register({
      id: "runtime-capability-api",
      contribute() {
        return {
          capabilities: [
            {
              id: "pooder.test.math",
              metadata: {
                name: "Math Capability",
              },
              commands: ["math.add"],
              facade: {
                add: (left: number, right: number) => left + right,
              } satisfies MathCapabilityApi,
            },
          ],
          commands: [
            {
              id: "math.add",
              command: "math.add",
              title: "Add",
              handler: (left: number, right: number) => left + right,
            },
          ],
        };
      },
      activate() {},
    });

    await runtime.extensions.flushActivation();

    assertEqual(runtime.capabilities.has("pooder.test.math"), true);
    assertEqual(
      runtime.capabilities
        .get<MathCapabilityApi>("pooder.test.math")
        ?.add(2, 3),
      5,
    );
    assertEqual(
      runtime.capabilities
        .getOrThrow<MathCapabilityApi>("pooder.test.math")
        .add(4, 6),
      10,
    );
    assertEqual(
      runtime.capabilities.getDefinition("pooder.test.math")?.metadata?.name,
      "Math Capability",
    );
    assertDeepEqual(
      runtime.capabilities.list().map((capability) => capability.id),
      ["pooder.test.math"],
    );
    assertEqual(await runtime.commands.execute("math.add", 7, 8), 15);
    assertDeepEqual(changes, [{ added: ["pooder.test.math"], removed: [] }]);

    await runtime.extensions.unregister("runtime-capability-api");

    assertEqual(runtime.capabilities.get("pooder.test.math"), undefined);
    assertDeepEqual(changes, [
      { added: ["pooder.test.math"], removed: [] },
      { added: [], removed: ["pooder.test.math"] },
    ]);

    subscription.dispose();
  });
}

async function testRuntimeCapabilityFacadeApiThrowsForMissingFacade() {
  await withRuntime(async (runtime) => {
    runtime.extensions.register({
      id: "facade-missing",
      contribute() {
        return {
          capabilities: [
            {
              id: "pooder.test.facade-missing",
            },
          ],
        };
      },
      activate() {},
    });

    await runtime.extensions.flushActivation();

    try {
      runtime.capabilities.getOrThrow("pooder.test.facade-missing");
      throw new Error("Expected missing facade to throw.");
    } catch (error) {
      assertEqual(
        error instanceof Error &&
          error.message ===
            'Capability "pooder.test.facade-missing" facade not found.',
        true,
      );
    }
  });
}

async function testEventBusOffMissingHandlerPreservesListeners() {
  const eventBus = new EventBus();
  const calls: string[] = [];
  const first = () => {
    calls.push("first");
  };
  const second = () => {
    calls.push("second");
  };
  const missing = () => {
    calls.push("missing");
  };

  eventBus.on("change", first);
  eventBus.on("change", second);
  eventBus.off("change", missing);
  eventBus.emit("change");

  assertDeepEqual(calls, ["first", "second"]);
  assertEqual(eventBus.count("change"), 2);
}

async function testUnregisterCleansDefinitionsCapabilitiesAndCommands() {
  await withRuntime(async (runtime) => {
    const cleanupExtension: ExtensionDefinition = {
      id: "cleanup",
      contribute() {
        return {
          capabilities: [
            {
              id: "cleanup.capability",
            },
          ],
          configurations: [
            {
              id: "cleanup.value",
              type: "number",
              label: "Cleanup Value",
              default: 1,
            },
          ],
          commands: [
            {
              id: "cleanup.command",
              command: "cleanup.command",
              title: "cleanup.command",
              handler: () => "cleanup",
            },
          ],
        };
      },
      activate() {},
    };

    runtime.extensions.register(cleanupExtension);
    await runtime.extensions.flushActivation();
    runtime.config.update("cleanup.value", 2);

    assertEqual(
      runtime.config.getDefinition("cleanup.value")?.extensionId,
      "cleanup",
    );
    assertEqual(
      runtime.services
        .getOrThrow(CAPABILITY_REGISTRY_SERVICE)
        .hasCapability("cleanup.capability"),
      true,
    );

    const removed = await runtime.extensions.unregister("cleanup");
    assertEqual(removed, true);
    assertEqual(runtime.config.getDefinition("cleanup.value"), undefined);
    assertEqual(runtime.config.get("cleanup.value"), 2);
    assertEqual(
      runtime.services
        .getOrThrow(COMMAND_SERVICE)
        .getCommand("cleanup.command"),
      undefined,
    );
    assertEqual(
      runtime.services
        .getOrThrow(CAPABILITY_REGISTRY_SERVICE)
        .hasCapability("cleanup.capability"),
      false,
    );
  });
}

async function testDuplicateCapabilityIdsFailWithoutLeakingContributions() {
  await withRuntime(async (runtime) => {
    runtime.extensions.register(
      createCommandExtension("first-capability", "first.command", "first", {
        contribute: () => ({
          capabilities: [
            {
              id: "pooder.test.duplicate",
            },
          ],
          commands: [
            {
              id: "first.command",
              command: "first.command",
              title: "first.command",
              handler: () => "first",
            },
          ],
        }),
      }),
    );
    runtime.extensions.register(
      createCommandExtension("second-capability", "second.command", "second", {
        contribute: () => ({
          capabilities: [
            {
              id: "pooder.test.duplicate",
            },
          ],
          commands: [
            {
              id: "second.command",
              command: "second.command",
              title: "second.command",
              handler: () => "second",
            },
          ],
        }),
      }),
    );

    await runtime.extensions.flushActivation();

    const capabilityRegistry = runtime.services.getOrThrow(
      CAPABILITY_REGISTRY_SERVICE,
    );
    assertEqual(
      runtime.extensions.getState("first-capability")?.state,
      "active",
    );
    assertEqual(
      runtime.extensions.getState("second-capability")?.state,
      "failed",
    );
    assertEqual(
      capabilityRegistry.getCapability("pooder.test.duplicate")?.extensionId,
      "first-capability",
    );
    assertEqual(await runtime.commands.execute("first.command"), "first");
    assertEqual(
      runtime.services.getOrThrow(COMMAND_SERVICE).getCommand("second.command"),
      undefined,
    );
  });
}

async function testCapabilityRegistryContractUsesDefensiveCopiesAndEvents() {
  await withRuntime(async (runtime) => {
    const registry = runtime.services.getOrThrow(CAPABILITY_REGISTRY_SERVICE);
    const events: Array<{
      added: string[];
      removed: string[];
      extensionId?: string;
    }> = [];
    const facade = { inspect: () => "ready" };
    let registrations = 0;
    let unregistrations = 0;
    const subscription = registry.onDidChange((event) => {
      events.push(event);
    });

    const disposable = registry.registerCapability("contract.extension", {
      id: "contract.capability",
      metadata: {
        name: "Contract Capability",
        tags: ["contract"],
      },
      dependencies: {
        capabilities: ["contract.dependency"],
        extensions: ["contract.extension.dependency"],
        services: [COMMAND_SERVICE],
      },
      commands: [
        "contract.legacyCommand",
        { id: "contract.typedCommand", title: "Typed Command" },
      ],
      facade,
      onRegister: () => {
        registrations += 1;
      },
      onUnregister: () => {
        unregistrations += 1;
      },
    });

    const listed = registry.listCapabilities()[0];
    assertEqual(registrations, 1);
    assertEqual(registry.getFacade("contract.capability"), facade);
    assertEqual(listed?.extensionId, "contract.extension");

    listed?.metadata?.tags?.push("mutated");
    listed?.dependencies?.capabilities?.push("mutated.capability");
    const typedCommand = listed?.commands?.find(
      (command) => typeof command !== "string",
    );
    if (typedCommand && typeof typedCommand !== "string") {
      typedCommand.title = "Mutated Command";
    }

    const reread = registry.getCapability("contract.capability");
    assertDeepEqual(reread?.metadata?.tags, ["contract"]);
    assertDeepEqual(reread?.dependencies?.capabilities, [
      "contract.dependency",
    ]);
    assertEqual(reread?.dependencies?.services?.[0], COMMAND_SERVICE);
    assertDeepEqual(reread?.commands, [
      "contract.legacyCommand",
      { id: "contract.typedCommand", title: "Typed Command" },
    ]);

    disposable.dispose();
    disposable.dispose();

    assertEqual(unregistrations, 1);
    assertDeepEqual(events, [
      {
        added: ["contract.capability"],
        removed: [],
        extensionId: "contract.extension",
      },
      {
        added: [],
        removed: ["contract.capability"],
        extensionId: "contract.extension",
      },
    ]);
    assertEqual(registry.unregisterCapability("contract.capability"), false);

    subscription.dispose();
  });
}

async function testSceneLayersAndElements() {
  await withRuntime(async (runtime) => {
    const scene = runtime.services.getOrThrow(SCENE_SERVICE);

    scene.addLayer({
      id: "artwork",
      order: 2,
      metadata: { owner: "app" },
    });
    scene.addLayer({ id: "background", order: 1, visible: false });
    scene.updateLayer("background", { visible: true });

    assertDeepEqual(
      scene.selectLayers().map((layer) => layer.id),
      ["background", "artwork"],
    );
    assertEqual(scene.selectOneLayer({ ids: ["background"] })?.visible, true);

    scene.addElement({
      id: "image-1",
      layerId: "artwork",
      type: "image",
      src: "image.png",
      width: 120,
      height: 80,
      transform: { left: 10, top: 12 },
    });
    scene.addElement({
      id: "path-1",
      layerId: "artwork",
      type: "path",
      path: "M 0 0 L 10 10",
      visible: false,
    });
    scene.addElement({
      id: "rect-1",
      layerId: "background",
      type: "rect",
      width: 400,
      height: 300,
    });
    scene.addElement({
      id: "text-1",
      layerId: "artwork",
      type: "text",
      text: "Label",
      order: 3,
    });

    scene.updateElement("image-1", {
      width: 140,
      metadata: { selected: true },
    });

    assertEqual(scene.selectOneElement({ ids: ["image-1"] })?.type, "image");
    assertEqual(
      scene.selectOneElement({ ids: ["image-1"] })?.metadata?.selected,
      true,
    );
    assertDeepEqual(
      scene
        .selectElements({ layerIds: ["artwork"] })
        .map((element) => element.id),
      ["image-1", "path-1", "text-1"],
    );
    assertDeepEqual(
      scene
        .selectElements({ types: ["path"], visible: false })
        .map((element) => element.id),
      ["path-1"],
    );
    assertEqual(scene.removeElement("path-1"), true);
    assertEqual(scene.selectOneElement({ ids: ["path-1"] }), undefined);
  });
}

async function testSceneSelectors() {
  await withRuntime(async (runtime) => {
    const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);

    scene.addLayer({
      id: "background",
      order: 1,
      tags: [" base ", "print", ""],
      metadata: { owner: "system", role: "background" },
    });
    scene.addLayer({
      id: "artwork",
      order: 2,
      tags: ["print", "design"],
      metadata: { owner: "app", role: "content" },
    });
    scene.addLayer({
      id: "overlay",
      order: 3,
      visible: false,
      tags: ["helper"],
      metadata: { owner: "app", role: "overlay" },
    });
    scene.addElement({
      id: "bg-rect",
      layerId: "background",
      type: "rect",
      width: 100,
      height: 100,
      tags: ["base"],
      metadata: { locked: true },
    });
    scene.addElement({
      id: "photo",
      layerId: "artwork",
      type: "image",
      src: "photo.png",
      tags: ["mockup", "design"],
      metadata: { selected: true },
    });
    scene.addElement({
      id: "guide",
      layerId: "overlay",
      type: "path",
      path: "M 0 0 L 1 1",
      visible: false,
      tags: ["helper"],
      metadata: { selected: true },
    });

    assertDeepEqual(
      scene.selectLayers().map((layer) => layer.id),
      ["background", "artwork", "overlay"],
      "empty layer selector should return the ordered layer set",
    );
    assertDeepEqual(
      scene
        .selectLayers({
          tags: ["design", "missing"],
          metadata: { owner: "app" },
        })
        .map((layer) => layer.id),
      ["artwork"],
      "layer selector should AND fields and match any requested tag",
    );
    assertDeepEqual(
      scene.selectElements().map((element) => element.id),
      ["bg-rect", "photo", "guide"],
      "empty element selector should return the ordered element set",
    );
    assertDeepEqual(
      scene
        .selectElements({
          layerIds: ["artwork", "overlay"],
          types: ["image", "path"],
          visible: false,
          tags: ["helper", "mockup"],
          metadata: { selected: true },
        })
        .map((element) => element.id),
      ["guide"],
      "element selector should AND fields and match array dimensions by any value",
    );
    assertEqual(
      scene.selectOneElement({ ids: ["missing"] }),
      undefined,
      "selectOneElement should return undefined for no results",
    );
    assertEqual(
      scene.selectOneLayer({ ids: ["artwork"] })?.metadata?.role,
      "content",
      "selectOneLayer should return one matching layer",
    );
    assertThrows(
      () => scene.selectOneElement({ metadata: { selected: true } }),
      "scene-selector-ambiguous",
    );
  });
}

async function testSceneServiceContractValidatesAndClonesState() {
  await withRuntime(async (runtime) => {
    const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
    const layer = scene.addLayer({
      id: " source ",
      metadata: { owner: "app" },
    });
    scene.addLayer({ id: "target", order: 2 });

    layer.metadata!.owner = "mutated";
    assertEqual(
      scene.selectOneLayer({ ids: ["source"] })?.metadata?.owner,
      "app",
    );

    const rect = scene.addElement({
      id: "rect",
      layerId: "source",
      type: "rect",
      width: 10,
      height: 20,
      metadata: { selected: false },
      data: { role: "shape" },
      style: { fill: "red" },
      transform: { left: 1, top: 2 },
    });
    rect.metadata!.selected = true;
    rect.data!.role = "mutated";
    rect.style!.fill = "blue";
    rect.transform!.left = 99;

    const stored = scene.selectOneElement({ ids: ["rect"] });
    assertEqual(stored?.metadata?.selected, false);
    assertEqual(stored?.data?.role, "shape");
    assertEqual(stored?.style?.fill, "red");
    assertEqual(stored?.transform?.left, 1);

    scene.updateElement("rect", {
      layerId: "target",
      order: 0,
      metadata: { selected: true },
    });
    assertDeepEqual(
      scene
        .selectElements({ layerIds: ["target"] })
        .map((element) => element.id),
      ["rect"],
    );
    assertEqual(
      scene.selectOneElement({ ids: ["rect"] })?.metadata?.selected,
      true,
    );

    assertThrows(
      () => scene.addLayer({ id: "source" }),
      'Scene layer "source" is already registered.',
    );
    assertThrows(
      () =>
        scene.addElement({
          id: "orphan",
          layerId: "missing",
          type: "rect",
          width: 1,
          height: 1,
        }),
      'Scene layer "missing" not found.',
    );
    assertThrows(
      () =>
        scene.addElement({
          id: "bad-image",
          layerId: "source",
          type: "image",
          src: "",
        }),
      "Scene image element src is required.",
    );
  });
}

async function testSceneTransactionsBatchAndRollback() {
  await withRuntime(async (runtime) => {
    const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
    const changes: SceneChangeEvent[] = [];
    scene.onDidChange((event) => {
      changes.push(event);
    });

    scene.transaction(() => {
      scene.addLayer({ id: "content" });
      scene.addElement({
        id: "rect-1",
        layerId: "content",
        type: "rect",
        width: 10,
        height: 20,
      });
      scene.updateElement("rect-1", { width: 12 });
    });

    assertEqual(changes.length, 1);
    assertDeepEqual(changes[0].causes, [{ type: "scene-content" }]);
    assertDeepEqual(changes[0].layers.added, ["content"]);
    assertDeepEqual(changes[0].elements.added, ["rect-1"]);
    assertDeepEqual(changes[0].elements.updated, ["rect-1"]);
    assertEqual(scene.selectOneElement({ ids: ["rect-1"] })?.type, "rect");

    try {
      scene.transaction(() => {
        scene.addLayer({ id: "rollback" });
        scene.addElement({
          id: "text-1",
          layerId: "rollback",
          type: "text",
          text: "Rollback",
        });
        throw new Error("rollback");
      });
    } catch {
      // Expected rollback path.
    }

    assertEqual(scene.selectOneLayer({ ids: ["rollback"] }), undefined);
    assertEqual(scene.selectOneElement({ ids: ["text-1"] }), undefined);
    assertEqual(changes.length, 1);

    scene.transaction(
      {
        cause: {
          type: "interaction-preview",
          sessionId: "image:front",
          toolId: "image-placement",
        },
      },
      () => scene.updateElement("rect-1", { width: 14 }),
    );
    assertEqual(changes.length, 2);
    assertDeepEqual(changes[1].causes, [
      {
        type: "interaction-preview",
        sessionId: "image:front",
        toolId: "image-placement",
      },
    ]);
  });
}

async function testRemovingSceneLayerRemovesScopedElements() {
  await withRuntime(async (runtime) => {
    const scene = runtime.services.getOrThrow(SCENE_SERVICE);

    scene.addLayer({ id: "temporary" });
    scene.addElement({
      id: "temporary-text",
      layerId: "temporary",
      type: "text",
      text: "Temporary",
    });

    assertEqual(scene.removeLayer("temporary"), true);
    assertEqual(scene.selectOneLayer({ ids: ["temporary"] }), undefined);
    assertEqual(scene.selectOneElement({ ids: ["temporary-text"] }), undefined);
  });
}

async function testSceneServiceManagesMultipleScenes() {
  await withRuntime(async (runtime) => {
    const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
    const changes: SceneChangeEvent[] = [];
    scene.onDidChange((event) => changes.push(event));

    scene.addLayer({ id: "shared" });
    scene.addElement({
      id: "shared-element",
      layerId: "shared",
      type: "rect",
      width: 10,
      height: 10,
    });
    scene.addScene({ id: "session", renderable: true, transient: true });
    scene.addLayer({ id: "shared" }, { sceneId: "session" });
    scene.addElement(
      {
        id: "shared-element",
        layerId: "shared",
        type: "rect",
        width: 20,
        height: 20,
      },
      { sceneId: "session" },
    );

    assertEqual(
      (scene.selectOneElement({ ids: ["shared-element"] }) as any)?.width,
      10,
      "default scene element should remain independent",
    );
    assertEqual(
      (
        scene.selectOneElement({
          ids: ["shared-element"],
          sceneId: "session",
        }) as any
      )?.width,
      20,
      "scoped scene element should support duplicate ids",
    );
    assertEqual(
      scene.getScene("session")?.renderable,
      true,
      "scene metadata should describe renderability",
    );
    assert(
      Boolean(
        changes.some((change) => change.scenes?.added.includes("session")),
      ),
      "scene changes should report scene additions",
    );
    assert(
      Boolean(
        changes.some((change) =>
          change.sceneChanges?.session?.elements.added.includes(
            "shared-element",
          ),
        ),
      ),
      "scene changes should report scoped element additions",
    );
    assertEqual(scene.removeScene("session"), true);
    assertEqual(scene.getScene("session"), undefined);
    assertEqual(
      (scene.selectOneElement({ ids: ["shared-element"] }) as any)?.width,
      10,
    );
  });
}

async function testSceneTransactionRollsBackMultipleScenes() {
  await withRuntime(async (runtime) => {
    const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
    try {
      scene.transaction(() => {
        scene.addScene({ id: "session", transient: true });
        scene.addLayer({ id: "layer" }, { sceneId: "session" });
        scene.addElement(
          {
            id: "rect",
            layerId: "layer",
            type: "rect",
            width: 10,
            height: 10,
          },
          { sceneId: "session" },
        );
        throw new Error("rollback");
      });
    } catch {
      // Expected rollback path.
    }
    assertEqual(scene.getScene("session"), undefined);
  });
}

async function testSessionsWithoutTools() {
  await withRuntime(async (runtime) => {
    const sessions =
      runtime.services.getOrThrow<SessionService>(SESSION_SERVICE);
    const changes: SessionChangeEvent[] = [];
    let beginCount = 0;
    let validateCount = 0;
    let commitCount = 0;

    sessions.onDidChange((event) => changes.push(event));
    sessions.createSession({
      sessionId: "session.image-placement.front.slot",
      scope: {
        surfaceId: "front",
        subjectId: "slot",
        channel: "image-placement",
      },
      leavePolicy: "commit",
      draft: { scale: 1 },
      lifecycle: {
        begin: () => {
          beginCount += 1;
        },
        validate: () => {
          validateCount += 1;
          return { ok: true, result: "validated" };
        },
        commit: () => {
          commitCount += 1;
          return "committed";
        },
      },
    });

    sessions.markDirty("session.image-placement.front.slot");

    const leaveResult = await sessions.handleBeforeLeave(
      "session.image-placement.front.slot",
    );

    assertDeepEqual(leaveResult, { decision: "allow" });
    assertEqual(beginCount, 1);
    assertEqual(validateCount, 1);
    assertEqual(commitCount, 1);
    assertEqual(
      sessions.getSession("session.image-placement.front.slot"),
      undefined,
      "terminal sessions should leave the active registry",
    );
    assertEqual(
      sessions.hasActiveSession({
        scope: { surfaceId: "front", subjectId: "slot" },
      }),
      false,
    );
    assertDeepEqual(
      changes.map((event) => event.reason),
      ["opened", "phase", "phase", "phase"],
    );
  });
}

async function testSessionLifecycleEvents() {
  await withRuntime(async (runtime) => {
    const sessions =
      runtime.services.getOrThrow<SessionService>(SESSION_SERVICE);
    const events: Array<{
      reason: string;
      sessionId: string;
    }> = [];

    sessions.onDidChange((event) => {
      events.push({
        reason: event.reason,
        sessionId: event.snapshot.descriptor.sessionId,
      });
    });

    sessions.createSession({
      sessionId: "image:front:slot",
      scope: { surfaceId: "front", subjectId: "slot", channel: "image" },
      draft: { scale: 1 },
    });
    sessions.createSession({
      sessionId: "image:front:slot-2",
      scope: { surfaceId: "front", subjectId: "slot-2", channel: "image" },
    });
    sessions.updateSession("image:front:slot", { draft: { scale: 1.2 } });
    sessions.focusSession("image:front:slot");
    await sessions.commitSession("image:front:slot");
    await sessions.cancelSession("image:front:slot-2");

    assertEqual(sessions.getFocusedSessionId(), null);
    assertEqual(sessions.isSessionActive("image:front:slot"), false);
    assertEqual(
      sessions.listSessions({ scope: { channel: "image" } }).length,
      0,
    );
    assert(
      events.some(
        (event) =>
          event.reason === "draft" && event.sessionId === "image:front:slot",
      ),
      "session draft changes should be typed lifecycle events",
    );
  });
}

async function testExclusiveSessionRequests() {
  await withRuntime(async (runtime) => {
    const sessions =
      runtime.services.getOrThrow<SessionService>(SESSION_SERVICE);
    await sessions.requestSession({
      sessionId: "white-ink:front",
      scope: { channel: "white-ink", groupId: "editor-interaction" },
      interactionMode: "exclusive",
      leavePolicy: "block",
    });
    sessions.markDirty("white-ink:front", true);

    const blocked = await sessions.requestSession({
      sessionId: "image:front",
      scope: { channel: "image-placement", groupId: "editor-interaction" },
      interactionMode: "exclusive",
    });
    assertEqual(blocked.ok, false);
    assertEqual(blocked.conflictingSessionId, "white-ink:front");

    sessions.markDirty("white-ink:front", false);
    const activated = await sessions.requestSession({
      sessionId: "image:front",
      scope: { channel: "image-placement", groupId: "editor-interaction" },
      interactionMode: "exclusive",
    });
    assertEqual(activated.ok, true);
    assertEqual(sessions.isSessionActive("white-ink:front"), false);
    assertEqual(sessions.isSessionActive("image:front"), true);
    assertEqual(
      sessions.hasActiveSession({
        scope: { groupId: "editor-interaction" },
      }),
      true,
    );
  });
}

async function testSessionV2OwnsLifecycleAndResources() {
  await withRuntime(async (runtime) => {
    const sessions =
      runtime.services.getOrThrow<SessionService>(SESSION_SERVICE);
    let releaseBegin!: () => void;
    const beginGate = new Promise<void>((resolve) => {
      releaseBegin = resolve;
    });
    let beginCount = 0;
    let opened = false;
    const opening = sessions
      .open({
        descriptor: {
          sessionId: "v2:lifecycle",
          ownerId: "test-owner",
          scope: { groupId: "v2" },
          interactionMode: "exclusive",
          leavePolicy: "block",
        },
        initialDraft: { value: 1 },
        lifecycle: {
          begin: async () => {
            beginCount += 1;
            await beginGate;
          },
        },
      })
      .then((handle) => {
        opened = true;
        return handle;
      });
    await Promise.resolve();
    assertEqual(opened, false, "open must await begin");
    releaseBegin();
    const handle = await opening;
    const duplicate = await sessions.open({
      descriptor: handle.descriptor,
      initialDraft: { value: 99 },
    });
    assertEqual(duplicate, handle, "same owner must receive the same handle");
    assertEqual(beginCount, 1, "duplicate open must not begin twice");

    let ownerError = false;
    try {
      await sessions.open({
        descriptor: { ...handle.descriptor, ownerId: "other-owner" },
        initialDraft: { value: 1 },
      });
    } catch {
      ownerError = true;
    }
    assertEqual(ownerError, true, "another owner must not reuse a session id");

    const disposalOrder: string[] = [];
    handle.own({ dispose: () => disposalOrder.push("first") });
    handle.own({ dispose: () => disposalOrder.push("second") });
    await handle.cancel();
    assertDeepEqual(disposalOrder, ["second", "first"]);
    assertEqual(sessions.getHandle("v2:lifecycle"), undefined);
  });
}

async function testSessionV2RecoversCommitAndForcesTerminalCleanup() {
  const sessions = new (
    await import("../src/services/SessionService")
  ).default();
  let validationOk = false;
  let commitThrows = true;
  const handle = await sessions.open({
    descriptor: {
      sessionId: "v2:commit",
      ownerId: "test-owner",
      scope: {},
      interactionMode: "cooperative",
      leavePolicy: "block",
    },
    initialDraft: { value: 1 },
    lifecycle: {
      validate: () => validationOk,
      commit: () => {
        if (commitThrows) throw new Error("commit failed");
        return "done";
      },
    },
  });
  handle.updateDraft({ value: 2 });
  assertDeepEqual(await handle.commit(), {
    ok: false,
    validation: { ok: false },
  });
  assertEqual(handle.phase, "active");
  assertDeepEqual(handle.getDraft(), { value: 2 });
  validationOk = true;
  let commitError = false;
  try {
    await handle.commit();
  } catch {
    commitError = true;
  }
  assertEqual(commitError, true);
  assertEqual(handle.phase, "active");
  assertEqual(handle.focused, true);
  commitThrows = false;
  assertDeepEqual(await handle.commit(), { ok: true, result: "done" });
  assertEqual(sessions.getHandle("v2:commit"), undefined);

  const forced = await sessions.open({
    descriptor: {
      sessionId: "v2:forced",
      ownerId: "test-owner",
      scope: {},
      interactionMode: "cooperative",
      leavePolicy: "block",
    },
    initialDraft: {},
    lifecycle: {
      rollback: () => {
        throw new Error("rollback failed");
      },
    },
  });
  forced.own({
    dispose: () => {
      throw new Error("dispose failed");
    },
  });
  let aggregate: unknown;
  try {
    await forced.rollback();
  } catch (error) {
    aggregate = error;
  }
  assert(aggregate instanceof AggregateError, "rollback errors must aggregate");
  assertEqual((aggregate as AggregateError).errors.length, 2);
  assertEqual(sessions.getHandle("v2:forced"), undefined);
}

async function testSessionSceneV2TracksFocusedRootAndOwnership() {
  await withRuntime(async (runtime) => {
    const sessions =
      runtime.services.getOrThrow<SessionService>(SESSION_SERVICE);
    const scenes = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
    const session = await sessions.open({
      descriptor: {
        sessionId: "scene-session",
        ownerId: "scene-owner",
        scope: {},
        interactionMode: "cooperative",
        leavePolicy: "block",
      },
      initialDraft: {},
    });
    const scene = scenes.createScene({
      id: "session-root",
      owner: { type: "session", sessionId: session.descriptor.sessionId },
      composition: {
        entries: [
          { source: "local", layerIds: ["underlay"] },
          { source: "document", interaction: "disabled" },
          { source: "local", layerIds: ["controls"] },
        ],
      },
    });
    session.own(scene);
    scene.addLayer({ id: "underlay" });
    scene.addLayer({ id: "controls" });
    scene.addElement({
      id: "control",
      layerId: "controls",
      type: "rect",
      width: 10,
      height: 10,
      interaction: { selection: { enabled: true } },
    });
    assertDeepEqual(
      scenes.getActiveRoot()?.composition.entries.map((entry) => entry.source),
      ["local", "document", "local"],
    );

    const other = await sessions.open({
      descriptor: {
        sessionId: "other-session",
        ownerId: "other-owner",
        scope: {},
        interactionMode: "cooperative",
        leavePolicy: "block",
      },
      initialDraft: {},
    });
    assertEqual(scenes.getActiveRoot(), null);
    await sessions.open({ descriptor: session.descriptor, initialDraft: {} });
    assertEqual(scenes.getActiveRoot()?.id, "session-root");
    await session.cancel();
    assertEqual(scenes.getSceneHandle("session-root"), undefined);
    assertEqual(scenes.getActiveRoot(), null);
    await other.cancel();
  });
}

async function testGeometryPrimitives() {
  assertDeepEqual(
    normalizeRect({ x: 1, y: 2, width: -5, height: 6 }),
    { left: 1, top: 2, width: 0, height: 6 },
    "rect normalization should accept editor-style x/y and clamp size",
  );
  assertDeepEqual(
    intersectRects(
      { left: 0, top: 0, width: 10, height: 10 },
      { left: 5, top: 4, width: 10, height: 3 },
    ),
    { left: 5, top: 4, width: 5, height: 3 },
    "rect intersection should return the overlapping frame",
  );
  assertEqual(
    containsPoint({ left: 0, top: 0, width: 10, height: 10 }, { x: 10, y: 0 }),
    true,
    "point containment should include rect edges",
  );
  assertEqual(
    containsRect(
      { left: 0, top: 0, width: 10, height: 10 },
      { left: 1, top: 1, width: 8, height: 8 },
    ),
    true,
    "rect containment should detect contained frames",
  );
  assertDeepEqual(
    projectRectIntoRect(
      { left: 12, top: -2, width: 4, height: 4 },
      { left: 0, top: 0, width: 10, height: 10 },
    ),
    { left: 6, top: 0, width: 4, height: 4 },
    "frame projection should clamp to container bounds",
  );
  assertDeepEqual(
    projectRectIntoRect(
      { left: 9, top: 9, width: 4, height: 4 },
      { left: 0, top: 0, width: 10, height: 10 },
      "center",
    ),
    { left: 8, top: 8, width: 4, height: 4 },
    "center projection should clamp the subject center",
  );
}

async function testDragInteractionSnapsAndConstrains() {
  const constrained = computeDragInteraction({
    frame: { left: 0, top: 0, width: 10, height: 10 },
    delta: { x: 95, y: 0 },
    constraints: [
      { rect: { left: 0, top: 0, width: 100, height: 100 }, target: "frame" },
    ],
  });
  assertDeepEqual(
    constrained.frame,
    { left: 90, top: 0, width: 10, height: 10 },
    "drag containment should clamp the final frame",
  );

  const centerConstrained = computeDragInteraction({
    frame: { left: 0, top: 0, width: 20, height: 20 },
    delta: { x: 100, y: 100 },
    constraints: [
      { rect: { left: 0, top: 0, width: 50, height: 50 }, target: "center" },
    ],
  });
  assertDeepEqual(
    centerConstrained.frame,
    { left: 40, top: 40, width: 20, height: 20 },
    "center containment should clamp by center rather than edges",
  );

  const snapped = computeDragInteraction({
    frame: { left: 0, top: 0, width: 10, height: 10 },
    proposedFrame: { left: 96, top: 15, width: 10, height: 10 },
    snapTargets: [
      { id: "frame", rect: { left: 100, top: 10, width: 80, height: 60 } },
    ],
    options: { thresholdPx: 6, includeCenters: false },
  });
  assertEqual(
    snapped.frame.left,
    100,
    "drag should snap x to the nearest line",
  );
  assertEqual(snapped.frame.top, 10, "drag should snap y to the nearest line");
  assertEqual(
    snapped.matches.length,
    2,
    "drag should return one snap match per snapped axis",
  );

  const rejected = computeDragInteraction({
    frame: { left: 0, top: 0, width: 10, height: 10 },
    proposedFrame: { left: 86, top: 0, width: 10, height: 10 },
    constraints: [
      { rect: { left: 0, top: 0, width: 95, height: 95 }, target: "frame" },
    ],
    snapTargets: [
      { id: "outside", rect: { left: 100, top: 0, width: 50, height: 50 } },
    ],
    options: { thresholdPx: 20, includeCenters: false },
  });
  assertEqual(
    rejected.matches.length,
    0,
    "snap candidates that break hard constraints should be rejected",
  );
  assertEqual(
    rejected.frame.left,
    85,
    "final projection still enforces bounds",
  );

  assertEqual(
    createRectSnapLines({ left: 0, top: 0, width: 10, height: 20 }).length,
    6,
    "rect snap lines should include edges and centers",
  );
}

async function testGeometrySourceServiceRegistry() {
  await withRuntime(async (runtime) => {
    const geometry = runtime.services.getOrThrow<GeometrySourceService>(
      GEOMETRY_SOURCE_SERVICE,
    );
    const disposable = geometry.registerSource(
      createStaticGeometrySource({
        sourceId: "static",
        geometries: [
          {
            kind: "rect",
            ref: { sourceId: "static", geometryId: "bounds" },
            space: "parent-local",
            bounds: { left: 10, top: 20, width: 30, height: 40 },
            rect: { left: 10, top: 20, width: 30, height: 40 },
            localToScene: coordinateMatrix(
              "parent-local",
              "scene",
              [1, 0, 0, 1, 5, 10],
            ),
          },
          {
            kind: "pointSet",
            ref: { sourceId: "static", geometryId: "points" },
            space: "scene",
            bounds: { left: 0, top: 0, width: 100, height: 100 },
            localToScene: coordinateMatrix(
              "scene",
              "scene",
              [1, 0, 0, 1, 0, 0],
            ),
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 100 },
            ],
          },
          {
            kind: "rect",
            ref: {
              sourceId: "static",
              geometryId: "representation",
              purpose: "preview",
            },
            space: "scene",
            bounds: { left: 0, top: 0, width: 10, height: 10 },
            rect: { left: 0, top: 0, width: 10, height: 10 },
            localToScene: coordinateMatrix(
              "scene",
              "scene",
              [1, 0, 0, 1, 0, 0],
            ),
          },
          {
            kind: "rect",
            ref: {
              sourceId: "static",
              geometryId: "representation",
              purpose: "export",
            },
            space: "scene",
            bounds: { left: 0, top: 0, width: 20, height: 20 },
            rect: { left: 0, top: 0, width: 20, height: 20 },
            localToScene: coordinateMatrix(
              "scene",
              "scene",
              [1, 0, 0, 1, 0, 0],
            ),
          },
        ],
      }),
    );

    const rect = geometry.getSnapshot({
      sourceId: "static",
      geometryId: "bounds",
    });
    assert(rect, "geometry source should resolve registered geometry");
    assertDeepEqual(
      geometry.getBounds(rect.ref),
      { left: 10, top: 20, width: 30, height: 40 },
      "geometry utility should read rect bounds",
    );
    assertDeepEqual(
      geometry.nearestPoint(rect.ref, { x: 100, y: 0 }),
      { x: 40, y: 20 },
      "geometry utility should clamp nearest rect point",
    );
    assertEqual(
      geometry.contains(rect.ref, { x: 15, y: 25 }),
      true,
      "geometry utility should test point containment",
    );
    assertEqual(
      geometry.project({
        ref: { sourceId: "static", geometryId: "bounds" },
        to: "scene",
      })?.space,
      "scene",
      "default projection should produce the requested coordinate space",
    );
    assertEqual(
      geometry.listGeometries("static").length,
      4,
      "geometry source should list registered descriptors",
    );
    assertEqual(
      geometry.getBounds({
        sourceId: "static",
        geometryId: "representation",
        purpose: "preview",
      })?.width,
      10,
      "preview geometry should resolve independently",
    );
    assertEqual(
      geometry.getBounds({
        sourceId: "static",
        geometryId: "representation",
        purpose: "export",
      })?.width,
      20,
      "export geometry should resolve independently",
    );
    disposable.dispose();
    assertEqual(
      geometry.getSnapshot({ sourceId: "static", geometryId: "bounds" }),
      null,
      "disposing a source should unregister it",
    );
  });
}

async function testConstraintResolverServiceBuiltins() {
  await withRuntime(async (runtime) => {
    const geometry = runtime.services.getOrThrow<GeometrySourceService>(
      GEOMETRY_SOURCE_SERVICE,
    );
    const resolver = runtime.services.getOrThrow<ConstraintResolverService>(
      CONSTRAINT_RESOLVER_SERVICE,
    );
    geometry.registerSource(
      createStaticGeometrySource({
        sourceId: "static",
        geometries: [
          {
            kind: "polygon",
            ref: { sourceId: "static", geometryId: "diamond" },
            space: "scene",
            bounds: { left: 0, top: 0, width: 100, height: 100 },
            localToScene: coordinateMatrix(
              "scene",
              "scene",
              [1, 0, 0, 1, 0, 0],
            ),
            points: [
              { x: 50, y: 0 },
              { x: 100, y: 50 },
              { x: 50, y: 100 },
              { x: 0, y: 50 },
            ],
          },
        ],
      }),
    );

    const clamped = resolver.resolve({
      transform: {
        frame: { left: 96, top: -5, width: 10, height: 10 },
      },
      constraints: [
        {
          type: "rect.contain",
          params: { rect: { left: 0, top: 0, width: 100, height: 100 } },
        },
      ],
    });
    assertDeepEqual(
      clamped.result.frame,
      { left: 90, top: 0, width: 10, height: 10 },
      "rect.contain should clamp a frame into bounds",
    );

    const nearest = resolver.resolve({
      transform: { position: { x: 80, y: 10 } },
      constraints: [
        {
          type: "path.nearest-point",
          source: { sourceId: "static", geometryId: "diamond" },
        },
      ],
    });
    assertDeepEqual(
      nearest.result.position,
      { x: 70, y: 20 },
      "path.nearest-point should use generic geometry nearest point lookup",
    );

    const snapped = resolver.resolve({
      transform: { position: { x: 23, y: 36 } },
      constraints: [
        { type: "axis.lock", mode: "x", params: { origin: { x: 0, y: 30 } } },
        { type: "grid.snap", params: { size: 10 } },
      ],
    });
    assertDeepEqual(
      snapped.result.position,
      { x: 20, y: 30 },
      "axis.lock and grid.snap should compose deterministically",
    );

    const rectSnapped = resolver.resolve({
      transform: {
        frame: { left: 96, top: 15, width: 10, height: 10 },
      },
      constraints: [
        {
          type: "rect.snap",
          params: {
            id: "frame",
            rect: { left: 100, top: 10, width: 80, height: 60 },
            thresholdPx: 6,
          },
        },
      ],
      metadata: { viewportScale: 1 },
    });
    assertDeepEqual(
      rectSnapped.result.frame,
      { left: 100, top: 10, width: 10, height: 10 },
      "rect.snap should align the moving frame to target edges",
    );
    assertEqual(
      Array.isArray(
        (rectSnapped.result.metadata?.rectSnap as { guides?: unknown[] })
          ?.guides,
      ),
      true,
      "rect.snap should expose snap guides in result metadata",
    );
  });
}

async function testInteractionServiceOwnsStateConstraintsAndDispatch() {
  await withRuntime(async (runtime) => {
    const interaction =
      runtime.services.getOrThrow<InteractionService>(INTERACTION_SERVICE);
    const resolver = runtime.services.getOrThrow<ConstraintResolverService>(
      CONSTRAINT_RESOLVER_SERVICE,
    );
    resolver.registerConstraint("test.move", (result) => ({
      ...result,
      frame: result.frame ? { ...result.frame, left: 10 } : result.frame,
    }));
    resolver.registerConstraint("test.resize", (result) => ({
      ...result,
      size: { width: 50, height: 60 },
    }));
    resolver.registerConstraint("test.rotate", (result) => ({
      ...result,
      rotation: 90,
    }));

    const spec = {
      enabledWhen: {
        op: "truthy" as const,
        ref: { source: "context" as const, key: "editable" },
      },
      selection: { enabled: false },
      activation: {
        action: { commandId: "interaction.open", payload: { value: 7 } },
      },
      manipulation: {
        move: {
          enabled: true,
          constraints: [
            {
              activeWhen: { op: "const" as const, value: true },
              spec: { type: "test.move" },
            },
          ],
        },
        resize: {
          enabled: true,
          constraints: [{ spec: { type: "test.resize" } }],
        },
        rotate: {
          enabled: true,
          constraints: [{ spec: { type: "test.rotate" } }],
        },
      },
    };
    const runtimeContext = { contextValues: { editable: true } };
    const state = interaction.resolveState(spec, runtimeContext, false);
    assertEqual(
      state.selectionEnabled,
      true,
      "manipulation should imply selection",
    );
    assertEqual(
      state.hitTestEnabled,
      true,
      "manipulation should imply hit testing",
    );
    assertEqual(
      state.activationEnabled,
      true,
      "activation should default enabled",
    );
    assertEqual(state.manipulation.move.constraints.length, 1);

    const lockedState = interaction.resolveState(spec, runtimeContext, true);
    assertEqual(
      lockedState.selectionEnabled,
      false,
      "lock should disable selection",
    );
    assertEqual(lockedState.manipulation.move.enabled, false);
    assertEqual(
      lockedState.activationEnabled,
      true,
      "lock should not implicitly disable activation",
    );
    assertEqual(
      interaction.resolveState(
        spec,
        { contextValues: { editable: false } },
        false,
      ).enabled,
      false,
      "enabledWhen should control the complete interaction spec",
    );

    const committedKinds: string[] = [];
    interaction.onDidCommitManipulation((event) =>
      committedKinds.push(event.kind),
    );
    const transform = {
      frame: { left: 1, top: 2, width: 20, height: 30 },
      size: { width: 20, height: 30 },
      rotation: 12,
    };
    assertEqual(
      interaction.resolveManipulation("move", {
        spec,
        runtimeContext,
        transform,
      }).result.frame?.left,
      10,
    );
    assertDeepEqual(
      interaction.resolveManipulation("resize", {
        spec,
        runtimeContext,
        transform,
      }).result.size,
      { width: 50, height: 60 },
    );
    assertEqual(
      interaction.resolveManipulation("rotate", {
        spec,
        runtimeContext,
        transform,
        commit: true,
      }).result.rotation,
      90,
    );
    assertDeepEqual(committedKinds, ["rotate"]);

    runtime.services
      .getOrThrow(COMMAND_SERVICE)
      .registerCommand("interaction.open", (payload) => payload.value * 2);
    const activation = await interaction.activate<number>({
      spec,
      runtimeContext,
      trigger: "primary-pointer",
      subjectId: "image",
    });
    assertEqual(activation.activated, true);
    assertEqual(
      activation.commandResult,
      14,
      "activate should return command result",
    );

    const sessions =
      runtime.services.getOrThrow<SessionService>(SESSION_SERVICE);
    runtime.services
      .getOrThrow(COMMAND_SERVICE)
      .registerCommand("interaction.open-session", async (payload) => {
        try {
          const handle = await sessions.open({
            descriptor: {
              sessionId: payload.session.sessionId,
              ownerId: "interaction-test-owner",
              scope: payload.session.scope,
              interactionMode: payload.session.interactionMode,
              leavePolicy: payload.session.leavePolicy,
            },
            initialDraft: {},
          });
          return { ok: true as const, ownerId: handle.descriptor.ownerId };
        } catch (error) {
          if (error instanceof SessionConflictError) {
            return { ok: false as const, reason: "session-conflict" as const };
          }
          throw error;
        }
      });
    const sessionActivationSpec = {
      activation: {
        action: { commandId: "interaction.open-session" },
        session: {
          channel: "image-placement",
          groupId: "editor-interaction",
          mode: "exclusive" as const,
          scope: "subject" as const,
        },
      },
    };
    const opened = await interaction.activate({
      spec: sessionActivationSpec,
      runtimeContext: {},
      trigger: "primary-pointer",
      subjectId: "current",
    });
    assertEqual(opened.activated, true);
    assertEqual(
      opened.sessionResult?.descriptor.ownerId,
      "interaction-test-owner",
      "activation commands should own sessions and attach their lifecycle",
    );
    await opened.sessionResult?.cancel();

    const existing = await sessions.open({
      descriptor: {
        sessionId: "existing",
        ownerId: "existing-owner",
        scope: { groupId: "editor-interaction" },
        interactionMode: "exclusive",
        leavePolicy: "block",
      },
      initialDraft: {},
    });
    existing.setDirty();
    const blocked = await interaction.activate({
      spec: sessionActivationSpec,
      runtimeContext: {},
      trigger: "primary-pointer",
      subjectId: "next",
    });
    assertEqual(blocked.activated, false);
    assertEqual(blocked.reason, "session-conflict");
    await existing.cancel();
  });
}

async function testSessionDirtyTrackerCanBlockLeave() {
  await withRuntime(async (runtime) => {
    const sessions =
      runtime.services.getOrThrow<SessionService>(SESSION_SERVICE);
    sessions.createSession({
      sessionId: "session.feature",
      scope: { channel: "feature" },
    });
    const tracker = sessions.registerDirtyTracker(
      "session.feature",
      () => true,
    );

    const leaveResult = await sessions.handleBeforeLeave("session.feature");

    assertDeepEqual(leaveResult, {
      decision: "blocked",
      reason: "session-dirty",
    });
    assertEqual(sessions.isSessionActive("session.feature"), true);

    tracker.dispose();
    sessions.markDirty("session.feature", false);
    assertDeepEqual(await sessions.handleBeforeLeave("session.feature"), {
      decision: "allow",
    });
  });
}

async function testRenderIntentRuntimePatchesAreSourceScoped() {
  await withRuntime(async (runtime) => {
    const intents = runtime.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    const changes: RenderIntentChangeEvent[] = [];
    intents.onDidChange((event) => changes.push(event));
    intents.setDocumentIntents([
      {
        id: "image",
        subject: {
          kind: "object",
          surfaceId: "front",
          layerId: "artwork",
          objectId: "image",
          objectType: "image",
        },
        visual: { type: "image", src: "/base.png" },
        placement: { frame: { x: 0, y: 0, width: 100, height: 100 } },
        ordering: { layerId: "artwork" },
      },
    ]);

    intents.patchIntent("source-a", {
      id: "image",
      visual: { replacement: { src: "/source-a.png" } },
    });
    intents.patchIntent("source-b", {
      id: "image",
      placement: { frame: { x: 10, y: 20, width: 30, height: 40 } },
      props: { opacity: 0.5 },
    });

    let node = intents.getGraph().layers[0]?.nodes[0];
    assertEqual(
      node?.visual?.src,
      "/source-a.png",
      "runtime patches from one source should keep visual replacement",
    );
    assertDeepEqual(
      node?.frame,
      { x: 10, y: 20, width: 30, height: 40 },
      "runtime patches from another source should keep placement",
    );
    assertEqual(
      node?.props.opacity,
      0.5,
      "runtime patches from another source should keep props",
    );

    assertEqual(
      intents.clearRuntimePatches("source-b"),
      true,
      "clearing one runtime patch source should report a change",
    );
    node = intents.getGraph().layers[0]?.nodes[0];
    assertEqual(
      node?.visual?.src,
      "/source-a.png",
      "clearing one source should not remove another source's visual patch",
    );
    assertDeepEqual(
      node?.frame,
      { x: 0, y: 0, width: 100, height: 100 },
      "clearing one source should remove only that source's placement patch",
    );

    assertEqual(
      intents.clearRuntimePatch("source-a", "image"),
      true,
      "clearing one intent patch should report a change",
    );
    node = intents.getGraph().layers[0]?.nodes[0];
    assertEqual(
      node?.visual?.src,
      "/base.png",
      "clearing the remaining source patch should restore the base source",
    );
    intents.setRuntimeConditionValue("session.image.active", true);
    assertDeepEqual(
      changes.map((event) => event.reason),
      [
        { type: "document-replaced" },
        {
          type: "runtime-patch",
          operation: "upsert",
          sourceId: "source-a",
          intentIds: ["image"],
        },
        {
          type: "runtime-patch",
          operation: "upsert",
          sourceId: "source-b",
          intentIds: ["image"],
        },
        {
          type: "runtime-patch",
          operation: "clear",
          sourceId: "source-b",
          intentIds: ["image"],
        },
        {
          type: "runtime-patch",
          operation: "remove",
          sourceId: "source-a",
          intentIds: ["image"],
        },
        {
          type: "runtime-condition",
          operation: "set",
          keys: ["session.image.active"],
        },
      ],
      "render intent changes should preserve their semantic origin",
    );
  });
}

async function testRenderIntentDocumentUpdatesAreScoped() {
  await withRuntime(async (runtime) => {
    const intents = runtime.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    const changes: RenderIntentChangeEvent[] = [];
    intents.onDidChange((event) => changes.push(event));
    const createIntent = (id: string, opacity: number) => ({
      id,
      subject: {
        kind: "object" as const,
        surfaceId: "front",
        layerId: "art",
        objectId: id,
      },
      visual: { type: "rect" as const },
      ordering: { layerId: "art" },
      props: { opacity, width: 10, height: 10 },
    });
    intents.setDocumentIntents([
      createIntent("first", 1),
      createIntent("second", 1),
    ]);
    changes.length = 0;

    intents.updateDocumentIntents([
      createIntent("first", 0.5),
      createIntent("second", 1),
    ]);
    assertDeepEqual(
      changes.map((event) => event.reason),
      [{ type: "document-updated", intentIds: ["first"] }],
      "document updates should invalidate only semantically changed intents",
    );

    changes.length = 0;
    intents.updateDocumentIntents([
      createIntent("first", 0.5),
      createIntent("second", 1),
    ]);
    assertEqual(
      changes.length,
      0,
      "equivalent document updates should not emit render invalidations",
    );
  });
}

async function testSurfaceFrameImportsOnlyEmitSemanticChanges() {
  const frames = new DefaultSurfaceFrameService();
  const changes: string[] = [];
  frames.onAnyFramesChange((event) => changes.push(event.surfaceId));
  const front = {
    previewBounds: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 80 },
    productionFrame: { xMm: 5, yMm: 5, widthMm: 90, heightMm: 70 },
  };
  frames.importFrames({ front });
  assertDeepEqual(changes, ["front"], "initial frame import should emit once");

  changes.length = 0;
  frames.importFrames({ front: { ...front } });
  assertEqual(
    changes.length,
    0,
    "equivalent frame imports should not invalidate scene layout",
  );

  frames.importFrames({
    front: {
      ...front,
      productionFrame: { ...front.productionFrame, widthMm: 88 },
    },
  });
  assertDeepEqual(
    changes,
    ["front"],
    "changed frames should invalidate only their surface",
  );
}

async function testRenderIntentPatchEntriesAreSortedDeterministically() {
  await withRuntime(async (runtime) => {
    const intents = runtime.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    intents.setDocumentIntents([
      {
        id: "image",
        subject: {
          kind: "object",
          surfaceId: "front",
          layerId: "artwork",
          objectId: "image",
        },
        visual: { type: "image", src: "/base.png" },
        ordering: { layerId: "artwork" },
      },
    ]);

    intents.patchIntentEntry({
      sourceId: "app:late",
      patch: { id: "image", visual: { replacement: { src: "/late.png" } } },
      priority: 5,
      phase: "runtime",
      sequence: 1,
    });
    intents.patchIntentEntry({
      sourceId: "app:early",
      patch: { id: "image", visual: { replacement: { src: "/early.png" } } },
      priority: 10,
      phase: "runtime",
      sequence: 0,
    });

    const node = intents.getGraph().layers[0]?.nodes[0];
    assertEqual(
      node?.visual?.src,
      "/early.png",
      "higher priority runtime patch should be applied later",
    );
  });
}

async function testRenderIntentPatchClearRemovesOnlyTargetField() {
  await withRuntime(async (runtime) => {
    const intents = runtime.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    intents.setDocumentIntents([
      {
        id: "image",
        subject: {
          kind: "object",
          surfaceId: "front",
          layerId: "artwork",
          objectId: "image",
        },
        visual: {
          type: "image",
          src: "/base.png",
          replacement: { src: "/replacement.png" },
          fallback: { src: "/fallback.png" },
        },
        placement: { frame: { x: 0, y: 0, width: 10, height: 10 } },
        ordering: { layerId: "artwork" },
      },
    ]);

    intents.patchIntent("app:clear", {
      id: "image",
      clear: ["visual.replacement"],
    });

    const node = intents.getGraph().layers[0]?.nodes[0];
    assertEqual(node?.visual?.src, "/fallback.png");
    assertDeepEqual(node?.frame, { x: 0, y: 0, width: 10, height: 10 });
  });
}

async function testRenderIntentPatchDiagnosticsAreTyped() {
  await withRuntime(async (runtime) => {
    const intents = runtime.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    intents.setDocumentIntents([
      {
        id: "image",
        subject: {
          kind: "object",
          surfaceId: "front",
          layerId: "artwork",
          objectId: "image",
        },
        visual: { type: "image", src: "/base.png" },
        ordering: { layerId: "artwork" },
      },
    ]);

    intents.patchIntentEntry({
      sourceId: "capability:first",
      patch: { id: "image", visual: { replacement: { src: "/first.png" } } },
      sequence: 0,
    });
    intents.patchIntentEntry({
      sourceId: "capability:second",
      patch: { id: "image", visual: { replacement: { src: "/second.png" } } },
      sequence: 1,
    });
    intents.patchIntent("app:invalid", {
      id: "missing",
      clear: ["id"],
    });

    const diagnostics = intents.getGraph().diagnostics;
    assert(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "render-intent-field-conflict" &&
          diagnostic.severity === "warning" &&
          diagnostic.field === "visual.replacement",
      ),
      "conflicting critical fields should produce typed diagnostics",
    );
    assert(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "render-intent-patch-base-missing" &&
          diagnostic.severity === "error" &&
          diagnostic.patchId === "missing",
      ),
      "missing base intent should produce typed diagnostics",
    );
  });
}

async function testRenderIntentInteractionAspectCarriesDeclarativeState() {
  await withRuntime(async (runtime) => {
    const intents = runtime.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    intents.setDocumentIntents([
      {
        id: "image",
        subject: {
          kind: "object",
          surfaceId: "front",
          layerId: "artwork",
          objectId: "image",
          objectType: "image",
        },
        visual: { type: "image", src: "/base.png" },
        coordinateSpace: "screen",
        placement: { frame: { x: 0, y: 0, width: 100, height: 100 } },
        ordering: { layerId: "artwork" },
        export: {
          keys: ["image.export"],
          tags: [" design ", "design", "mockup"],
        },
        props: { fill: "red" },
        data: { locked: false },
        interaction: {
          manipulation: {
            move: {
              enabled: true,
              constraints: [
                {
                  activeWhen: { op: "const", value: true },
                  spec: { type: "grid.snap", params: { size: 10 } },
                },
              ],
            },
            resize: { enabled: true },
            rotate: { enabled: true },
          },
          enabledWhen: {
            op: "truthy",
            ref: { source: "context", key: "can-interact" },
          },
        },
      },
    ]);
    intents.patchIntentEntry({
      sourceId: "constraints:first",
      phase: "interaction",
      sequence: 1,
      patch: {
        id: "image",
        interaction: {
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
        },
      },
    });
    intents.patchIntentEntry({
      sourceId: "constraints:second",
      phase: "interaction",
      sequence: 2,
      patch: {
        id: "image",
        interaction: {
          manipulation: {
            move: {
              enabled: true,
              constraints: [
                {
                  activeWhen: {
                    op: "in",
                    ref: { source: "activeToolId" },
                    values: ["move"],
                  },
                  spec: { type: "axis.lock", mode: "x" },
                },
              ],
            },
          },
        },
      },
    });

    const node = intents.getGraph().layers[0]?.nodes[0];
    assertEqual(
      node?.props.selectable,
      undefined,
      "interaction should not write renderer-specific selectable props",
    );
    assertEqual(
      node?.props.evented,
      undefined,
      "interaction should not write renderer-specific evented props",
    );
    assertEqual(
      node?.data.locked,
      false,
      "lock state should remain document data rather than interaction state",
    );
    assertDeepEqual(
      node?.interaction,
      {
        manipulation: {
          move: {
            enabled: true,
            constraints: [
              {
                activeWhen: { op: "const", value: true },
                spec: { type: "grid.snap", params: { size: 10 } },
              },
              {
                spec: {
                  type: "rect.contain",
                  params: {
                    rect: { left: 0, top: 0, width: 100, height: 100 },
                  },
                },
              },
              {
                activeWhen: {
                  op: "in",
                  ref: { source: "activeToolId" },
                  values: ["move"],
                },
                spec: { type: "axis.lock", mode: "x" },
              },
            ],
          },
          resize: { enabled: true },
          rotate: { enabled: true },
        },
        enabledWhen: {
          op: "truthy",
          ref: { source: "context", key: "can-interact" },
        },
      },
      "interaction aspect should carry merged constraints in patch order",
    );
    assertEqual(
      node?.data.interactionComponents,
      undefined,
      "interaction should not emit legacy interaction component data",
    );
    assertEqual(
      node?.data.interactionConstraints,
      undefined,
      "interaction constraints should stay on the graph interaction aspect",
    );
    assertEqual(
      node?.coordinateSpace,
      "screen",
      "render intent coordinate space should become graph node state",
    );
    assertDeepEqual(
      node?.exportKeys,
      ["image", "image.export"],
      "render intent export keys should include the render node id",
    );
    assertDeepEqual(
      node?.tags,
      ["design", "mockup"],
      "render intent export tags should normalize into graph node state",
    );
    assertEqual(
      "exportable" in ((node ?? {}) as unknown as Record<string, unknown>),
      false,
      "render graph node should not expose exportable",
    );
  });
}

async function testRenderIntentObjectLocalEffects() {
  await withRuntime(async (runtime) => {
    const intents = runtime.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    intents.setDocumentIntents([
      {
        id: "clip-target",
        subject: {
          kind: "object",
          surfaceId: "front",
          layerId: "artwork",
          objectId: "target",
        },
        visual: { type: "rect" },
        ordering: { layerId: "artwork" },
        props: { width: 10, height: 10 },
        effects: [
          {
            type: "clipPath",
            id: "clip.target",
            source: {
              id: "clip-source",
              type: "rect",
              props: { width: 5, height: 5 },
            },
            coordinateMode: "absolute",
          },
        ],
      },
    ]);

    const effect = intents.getGraph().layers[0]?.nodes[0]?.effects[0];
    assertDeepEqual(
      {
        coordinateMode: effect?.coordinateMode,
        id: effect?.id,
        sourceId: effect?.source.id,
      },
      {
        coordinateMode: "absolute",
        id: "clip.target",
        sourceId: "clip-source",
      },
      "clip effects should stay local on the render graph node",
    );
    assertEqual(
      "targetLayerIds" in
        ((effect ?? {}) as unknown as Record<string, unknown>),
      false,
      "clip effects should not expose global layer selectors",
    );
    assertEqual(
      "targetSubjectIds" in
        ((effect ?? {}) as unknown as Record<string, unknown>),
      false,
      "clip effects should not expose global subject selectors",
    );
  });
}

async function testRenderIntentPatchMergeHelper() {
  const base = {
    id: "object",
    subject: {
      kind: "object" as const,
      surfaceId: "front",
      layerId: "artwork",
      objectId: "object",
    },
    visual: { type: "image" as const, src: "/base.png" },
    placement: { frame: { x: 0, y: 0, width: 10, height: 20 } },
    coordinateSpace: "scene" as const,
    ordering: { layerId: "artwork", layerOrder: 1, objectOrder: 2 },
    props: { opacity: 0.5 },
  };

  const basePatch = mergeRenderIntentPatchDraft([base], {
    id: "object",
    visual: { replacement: { src: "/replacement.png" } },
    props: { selectable: false },
  });
  assertEqual(basePatch.diagnostics.length, 0);
  assertEqual(basePatch.draft?.visual?.src, "/base.png");
  assertEqual(basePatch.draft?.visual?.replacement?.src, "/replacement.png");
  assertEqual(basePatch.draft?.props?.opacity, 0.5);
  assertEqual(basePatch.draft?.props?.selectable, false);
  assertEqual(basePatch.draft?.coordinateSpace, "scene");

  const newIntentPatch = mergeRenderIntentPatchDraft([], {
    id: "overlay",
    subject: {
      kind: "object",
      surfaceId: "front",
      layerId: "overlay-layer",
      objectId: "overlay",
    },
    ordering: { layerId: "overlay-layer", channel: "overlay" },
    visual: { type: "rect" },
  });
  assertEqual(newIntentPatch.diagnostics.length, 0);
  assertEqual(newIntentPatch.draft?.subject.surfaceId, "front");
  assertEqual(newIntentPatch.draft?.ordering.layerId, "overlay-layer");

  const missingBasePatch = mergeRenderIntentPatchDraft([], {
    id: "broken",
    visual: { type: "rect" },
  });
  assertEqual(missingBasePatch.draft, undefined);
  assertEqual(
    missingBasePatch.diagnostics[0]?.code,
    "render-intent-patch-base-missing",
  );
}

async function testSceneLayoutModelDefaultsAndPadding() {
  const config = {
    get: <T>(_key: string, defaultValue?: T) => defaultValue,
  };

  const state = readSizeState(config as any);
  assertEqual(state.unit, "mm");
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

async function testSceneLayoutModelUsesExportFrames() {
  const canvas = new FakeLayoutCanvasService(800, 600);
  const layout = computeTestSceneLayout(canvas, {
    aspectRatio: 1,
    constraintMode: "free",
    maxMm: 2000,
    minMm: 10,
    sceneFrames: {
      exportFrame: { xMm: -10, yMm: -10, widthMm: 120, heightMm: 120 },
      previewBounds: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 },
      productionFrame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 },
    },
    stepMm: 0.1,
    unit: "mm",
    viewPadding: "16%",
  });

  assert(layout, "outset layout should resolve");
  assertClose(layout.scale, 4.08);
  assertClose(layout.trimRect.left, 196);
  assertClose(layout.trimRect.width, 408);
  assertClose(layout.cutRect.left, 155.2);
  assertClose(layout.cutRect.width, 489.6);

  const insetLayout = computeTestSceneLayout(canvas, {
    aspectRatio: 1,
    constraintMode: "free",
    maxMm: 2000,
    minMm: 10,
    sceneFrames: {
      exportFrame: { xMm: 10, yMm: 10, widthMm: 80, heightMm: 80 },
      previewBounds: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 },
      productionFrame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 },
    },
    stepMm: 0.1,
    unit: "mm",
    viewPadding: "16%",
  });

  assert(insetLayout, "inset layout should resolve");
  assertClose(insetLayout.trimRect.width, 408);
  assertClose(insetLayout.cutRect.width, 326.4);
}

async function testSceneLayoutModelPositionsProductionFrame() {
  const canvas = new FakeLayoutCanvasService(800, 600);
  const layout = computeTestSceneLayout(canvas, {
    aspectRatio: 1299 / 709,
    constraintMode: "free",
    maxMm: 2000,
    minMm: 0.1,
    sceneFrames: {
      previewBounds: { xMm: 0, yMm: 0, widthMm: 1299, heightMm: 709 },
      productionFrame: { xMm: 265, yMm: 319, widthMm: 770, heightMm: 300 },
    },
    stepMm: 0.001,
    unit: "mm",
    viewPadding: 0,
  });

  assert(layout, "production frame layout should resolve");
  assertClose(layout.scale, 800 / 1299);
  assertClose(layout.trimRect.centerX, 650 * layout.scale);
  assertClose(layout.trimRect.left, 265 * layout.scale);
  assertClose(layout.trimRect.top, 300 - 150 * layout.scale);
  assertClose(layout.trimRect.width, 770 * layout.scale);
  assertClose(layout.trimRect.height, 300 * layout.scale);
  assertClose(layout.cutRect.left, layout.trimRect.left);
  assertClose(layout.cutRect.width, layout.trimRect.width);
}

async function testSceneLayoutModelClampsFocusedProductionFrame() {
  const canvas = new FakeLayoutCanvasService(800, 600);
  const layout = computeTestSceneLayout(canvas, {
    aspectRatio: 1,
    constraintMode: "free",
    maxMm: 2000,
    minMm: 0.1,
    sceneFrames: {
      previewBounds: { xMm: 0, yMm: 0, widthMm: 500, heightMm: 500 },
      productionFrame: { xMm: 0, yMm: 0, widthMm: 120, heightMm: 120 },
    },
    stepMm: 0.001,
    unit: "mm",
    viewPadding: 0,
  });

  assert(layout, "edge production frame layout should resolve");
  assertClose(layout.scale, 600 / 500);
  assertClose(layout.trimRect.left, 200);
  assertClose(layout.trimRect.top, 0);
}

async function testSceneLayoutModelUsesExplicitExportFrame() {
  const canvas = new FakeLayoutCanvasService(800, 600);
  const layout = computeTestSceneLayout(canvas, {
    aspectRatio: 1,
    constraintMode: "free",
    maxMm: 2000,
    minMm: 0.1,
    sceneFrames: {
      exportFrame: { xMm: 10, yMm: 15, widthMm: 80, heightMm: 70 },
      previewBounds: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 },
      productionFrame: { xMm: 20, yMm: 20, widthMm: 50, heightMm: 40 },
    },
    stepMm: 0.001,
    unit: "mm",
    viewPadding: 0,
  });

  assert(layout, "explicit export frame layout should resolve");
  assertClose(layout.cutRect.left, 190);
  assertClose(layout.cutRect.width, 80 * layout.scale);
}

async function testImageGeometryKeepsIntrinsicSizeAndResolvesFit() {
  const frame = { left: 10, top: 20, width: 200, height: 100 };
  const source = { width: 400, height: 400 };

  assertDeepEqual(resolveImageFitScale(frame, source, "cover"), {
    x: 0.5,
    y: 0.5,
  });
  assertDeepEqual(resolveImageFitScale(frame, source, "contain"), {
    x: 0.25,
    y: 0.25,
  });
  assertDeepEqual(resolveImageFitScale(frame, source, "stretch"), {
    x: 0.5,
    y: 0.25,
  });

  const resolved = resolveImageGeometry({
    source: { src: "/image.png", size: source },
    frame: { space: "object-local", ...frame },
    fit: "cover",
    transform: {
      anchorX: 0.25,
      anchorY: 0.75,
      zoom: 1.2,
      rotation: 15,
      opacity: 0.8,
    },
    clip: { space: "object-local", ...frame },
  });
  assertEqual(resolved.imageLocalBounds.width, 400);
  assertEqual(resolved.imageLocalBounds.height, 400);
  assertEqual(resolved.imageLocalToObjectLocal.from, "object-local");
  assertEqual(resolved.imageLocalToObjectLocal.to, "object-local");
  assertEqual(resolved.opacity, 0.8);
  assertEqual(resolved.clip?.space, "object-local");
}

async function main() {
  const tests: Array<[string, () => Promise<void>]> = [
    ["activates extensions in derived order", testOutOfOrderActivation],
    [
      "keeps missing-service extensions pending until flush after registration",
      testPendingUntilRequiredServiceArrives,
    ],
    ["fails cyclic extensions explicitly", testCycleDetection],
    [
      "isolates activation failures and rolls back partial dynamic registrations",
      testActivationFailureDoesNotLeakDynamicContributions,
    ],
    [
      "registers capabilities without toolbar tools",
      testCapabilityContributionWithoutTool,
    ],
    [
      "exposes typed runtime capability facades while keeping command bridge",
      testRuntimeCapabilityFacadeApiKeepsCommandBridge,
    ],
    [
      "throws clearly when a runtime capability facade is missing",
      testRuntimeCapabilityFacadeApiThrowsForMissingFacade,
    ],
    [
      "unregister cleans up config definitions, capabilities, and commands",
      testUnregisterCleansDefinitionsCapabilitiesAndCommands,
    ],
    [
      "fails duplicate capability ids without leaking dynamic contributions",
      testDuplicateCapabilityIdsFailWithoutLeakingContributions,
    ],
    [
      "keeps capability registry contracts immutable and observable",
      testCapabilityRegistryContractUsesDefensiveCopiesAndEvents,
    ],
    ["manages headless scene layers and elements", testSceneLayersAndElements],
    ["selects scene layers and elements", testSceneSelectors],
    [
      "validates and clones headless scene contract state",
      testSceneServiceContractValidatesAndClonesState,
    ],
    [
      "batches and rolls back scene transactions",
      testSceneTransactionsBatchAndRollback,
    ],
    [
      "removing a scene layer removes scoped elements",
      testRemovingSceneLayerRemovesScopedElements,
    ],
    ["manages multiple scoped scenes", testSceneServiceManagesMultipleScenes],
    [
      "rolls back multi-scene transactions",
      testSceneTransactionRollsBackMultipleScenes,
    ],
    ["manages sessions without registered tools", testSessionsWithoutTools],
    ["emits generic session lifecycle events", testSessionLifecycleEvents],
    ["coordinates exclusive session requests", testExclusiveSessionRequests],
    [
      "owns V2 session lifecycle and resources",
      testSessionV2OwnsLifecycleAndResources,
    ],
    [
      "recovers failed V2 commits and forces terminal cleanup",
      testSessionV2RecoversCommitAndForcesTerminalCleanup,
    ],
    [
      "tracks focused session scene roots and ownership",
      testSessionSceneV2TracksFocusedRootAndOwnership,
    ],
    ["computes geometry primitives", testGeometryPrimitives],
    [
      "keeps intrinsic image size while resolving fit geometry",
      testImageGeometryKeepsIntrinsicSizeAndResolvesFit,
    ],
    [
      "computes drag interaction snaps and constraints",
      testDragInteractionSnapsAndConstrains,
    ],
    [
      "registers and queries geometry sources",
      testGeometrySourceServiceRegistry,
    ],
    [
      "resolves generic constraints through capability",
      testConstraintResolverServiceBuiltins,
    ],
    [
      "owns interaction state, constraints, activation, and commits",
      testInteractionServiceOwnsStateConstraintsAndDispatch,
    ],
    [
      "session dirty trackers can block leave",
      testSessionDirtyTrackerCanBlockLeave,
    ],
    [
      "EventBus off ignores missing handlers",
      testEventBusOffMissingHandlerPreservesListeners,
    ],
    [
      "keeps render intent runtime patches source scoped",
      testRenderIntentRuntimePatchesAreSourceScoped,
    ],
    [
      "scopes document render intent updates by semantic diff",
      testRenderIntentDocumentUpdatesAreScoped,
    ],
    [
      "emits surface frame changes only for semantic updates",
      testSurfaceFrameImportsOnlyEmitSemanticChanges,
    ],
    [
      "sorts render intent patch entries deterministically",
      testRenderIntentPatchEntriesAreSortedDeterministically,
    ],
    [
      "clears render intent patch fields explicitly",
      testRenderIntentPatchClearRemovesOnlyTargetField,
    ],
    [
      "emits typed render intent patch diagnostics",
      testRenderIntentPatchDiagnosticsAreTyped,
    ],
    [
      "carries declarative render intent interaction",
      testRenderIntentInteractionAspectCarriesDeclarativeState,
    ],
    [
      "keeps render intent effects object-local",
      testRenderIntentObjectLocalEffects,
    ],
    [
      "merges render intent patches with diagnostics",
      testRenderIntentPatchMergeHelper,
    ],
    [
      "resolves scene layout defaults and responsive padding",
      testSceneLayoutModelDefaultsAndPadding,
    ],
    [
      "computes scene export frame layouts",
      testSceneLayoutModelUsesExportFrames,
    ],
    [
      "positions trim and cut rectangles from production frame",
      testSceneLayoutModelPositionsProductionFrame,
    ],
    [
      "clamps focused production frame to keep preview visible",
      testSceneLayoutModelClampsFocusedProductionFrame,
    ],
    [
      "uses explicit export frame instead of derived cut frame",
      testSceneLayoutModelUsesExplicitExportFrame,
    ],
  ];

  for (const [name, run] of tests) {
    await run();
    console.log(`PASS ${name}`);
  }

  console.log("All core runtime tests passed.");
}

main().catch((error) => {
  console.error("Core runtime tests failed.");
  console.error(error);
  process.exit(1);
});
