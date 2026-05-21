import {
  CAPABILITY_REGISTRY_SERVICE,
  COMMAND_SERVICE,
  Pooder,
  RENDER_INTENT_SERVICE,
  SCENE_SERVICE,
  SESSION_SERVICE,
  TOOL_REGISTRY_SERVICE,
  buildSceneGeometry,
  computeSceneLayout,
  computeDragInteraction,
  containsPoint,
  containsRect,
  createRectSnapLines,
  evaluateVisibilityExpr,
  intersectRects,
  mergeRenderIntentPatchDraft,
  normalizeRect,
  projectRectIntoRect,
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
  type SessionChangeEvent,
  type SessionService,
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
  getObjects() {
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

async function testSessionsWithoutTools() {
  await withRuntime(async (runtime) => {
    const sessions = runtime.services.getOrThrow<SessionService>(
      SESSION_SERVICE,
    );
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
      sessions.getSession("session.image-placement.front.slot")?.status,
      "committed",
    );
    assertEqual(
      sessions.getSession("session.image-placement.front.slot")?.dirty,
      false,
    );
    assertEqual(
      sessions.hasActiveSession({
        scope: { surfaceId: "front", subjectId: "slot" },
      }),
      false,
    );
    assertDeepEqual(
      changes.map((event) => event.reason),
      ["create", "dirty", "committing", "commit"],
    );
  });
}

async function testSessionLifecycleEvents() {
  await withRuntime(async (runtime) => {
    const sessions = runtime.services.getOrThrow<SessionService>(
      SESSION_SERVICE,
    );
    const events: Array<{
      reason: string;
      sessionId: string;
    }> = [];

    sessions.onDidChange((event) => {
      events.push({ reason: event.reason, sessionId: event.sessionId });
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

    assertEqual(sessions.getFocusedSessionId(), "image:front:slot");
    assertEqual(sessions.isSessionActive("image:front:slot"), false);
    assertEqual(
      sessions.listSessions({ scope: { channel: "image" } }).length,
      2,
    );
    assertDeepEqual(
      events,
      [
        { reason: "create", sessionId: "image:front:slot" },
        { reason: "create", sessionId: "image:front:slot-2" },
        { reason: "update", sessionId: "image:front:slot" },
        { reason: "focus", sessionId: "image:front:slot" },
        { reason: "committing", sessionId: "image:front:slot" },
        { reason: "commit", sessionId: "image:front:slot" },
        { reason: "cancel", sessionId: "image:front:slot-2" },
      ],
      "sessions should emit unified lifecycle events",
    );
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
  assertEqual(snapped.frame.left, 100, "drag should snap x to the nearest line");
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
  assertEqual(rejected.frame.left, 85, "final projection still enforces bounds");

  assertEqual(
    createRectSnapLines({ left: 0, top: 0, width: 10, height: 20 }).length,
    6,
    "rect snap lines should include edges and centers",
  );
}

async function testSessionDirtyTrackerCanBlockLeave() {
  await withRuntime(async (runtime) => {
    const sessions = runtime.services.getOrThrow<SessionService>(
      SESSION_SERVICE,
    );
    sessions.createSession({
      sessionId: "session.feature",
      scope: { channel: "feature" },
    });
    const tracker = sessions.registerDirtyTracker(
      "session.feature",
      () => true,
    );

    const leaveResult =
      await sessions.handleBeforeLeave("session.feature");

    assertDeepEqual(leaveResult, {
      decision: "blocked",
      reason: "session-dirty",
    });
    assertEqual(sessions.isSessionActive("session.feature"), true);

    tracker.dispose();
    sessions.markDirty("session.feature", false);
    assertDeepEqual(
      await sessions.handleBeforeLeave("session.feature"),
      { decision: "allow" },
    );
  });
}

async function testWorkbenchDoesNotManageSessions() {
  await withRuntime(async (runtime) => {
    runtime.extensions.register({
      id: "tool-session-decoupled",
      contribute() {
        return {
          tools: [
            {
              id: "decoupled.session-tool",
              name: "Decoupled Session Tool",
              interaction: "session",
            },
          ],
        };
      },
      activate() {},
    });

    await runtime.extensions.flushActivation();
    const sessions = runtime.services.getOrThrow<SessionService>(
      SESSION_SERVICE,
    );

    await runtime.workbench.activate("decoupled.session-tool");

    assertEqual(sessions.hasActiveSession(), false);

    const result = await runtime.workbench.deactivate();

    assertEqual(result.ok, true);
    assertEqual(sessions.hasActiveSession(), false);
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

async function testRenderIntentInteractionAspectWritesGraphPropsAndData() {
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
        export: { keys: ["image.export"] },
        props: { selectable: true, evented: false },
        data: { locked: false },
        interaction: {
          selectable: false,
          evented: true,
          locked: true,
          dragConstraints: [
            {
              type: "rect",
              rect: { left: 0, top: 0, width: 100, height: 100 },
              target: "frame",
            },
          ],
        },
      },
    ]);

    const node = intents.getGraph().layers[0]?.nodes[0];
    assertEqual(
      node?.props.selectable,
      false,
      "interaction selectable should override graph props",
    );
    assertEqual(
      node?.props.evented,
      true,
      "interaction evented should override graph props",
    );
    assertEqual(
      node?.data.locked,
      true,
      "interaction locked should override graph data",
    );
    assertDeepEqual(
      node?.data.dragConstraints,
      [
        {
          type: "rect",
          rect: { left: 0, top: 0, width: 100, height: 100 },
          target: "frame",
        },
      ],
      "interaction drag constraints should enter render graph data",
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
  });
}

async function testRenderIntentProjectionAndVisibilityContext() {
  await withRuntime(async (runtime) => {
    const intents = runtime.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    let changeCount = 0;
    const subscription = intents.onDidChange(() => {
      changeCount += 1;
    });

    intents.setDocumentIntents([
      {
        id: "source",
        subject: {
          kind: "object",
          surfaceId: "front",
          layerId: "artwork",
          objectId: "source-subject",
        },
        visual: { type: "rect" },
        ordering: { layerId: "artwork", objectOrder: 0 },
        props: { width: 100, height: 80, opacity: 0.5 },
      },
      {
        id: "projection",
        subject: {
          kind: "layer",
          surfaceId: "front",
          layerId: "overlay",
        },
        projection: {
          sourceSubjectIds: ["source-subject"],
          opacity: 0.4,
          interactive: true,
          suppressSource: true,
        },
        ordering: { layerId: "overlay", stack: 1, objectOrder: 0 },
        export: { visibility: { op: "contextTruthy", key: "show.overlay" } },
      },
    ]);

    const graph = intents.getGraph();
    const sourceNode = graph.layers
      .find((layer) => layer.id === "artwork")
      ?.nodes.find((node) => node.id === "source");
    const projectionNode = graph.layers
      .find((layer) => layer.id === "overlay")
      ?.nodes.find((node) => node.id.startsWith("projection:projection:source"));

    assertEqual(sourceNode?.visible, false, "projection should suppress source in graph");
    assertEqual(
      projectionNode?.projection?.sourceSubjectId,
      "source-subject",
      "projection node should reference its source subject",
    );
    assertEqual(
      projectionNode?.props.opacity,
      0.2,
      "projection opacity should compose with source opacity",
    );
    assertEqual(
      projectionNode?.props.selectable,
      true,
      "interactive projections should become selectable draw nodes",
    );
    assertEqual(
      intents.setVisibilityContextValue("show.overlay", true),
      true,
      "visibility context updates should report changes",
    );
    assertEqual(
      intents.getVisibilityContextValue("show.overlay"),
      true,
      "visibility context should be stored on RenderIntentService",
    );
    assert(
      changeCount >= 2,
      "visibility context updates should notify graph subscribers",
    );

    subscription.dispose();
  });
}

async function testRenderIntentProjectionPreservesSourceVisibility() {
  await withRuntime(async (runtime) => {
    const intents = runtime.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );

    intents.setDocumentIntents([
      {
        id: "hidden.source",
        subject: {
          kind: "object",
          surfaceId: "front",
          layerId: "template",
          objectId: "hidden.source",
        },
        visual: { type: "image", src: "/hidden.png" },
        ordering: { layerId: "template", stack: 1, objectOrder: 0 },
        export: { visible: false },
      },
      {
        id: "conditional.source",
        subject: {
          kind: "object",
          surfaceId: "front",
          layerId: "template",
          objectId: "conditional.source",
        },
        visual: { type: "image", src: "/conditional.png" },
        ordering: { layerId: "template", stack: 1, objectOrder: 1 },
        export: { visibility: { op: "contextTruthy", key: "show.source" } },
      },
      {
        id: "template.projection",
        subject: {
          kind: "layer",
          surfaceId: "front",
          layerId: "session.overlay",
        },
        projection: {
          sourceLayerIds: ["template"],
          suppressSource: true,
        },
        ordering: {
          layerId: "session.overlay",
          stack: 2,
          objectOrder: 0,
        },
        export: { visibility: { op: "contextTruthy", key: "show.session" } },
      },
    ]);

    const projectedNodes = intents
      .getGraph()
      .layers.find((layer) => layer.id === "session.overlay")
      ?.nodes ?? [];
    const hiddenProjection = projectedNodes.find(
      (node) => node.projection?.sourceSubjectId === "hidden.source",
    );
    const conditionalProjection = projectedNodes.find(
      (node) => node.projection?.sourceSubjectId === "conditional.source",
    );

    assertEqual(
      hiddenProjection?.visible,
      false,
      "projection should not make an invisible source visible",
    );
    assertEqual(
      conditionalProjection?.visibility?.op,
      "all",
      "projection should require both source and projection visibility",
    );
    assertEqual(
      evaluateVisibilityExpr(conditionalProjection?.visibility, {
        contextValues: { "show.source": true, "show.session": false },
      }),
      false,
      "projection should hide when its own visibility context is false",
    );
    assertEqual(
      evaluateVisibilityExpr(conditionalProjection?.visibility, {
        contextValues: { "show.source": false, "show.session": true },
      }),
      false,
      "projection should hide when the source visibility context is false",
    );
    assertEqual(
      evaluateVisibilityExpr(conditionalProjection?.visibility, {
        contextValues: { "show.source": true, "show.session": true },
      }),
      true,
      "projection should show when both visibility contexts are true",
    );
  });
}

async function testRenderIntentProjectionPreservesSourceStacking() {
  await withRuntime(async (runtime) => {
    const intents = runtime.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );

    intents.setDocumentIntents([
      {
        id: "template.normal",
        subject: {
          kind: "object",
          surfaceId: "front",
          layerId: "template",
          objectId: "template.normal",
        },
        visual: { type: "image", src: "/normal.png" },
        ordering: { layerId: "template", stack: 1, objectOrder: 0 },
      },
      {
        id: "template.frame",
        subject: {
          kind: "object",
          surfaceId: "front",
          layerId: "template",
          objectId: "template.frame",
        },
        visual: { type: "image", src: "/frame.png" },
        ordering: { layerId: "template", stack: 1, objectOrder: 1 },
      },
      {
        id: "template.projection",
        subject: {
          kind: "layer",
          surfaceId: "front",
          layerId: "session.overlay",
        },
        projection: {
          sourceLayerIds: ["template"],
          suppressSource: true,
        },
        ordering: {
          layerId: "session.overlay",
          stack: 2,
          objectOrder: 0,
        },
      },
    ]);

    const projectedSubjectIds = intents
      .getGraph()
      .layers.find((layer) => layer.id === "session.overlay")
      ?.nodes.map((node) => node.projection?.sourceSubjectId);

    assertDeepEqual(
      projectedSubjectIds,
      ["template.normal", "template.frame"],
      "projection should preserve source layer stacking order",
    );
  });
}

async function testRenderIntentClipTargetsLayerAndSubject() {
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
        clipping: {
          effects: [
            {
              type: "clipPath",
              id: "clip.target",
              source: {
                id: "clip-source",
                type: "rect",
                props: { width: 5, height: 5 },
              },
              targetLayerIds: ["artwork"],
              targetSubjectIds: ["target"],
            },
          ],
        },
      },
    ]);

    const effect = intents.getGraph().layers[0]?.nodes[0]?.effects[0];
    assertDeepEqual(
      {
        targetLayerIds: effect?.targetLayerIds,
        targetSubjectIds: effect?.targetSubjectIds,
      },
      {
        targetLayerIds: ["artwork"],
        targetSubjectIds: ["target"],
      },
      "clip effects should target graph layer and subject ids",
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
    projection: { sourceLayerIds: ["base-layer"] },
    coordinateSpace: "scene" as const,
    ordering: { layerId: "artwork", layerOrder: 1, objectOrder: 2 },
    props: { opacity: 0.5 },
  };

  const basePatch = mergeRenderIntentPatchDraft([base], {
    id: "object",
    visual: { replacement: { src: "/replacement.png" } },
    projection: { sourceSubjectIds: ["subject"] },
    props: { selectable: false },
  });
  assertEqual(basePatch.diagnostics.length, 0);
  assertEqual(basePatch.draft?.visual?.src, "/base.png");
  assertEqual(basePatch.draft?.visual?.replacement?.src, "/replacement.png");
  assertDeepEqual(basePatch.draft?.projection?.sourceLayerIds, ["base-layer"]);
  assertDeepEqual(basePatch.draft?.projection?.sourceSubjectIds, ["subject"]);
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

