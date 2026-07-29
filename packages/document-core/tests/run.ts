import {
  DefaultSurfaceFrameService,
  GEOMETRY_SOURCE_SERVICE,
  Pooder,
  RENDER_INTENT_COMPILER_REGISTRY_SERVICE,
  RENDER_INTENT_SERVICE,
  RenderIntentCompilerRegistryService,
  RenderIntentService,
  SURFACE_FRAME_SERVICE,
  GeometrySourceService,
  type GeometrySnapshot,
  type Service,
  type ServiceIdentifier,
} from "@pooder/core";
import {
  applyEditorDocument,
  createDocumentObjectGeometrySource,
  createEditorDocumentController,
  registerEditorDocumentService,
  resolveObjectSource,
  sceneFrameToLocalFrame,
  SourceResolver,
} from "../src";
import {
  EffectSchemaRegistry,
  normalizeEditorDocument,
  type EditorEffect,
} from "@pooder/document";

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
        register<T extends Service>(
          service: T,
          identifier?: ServiceIdentifier<T>,
        ) {
          if (!identifier) return false;
          services.set(identifier, service);
          return true;
        },
        get<T extends Service>(
          identifier: ServiceIdentifier<T>,
        ): T | undefined {
          return services.get(identifier) as T | undefined;
        },
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
      kind: "image",
      resource: {
        kind: "url",
        url: "/art.png",
        intrinsicSize: { width: 120, height: 80 },
      },
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
      version: 7,
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
                    selection: { enabled: false },
                    activation: {
                      action: { commandId: "test.open-session" },
                    },
                    manipulation: {
                      move: {
                        enabled: true,
                        constraints: [{ spec: { type: "rect.contain" } }],
                      },
                      resize: { enabled: true },
                      rotate: { enabled: false },
                    },
                  },
                },
                {
                  id: "label",
                  frame: { x: 5, y: 6, width: 30, height: 10 },
                  source: { kind: "text", text: "Label" },
                },
                {
                  id: "empty-image-slot",
                  frame: { x: 20, y: 30, width: 50, height: 60 },
                  source: { kind: "image" },
                  placement: {
                    fit: "cover",
                    anchorX: 0.5,
                    anchorY: 0.5,
                    zoom: 1,
                    rotation: 0,
                    opacity: 1,
                    clip: "frame",
                  },
                  slot: {},
                  interaction: { hitRegion: { type: "frame" } },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      effectSchemaRegistry: new EffectSchemaRegistry([
        {
          effectType: "custom",
          capabilityId: "test.effect",
          validate: () => [],
        },
      ]),
      resolveEffectCapabilityId: resolveTestEffectCapabilityId,
    },
  );

  assertEqual(result.ok, true, "document should apply");
  const graph = renderIntentService.getGraph();
  const node = graph.layers[0]?.nodes.find((item) => item.id === "shape");
  const labelNode = graph.layers[0]?.nodes.find((item) => item.id === "label");
  const emptySlotNode = graph.layers[0]?.nodes.find(
    (item) => item.id === "empty-image-slot",
  );
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
    node?.interaction?.manipulation?.move?.enabled,
    true,
    "object interaction should enable drag",
  );
  assertEqual(
    node?.interaction?.manipulation?.move?.constraints?.[0]?.spec.type,
    "rect.contain",
    "object interaction constraints should translate to render intent",
  );
  assertEqual(
    node?.interaction?.activation?.action.commandId,
    "test.open-session",
    "object activation should translate to render intent",
  );
  assertEqual(
    emptySlotNode?.visible,
    true,
    "empty image slots should remain visible to frame hit testing",
  );
  assertEqual(
    emptySlotNode?.visual?.src,
    undefined,
    "empty image slots should not synthesize content resources",
  );
}

async function testControllerUpdatesOnlyChangedRenderIntents() {
  const { runtime, renderIntentService } = createRuntime();
  const controller = createEditorDocumentController(runtime);
  const document = {
    version: 7 as const,
    config: {},
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" as const },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "artwork",
            objects: ["first", "second"].map((id, index) => ({
              id,
              frame: { x: index * 20, y: 0, width: 10, height: 10 },
              source: {
                kind: "shape" as const,
                shape: "rect" as const,
                params: { width: 10, height: 10 },
              },
            })),
          },
        ],
      },
    ],
  };
  const applied = await controller.apply(document);
  assertEqual(applied.ok, true, "controller document should apply");
  const reasons: unknown[] = [];
  renderIntentService.onDidChange((event) => reasons.push(event.reason));

  const updated = await controller.updateObject("first", (current) => ({
    ...current,
    style: { ...(current.style ?? {}), opacity: 0.5 },
  }));
  assertEqual(updated.ok, true, "controller object update should succeed");
  assertDeepEqual(
    reasons,
    [{ type: "base-updated", intentIds: ["first"] }],
    "controller updates should publish only changed render intents",
  );
}

