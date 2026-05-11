import {
  CAPABILITY_REGISTRY_SERVICE,
  COMMAND_SERVICE,
  Pooder,
  SCENE_SERVICE,
  TOOL_REGISTRY_SERVICE,
  createServiceToken,
  type ExtensionDefinition,
  type SceneChangeEvent,
  type SceneService,
  type Service,
  type ToolContribution,
} from "../src";

declare const process: {
  exit(code: number): never;
};

class DeferredDependencyService implements Service {}

const REQUIRED_SERVICE = createServiceToken<DeferredDependencyService>(
  "DeferredDependencyService",
);

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
    ["manages headless scene layers and elements", testSceneLayersAndElements],
    [
      "batches and rolls back scene transactions",
      testSceneTransactionsBatchAndRollback,
    ],
    [
      "removing a scene layer removes scoped elements",
      testRemovingSceneLayerRemovesScopedElements,
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
