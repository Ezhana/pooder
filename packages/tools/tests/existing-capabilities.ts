import {
  COMMAND_SERVICE,
  OBJECT_IMAGE_RESOLVER_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_EXPORT_SERVICE,
  SCENE_BOUNDS_SERVICE,
  SCENE_SERVICE,
  Pooder,
  evaluateRuntimeCondition,
  type CommandService,
  type RenderIntentService,
  type SceneBoundsService,
  type SceneService,
} from "@pooder/core";
import type {
  EditorDocument,
  EditorObject,
  EditorObjectEffect,
} from "@pooder/document";
import { registerEditorDocumentService } from "../../document-core/src";
import {
  EDGE_DETECTION_CAPABILITY_ID,
  EXPORT_CAPABILITY_ID,
  IMAGE_MASK_CAPABILITY_ID,
  MIRROR_CAPABILITY_ID,
  EdgeDetectionCapabilityExtension,
  ExportCapability,
  ImageMaskCapabilityExtension,
  MirrorCapabilityExtension,
  createEffectSchemaRegistry,
  mapImageMaskAlpha,
  normalizeImageMaskAlpha,
  resolveDefaultOutputMask,
  DEFAULT_MOCKUP_OUTPUT_MASK_KEY,
  resolveEffectCapabilityId,
  type EdgeDetectionCapabilityApi,
  type ExportCapabilityApi,
  type ExportPurpose,
  type ImageMaskCapabilityApi,
  type MirrorCapabilityApi,
} from "../src";
import {
  circularMorphology,
  createMask,
  fillHoles,
  findMinimalConnectRadius,
  isMaskConnected8,
} from "../src/extensions/maskOps";
import { computeDetectEdgeSize } from "../src/extensions/edgeScale";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
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

class FakeSceneExportService {
  calls: Array<Record<string, unknown>> = [];
  error: Error | null = null;
  errorsBySceneId = new Map<string, Error>();
  response: Record<string, unknown> = {};

  async exportImage(options: Record<string, unknown>) {
    this.calls.push(options);
    const sceneId = String(options.sceneId || "");
    const sceneError = this.errorsBySceneId.get(sceneId);
    if (sceneError) throw sceneError;
    if (this.error) throw this.error;
    return { ...this.response, sceneId: sceneId || this.response.sceneId };
  }
}

const SCENE_BOUNDS = {
  bounds: { x: 0, y: 0, width: 200, height: 100 },
  insets: { top: 5, right: 10, bottom: 5, left: 10 },
};

async function testSharedCurrentCapabilityUtilities(): Promise<void> {
  const width = 50;
  const height = 50;
  const mask = new Uint8Array(width * height);
  mask[10 * width + 10] = 1;
  mask[10 * width + 20] = 1;
  const radius = findMinimalConnectRadius(mask, width, height, 20);
  assert(
    isMaskConnected8(
      circularMorphology(mask, width, height, radius, "closing"),
      width,
      height,
    ),
    "edge mask closing should connect the source regions",
  );
  if (radius > 0) {
    assert(
      !isMaskConnected8(
        circularMorphology(mask, width, height, radius - 1, "closing"),
        width,
        height,
      ),
      "edge mask connection radius should remain minimal",
    );
  }

  const donut = new Uint8Array(9 * 9);
  for (let y = 1; y <= 7; y++) {
    for (let x = 1; x <= 7; x++) donut[y * 9 + x] = 1;
  }
  for (let y = 3; y <= 5; y++) {
    for (let x = 3; x <= 5; x++) donut[y * 9 + x] = 0;
  }
  assertEqual(fillHoles(donut, 9, 9)[4 * 9 + 4], 1, "mask holes");

  const imageData = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([255, 255, 255, 255, 10, 10, 10, 254]),
  } as unknown as ImageData;
  const created = createMask(imageData, {
    threshold: 10,
    padding: 2,
    paddedWidth: 6,
    paddedHeight: 5,
    maskMode: "auto",
    alphaOpaqueCutoff: 250,
  });
  assertEqual(created[2 * 6 + 2], 0, "white mask background");
  assertEqual(created[2 * 6 + 3], 1, "non-white mask foreground");

  assertDeepEqual(
    computeDetectEdgeSize(
      100,
      { width: 50, height: 20 },
      { width: 70, height: 40 },
    ),
    { scale: 2, width: 140, height: 80 },
    "edge detection scale should include expanded bounds",
  );

  const conditionContext = {
    activeToolId: "pooder.kit.image-slot",
    isSessionActive: (sessionId: string) => sessionId === "image-session",
    isSessionScopeActive: () => true,
    hasAnyActiveSession: () => true,
    layers: new Map([["artwork", { exists: true, objectCount: 1 }]]),
  };
  assertEqual(
    evaluateRuntimeCondition(
      {
        op: "in",
        ref: { source: "activeToolId" },
        values: ["pooder.kit.image-slot"],
      },
      conditionContext,
    ),
    true,
    "runtime conditions should resolve current capability ids",
  );
  assertEqual(
    evaluateRuntimeCondition(
      {
        op: "truthy",
        ref: {
          source: "workflowSession",
          field: "active",
          sessionId: "image-session",
        },
      },
      conditionContext,
    ),
    true,
    "runtime conditions should resolve active capability sessions",
  );
}

