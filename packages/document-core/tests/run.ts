import {
  DefaultSurfaceFrameService,
  RENDER_INTENT_COMPILER_REGISTRY_SERVICE,
  RENDER_INTENT_SERVICE,
  RenderIntentCompilerRegistryService,
  RenderIntentService,
  SURFACE_FRAME_SERVICE,
  type Service,
  type ServiceIdentifier,
} from "@pooder/core";
import {
  applyEditorDocument,
  resolveObjectSource,
  SourceResolver,
} from "../src";
import type { EditorEffect } from "@pooder/document";

declare const process: {
  exit(code: number): never;
};

function assert(condition: unknown, message: string) {
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

const TEST_SURFACE_FRAMES = {
  previewBounds: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 },
  productionFrame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 },
  viewportFocusFrame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 },
};

function createRuntime() {
  const renderIntentService = new RenderIntentService();
  const compilerRegistry = new RenderIntentCompilerRegistryService();
  const surfaceFrameService = new DefaultSurfaceFrameService();
  const services = new Map<ServiceIdentifier<Service>, Service>([
    [RENDER_INTENT_SERVICE, renderIntentService],
    [RENDER_INTENT_COMPILER_REGISTRY_SERVICE, compilerRegistry],
    [SURFACE_FRAME_SERVICE, surfaceFrameService],
  ]);

  return {
    runtime: {
      config: {
        state: {} as Record<string, unknown>,
        export() {
          return { ...this.state };
        },
        get<T = unknown>(key: string, defaultValue?: T): T {
          return (this.state[key] as T) ?? (defaultValue as T);
        },
        import(data: Record<string, unknown>) {
          this.state = { ...data };
        },
        update(key: string, value: unknown) {
          this.state[key] = value;
        },
      },
      services: {
        getOrThrow<T extends Service>(identifier: ServiceIdentifier<T>): T {
          const service = services.get(
            identifier as ServiceIdentifier<Service>,
          );
          if (!service) throw new Error("service missing");
          return service as T;
        },
      },
      capabilities: {
        has(id: string) {
          return id === "test.effect";
        },
        get() {
          return undefined;
        },
      },
    },
    renderIntentService,
    compilerRegistry,
  };
}

function resolveTestEffectCapabilityId(
  effect: EditorEffect,
): string | undefined {
  return (
    effect.capabilityId ||
    (effect.type === "custom" ? "test.effect" : undefined)
  );
}

function testSourceResolver() {
  const resolver = new SourceResolver();
  assertDeepEqual(
    resolver.resolve({
      kind: "url",
      url: "/art.png",
      intrinsicSize: { width: 120, height: 80 },
    })?.bounds,
    { left: 0, top: 0, width: 120, height: 80 },
    "url source should resolve intrinsic bounds",
  );
  assert(
    resolveObjectSource({
      kind: "shape",
      shape: "circle",
      params: { radius: 10 },
    })?.pathData?.startsWith("M10 0"),
    "shape source should resolve path data",
  );
  assertEqual(
    resolveObjectSource({ kind: "text", text: "Label" })?.text,
    "Label",
    "text source should resolve text content",
  );
}

async function testApplyEditorDocument() {
  const { runtime, renderIntentService, compilerRegistry } = createRuntime();
  compilerRegistry.registerCompiler("test", {
    capabilityId: "test.effect",
    effectType: "custom",
    compile({ target }) {
      return {
        id: target.objectId ?? "missing",
        props: { compiled: true },
      };
    },
  });

  const result = await applyEditorDocument(
    runtime,
    {
      version: 5,
      config: { mode: "test" },
      surfaces: [
        {
          id: "front",
          size: { width: 100, height: 100, unit: "mm" },
          frames: TEST_SURFACE_FRAMES,
          layers: [
            {
              id: "artwork",
              objects: [
                {
                  id: "shape",
                  frame: { x: 10, y: 20, width: 40, height: 40 },
                  source: {
                    kind: "shape",
                    shape: "rect",
                    params: { width: 20, height: 20 },
                  },
                  effects: [{ type: "custom" }],
                  interaction: {
                    activation: {
                      action: { command: "test.open-session" },
                    },
                    transform: { enabled: true },
                    drag: {
                      enabled: true,
                      constraints: [{ spec: { type: "rect.contain" } }],
                    },
                  },
                },
                {
                  id: "label",
                  frame: { x: 5, y: 6, width: 30, height: 10 },
                  source: { kind: "text", text: "Label" },
                },
              ],
            },
          ],
        },
      ],
    },
    { resolveEffectCapabilityId: resolveTestEffectCapabilityId },
  );

  assertEqual(result.ok, true, "document should apply");
  const graph = renderIntentService.getGraph();
  const node = graph.layers[0]?.nodes.find((item) => item.id === "shape");
  const labelNode = graph.layers[0]?.nodes.find((item) => item.id === "label");
  assertEqual(node?.id, "shape", "source object should become a render node");
  assertEqual(node?.type, "path", "shape source should render as path");
  assertEqual(labelNode?.type, "text", "text source should render as text");
  assertEqual(
    labelNode?.props.text,
    "Label",
    "text source should write text props",
  );
  assertEqual(
    node?.props.compiled,
    true,
    "generic effect compiler should patch node",
  );
  assertEqual(
    node?.interaction?.drag?.enabled,
    true,
    "object interaction should enable drag",
  );
  assertEqual(
    node?.interaction?.drag?.constraints?.[0]?.spec.type,
    "rect.contain",
    "object interaction constraints should translate to render intent",
  );
  assertEqual(
    node?.interaction?.activation?.action.command,
    "test.open-session",
    "object activation should translate to render intent",
  );
}

async function main() {
  testSourceResolver();
  await testApplyEditorDocument();
  console.log("ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
