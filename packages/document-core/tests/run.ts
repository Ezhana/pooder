import {
  GEOMETRY_SOURCE_SERVICE,
  RENDER_INTENT_SERVICE,
  Pooder,
  type GeometrySourceService,
  type ImageResourceService,
  type RenderIntentService,
} from "@pooder/core";
import {
  resolveEditorDocumentAsset,
  type EditorDocument,
  type EditorImageObject,
} from "@pooder/document";
import {
  collectUnresolvableImageObjectIds,
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
    version: 8,
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
        objects: [
          {
            type: "group",
            id: "front.content",
            tags: [],
            visible: true,
            locked: false,
            localToParent: [1, 0, 0, 1, 0, 0],
            children: [
              {
                type: "shape",
                id: "clip-source",
                tags: ["clip:source"],
                visible: false,
                locked: true,
                localFrame: { x: 0, y: 0, width: 80, height: 60 },
                localToParent: [1, 0, 0, 1, 10, 20],
                localPivot: { x: 40, y: 30 },
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
                localFrame: { x: 0, y: 0, width: 80, height: 60 },
                localToParent: [1, 0.25, -0.1, 1, 10, 20],
                localPivot: { x: 40, y: 30 },
                source: { kind: "asset", assetId: "artwork.asset" },
                contentFit: {
                  fit: "cover",
                  anchorX: 0.5,
                  anchorY: 0.5,
                  zoom: 1,
                  rotation: 0,
                  clip: "frame",
                },
                opacity: 1,
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
    localFrame: { x: 0, y: 0, width: 1, height: 1 },
    localToParent: [1, 0, 0, 1, 0, 0] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
    localPivot: { x: 0, y: 0 },
  };
  assert(
    resolveObjectSource({
      ...base,
      type: "shape",
      source: { kind: "inline", content: { shape: "circle", params: {} } },
    })?.pathData,
    "shape source should resolve geometry",
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

async function testDocumentDepthFirstOrderDefinesRenderGraphOrder(): Promise<void> {
  const document = createDocument();
  const shape = (id: string) => ({
    type: "shape" as const,
    id,
    tags: [],
    visible: true,
    locked: false,
    localFrame: { x: 0, y: 0, width: 10, height: 10 },
    localToParent: [1, 0, 0, 1, 0, 0] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
    source: {
      kind: "inline" as const,
      content: { shape: "rect" as const, params: {} },
    },
  });
  document.surfaces[0]!.objects = [
    {
      type: "group",
      id: "z-root",
      tags: [],
      visible: true,
      locked: false,
      localToParent: [1, 0, 0, 1, 0, 0],
      children: [
        shape("z-first"),
        {
          type: "group",
          id: "a-nested-group",
          tags: [],
          visible: true,
          locked: false,
          localToParent: [1, 0, 0, 1, 0, 0],
          children: [shape("y-nested")],
        },
      ],
    },
    shape("a-last"),
  ];

  const runtime = new Pooder();
  const controller = registerEditorDocumentService(runtime);
  try {
    const applied = await controller.apply(document);
    assert(applied.ok, "root group ordering document should apply");
    const graph = runtime.services
      .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
      .getGraph();
    assertDeepEqual(
      graph.layers.map((layer) => layer.id),
      ["front"],
      "document groups should not create render layers",
    );
    assertDeepEqual(
      graph.layers[0]?.nodes.map((node) => node.id),
      ["z-first", "y-nested", "a-last"],
      "RenderGraph nodes should follow document DFS order rather than id order",
    );
  } finally {
    await runtime.dispose();
  }
}

async function testGroupFlatteningPreservesRenderProjection(): Promise<void> {
  const grouped = createDocument();
  const group = grouped.surfaces[0]!.objects[0]!;
  assert(group.type === "group", "flattening fixture root should be a group");
  group.localToParent = [1, 0, 0, 1, 30, 40];

  const flattened = JSON.parse(JSON.stringify(grouped)) as EditorDocument;
  const flattenedGroup = flattened.surfaces[0]!.objects[0]!;
  assert(
    flattenedGroup.type === "group",
    "flattening clone root should be a group",
  );
  flattened.surfaces[0]!.objects = flattenedGroup.children.map((child) => {
    const [a, b, c, d, e, f] = child.localToParent;
    return {
      ...child,
      visible: flattenedGroup.visible && child.visible,
      localToParent: [a, b, c, d, e + 30, f + 40] as typeof child.localToParent,
    };
  });

  const runtime = new Pooder();
  const controller = registerEditorDocumentService(runtime);
  const renderProjection = () =>
    runtime.services
      .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
      .getGraph()
      .layers.flatMap((layer) => layer.nodes)
      .map((node) => ({
        id: node.id,
        type: node.type,
        visual: node.visual,
        placement: node.placement,
        props: node.props,
        effects: node.effects,
        visible: node.visible,
        tags: node.tags,
      }));
  try {
    assert(
      (await controller.apply(grouped)).ok,
      "grouped document should apply",
    );
    const groupedProjection = renderProjection();
    assert(
      (await controller.apply(flattened)).ok,
      "flattened document should apply",
    );
    assertDeepEqual(
      renderProjection(),
      groupedProjection,
      "expanding a group in place should preserve its render projection",
    );

    group.visible = false;
    assert(
      (await controller.apply(grouped)).ok,
      "hidden ancestor document should apply",
    );
    assertEqual(
      renderProjection().find((node) => node.id === "artwork")?.visible,
      false,
      "ancestor visibility should be ANDed into visible descendants",
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
    const exportedGroup = controller.export()?.surfaces[0]!.objects[0];
    assert(exportedGroup?.type === "group", "exported root should be a group");
    assertDeepEqual(
      exportedGroup.children[1]!.localToParent,
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
    const group = document.surfaces[0]!.objects[0]!;
    assert(group.type === "group", "fixture root should be a group");
    const artwork = group.children.find((object) => object.id === "artwork")!;
    group.children.push({
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
    const exportedGroup = exported.surfaces[0]!.objects[0]!;
    assert(exportedGroup.type === "group", "exported root should be a group");
    const target = exportedGroup.children.find(
      (object) => object.id === "artwork",
    );
    const sibling = exportedGroup.children.find(
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

    const replacementAssetId = target.source?.assetId;
    const hidden = await controller.updateImageResources(
      { ids: ["artwork"] },
      { visible: false },
      { expectedCount: 1 },
    );
    assert(hidden.ok, "visibility-only image update should commit");
    const hiddenGroup = controller.export()!.surfaces[0]!.objects[0]!;
    assert(hiddenGroup.type === "group", "exported root should be a group");
    const hiddenTarget = hiddenGroup.children.find(
      (object) => object.id === "artwork",
    );
    assert(
      hiddenTarget?.type === "image",
      "visibility-only update should retain the image object",
    );
    assertEqual(
      hiddenTarget.source?.assetId,
      replacementAssetId,
      "omitting source should preserve the current resource",
    );
    assertEqual(
      controller
        .export()!
        .assets.some((asset) => asset.id === replacementAssetId),
      true,
      "visibility-only update should not reclaim the current resource",
    );

    const cleared = await controller.updateImageResources(
      { ids: ["artwork"] },
      { source: null },
      { expectedCount: 1 },
    );
    assert(cleared.ok, "explicit null source should clear the resource");
    const clearedGroup = controller.export()!.surfaces[0]!.objects[0]!;
    assert(clearedGroup.type === "group", "exported root should be a group");
    const clearedTarget = clearedGroup.children.find(
      (object) => object.id === "artwork",
    );
    assert(
      clearedTarget?.type === "image" && clearedTarget.source === null,
      "explicit null should persist an empty image source",
    );
    assertEqual(
      controller
        .export()!
        .assets.some((asset) => asset.id === replacementAssetId),
      false,
      "clearing the source should reclaim the orphaned resource",
    );
  } finally {
    await runtime.dispose();
  }
}

async function testUnresolvableImageDetection(): Promise<void> {
  const document = createDocument();
  const surface = document.surfaces[0]!;
  const group = surface.objects[0]!;
  assert(group.type === "group", "fixture root should be a group");
  const template = group.children.find(
    (object): object is EditorImageObject => object.type === "image",
  )!;
  document.assets.push(
    {
      id: "missing.asset",
      type: "image",
      source: { kind: "url", url: "/missing.png" },
    },
    {
      id: "placeholder.asset",
      type: "image",
      source: { kind: "url", url: "/placeholder.png" },
    },
  );
  group.children.push(
    {
      ...template,
      id: "missing",
      source: { kind: "asset", assetId: "missing.asset" },
    },
    {
      ...template,
      id: "missing-hidden",
      visible: false,
      source: { kind: "asset", assetId: "missing.asset" },
    },
    {
      ...template,
      id: "empty-slot",
      source: null,
      behaviors: [
        {
          type: "pooder.image-slot",
          config: {
            placeholderSource: { kind: "asset", assetId: "placeholder.asset" },
          },
        },
      ],
    } as EditorImageObject,
  );
  surface.objects.push({
    type: "group",
    id: "front.hidden",
    tags: [],
    visible: false,
    locked: false,
    localToParent: [1, 0, 0, 1, 0, 0],
    children: [
      {
        ...template,
        id: "missing-in-hidden-layer",
        source: { kind: "asset", assetId: "missing.asset" },
      },
    ],
  });

  const ensured: string[] = [];
  const service: Pick<ImageResourceService, "read" | "ensure"> = {
    read: (resource) =>
      resource.kind === "url" && resource.url === "/artwork.png"
        ? { ok: true, src: resource.url, width: 200, height: 100 }
        : undefined,
    ensure: async (resource) => {
      ensured.push(resource.kind === "url" ? resource.url : "");
      return { ok: false, reason: "load-failed" };
    },
  };

  assertDeepEqual(
    await collectUnresolvableImageObjectIds(document, service),
    ["missing"],
    "only drawable images with unavailable bytes should be reported",
  );
  // Skipped objects must not even be asked for: a hidden image or an empty slot's
  // placeholder never reaches the exported pixels, so blocking on them would be wrong.
  assertDeepEqual(
    ensured,
    ["/missing.png"],
    "established resources should not be re-fetched and skipped ones not fetched at all",
  );
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
  await testDocumentDepthFirstOrderDefinesRenderGraphOrder();
  await testGroupFlatteningPreservesRenderProjection();
  await testRejectedDocumentsRemainAtomic();
  await testSceneTranslationCommit();
  await testImageUploadReplacesOnlyTheTargetSource();
  await testUnresolvableImageDetection();
  console.log("ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