function createEffectDocument(
  effect: EditorObjectEffect | undefined,
  source:
    | { type: "image" }
    | {
        type: "shape";
        shape: "rect" | "circle" | "ellipse" | "heart";
        params: Record<string, never>;
      },
  traits: EditorObject["traits"] = [],
): EditorDocument {
  const geometry = {
    localFrame: { x: 0, y: 0, width: 80, height: 40 },
    localToParent: [1.15911, 0.31058, -0.20706, 0.77274, 50, 40] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
    localPivot: { x: 40, y: 20 },
  };
  const visual: EditorObject =
    source.type === "image"
      ? {
          type: "image",
          id: "visual",
          tags: ["visual:test"],
          visible: true,
          locked: false,
          ...(traits.length ? { traits } : {}),
          ...geometry,
          source: { kind: "asset", assetId: "visual.asset" },
          contentFit: {
            fit: "contain",
            anchorX: 0.5,
            anchorY: 0.5,
            zoom: 1,
            rotation: 0,
            clip: "frame",
          },
          opacity: 1,
          ...(effect ? { effects: [effect] } : {}),
        }
      : {
          type: "shape",
          id: "visual",
          tags: ["visual:test"],
          visible: true,
          locked: false,
          ...(traits.length ? { traits } : {}),
          ...geometry,
          source: {
            kind: "inline",
            content: {
              shape: source.shape,
              params: source.params,
            },
          },
          ...(effect ? { effects: [effect] } : {}),
        };
  return {
    version: 8,
    assets:
      source.type === "image"
        ? [
            {
              id: "visual.asset",
              type: "image",
              source: { kind: "url", url: "/default-flash.png" },
              intrinsicSize: { width: 200, height: 100 },
            },
          ]
        : [],
    extension: { required: [], states: {} },
    surfaces: [
      {
        id: "front",
        bounds: { x: 0, y: 0, width: 200, height: 100 },
        objects: [
          {
            type: "group",
            id: "artwork",
            tags: [],
            visible: true,
            locked: false,
            localToParent: [1, 0, 0, 1, 0, 0],
            children: [visual],
          },
        ],
      },
    ],
  };
}

