import {
  COMMAND_SERVICE,
  OBJECT_IMAGE_RESOLVER_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_EXPORT_SERVICE,
  Pooder,
  evaluateRuntimeCondition,
  type CommandService,
  type RenderIntentService,
} from "@pooder/core";
import type {
  EditorDocument,
  EditorObject,
  EditorObjectEffect,
} from "@pooder/document";
import { registerEditorDocumentService } from "../../document-core/src";
import {
  DESIGN_EXPORT_CAPABILITY_ID,
  EDGE_DETECTION_CAPABILITY_ID,
  IMAGE_MASK_CAPABILITY_ID,
  MIRROR_CAPABILITY_ID,
  SCENE_EXPORT_CAPABILITY_ID,
  DesignExportCapabilityExtension,
  EdgeDetectionCapabilityExtension,
  ImageMaskCapabilityExtension,
  MirrorCapabilityExtension,
  SceneExportCapabilityExtension,
  createOfficialToolEffectSchemaRegistry,
  mapImageMaskAlpha,
  normalizeImageMaskAlpha,
  resolveOfficialToolDocumentEffectCapabilityId,
  type DesignExportCapabilityApi,
  type EdgeDetectionCapabilityApi,
  type ImageMaskCapabilityApi,
  type MirrorCapabilityApi,
  type SceneExportCapabilityApi,
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
  response: Record<string, unknown> = {};

  async exportImage(options: Record<string, unknown>) {
    this.calls.push(options);
    if (this.error) throw this.error;
    return this.response;
  }
}