async function testCompositeRenderIntentFlattening() {
  const { runtime, renderIntentService } = createRuntime();
  const result = await applyEditorDocument(runtime, {
    version: 7,
    config: {},
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "guide",
            objects: [
              {
                id: "feature",
                frame: { x: 20, y: 30, width: 20, height: 20 },
                interaction: {
                  hitRegion: { type: "frame", space: "scene" },
                  manipulation: { move: { enabled: true } },
                },
                children: [
                  {
                    id: "feature.add",
                    frame: { x: 2, y: 3, width: 10, height: 10 },
                    source: { kind: "shape", shape: "circle", params: {} },
                  },
                  {
                    id: "feature.subtract",
                    frame: { x: 4, y: 5, width: 4, height: 4 },
                    source: { kind: "shape", shape: "circle", params: {} },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  assertEqual(result.ok, true, "composite document should apply");
  const nodes = renderIntentService
    .getGraph()
    .layers.flatMap((layer) => layer.nodes);
  assertDeepEqual(
    nodes.map((node) => node.id).sort(),
    ["feature.add", "feature.subtract", "feature:interaction-proxy"].sort(),
    "composite should flatten to visual nodes plus an interaction proxy",
  );
  assert(
    nodes.every((node) => node.type !== ("group" as never)),
    "composite rendering must not create a renderer group",
  );
  assertDeepEqual(
    nodes
      .find((node) => node.id === "feature.add")
      ?.placement.localToScene.values.slice(4),
    [22, 33],
    "child placement should compose the complete parent transform",
  );
  assertEqual(
    nodes.find((node) => node.id === "feature.add")?.interaction,
    undefined,
    "composite children should not receive interaction",
  );
}

async function testDocumentServiceDraftIsolation() {
  const { runtime } = createRuntime();
  const service = createEditorDocumentController(runtime);
  const applied = await service.apply({
    version: 7,
    config: {},
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
                frame: { x: 10, y: 20, width: 30, height: 40 },
                source: { kind: "shape", shape: "rect", params: {} },
              },
            ],
          },
        ],
      },
    ],
  });
  assertEqual(applied.ok, true, "draft fixture should apply");
  const events: string[] = [];
  service.onDidChange((event) => events.push(event.type));
  const draft = await service.beginDraft();
  const invalid = await draft.mutate((document) => {
    document.surfaces = [];
  });
  assertEqual(invalid.ok, false, "invalid draft mutation should fail");
  assertEqual(
    service.export("working")?.surfaces.length,
    1,
    "failed mutation must not pollute working state",
  );
  const updated = await draft.mutate((document) => {
    const object = document.surfaces[0]?.layers[0]?.objects?.[0];
    if (object?.frame) object.frame.x = 25;
  });
  assertEqual(
    updated.ok,
    true,
    "valid draft mutation should update working state",
  );
  assertEqual(
    service.export("committed")?.surfaces[0]?.layers[0]?.objects?.[0]?.frame?.x,
    10,
    "draft mutation should not change committed state",
  );
  await draft.rollback();
  assertEqual(
    service.export("working")?.surfaces[0]?.layers[0]?.objects?.[0]?.frame?.x,
    10,
    "rollback should restore committed state",
  );
  const commitDraft = await service.beginDraft();
  const commitMutation = await commitDraft.mutate((document) => {
    const object = document.surfaces[0]?.layers[0]?.objects?.[0];
    if (object?.frame) object.frame.x = 35;
  });
  assertEqual(commitMutation.ok, true, "commit draft mutation should succeed");
  await commitDraft.commit();
  assertEqual(
    service.export("committed")?.surfaces[0]?.layers[0]?.objects?.[0]?.frame?.x,
    35,
    "commit should atomically promote working state",
  );

  const committedBeforeInvalidApply = service.export("committed");
  const invalidApply = await service.apply({
    version: 7,
    config: {},
    surfaces: [],
  });
  assertEqual(invalidApply.ok, false, "invalid document apply should fail");
  assertDeepEqual(
    service.export("committed"),
    committedBeforeInvalidApply,
    "validation failure must preserve the complete committed document",
  );
  assertDeepEqual(
    events,
    ["mutate", "rollback", "mutate", "commit"],
    "draft events should be explicit",
  );
}

