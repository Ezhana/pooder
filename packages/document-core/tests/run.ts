import {
  GEOMETRY_SOURCE_SERVICE,
  RENDER_INTENT_SERVICE,
  Pooder,
  type GeometrySourceService,
  type RenderIntentService,
} from "@pooder/core";
import {
  resolveEditorDocumentAsset,
  type EditorDocument,
} from "@pooder/document";
import {
  registerEditorDocumentService,
  resolveObjectSource,
  sceneFrameToLocalFrame,
} from "../src";

declare const process: { exit(code: number): never };

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

function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message} (expected ${expectedJson}, got ${actualJson})`);
  }
}

function createDocument(): EditorDocument {
  return {
    version: 7,
    assets: [
      {
        id: "artwork.asset",
        type: "image",
        source: { kind: "url", url: "/artwork.png" },
        intrinsicSize: { width: 200, height: 100 },
      },
    ],
    extensions: {},
    surfaces: [
      {
        id: "front",
        geometry: {
          canvasBounds: { x: 0, y: 0, width: 100, height: 100 },
          productionBounds: { x: 5, y: 5, width: 90, height: 90 },
        },
        layers: [
          {
            id: "front.content",
            visible: true,
            locked: false,
            objects: [
              {
                type: "shape",
                id: "clip-source",
                tags: ["clip:source"],
                visible: false,
                locked: true,
                placement: {
                  localBounds: { x: 0, y: 0, width: 80, height: 60 },
                  localToParent: [1, 0, 0, 1, 10, 20],
                  pivot: { x: 40, y: 30 },
                },
                source: {
                  kind: "inline",
                  content: { shape: "rect", params: {} },
                },
              },
              {
                type: "image",
                id: "artwork",
                tags: ["artwork:test"],
                visible: true,
                locked: false,
                placement: {
                  localBounds: { x: 0, y: 0, width: 80, height: 60 },
                  localToParent: [1, 0.25, -0.1, 1, 10, 20],
                  pivot: { x: 40, y: 30 },
                },
                source: { kind: "asset", assetId: "artwork.asset" },
                appearance: {
                  fit: "cover",
                  anchorX: 0.5,
                  anchorY: 0.5,
                  zoom: 1,
                  rotation: 0,
                  opacity: 1,
                  clip: "frame",
                },
                effects: [
                  {
                    type: "core.geometry.clip",
                    sourceObjectId: "clip-source",
                    participation: "both",
                  },
                ],
                interaction: {
                  selection: { enabled: true },
                  manipulation: {
                    move: {
                      enabled: true,
                      constraints: [{ spec: { type: "rect.contain" } }],
                    },
                    resize: { enabled: true },
                    rotate: { enabled: true },
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

function testSourceResolution(): void {
  const base = {
    id: "test",
    tags: [],
    visible: true,
    locked: false,
    placement: {
      localBounds: { x: 0, y: 0, width: 1, height: 1 },
      localToParent: [1, 0, 0, 1, 0, 0] as [
        number,
        number,
        number,
        number,
        number,
        number,
      ],
      pivot: { x: 0, y: 0 },
    },
  };
  assert(
    resolveObjectSource({
      ...base,
      type: "shape",
      source: { kind: "inline", content: { shape: "circle", params: {} } },
    })?.pathData,
    "shape source should resolve geometry",
  );
  assertEqual(
    resolveObjectSource({
      ...base,
      type: "text",
      source: { kind: "inline", content: { text: "Label" } },
    })?.text,
    "Label",
    "text source should resolve content",
  );
}

async function testStrictApplyAndGeometry(): Promise<void> {
  const runtime = new Pooder();
  const controller = registerEditorDocumentService(runtime);
  try {
    const result = await controller.apply(createDocument());
    assert(
      result.ok,
      `strict document should apply (${JSON.stringify(result.diagnostics)})`,
    );
    const renderIntents = runtime.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    const artwork = renderIntents
      .getGraph()
      .layers.flatMap((layer) => layer.nodes)
      .find((node) => node.subjectId === "artwork");
    assert(artwork, "artwork should compile into the render graph");

    const geometry = runtime.services.getOrThrow<GeometrySourceService>(
      GEOMETRY_SOURCE_SERVICE,
    );
    const bounds = geometry.getBounds(
      {
        sourceId: "document-object",
        geometryId: "artwork",
        purpose: "preview",
      },
      "scene",
    );
    assert(bounds.value, "document object geometry should be registered");

    const beforeRevision = renderIntents.getGraph().revision;
    const mutation = await controller.updateObject("artwork", (object) => ({
      ...object,
      visible: false,
    }));
    assert(mutation.ok, "object mutation should commit");
    assert(
      renderIntents.getGraph().revision > beforeRevision,
      "committed mutation should republish render intent",
    );
  } finally {
    await runtime.dispose();
  }
}

async function testDocumentLayerArrayDefinesRenderGraphOrder(): Promise<void> {
  const document = createDocument();
  document.surfaces[0]!.layers = ["bottom", "middle", "top"].map(
    (id, layerIndex) => ({
      id,
      visible: true,
      locked: false,
      objects: [
        {
          type: "shape" as const,
          id: `${id}.object`,
          tags: [],
          visible: true,
          locked: false,
          placement: {
            localBounds: { x: 0, y: 0, width: 10, height: 10 },
            localToParent: [1, 0, 0, 1, layerIndex, layerIndex],
            pivot: { x: 0, y: 0 },
          },
          source: {
            kind: "inline" as const,
            content: { shape: "rect" as const, params: {} },
          },
        },
      ],
    }),
  );

  const runtime = new Pooder();
  const controller = registerEditorDocumentService(runtime);
  try {
    const applied = await controller.apply(document);
    assert(applied.ok, "layer ordering document should apply");
    const graph = runtime.services
      .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
      .getGraph();
    assertDeepEqual(
      graph.layers.map((layer) => layer.id),
      ["bottom", "middle", "top"],
      "RenderGraph should use document layer indexes from bottom to top",
    );
    assertEqual(
      graph.layers[0]?.order,
      0,
      "the first layer should be bottommost",
    );
    assertEqual(
      graph.layers.at(-1)?.order,
      2,
      "the last layer should be topmost",
    );
  } finally {
    await runtime.dispose();
  }
}

async function testRejectedDocumentsRemainAtomic(): Promise<void> {
  const runtime = new Pooder();
  const controller = registerEditorDocumentService(runtime);
  try {
    const initial = await controller.apply(createDocument());
    assert(initial.ok, "initial document should apply");
    const invalid = { ...createDocument(), metadata: {} };
    const rejected = await controller.apply(invalid);
    assertEqual(rejected.ok, false, "unknown document fields should reject");
    assertEqual(
      controller.export()?.surfaces[0]?.id,
      "front",
      "rejected apply should preserve the committed document",
    );
  } finally {
    await runtime.dispose();
  }
}

async function testSceneTranslationCommit(): Promise<void> {
  const runtime = new Pooder();
  const controller = registerEditorDocumentService(runtime);
  try {
    const applied = await controller.apply(createDocument());
    assert(applied.ok, "translation fixture should apply");
    const result = await controller.commitManipulation({
      subjectId: "artwork",
      sceneTransformPatch: {
        type: "translate",
        coordinateSpace: "scene",
        delta: { space: "scene", x: 20, y: 10 },
      },
      parentMatrix: [2, 0, 0, 2, 0, 0],
    });
    assert(result.ok, "scene translation should commit");
    assertDeepEqual(
      controller.export()?.surfaces[0]!.layers[0]!.objects[1]!.placement
        .localToParent,
      [1, 0.25, -0.1, 1, 20, 25],
      "scene delta should convert to parent-local translation",
    );
  } finally {
    await runtime.dispose();
  }
}

async function testImageUploadReplacesOnlyTheTargetSource(): Promise<void> {
  const runtime = new Pooder();
  const controller = registerEditorDocumentService(runtime);
  try {
    const document = createDocument();
    const layer = document.surfaces[0]!.layers[0]!;
    const artwork = layer.objects.find((object) => object.id === "artwork")!;
    layer.objects.push({
      ...JSON.parse(JSON.stringify(artwork)),
      id: "artwork-copy",
      effects: undefined,
    });
    assert(
      (await controller.apply(document)).ok,
      "shared image fixture should apply",
    );

    const updated = await controller.updateImageResources(
      { ids: ["artwork"] },
      { source: { kind: "url", url: "/replacement.png" } },
      { expectedCount: 1 },
    );
    assert(updated.ok, "target image upload should commit");
    const exported = controller.export()!;
    const target = exported.surfaces[0]!.layers[0]!.objects.find(
      (object) => object.id === "artwork",
    );
    const sibling = exported.surfaces[0]!.layers[0]!.objects.find(
      (object) => object.id === "artwork-copy",
    );
    assert(
      target?.type === "image" && sibling?.type === "image",
      "images should retain type",
    );
    assert(
      target.source?.assetId !== sibling.source?.assetId,
      "upload should replace only the target source reference",
    );
    const targetAsset = resolveEditorDocumentAsset(
      exported,
      target.source,
      "image",
    );
    const siblingAsset = resolveEditorDocumentAsset(
      exported,
      sibling.source,
      "image",
    );
    assertEqual(
      targetAsset?.source.kind === "url" ? targetAsset.source.url : undefined,
      "/replacement.png",
      "target should resolve the replacement asset",
    );
    assertEqual(
      siblingAsset?.source.kind === "url" ? siblingAsset.source.url : undefined,
      "/artwork.png",
      "sibling should retain the shared original asset",
    );
  } finally {
    await runtime.dispose();
  }
}

function testSceneFrameConversion(): void {
  assertDeepEqual(
    sceneFrameToLocalFrame(
      { left: 30, top: 50, width: 40, height: 20 },
      [2, 0, 0, 2, 10, 10],
    ),
    { left: 10, top: 20, width: 20, height: 10 },
    "scene frame should use the inverse parent matrix",
  );
}

async function main(): Promise<void> {
  testSourceResolution();
  testSceneFrameConversion();
  await testStrictApplyAndGeometry();
  await testDocumentLayerArrayDefinesRenderGraphOrder();
  await testRejectedDocumentsRemainAtomic();
  await testSceneTranslationCommit();
  await testImageUploadReplacesOnlyTheTargetSource();
  console.log("ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