const FRAMES = {
  previewBounds: { xMm: 0, yMm: 0, widthMm: 200, heightMm: 100 },
  productionFrame: { xMm: 0, yMm: 0, widthMm: 200, heightMm: 100 },
  viewportFocusFrame: { xMm: 0, yMm: 0, widthMm: 200, heightMm: 100 },
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
  effect: EditorObjectEffect,
  source:
    | { type: "image" }
    | {
        type: "shape";
        shape: "rect" | "circle" | "ellipse" | "heart";
        params: Record<string, never>;
      },
): EditorDocument {
  const geometry = {
    localBounds: { x: 0, y: 0, width: 80, height: 40 },
    localToParent: [1.15911, 0.31058, -0.20706, 0.77274, 50, 40] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
    pivot: { x: 40, y: 20 },
  };
  const visual: EditorObject =
    source.type === "image"
      ? {
          type: "image",
          id: "visual",
          tags: ["visual:test"],
          visible: true,
          locked: false,
          ...geometry,
          source: { kind: "asset", assetId: "visual.asset" },
          contentFit: {
            fit: "contain",
            anchorX: 0.5,
            anchorY: 0.5,
            zoom: 1,
            rotation: 0,
          },
          opacity: 1,
          clip: "frame",
          effects: [effect],
        }
      : {
          type: "shape",
          id: "visual",
          tags: ["visual:test"],
          visible: true,
          locked: false,
          ...geometry,
          source: {
            kind: "inline",
            content: {
              shape: source.shape,
              params: source.params,
            },
          },
          effects: [effect],
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
    extensions: {},
    surfaces: [
      {
        id: "front",
        geometry: {
          canvasBounds: { x: 0, y: 0, width: 200, height: 100 },
          productionBounds: { x: 0, y: 0, width: 200, height: 100 },
        },
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

async function testDesignExportCapability(): Promise<void> {
  const runtime = new Pooder();
  const service = new FakeSceneExportService();
  service.response = {
    crop: { left: 1, top: 2, width: 30, height: 20 },
    format: "png",
    height: 60,
    multiplier: 3,
    source: {
      layerIds: ["artwork"],
      elementIds: ["visual"],
      tags: ["design"],
    },
    url: "data:image/png;base64,design",
    width: 90,
  };
  runtime.extensions.register(new DesignExportCapabilityExtension());
  runtime.services.register(service as never, SCENE_EXPORT_SERVICE);
  await runtime.extensions.flushActivation();
  try {
    assertEqual(
      runtime.extensions.getState(DESIGN_EXPORT_CAPABILITY_ID)?.state,
      "active",
      "design export should activate",
    );
    assertEqual(
      runtime.services
        .getOrThrow<CommandService>(COMMAND_SERVICE)
        .getCommand("exportImage"),
      undefined,
      "design export must not restore the legacy command",
    );
    const facade = runtime.capabilities.get<DesignExportCapabilityApi>(
      DESIGN_EXPORT_CAPABILITY_ID,
    );
    assert(facade, "design export facade should be registered");
    const result = await facade.exportImage({
      crop: {
        type: "sceneRect",
        rect: { space: "scene", left: 1, top: 2, width: 30, height: 20 },
      },
      multiplier: 3,
      source: { elementIds: ["visual"], layerIds: ["artwork"] },
    });
    assertDeepEqual(
      service.calls.at(-1)?.source,
      { elementIds: ["visual"], layerIds: ["artwork"] },
      "design export should delegate the explicit source",
    );
    assertEqual(
      result.url,
      "data:image/png;base64,design",
      "design export url",
    );
    assertDeepEqual(
      result.source,
      {
        layerIds: ["artwork"],
        elementIds: ["visual"],
        tags: ["design"],
      },
      "design export should map the platform source result",
    );
    assertDeepEqual(
      result.crop,
      { left: 1, top: 2, width: 30, height: 20 },
      "design export should map the platform crop",
    );
    await facade.exportImage();
    assertDeepEqual(
      service.calls.at(-1)?.crop,
      { type: "frame", frame: "cut" },
      "design export should default to cut frame",
    );
    assertDeepEqual(
      service.calls.at(-1)?.source,
      { tags: ["export:design"] },
      "design export should use the canonical design export tag by default",
    );
  } finally {
    await runtime.dispose();
  }
}

async function testSceneExportCapability(): Promise<void> {
  const runtime = new Pooder();
  const service = new FakeSceneExportService();
  service.response = {
    crop: { left: 4, top: 5, width: 120, height: 90 },
    format: "png",
    height: 90,
    multiplier: 1,
    source: { layerIds: ["base", "artwork"], elementIds: [], tags: [] },
    url: "data:image/png;base64,scene",
    width: 120,
  };
  runtime.extensions.register(new SceneExportCapabilityExtension());
  runtime.services.register(service as never, SCENE_EXPORT_SERVICE);
  await runtime.extensions.flushActivation();
  try {
    const facade = runtime.capabilities.get<SceneExportCapabilityApi>(
      SCENE_EXPORT_CAPABILITY_ID,
    );
    assert(facade, "scene export facade should be registered");
    const result = await facade.exportImage({
      crop: {
        type: "sceneRect",
        rect: { space: "scene", left: 4, top: 5, width: 120, height: 90 },
      },
      includeHidden: true,
      source: { layerIds: ["base", "artwork"] },
    });
    assertEqual(service.calls.at(-1)?.includeHidden, true, "includeHidden");
    assertEqual(
      service.calls.at(-1)?.preserveClipPaths,
      true,
      "scene export should preserve clip paths by default",
    );
    assertEqual(result.url, "data:image/png;base64,scene", "scene export url");
    assertDeepEqual(
      result.source,
      { layerIds: ["base", "artwork"], elementIds: [], tags: [] },
      "scene export should map the platform source result",
    );
    assertDeepEqual(
      result.crop,
      { left: 4, top: 5, width: 120, height: 90 },
      "scene export should map the platform crop",
    );
    await facade.exportImage({ preserveClipPaths: false });
    assertEqual(
      service.calls.at(-1)?.preserveClipPaths,
      false,
      "scene export should accept preserveClipPaths=false",
    );
    await facade.exportImage({
      format: "jpeg",
      outputMask: { mode: "outline", sourceKey: "frame" },
    });
    assertEqual(
      service.calls.at(-1)?.format,
      "png",
      "output masks should force lossless png",
    );
    assertDeepEqual(
      service.calls.at(-1)?.outputMask,
      { mode: "outline", sourceKey: "frame" },
      "scene export should delegate output mask options",
    );
    for (const [platformError, capabilityError] of [
      ["browser-scene-export-empty", "scene-export-empty"],
      ["browser-scene-export-failed", "scene-export-failed"],
      [
        "browser-scene-export-output-mask-source-missing",
        "scene-export-output-mask-source-missing",
      ],
    ] as const) {
      service.error = new Error(platformError);
      await facade.exportImage().then(
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
  } finally {
    await runtime.dispose();
  }
}

async function testMirrorCapability(): Promise<void> {
  const runtime = new Pooder();
  runtime.extensions.register(new MirrorCapabilityExtension());
  await runtime.extensions.flushActivation();
  const controller = registerEditorDocumentService(runtime, {
    effectSchemaRegistry: createOfficialToolEffectSchemaRegistry(),
    resolveEffectCapabilityId: resolveOfficialToolDocumentEffectCapabilityId,
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
    ["DesignExport", testDesignExportCapability],
    ["SceneExport", testSceneExportCapability],
    ["Mirror", testMirrorCapability],
    ["ImageMask", testImageMaskCapability],
    ["EdgeDetection", testEdgeDetectionCapability],
  ];
  for (const [name, run] of tests) {
    await run();
    console.log(`PASS tools ${name}`);
  }
}