async function testExportCapability(): Promise<void> {
  assertDeepEqual(
    resolveDefaultOutputMask("mockup", [DEFAULT_MOCKUP_OUTPUT_MASK_KEY]),
    {
      mode: "outline",
      sourceKey: DEFAULT_MOCKUP_OUTPUT_MASK_KEY,
      transparentColor: { red: 255, green: 255, blue: 255, tolerance: 8 },
    },
    "mockup should auto-apply the canonical white templateFrame mask",
  );
  assertEqual(
    resolveDefaultOutputMask("mockup", []),
    undefined,
    "mockup should skip output mask when the document has no keys",
  );
  assertEqual(
    resolveDefaultOutputMask("design", [DEFAULT_MOCKUP_OUTPUT_MASK_KEY]),
    undefined,
    "design should not auto-apply an output mask",
  );
  try {
    resolveDefaultOutputMask("mockup", [
      DEFAULT_MOCKUP_OUTPUT_MASK_KEY,
      "otherMask",
    ]);
    throw new Error("multiple output-mask keys should fail");
  } catch (error) {
    assertEqual(
      error instanceof Error ? error.message : "",
      "export-output-mask-ambiguous",
      "multiple output-mask keys should require an explicit mask",
    );
  }
  try {
    resolveDefaultOutputMask("mockup", ["otherMask"]);
    throw new Error("unknown output-mask key should fail");
  } catch (error) {
    assertEqual(
      error instanceof Error ? error.message : "",
      "export-output-mask-required",
      "unknown output-mask keys should require an explicit mask",
    );
  }
  assertDeepEqual(
    resolveDefaultOutputMask("mockup", ["otherMask"], {
      mode: "outline",
      sourceKey: "otherMask",
    }),
    { mode: "outline", sourceKey: "otherMask" },
    "explicit output mask should win over graph keys",
  );

  const runtime = new Pooder();
  const service = new FakeSceneExportService();
  service.response = {
    crop: { left: 1, top: 2, width: 30, height: 20 },
    format: "png",
    height: 60,
    multiplier: 3,
    source: {
      elementIds: ["visual"],
      tags: ["design"],
    },
    sceneId: "front",
    url: "data:image/png;base64,design",
    width: 90,
  };
  runtime.extensions.register(new ExportCapability());
  runtime.services.register(service as never, SCENE_EXPORT_SERVICE);
  runtime.services
    .getOrThrow<SceneService>(SCENE_SERVICE)
    .registerDocumentScene("front");
  runtime.services
    .getOrThrow<SceneBoundsService>(SCENE_BOUNDS_SERVICE)
    .setBounds("front", SCENE_BOUNDS);
  await runtime.extensions.flushActivation();
  try {
    assertEqual(
      runtime.extensions.getState(EXPORT_CAPABILITY_ID)?.state,
      "active",
      "export should activate",
    );
    assertEqual(
      runtime.capabilities.list().filter((capability) =>
        capability.id.includes("export"),
      ).length,
      1,
      "runtime should register exactly one export capability",
    );
    assertEqual(
      runtime.services
        .getOrThrow<CommandService>(COMMAND_SERVICE)
        .getCommand("exportImage"),
      undefined,
      "export must not restore the legacy command",
    );
    const facade = runtime.capabilities.get<ExportCapabilityApi>(
      EXPORT_CAPABILITY_ID,
    );
    assert(facade, "export facade should be registered");
    const result = await facade.exportImage({
      multiplier: 3,
      purpose: "design",
      sceneId: "front",
      source: { elementIds: ["visual"] },
    });
    assertDeepEqual(
      service.calls.at(-1)?.source,
      { elementIds: ["visual"] },
      "export should delegate the explicit source",
    );
    assertEqual(result.url, "data:image/png;base64,design", "export url");
    assertEqual(result.sceneId, "front", "export should include the scene id");
    assertDeepEqual(
      result.source,
      {
        elementIds: ["visual"],
        tags: ["design"],
      },
      "export should map the platform source result",
    );
    assertDeepEqual(
      result.crop,
      { left: 1, top: 2, width: 30, height: 20 },
      "export should map the platform crop",
    );
    await facade.exportImage({ purpose: "design", sceneId: "front" });
    assertDeepEqual(
      service.calls.at(-1)?.crop,
      {
        type: "sceneRect",
        rect: { left: 10, top: 5, width: 180, height: 90, space: "scene" },
      },
      "design export should crop to the content rect by default",
    );
    assertDeepEqual(
      service.calls.at(-1)?.source,
      { tags: ["export:design"] },
      "design export should use the canonical design export tag by default",
    );
    assertEqual(
      Object.prototype.hasOwnProperty.call(
        service.calls.at(-1) ?? {},
        "includeHidden",
      ),
      false,
      "export must not rewrite membership with includeHidden",
    );
    assertEqual(
      service.calls.at(-1)?.preserveClipPaths,
      true,
      "export should preserve clip paths by default",
    );
    await facade.exportImage({
      purpose: "design",
      sceneId: "front",
      crop: {
        left: 0,
        top: 0,
        width: 200,
        height: 100,
        space: "scene",
      },
    });
    assertDeepEqual(
      service.calls.at(-1)?.crop,
      {
        type: "sceneRect",
        rect: { left: 0, top: 0, width: 200, height: 100, space: "scene" },
      },
      "export should use an explicit crop when provided",
    );

    runtime.config.update("export.cutMode", "outset");
    runtime.config.update("export.cutMarginMm", 4);
    await facade.exportImage({ purpose: "design", sceneId: "front" });
    assertDeepEqual(
      service.calls.at(-1)?.crop,
      {
        type: "sceneRect",
        rect: { left: 6, top: 1, width: 188, height: 98, space: "scene" },
      },
      "design export should expand the content rect when cutMode is outset",
    );
    await facade.exportImage({ purpose: "mockup", sceneId: "front" });
    assertDeepEqual(
      service.calls.at(-1)?.crop,
      {
        type: "sceneRect",
        rect: { left: 10, top: 5, width: 180, height: 90, space: "scene" },
      },
      "mockup export should crop to the content rect",
    );
    assertDeepEqual(
      service.calls.at(-1)?.source,
      { tags: ["export:mockup"] },
      "mockup export should use the canonical mockup export tag by default",
    );
    assertEqual(
      Object.prototype.hasOwnProperty.call(
        service.calls.at(-1) ?? {},
        "outputMask",
      ),
      false,
      "mockup export should skip output mask when the document has no keys",
    );
    runtime.config.update("export.cutMode", "trim");
    runtime.config.update("export.cutMarginMm", 0);

    runtime.services
      .getOrThrow<SceneService>(SCENE_SERVICE)
      .registerDocumentScene("back");
    runtime.services
      .getOrThrow<SceneBoundsService>(SCENE_BOUNDS_SERVICE)
      .setBounds("back", SCENE_BOUNDS);
    const explicitCallCount = service.calls.length;
    await facade.exportImage({
      purpose: "design",
      sceneId: "back",
      crop: {
        left: 1,
        top: 2,
        width: 3,
        height: 4,
        space: "scene",
      },
    });
    const explicitCalls = service.calls.slice(explicitCallCount);
    assertEqual(explicitCalls.length, 1, "one call exports one scene");
    assertEqual(
      explicitCalls[0]?.sceneId,
      "back",
      "export should use the requested sceneId",
    );
    await facade.exportImage({ purpose: "design", sceneId: "front" }).then(
      () => undefined,
      () => {
        throw new Error("front should still export independently");
      },
    );

    await facade.exportImage({
      purpose: "mockup",
      sceneId: "front",
      preserveClipPaths: false,
    });
    assertEqual(
      service.calls.at(-1)?.preserveClipPaths,
      false,
      "export should accept preserveClipPaths=false",
    );
    await facade.exportImage({
      format: "jpeg",
      outputMask: { mode: "outline", sourceKey: "frame" },
      purpose: "mockup",
      sceneId: "front",
    });
    assertEqual(
      service.calls.at(-1)?.format,
      "png",
      "output masks should force lossless png",
    );
    assertDeepEqual(
      service.calls.at(-1)?.outputMask,
      { mode: "outline", sourceKey: "frame" },
      "export should delegate explicit output mask options",
    );

    service.errorsBySceneId.set(
      "front",
      new Error("browser-scene-export-empty"),
    );
    await facade.exportImage({ purpose: "design", sceneId: "front" }).then(
      () => {
        throw new Error("empty export should fail");
      },
      (error: unknown) => {
        assertEqual(
          error instanceof Error ? error.message : "",
          "export-empty",
          "export should fail when the requested scene is empty",
        );
      },
    );
    service.errorsBySceneId.clear();
    for (const [platformError, capabilityError] of [
      ["browser-scene-export-empty", "export-empty"],
      ["browser-scene-export-failed", "export-failed"],
      [
        "browser-scene-export-output-mask-source-missing",
        "export-output-mask-source-missing",
      ],
    ] as const) {
      service.error = new Error(platformError);
      await facade
        .exportImage({
          purpose: "mockup",
          sceneId: "front",
        })
        .then(
          () => {
            throw new Error(`${platformError} should be mapped`);
          },
          (error: unknown) => {
            assertEqual(
              error instanceof Error ? error.message : "",
              capabilityError,
              `${platformError} mapping`,
            );
          },
        );
    }
    service.error = null;

    await facade
      .exportImage({
        purpose: "preview" as ExportPurpose,
        sceneId: "front",
      })
      .then(
        () => {
          throw new Error("invalid purpose should fail");
        },
        (error: unknown) => {
          assertEqual(
            error instanceof Error ? error.message : "",
            "export-purpose-required",
            "invalid purpose should not reuse export-scene-required",
          );
        },
      );
    await facade.exportImage({ purpose: "design", sceneId: " " }).then(
      () => {
        throw new Error("missing scene should fail");
      },
      (error: unknown) => {
        assertEqual(
          error instanceof Error ? error.message : "",
          "export-scene-required",
          "missing sceneId should stay export-scene-required",
        );
      },
    );

    const controller = registerEditorDocumentService(runtime, {
      effectSchemaRegistry: createEffectSchemaRegistry(),
      resolveEffectCapabilityId,
    });
    const masked = await controller.apply(
      createEffectDocument(undefined, { type: "image" }, [
        { type: "core.output-mask", keys: [DEFAULT_MOCKUP_OUTPUT_MASK_KEY] },
      ]),
    );
    assertEqual(masked.ok, true, "output-mask document should apply");
    runtime.services
      .getOrThrow<SceneBoundsService>(SCENE_BOUNDS_SERVICE)
      .setBounds("front", SCENE_BOUNDS);
    await facade.exportImage({ purpose: "mockup", sceneId: "front" });
    assertDeepEqual(
      service.calls.at(-1)?.outputMask,
      {
        mode: "outline",
        sourceKey: DEFAULT_MOCKUP_OUTPUT_MASK_KEY,
        transparentColor: { red: 255, green: 255, blue: 255, tolerance: 8 },
      },
      "mockup export should read templateFrame from the compiled graph",
    );

    const ambiguous = await controller.apply({
      ...createEffectDocument(undefined, { type: "image" }, [
        { type: "core.output-mask", keys: [DEFAULT_MOCKUP_OUTPUT_MASK_KEY] },
      ]),
      surfaces: [
        {
          id: "front",
          bounds: { x: 0, y: 0, width: 200, height: 100 },
          objects: [
            {
              type: "group",
              id: "artwork",
              tags: [],
              visible: true,
              locked: false,
              localToParent: [1, 0, 0, 1, 0, 0],
              children: [
                {
                  type: "image",
                  id: "visual",
                  tags: ["visual:test"],
                  visible: true,
                  locked: false,
                  traits: [
                    {
                      type: "core.output-mask",
                      keys: [DEFAULT_MOCKUP_OUTPUT_MASK_KEY],
                    },
                  ],
                  localFrame: { x: 0, y: 0, width: 80, height: 40 },
                  localToParent: [1, 0, 0, 1, 50, 40],
                  localPivot: { x: 40, y: 20 },
                  source: { kind: "asset", assetId: "visual.asset" },
                  contentFit: {
                    fit: "contain",
                    anchorX: 0.5,
                    anchorY: 0.5,
                    zoom: 1,
                    rotation: 0,
                    clip: "frame",
                  },
                  opacity: 1,
                },
                {
                  type: "image",
                  id: "visual-alt",
                  tags: ["visual:alt"],
                  visible: true,
                  locked: false,
                  traits: [{ type: "core.output-mask", keys: ["otherMask"] }],
                  localFrame: { x: 0, y: 0, width: 80, height: 40 },
                  localToParent: [1, 0, 0, 1, 50, 40],
                  localPivot: { x: 40, y: 20 },
                  source: { kind: "asset", assetId: "visual.asset" },
                  contentFit: {
                    fit: "contain",
                    anchorX: 0.5,
                    anchorY: 0.5,
                    zoom: 1,
                    rotation: 0,
                    clip: "frame",
                  },
                  opacity: 1,
                },
              ],
            },
          ],
        },
      ],
    });
    assertEqual(
      ambiguous.ok,
      true,
      "ambiguous output-mask document should apply",
    );
    await facade.exportImage({ purpose: "mockup", sceneId: "front" }).then(
      () => {
        throw new Error("ambiguous graph mask keys should fail");
      },
      (error: unknown) => {
        assertEqual(
          error instanceof Error ? error.message : "",
          "export-output-mask-ambiguous",
          "capability should require an explicit mask when the graph has multiple keys",
        );
      },
    );
  } finally {
    await runtime.dispose();
  }
}

