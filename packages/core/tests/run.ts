import {
  CAPABILITY_REGISTRY_SERVICE,
  COMMAND_SERVICE,
  Pooder,
  RENDER_INTENT_SERVICE,
  SCENE_SERVICE,
  TOOL_REGISTRY_SERVICE,
  TOOL_SESSION_SERVICE,
  WORKFLOW_SESSION_SERVICE,
  buildSceneGeometry,
  computeSceneLayout,
  readSizeState,
  resolveViewPaddingPx,
  createServiceToken,
  type CanvasService,
  type ExtensionDefinition,
  type RenderIntentService,
  type SceneChangeEvent,
  type SceneService,
  type Service,
  type ToolContribution,
  type WorkflowSessionChangeEvent,
  type WorkflowSessionService,
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

  registerRenderProducer() {
    return { dispose: () => {} };
  }
  unregisterRenderProducer() {
    return false;
  }
  requestRenderFromProducers() {}
  async flushRenderFromProducers() {}
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
  }) {
    const availableWidth = Math.max(0, options.containerWidth - options.padding * 2);
    const availableHeight = Math.max(0, options.containerHeight - options.padding * 2);
    const scale = Math.min(
      availableWidth / options.widthMm,
      availableHeight / options.heightMm,
    );
    const width = options.widthMm * scale;
    const height = options.heightMm * scale;
    return {
      scale,
      offsetX: (options.containerWidth - width) / 2,
      offsetY: (options.containerHeight - height) / 2,
      width,
      height,
    };
  }
  getObjects() {
    return [];
  }
  getPassObjects() {
    return [];
  }
  getRootLayerObjects() {
    return [];
  }
  getObject() {
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
  setViewportMirror() {}
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
  toScreenRect(rect: { left: number; top: number; width: number; height: number }) {
    return rect;
  }
  toSceneRect(rect: { left: number; top: number; width: number; height: number }) {
    return rect;
  }
  getSceneViewportRect() {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
  getScreenViewportRect() {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
  setLayerVisibility() {
    return false;
  }
  setPassVisibility() {
    return false;
  }
  bringLayerToFront() {}
  bringPassToFront() {}
  async applyPassSpec() {}
  async applyObjectSpecsToRootLayer() {}
  async applyObjectSpecsToPass() {}
  setVisibilityContextValue() {}
  deleteVisibilityContextValue() {
    return false;
  }
  clearVisibilityContextValues() {
    return false;
  }
  syncPassStacking() {}
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
      runtime.services.getOrThrow(COMMAND_SERVICE).getCommand("dependent.command"),
      undefined,
    );

    runtime.services.register(new DeferredDependencyService(), REQUIRED_SERVICE);
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
          ],
          commands: [
            {
              id: "bad.command",
              command: "bad.command",
              title: "bad.command",
              handler: () => "bad",
            },
          ],
          tools: [
            {
              id: "",
              name: "Broken Tool",
              interaction: "instant",
            } as ToolContribution,
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
    assertEqual(
      runtime.services.getOrThrow(TOOL_REGISTRY_SERVICE).listTools().length,
      0,
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
      runtime.capabilities.get<MathCapabilityApi>("pooder.test.math")?.add(2, 3),
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
    assertDeepEqual(changes, [
      { added: ["pooder.test.math"], removed: [] },
    ]);

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

async function testCapabilityCanCoexistWithLegacyTool() {
  await withRuntime(async (runtime) => {
    runtime.extensions.register({
      id: "capability-with-tool",
      contribute() {
        return {
          capabilities: [
            {
              id: "pooder.test.capability-with-tool",
            },
          ],
          tools: [
            {
              id: "legacy.tool",
              name: "Legacy Tool",
              interaction: "instant",
            },
          ],
        };
      },
      activate() {},
    });

    await runtime.extensions.flushActivation();

    assertEqual(
      runtime.services
        .getOrThrow(CAPABILITY_REGISTRY_SERVICE)
        .hasCapability("pooder.test.capability-with-tool"),
      true,
    );
    assertEqual(
      runtime.services.getOrThrow(TOOL_REGISTRY_SERVICE).hasTool("legacy.tool"),
      true,
    );
  });
}

async function testUnregisterCleansDefinitionsCommandsAndTools() {
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
          tools: [
            {
              id: "cleanup.tool",
              name: "Cleanup Tool",
              interaction: "instant",
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
      runtime.services.getOrThrow(TOOL_REGISTRY_SERVICE).hasTool("cleanup.tool"),
      true,
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
      runtime.services.getOrThrow(COMMAND_SERVICE).getCommand("cleanup.command"),
      undefined,
    );
    assertEqual(
      runtime.services.getOrThrow(TOOL_REGISTRY_SERVICE).hasTool("cleanup.tool"),
      false,
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
    const events: Array<{ added: string[]; removed: string[]; extensionId?: string }> =
      [];
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
      scene.listLayers().map((layer) => layer.id),
      ["background", "artwork"],
    );
    assertEqual(scene.getLayer("background")?.visible, true);

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

    assertEqual(scene.getElement("image-1")?.type, "image");
    assertEqual(scene.getElement("image-1")?.metadata?.selected, true);
    assertDeepEqual(
      scene.listElements({ layerId: "artwork" }).map((element) => element.id),
      ["image-1", "path-1", "text-1"],
    );
    assertDeepEqual(
      scene.listElements({ type: "path", visible: false }).map(
        (element) => element.id,
      ),
      ["path-1"],
    );
    assertEqual(scene.removeElement("path-1"), true);
    assertEqual(scene.getElement("path-1"), undefined);
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
    assertEqual(scene.getLayer("source")?.metadata?.owner, "app");

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

    const stored = scene.getElement("rect");
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
      scene.listElements({ layerId: "target" }).map((element) => element.id),
      ["rect"],
    );
    assertEqual(scene.getElement("rect")?.metadata?.selected, true);

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
    assertDeepEqual(changes[0].layers.added, ["content"]);
    assertDeepEqual(changes[0].elements.added, ["rect-1"]);
    assertDeepEqual(changes[0].elements.updated, ["rect-1"]);
    assertEqual(scene.getElement("rect-1")?.type, "rect");

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

    assertEqual(scene.getLayer("rollback"), undefined);
    assertEqual(scene.getElement("text-1"), undefined);
    assertEqual(changes.length, 1);
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
    assertEqual(scene.getLayer("temporary"), undefined);
    assertEqual(scene.getElement("temporary-text"), undefined);
  });
}

async function testWorkflowSessionsWithoutTools() {
  await withRuntime(async (runtime) => {
    const workflowSessions = runtime.services.getOrThrow<WorkflowSessionService>(
      WORKFLOW_SESSION_SERVICE,
    );
    const changes: WorkflowSessionChangeEvent[] = [];
    let beginCount = 0;
    let validateCount = 0;
    let commitCount = 0;

    workflowSessions.onDidChange((event) => changes.push(event));
    workflowSessions.registerSession({
      id: "storefront.image-placement",
      leavePolicy: "commit",
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

    await workflowSessions.begin("storefront.image-placement");
    workflowSessions.markDirty("storefront.image-placement");

    const leaveResult = await workflowSessions.handleBeforeLeave(
      "storefront.image-placement",
    );

    assertDeepEqual(leaveResult, { decision: "allow" });
    assertEqual(beginCount, 1);
    assertEqual(validateCount, 1);
    assertEqual(commitCount, 1);
    assertEqual(
      workflowSessions.getState("storefront.image-placement").status,
      "idle",
    );
    assertEqual(
      workflowSessions.getState("storefront.image-placement").dirty,
      false,
    );
    assertDeepEqual(
      changes.map((event) => event.reason),
      ["begin", "dirty", "commit"],
    );
  });
}

async function testWorkflowDirtyTrackerCanBlockLeave() {
  await withRuntime(async (runtime) => {
    const workflowSessions = runtime.services.getOrThrow(
      WORKFLOW_SESSION_SERVICE,
    );
    const tracker = workflowSessions.registerDirtyTracker(
      "storefront.feature",
      () => true,
    );

    await workflowSessions.begin("storefront.feature");
    const leaveResult =
      await workflowSessions.handleBeforeLeave("storefront.feature");

    assertDeepEqual(leaveResult, {
      decision: "blocked",
      reason: "session-dirty",
    });
    assertEqual(workflowSessions.hasActiveSession("storefront.feature"), true);

    tracker.dispose();
    workflowSessions.markDirty("storefront.feature", false);
    assertDeepEqual(
      await workflowSessions.handleBeforeLeave("storefront.feature"),
      { decision: "allow" },
    );
  });
}

async function testLegacyToolSessionUsesWorkflowSessionState() {
  await withRuntime(async (runtime) => {
    const calls: string[] = [];
    runtime.extensions.register({
      id: "legacy-tool-session",
      contribute() {
        return {
          commands: [
            {
              id: "legacy.begin",
              command: "legacy.begin",
              title: "legacy.begin",
              handler: () => calls.push("begin"),
            },
            {
              id: "legacy.rollback",
              command: "legacy.rollback",
              title: "legacy.rollback",
              handler: () => calls.push("rollback"),
            },
          ],
          tools: [
            {
              id: "legacy.session-tool",
              name: "Legacy Session Tool",
              interaction: "session",
              commands: {
                begin: "legacy.begin",
                rollback: "legacy.rollback",
              },
              session: {
                autoBegin: true,
                leavePolicy: "rollback",
              },
            },
          ],
        };
      },
      activate() {},
    });

    await runtime.extensions.flushActivation();
    const toolSessions = runtime.services.getOrThrow(TOOL_SESSION_SERVICE);
    const workflowSessions = runtime.services.getOrThrow(
      WORKFLOW_SESSION_SERVICE,
    );

    await runtime.workbench.activate("legacy.session-tool");
    toolSessions.markDirty("legacy.session-tool");

    assertEqual(toolSessions.getState("legacy.session-tool").status, "active");
    assertEqual(
      workflowSessions.getState("legacy.session-tool").status,
      "active",
    );
    assertEqual(workflowSessions.isDirty("legacy.session-tool"), true);

    const result = await runtime.workbench.deactivate();

    assertEqual(result.ok, true);
    assertDeepEqual(calls, ["begin", "rollback"]);
    assertEqual(toolSessions.getState("legacy.session-tool").status, "idle");
    assertEqual(workflowSessions.isDirty("legacy.session-tool"), false);
  });
}

async function testRenderIntentRuntimePatchesAreSourceScoped() {
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
  });
}

async function testSceneLayoutModelDefaultsAndPadding() {
  const config = {
    get: <T>(_key: string, defaultValue?: T) => defaultValue,
  };

  const state = readSizeState(config as any);
  assertEqual(state.viewPadding, "16%");
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

async function testSceneLayoutModelComputesCutModes() {
  const canvas = new FakeLayoutCanvasService(800, 600);
  const layout = computeSceneLayout(canvas, {
    actualHeightMm: 100,
    actualWidthMm: 100,
    aspectRatio: 1,
    constraintMode: "free",
    cutMarginMm: 10,
    cutMode: "outset",
    maxMm: 2000,
    minMm: 10,
    stepMm: 0.1,
    unit: "mm",
    viewPadding: "16%",
  });

  assert(layout, "outset layout should resolve");
  assertClose(layout.scale, 3.4);
  assertClose(layout.cutRect.left, 196);
  assertClose(layout.cutRect.width, 408);
  assertClose(layout.trimRect.left, 230);
  assertClose(layout.trimRect.width, 340);

  const insetLayout = computeSceneLayout(canvas, {
    actualHeightMm: 100,
    actualWidthMm: 100,
    aspectRatio: 1,
    constraintMode: "free",
    cutMarginMm: 10,
    cutMode: "inset",
    maxMm: 2000,
    minMm: 10,
    stepMm: 0.1,
    unit: "mm",
    viewPadding: "16%",
  });

  assert(insetLayout, "inset layout should resolve");
  assertClose(insetLayout.trimRect.width, 408);
  assertClose(insetLayout.cutRect.width, 326.4);
}

async function testSceneLayoutModelBuildsDielineGeometry() {
  const canvas = new FakeLayoutCanvasService(800, 600);
  const layout = computeSceneLayout(canvas, {
    actualHeightMm: 100,
    actualWidthMm: 100,
    aspectRatio: 1,
    constraintMode: "free",
    cutMarginMm: 10,
    cutMode: "outset",
    maxMm: 2000,
    minMm: 10,
    stepMm: 0.1,
    unit: "mm",
    viewPadding: "16%",
  });
  assert(layout, "layout should resolve before geometry");

  const config = {
    get: (key: string, defaultValue?: unknown) => {
      const values: Record<string, unknown> = {
        "dieline.customSourceHeightPx": 240,
        "dieline.customSourceWidthPx": 320,
        "dieline.radius": "5mm",
        "dieline.shape": "circle",
        "dieline.shapeStyle": { fitMode: "contain", lobeSpread: 2 },
      };
      return Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : defaultValue;
    },
  };
  const geometry = buildSceneGeometry(config as any, layout);

  assertEqual(geometry.shape, "circle");
  assertEqual(geometry.shapeStyle.fitMode, "contain");
  assertEqual(geometry.shapeStyle.lobeSpread, 1);
  assertEqual(geometry.width, layout.trimRect.width);
  assertClose(geometry.radius, 17);
  assertClose(geometry.offset, 34);
  assertEqual(geometry.customSourceWidthPx, 320);
  assertEqual(geometry.customSourceHeightPx, 240);
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
      "allows capabilities to coexist with legacy tools",
      testCapabilityCanCoexistWithLegacyTool,
    ],
    [
      "unregister cleans up config definitions, capabilities, commands, and tools",
      testUnregisterCleansDefinitionsCommandsAndTools,
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
    [
      "manages workflow sessions without registered tools",
      testWorkflowSessionsWithoutTools,
    ],
    [
      "workflow dirty trackers can block leave",
      testWorkflowDirtyTrackerCanBlockLeave,
    ],
    [
      "legacy tool sessions use workflow session state",
      testLegacyToolSessionUsesWorkflowSessionState,
    ],
    [
      "keeps render intent runtime patches source scoped",
      testRenderIntentRuntimePatchesAreSourceScoped,
    ],
    [
      "resolves scene layout defaults and responsive padding",
      testSceneLayoutModelDefaultsAndPadding,
    ],
    ["computes scene cut mode layouts", testSceneLayoutModelComputesCutModes],
    [
      "builds scene dieline geometry from config",
      testSceneLayoutModelBuildsDielineGeometry,
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