async function testSceneLayoutModelUsesExportFrames() {
  const canvas = new FakeLayoutCanvasService(800, 600);
  const layout = computeSceneLayout(canvas, {
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

  const insetLayout = computeSceneLayout(canvas, {
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
  const layout = computeSceneLayout(canvas, {
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
  assertClose(
    layout.trimRect.top,
    300 - 150 * layout.scale,
  );
  assertClose(layout.trimRect.width, 770 * layout.scale);
  assertClose(layout.trimRect.height, 300 * layout.scale);
  assertClose(layout.cutRect.left, layout.trimRect.left);
  assertClose(layout.cutRect.width, layout.trimRect.width);
  assertEqual(layout.trimWidthMm, 770);
  assertEqual(layout.trimHeightMm, 300);
}

async function testSceneLayoutModelClampsFocusedProductionFrame() {
  const canvas = new FakeLayoutCanvasService(800, 600);
  const layout = computeSceneLayout(canvas, {
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
  const layout = computeSceneLayout(canvas, {
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
  assertEqual(layout.cutWidthMm, 80);
  assertEqual(layout.cutHeightMm, 70);
  assertClose(layout.cutRect.left, 190);
  assertClose(layout.cutRect.width, 80 * layout.scale);
}

async function testSceneLayoutModelBuildsDielineGeometry() {
  const canvas = new FakeLayoutCanvasService(800, 600);
  const layout = computeSceneLayout(canvas, {
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
  assertClose(geometry.radius, 20.4);
  assertClose(geometry.offset, 40.8);
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
      "manages sessions without registered tools",
      testSessionsWithoutTools,
    ],
    [
      "emits generic session lifecycle events",
      testSessionLifecycleEvents,
    ],
    ["computes geometry primitives", testGeometryPrimitives],
    ["computes drag interaction snaps and constraints", testDragInteractionSnapsAndConstrains],
    [
      "session dirty trackers can block leave",
      testSessionDirtyTrackerCanBlockLeave,
    ],
    [
      "workbench does not manage sessions",
      testWorkbenchDoesNotManageSessions,
    ],
    [
      "keeps render intent runtime patches source scoped",
      testRenderIntentRuntimePatchesAreSourceScoped,
    ],
    [
      "writes render intent interaction onto graph props and data",
      testRenderIntentInteractionAspectWritesGraphPropsAndData,
    ],
    [
      "builds render intent projection nodes and visibility context",
      testRenderIntentProjectionAndVisibilityContext,
    ],
    [
      "preserves source visibility when projecting render intent nodes",
      testRenderIntentProjectionPreservesSourceVisibility,
    ],
    [
      "preserves source stacking when projecting render intent nodes",
      testRenderIntentProjectionPreservesSourceStacking,
    ],
    [
      "keeps render intent clip targets graph-scoped",
      testRenderIntentClipTargetsLayerAndSubject,
    ],
    [
      "merges render intent patches with diagnostics",
      testRenderIntentPatchMergeHelper,
    ],
    [
      "resolves scene layout defaults and responsive padding",
      testSceneLayoutModelDefaultsAndPadding,
    ],
    ["computes scene export frame layouts", testSceneLayoutModelUsesExportFrames],
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
