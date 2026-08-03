import {
  DefaultSurfaceFrameService,
  ConfigurationService,
  GEOMETRY_SOURCE_SERVICE,
  IMAGE_RESOURCE_SERVICE,
  Pooder,
  RENDER_INTENT_COMPILER_REGISTRY_SERVICE,
  RENDER_INTENT_SERVICE,
  RenderIntentCompilerRegistryService,
  RenderIntentService,
  SURFACE_FRAME_SERVICE,
  GeometrySourceService,
  type GeometrySnapshot,
  type ImageResourceService,
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
  type EditorDocumentRuntime,
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
  const configService = new ConfigurationService();
  const services = new Map<ServiceIdentifier<Service>, Service>([
    [RENDER_INTENT_SERVICE, renderIntentService],
    [RENDER_INTENT_COMPILER_REGISTRY_SERVICE, compilerRegistry],
    [SURFACE_FRAME_SERVICE, surfaceFrameService],
  ]);

  return {
    runtime: {
      config: {
        export: () => configService.export(),
        get: <T = unknown>(key: string, defaultValue?: T) =>
          configService.get(key, defaultValue),
        import: (data: Record<string, unknown>) => configService.import(data),
        prepareImport: configService.prepareImport.bind(configService),
        assertImportPublicationCurrent:
          configService.assertImportPublicationCurrent.bind(configService),
        publishImport: configService.publishImport.bind(configService),
        notifyImportPublished:
          configService.notifyImportPublished.bind(configService),
        update: (key: string, value: unknown) =>
          configService.update(key, value),
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
    configService,
    surfaceFrameService,
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
      assetId: "artwork",
    }),
    null,
    "image source geometry should be resolved from the document asset context",
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
                {
                  id: "placed-image",
                  frame: { x: 10, y: 20, width: 50, height: 60 },
                  source: {
                    kind: "image",
                    resource: {
                      kind: "url",
                      url: "/placed.png",
                      intrinsicSize: { width: 100, height: 80 },
                    },
                  },
                  placement: {
                    fit: "cover",
                    anchorX: 0.25,
                    anchorY: 0.75,
                    zoom: 1.5,
                    rotation: 15,
                    opacity: 1,
                    clip: "frame",
                  },
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

  assertEqual(
    result.ok,
    true,
    `document should apply: ${JSON.stringify(result.diagnostics)}`,
  );
  const graph = renderIntentService.getGraph();
  const node = graph.layers[0]?.nodes.find((item) => item.id === "shape");
  const labelNode = graph.layers[0]?.nodes.find((item) => item.id === "label");
  const emptySlotNode = graph.layers[0]?.nodes.find(
    (item) => item.id === "empty-image-slot",
  );
  const placedImageNode = graph.layers[0]?.nodes.find(
    (item) => item.id === "placed-image",
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
  assertEqual(
    placedImageNode?.previewGeometryRef.sourceId,
    "render-intent",
    "placed images should project their derived bitmap placement",
  );
  assertEqual(
    placedImageNode?.exportGeometryRef.sourceId,
    "render-intent",
    "placed image export should preserve the committed bitmap placement",
  );
  assertDeepEqual(
    placedImageNode?.containerGeometryRef,
    {
      sourceId: "document-object",
      geometryId: "placed-image",
      variant: "base",
    },
    "placed images should expose their Document frame as container geometry",
  );
  assertDeepEqual(
    node?.containerGeometryRef,
    {
      sourceId: "document-object",
      geometryId: "shape",
      variant: "base",
    },
    "all Document objects should expose uncombined logical geometry",
  );
  assertEqual(
    "documentObjectPlacement" in (placedImageNode?.data ?? {}),
    false,
    "render nodes should not carry a parallel Document placement payload",
  );
  const geometrySource = new GeometrySourceService();
  geometrySource.registerSource(
    createDocumentObjectGeometrySource(() => result.document, geometrySource),
  );
  const containerGeometry = placedImageNode
    ? geometrySource.getSnapshot(placedImageNode.containerGeometryRef).value
    : null;
  assertDeepEqual(
    containerGeometry?.bounds,
    { left: 0, top: 0, width: 50, height: 60 },
    "image container geometry should equal its Document frame",
  );
  assert(
    placedImageNode?.placement.localToScene.values.some(
      (value, index) =>
        Math.abs(
          value - (containerGeometry?.localToScene.values[index] ?? value),
        ) > 1e-6,
    ),
    "placed image visual geometry should differ from its container frame",
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
    assets: [],
    config: {},
    surfaces: [
      {
        id: "front",
        geometry: {
          canvasBounds: { x: 0, y: 0, width: 100, height: 100 },
          productionBounds: { x: 0, y: 0, width: 100, height: 100 },
        },
        layers: [
          {
            id: "guide",
            objects: [
              {
                id: "feature",
                placement: {
                  localBounds: { x: 0, y: 0, width: 20, height: 20 },
                  localToParent: [0, 1, -1, 0, 20, 30],
                  pivot: { x: 10, y: 10 },
                },
                interaction: {
                  hitRegion: { type: "frame", space: "scene" },
                  manipulation: { move: { enabled: true } },
                },
                children: [
                  {
                    id: "feature.add",
                    placement: {
                      localBounds: { x: 0, y: 0, width: 10, height: 10 },
                      localToParent: [-1, 0, 0.5, 1, 2, 3],
                      pivot: { x: 2, y: 4 },
                    },
                    source: { kind: "shape", shape: "circle", params: {} },
                  },
                  {
                    id: "feature.subtract",
                    placement: {
                      localBounds: { x: 0, y: 0, width: 4, height: 4 },
                      localToParent: [1, 0, 0, 1, 4, 5],
                      pivot: { x: 0, y: 0 },
                    },
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
    nodes.find((node) => node.id === "feature.add")?.placement.localToScene
      .values,
    [0, -1, -1, 0.5, 17, 32],
    "child placement should preserve nested rotation, skew, negative scale, and translation",
  );
  assertEqual(
    nodes.find((node) => node.id === "feature.add")?.interaction,
    undefined,
    "composite children should not receive interaction",
  );
}

async function testDocumentServiceDraftIsolation() {
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
  assertEqual(applied.ok, true, "draft fixture should apply");
  const events: string[] = [];
  let renderPublications = 0;
  service.onDidChange((event) => events.push(event.type));
  renderIntentService.onDidChange(() => {
    renderPublications += 1;
  });
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
    if (object) object.placement.localToParent[4] = 25;
  });
  assertEqual(
    updated.ok,
    true,
    "valid draft mutation should update working state",
  );
  assertEqual(
    service.export("committed")?.surfaces[0]?.layers[0]?.objects?.[0]?.placement
      .localToParent[4],
    10,
    "draft mutation should not change committed state",
  );
  await draft.rollback();
  assertEqual(
    service.export("working")?.surfaces[0]?.layers[0]?.objects?.[0]?.placement
      .localToParent[4],
    10,
    "rollback should restore committed state",
  );
  const commitDraft = await service.beginDraft();
  const commitMutation = await commitDraft.mutate((document) => {
    const object = document.surfaces[0]?.layers[0]?.objects?.[0];
    if (object) object.placement.localToParent[4] = 35;
  });
  assertEqual(commitMutation.ok, true, "commit draft mutation should succeed");
  await commitDraft.commit();
  assertEqual(
    service.export("committed")?.surfaces[0]?.layers[0]?.objects?.[0]?.placement
      .localToParent[4],
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
  assertEqual(
    renderPublications,
    3,
    "mutate and rollback should each publish one graph while draft commit publishes none",
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
  let runtimeStateVisibleDuringPublish = false;
  let renderPublications = 0;
  const subscription = renderIntentService.onDidChange(() => {
    renderPublications += 1;
    snapshotDuringApply = geometrySource.getSnapshot({
      sourceId: "document-object",
      geometryId: "shape",
      purpose: "preview",
    }).value;
    runtimeStateVisibleDuringPublish =
      service.export("working")?.surfaces[0]?.id === "front" &&
      runtime.services
        .getOrThrow<DefaultSurfaceFrameService>(SURFACE_FRAME_SERVICE)
        .getFrames("front") !== null;
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
    assertEqual(
      runtimeStateVisibleDuringPublish,
      true,
      "document and frames must be visible before RenderGraph notification",
    );
    assertEqual(
      renderPublications,
      1,
      "one document publication must emit one RenderGraph notification",
    );
  } finally {
    subscription.dispose();
    await runtime.dispose();
  }
}

async function testDocumentPreparationFailuresAreAtomic() {
  const {
    runtime,
    renderIntentService,
    compilerRegistry,
    configService,
    surfaceFrameService,
  } = createRuntime();
  let configEvents = 0;
  let afterPublishCalls = 0;
  configService.onAnyChange(() => {
    configEvents += 1;
  });
  runtime.services.register<ImageResourceService>(
    {
      init() {},
      async resolve(resource) {
        if (resource.kind === "url" && resource.url === "/fail.png") {
          throw new Error("injected image resolution failure");
        }
        return { ok: false, reason: "unsupported" };
      },
    },
    IMAGE_RESOURCE_SERVICE,
  );
  compilerRegistry.registerCompiler("atomic-test", {
    capabilityId: "test.effect",
    effectType: "custom",
    compile({ effect }) {
      if ((effect as { payload?: { fail?: boolean } }).payload?.fail) {
        throw new Error("injected effect compilation failure");
      }
    },
  });
  const service = registerEditorDocumentService(runtime, {
    effectSchemaRegistry: new EffectSchemaRegistry([
      {
        effectType: "custom",
        capabilityId: "test.effect",
        validate: () => [],
      },
    ]),
    resolveEffectCapabilityId: resolveTestEffectCapabilityId,
    publicationParticipants: [
      {
        prepare({ document }) {
          if (document.config.failParticipant) {
            throw new Error("injected participant prepare failure");
          }
          return { publish() {} };
        },
      },
    ],
    afterPublish: (_runtime, document) => {
      afterPublishCalls += 1;
      if (document.config.failAfterPublish) {
        throw new Error("injected afterPublish failure");
      }
    },
  });
  const createDocument = (
    options: {
      config?: Record<string, unknown>;
      imageUrl?: string;
      effect?: EditorEffect;
    } = {},
  ) => ({
    version: 7 as const,
    config: options.config ?? { mode: "stable" },
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" as const },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "artwork",
            objects: [
              options.imageUrl
                ? {
                    id: "subject",
                    frame: { x: 10, y: 20, width: 30, height: 40 },
                    source: {
                      kind: "image" as const,
                      resource: { kind: "url" as const, url: options.imageUrl },
                    },
                  }
                : {
                    id: "subject",
                    frame: { x: 10, y: 20, width: 30, height: 40 },
                    source: {
                      kind: "shape" as const,
                      shape: "rect" as const,
                      params: {},
                    },
                    ...(options.effect ? { effects: [options.effect] } : {}),
                  },
            ],
          },
        ],
      },
    ],
  });

  assertEqual(
    (await service.apply(createDocument())).ok,
    true,
    "baseline apply should succeed",
  );
  const documentEvents: unknown[] = [];
  const renderEvents: unknown[] = [];
  const frameEvents: unknown[] = [];
  service.onDidChange((event) => documentEvents.push(event));
  renderIntentService.onDidChange((event) => renderEvents.push(event));
  surfaceFrameService.onAnyFramesChange((event) => frameEvents.push(event));
  const snapshot = () => ({
    document: service.export(),
    config: runtime.config.export(),
    frames: Object.fromEntries(
      surfaceFrameService
        .listSurfaceIds()
        .map((surfaceId) => [
          surfaceId,
          surfaceFrameService.getFrames(surfaceId),
        ]),
    ),
    graph: renderIntentService.getGraph(),
    configEvents,
    eventCounts: [
      documentEvents.length,
      renderEvents.length,
      frameEvents.length,
    ],
  });
  const stable = snapshot();

  const failures = [
    await service.apply(createDocument({ imageUrl: "/fail.png" })),
    await service.apply(
      createDocument({
        effect: { type: "custom", payload: { fail: true } },
      }),
    ),
    await service.apply(createDocument({ config: { failParticipant: true } })),
  ];
  failures.forEach((result, index) =>
    assertEqual(
      result.ok,
      false,
      `injected preparation failure ${index} should be rejected: ${JSON.stringify(result.diagnostics)}`,
    ),
  );
  assertDeepEqual(
    snapshot(),
    stable,
    "preparation failures must preserve document, config, frames, graph, revision, and events",
  );

  const originalConsoleError = console.error;
  console.error = () => undefined;
  const afterPublishFailure = await service.apply(
    createDocument({ config: { failAfterPublish: true } }),
  );
  console.error = originalConsoleError;
  assertEqual(
    afterPublishFailure.ok,
    true,
    "afterPublish failures must not reject or roll back published state",
  );
  assertEqual(
    service.export()?.config.failAfterPublish,
    true,
    "published document must remain committed after afterPublish failure",
  );
  assertEqual(
    afterPublishCalls,
    2,
    "afterPublish should run for the baseline and successful publication only",
  );
}

async function testDocumentRejectsLegacyConfigurationRuntime() {
  const { runtime, renderIntentService, surfaceFrameService } = createRuntime();
  let legacyImports = 0;
  const legacyRuntime = {
    ...runtime,
    config: {
      export: () => runtime.config.export(),
      get: <T = unknown>(key: string, defaultValue?: T) =>
        runtime.config.get(key, defaultValue),
      import: (_data: Record<string, unknown>) => {
        legacyImports += 1;
      },
      update: (key: string, value: unknown) =>
        runtime.config.update(key, value),
    },
  } as unknown as EditorDocumentRuntime;
  const result = await applyEditorDocument(legacyRuntime, {
    version: 7,
    config: { mode: "candidate" },
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [],
      },
    ],
  });

  assertEqual(result.ok, false, "legacy configuration runtime must reject");
  assertEqual(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "runtime-config-publication-required",
    ),
    true,
    "legacy configuration rejection should identify the missing publication API",
  );
  assertEqual(legacyImports, 0, "legacy config.import must never run");
  assertEqual(
    surfaceFrameService.listSurfaceIds().length,
    0,
    "legacy runtime rejection must not publish frames",
  );
  assertEqual(
    renderIntentService.getGraph().revision,
    0,
    "legacy runtime rejection must not publish a graph",
  );
}

async function testDocumentPreflightPreservesConcurrentConfigAndFrames() {
  const { runtime, renderIntentService, surfaceFrameService } = createRuntime();
  const service = registerEditorDocumentService(runtime, {
    publicationParticipants: [
      {
        prepare({ runtime: participantRuntime, document }) {
          if (!document.config.triggerConcurrentUpdate) return;
          participantRuntime.config?.update("concurrent", "preserved");
          surfaceFrameService.setFrames("front", {
            ...TEST_SURFACE_FRAMES,
            productionFrame: {
              ...TEST_SURFACE_FRAMES.productionFrame,
              widthMm: 91,
            },
          });
        },
      },
    ],
  });
  const createDocument = (
    config: Record<string, unknown>,
    widthMm: number,
  ) => ({
    version: 7 as const,
    config,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" as const },
        frames: {
          ...TEST_SURFACE_FRAMES,
          productionFrame: {
            ...TEST_SURFACE_FRAMES.productionFrame,
            widthMm,
          },
        },
        layers: [],
      },
    ],
  });
  assertEqual(
    (await service.apply(createDocument({ mode: "stable" }, 100))).ok,
    true,
    "concurrency fixture baseline should apply",
  );
  const committedBefore = service.export();
  const graphBefore = renderIntentService.getGraph();
  let documentEvents = 0;
  let renderEvents = 0;
  service.onDidChange(() => {
    documentEvents += 1;
  });
  renderIntentService.onDidChange(() => {
    renderEvents += 1;
  });

  const result = await service.apply(
    createDocument({ mode: "candidate", triggerConcurrentUpdate: true }, 82),
  );
  assertEqual(result.ok, false, "stale document publication should reject");
  assertDeepEqual(
    service.export(),
    committedBefore,
    "publication preflight must run before replacing Document state",
  );
  assertDeepEqual(
    runtime.config.export(),
    { mode: "stable", concurrent: "preserved" },
    "stale config candidate must not overwrite the concurrent update",
  );
  assertEqual(
    surfaceFrameService.getFrames("front")?.productionFrame.widthMm,
    91,
    "stale frame candidate must not overwrite the concurrent frame update",
  );
  assertDeepEqual(
    renderIntentService.getGraph(),
    graphBefore,
    "failed preflight must not publish the prepared graph",
  );
  assertDeepEqual(
    [documentEvents, renderEvents],
    [0, 0],
    "failed preflight must not emit Document or RenderGraph events",
  );
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
    service.export()?.surfaces[0]?.layers[0]?.objects?.[0]?.placement,
    {
      localBounds: { x: 0, y: 0, width: 30, height: 40 },
      localToParent: [1, 0, 0, 1, 20, 25],
      pivot: { x: 0, y: 0 },
    },
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
  await testDocumentPreparationFailuresAreAtomic();
  await testDocumentRejectsLegacyConfigurationRuntime();
  await testDocumentPreflightPreservesConcurrentConfigAndFrames();
  await testDocumentServiceDraftIsolation();
  await testDocumentServiceCommitsSceneTranslationBySubject();
  console.log("ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