async function testDocumentGeometryIsAvailableDuringInitialApply() {
  const runtime = new Pooder();
  const service = registerEditorDocumentService(runtime);
  const renderIntentService = runtime.services.getOrThrow<RenderIntentService>(
    RENDER_INTENT_SERVICE,
  );
  const geometrySource = runtime.services.getOrThrow<GeometrySourceService>(
    GEOMETRY_SOURCE_SERVICE,
  );
  let snapshotDuringApply: GeometrySnapshot | null = null;
  const subscription = renderIntentService.onDidChange(() => {
    snapshotDuringApply = geometrySource.getSnapshot({
      sourceId: "document-object",
      geometryId: "shape",
      purpose: "preview",
    }).value;
  });

  try {
    const applied = await service.apply({
      version: 7,
      config: {},
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
                  frame: { x: 10, y: 20, width: 30, height: 40 },
                  source: { kind: "shape", shape: "rect", params: {} },
                },
              ],
            },
          ],
        },
      ],
    });
    assertEqual(applied.ok, true, "initial document should apply");
    assert(
      snapshotDuringApply !== null,
      "document geometry must resolve while the initial RenderGraph is published",
    );
  } finally {
    subscription.dispose();
    await runtime.dispose();
  }
}

function testUnresolvedImageUsesFrameGeometry() {
  const geometryService = new GeometrySourceService();
  const document = normalizeEditorDocument({
    version: 7,
    config: {},
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
                id: "image",
                frame: { x: 10, y: 20, width: 30, height: 40 },
                source: {
                  kind: "image",
                  resource: {
                    kind: "url",
                    url: "/image-without-intrinsic-size.png",
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  });
  const source = createDocumentObjectGeometrySource(
    () => document,
    geometryService,
  );
  const snapshot = source.getSnapshot({
    sourceId: "document-object",
    geometryId: "image",
    purpose: "preview",
  });

  assertEqual(
    snapshot?.kind,
    "rect",
    "an unresolved image should use its document frame geometry",
  );
  assertDeepEqual(
    snapshot?.bounds,
    { space: "object-local", left: 0, top: 0, width: 30, height: 40 },
    "image frame geometry should not depend on resource intrinsic size",
  );
}

async function testDocumentServiceCommitsSceneTranslationBySubject() {
  const { runtime, renderIntentService } = createRuntime();
  const service = createEditorDocumentController(runtime);
  const applied = await service.apply({
    version: 7,
    config: {},
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
                frame: { x: 10, y: 20, width: 30, height: 40 },
                source: { kind: "shape", shape: "rect", params: {} },
              },
            ],
          },
        ],
      },
    ],
  });
  assertEqual(applied.ok, true, "translation fixture should apply");
  const previousRevision = renderIntentService.getGraph().revision;

  const result = await service.commitManipulation({
    subjectId: "shape",
    sceneTransformPatch: {
      type: "translate",
      coordinateSpace: "scene",
      delta: { space: "scene", x: 20, y: 10 },
    },
    parentMatrix: [2, 0, 0, 2, 0, 0],
  });

  assertEqual(result.ok, true, "scene translation should commit");
  assertDeepEqual(
    service.export()?.surfaces[0]?.layers[0]?.objects?.[0]?.frame,
    { x: 20, y: 25, width: 30, height: 40 },
    "scene delta should be converted to parent-local document coordinates",
  );
  assert(
    renderIntentService.getGraph().revision > previousRevision,
    "document commit should regenerate the RenderGraph",
  );
}

function testSceneFrameUsesInverseParentMatrix() {
  assertDeepEqual(
    sceneFrameToLocalFrame(
      { left: 30, top: 50, width: 40, height: 20 },
      [2, 0, 0, 2, 10, 10],
    ),
    { left: 10, top: 20, width: 20, height: 10 },
    "scene frame should be converted through the inverse parent matrix",
  );
}

async function main() {
  testSourceResolver();
  testSceneFrameUsesInverseParentMatrix();
  testUnresolvedImageUsesFrameGeometry();
  await testApplyEditorDocument();
  await testCompositeRenderIntentFlattening();
  await testControllerUpdatesOnlyChangedRenderIntents();
  await testDocumentGeometryIsAvailableDuringInitialApply();
  await testDocumentServiceDraftIsolation();
  await testDocumentServiceCommitsSceneTranslationBySubject();
  console.log("ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