async function testMirrorCapability(): Promise<void> {
  const runtime = new Pooder();
  runtime.extensions.register(new MirrorCapabilityExtension());
  await runtime.extensions.flushActivation();
  const controller = registerEditorDocumentService(runtime, {
    effectSchemaRegistry: createEffectSchemaRegistry(),
    resolveEffectCapabilityId,
  });
  try {
    const applied = await controller.apply(
      createEffectDocument(
        { type: "mirror", payload: { horizontal: true } },
        { type: "shape", shape: "rect", params: {} },
      ),
    );
    assertEqual(applied.ok, true, "mirror document should apply");
    const renderIntents = runtime.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    const getNode = () =>
      renderIntents
        .getGraph()
        .layers.flatMap((layer) => layer.nodes)
        .find((node) => node.subjectId === "visual");
    assertDeepEqual(
      getNode()?.data.mirror,
      { horizontal: true, vertical: false },
      "document mirror state should compile",
    );
    const facade =
      runtime.capabilities.get<MirrorCapabilityApi>(MIRROR_CAPABILITY_ID);
    assert(facade, "mirror facade should be registered");
    const toggled = facade.toggleObjectMirror(
      { objectId: "visual" },
      "vertical",
    );
    assertDeepEqual(
      toggled,
      { horizontal: true, vertical: true },
      "mirror facade should toggle the current graph state",
    );
    assertDeepEqual(
      getNode()?.data.mirror,
      { horizontal: true, vertical: true },
      "runtime mirror patch should update the graph",
    );
    assertEqual(
      facade.clearObjectMirror({ objectId: "visual" }),
      true,
      "mirror runtime override should clear",
    );
    assertDeepEqual(
      getNode()?.data.mirror,
      { horizontal: true, vertical: false },
      "clearing should reveal the document mirror state",
    );
  } finally {
    await runtime.dispose();
  }
}

