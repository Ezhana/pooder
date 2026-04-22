import {
  COMMAND_SERVICE,
  Pooder,
  TOOL_REGISTRY_SERVICE,
  createServiceToken,
  type ExtensionDefinition,
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
    const good = createCommandExtension("good", "good.command", "good", {
      onActivate: () => activationOrder.push("good"),
    });

    const bad: ExtensionDefinition = {
      id: "bad",
      contribute() {
        return {
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
    assertEqual(
      runtime.services.getOrThrow(COMMAND_SERVICE).getCommand("bad.command"),
      undefined,
    );
    assertEqual(await runtime.commands.execute("good.command"), "good");
  });
}

async function testUnregisterCleansDefinitionsCommandsAndTools() {
  await withRuntime(async (runtime) => {
    const cleanupExtension: ExtensionDefinition = {
      id: "cleanup",
      contribute() {
        return {
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
      "unregister cleans up config definitions, commands, and tools",
      testUnregisterCleansDefinitionsCommandsAndTools,
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