async function testImageMaskCapability(): Promise<void> {
  assertEqual(
    mapImageMaskAlpha(
      0.2,
      normalizeImageMaskAlpha({ selection: "transparent" }),
    ),
    0.8,
    "transparent alpha selection",
  );
  assertEqual(
    mapImageMaskAlpha(
      0.2,
      normalizeImageMaskAlpha({
        selection: "transparent",
        mapping: "threshold",
        threshold: 0.7,
      }),
    ),
    1,
    "transparent alpha threshold",
  );
  assertEqual(
    mapImageMaskAlpha(
      0.4,
      normalizeImageMaskAlpha({
        selection: "transparent",
        mapping: "threshold",
        threshold: 0.7,
      }),
    ),
    0,
    "transparent threshold should reject insufficient transparency",
  );
  assertEqual(
    mapImageMaskAlpha(
      0.5,
      normalizeImageMaskAlpha({
        mapping: "threshold",
        threshold: 0.5,
        softness: 0.2,
        outputOpacity: 0.5,
      }),
    ),
    0.25,
    "soft threshold should scale by output opacity",
  );
  const runtime = new Pooder();
  runtime.extensions.register(new ImageMaskCapabilityExtension());
  await runtime.extensions.flushActivation();
  try {
    const facade = runtime.capabilities.get<ImageMaskCapabilityApi>(
      IMAGE_MASK_CAPABILITY_ID,
    );
    assert(facade, "image mask facade should be registered");
    await facade.extractAlphaMask("data:image/png;base64,test").then(
      () => {
        throw new Error("image mask should require browser APIs");
      },
      (error: unknown) => {
        assertEqual(
          error instanceof Error ? error.message : "",
          "image-mask-browser-required",
          "image mask should report missing browser APIs",
        );
      },
    );
  } finally {
    await runtime.dispose();
  }
}

async function testEdgeDetectionCapability(): Promise<void> {
  const runtime = new Pooder();
  runtime.services.register(
    {
      resolve: async () => ({
        format: "png",
        height: 1,
        multiplier: 1,
        objectId: "visual",
        representation: "committed-visual",
        url: "data:image/png;base64,test",
        width: 1,
      }),
    } as never,
    OBJECT_IMAGE_RESOLVER_SERVICE,
  );
  runtime.extensions.register(new EdgeDetectionCapabilityExtension());
  await runtime.extensions.flushActivation();
  try {
    assert(
      runtime.capabilities.get<EdgeDetectionCapabilityApi>(
        EDGE_DETECTION_CAPABILITY_ID,
      ),
      "edge detection facade should be registered",
    );
  } finally {
    await runtime.dispose();
  }
}

export async function runExistingCapabilityRegressions(): Promise<void> {
  const tests: Array<[string, () => Promise<void>]> = [
    ["shared capability utilities", testSharedCurrentCapabilityUtilities],
    ["Export", testExportCapability],
    ["Mirror", testMirrorCapability],
    ["ImageMask", testImageMaskCapability],
    ["EdgeDetection", testEdgeDetectionCapability],
  ];
  for (const [name, run] of tests) {
    await run();
    console.log(`PASS tools ${name}`);
  }
}
