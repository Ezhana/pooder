import {
  RENDER_INTENT_SERVICE,
  SCENE_SERVICE,
  Pooder,
  coordinateMatrix,
  type RenderIntentService,
  type SceneService,
} from "@pooder/core";
import {
  registerEditorDocumentService,
  type EditorDocumentService,
} from "../../document-core/src";
import {
  isEditorVisualObject,
  type EditorDocument,
  type EditorImageObject,
  type EditorImagePlacement,
} from "@pooder/document";
import {
  IMAGE_SLOT_CAPABILITY_ID,
  IMAGE_SLOT_UPDATE_PLACEMENT_COMMAND_ID,
  createImageSlotCapability,
  type ImageSlotCapabilityApi,
} from "../src";
import { runExistingCapabilityRegressions } from "./existing-capabilities";

declare const process: {
  exit(code: number): never;
};

const IMAGE_SLOT_ID = "artwork";
const EPSILON = 1e-6;

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

function assertMatrixClose(
  actual: readonly number[] | undefined,
  expected: readonly number[] | undefined,
  message: string,
): void {
  assert(actual, `${message}: actual matrix is unavailable`);
  assert(expected, `${message}: expected matrix is unavailable`);
  assertEqual(actual.length, expected.length, `${message}: matrix size`);
  actual.forEach((value, index) => {
    if (Math.abs(value - expected[index]!) > EPSILON) {
      throw new Error(
        `${message}: matrix[${index}] expected ${expected[index]}, got ${value}`,
      );
    }
  });
}

function createImageSlotDocument(): EditorDocument {
  return {
    version: 7,
    assets: [
      {
        id: "artwork.asset",
        type: "image",
        source: { kind: "url", url: "/artwork.png" },
        intrinsicSize: { width: 240, height: 100 },
      },
      {
        id: "artwork.placeholder.asset",
        type: "image",
        source: { kind: "url", url: "/placeholder.png" },
        intrinsicSize: { width: 120, height: 80 },
      },
    ],
    extensions: {},
    surfaces: [
      {
        id: "front",
        geometry: {
          canvasBounds: { x: 0, y: 0, width: 240, height: 180 },
          productionBounds: { x: 8, y: 12, width: 220, height: 150 },
        },
        layers: [
          {
            id: "front.artwork.layer",
            visible: true,
            locked: false,
            objects: [
              {
                type: "image",
                id: IMAGE_SLOT_ID,
                tags: ["slot:artwork"],
                visible: true,
                locked: false,
                placement: {
                  localBounds: { x: 0, y: 0, width: 120, height: 80 },
                  localToParent: [1.05858, 0.44934, -0.33212, 0.78243, 92, 76],
                  pivot: { x: 60, y: 40 },
                },
                source: {
                  kind: "asset",
                  assetId: "artwork.asset",
                },
                appearance: {
                  fit: "cover",
                  anchorX: 0.5,
                  anchorY: 0.5,
                  zoom: 1,
                  rotation: 0,
                  opacity: 1,
                  clip: "frame",
                },
                behaviors: [
                  {
                    type: "pooder.image-slot",
                    config: {
                      accepts: ["image/*"],
                      placeholderSource: {
                        kind: "asset",
                        assetId: "artwork.placeholder.asset",
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function createHarness(
  imageSlotOptions: Parameters<typeof createImageSlotCapability>[0] = {},
): Promise<{
  runtime: Pooder;
  controller: EditorDocumentService;
  facade: ImageSlotCapabilityApi;
}> {
  const runtime = new Pooder();
  runtime.extensions.register(createImageSlotCapability(imageSlotOptions));
  await runtime.extensions.flushActivation();
  const controller = registerEditorDocumentService(runtime);
  const applied = await controller.apply(createImageSlotDocument());
  assertEqual(applied.ok, true, "image-slot document should apply");
  const facade = runtime.capabilities.get<ImageSlotCapabilityApi>(
    IMAGE_SLOT_CAPABILITY_ID,
  );
  assert(facade, "image-slot facade should be registered");
  facade.syncDocument(applied.document, controller);
  return { runtime, controller, facade };
}

async function testStrictPolicyAcceptsAFrameCoveringCrop(): Promise<void> {
  const { runtime, facade } = await createHarness({
    outsideFramePolicy: "strict",
  });
  try {
    assertEqual(
      (await facade.openSession({ objectId: IMAGE_SLOT_ID })).ok,
      true,
      "strict cover session should open",
    );
    const committed = await facade.commitSession();
    assertEqual(
      committed.type,
      "placed",
      "strict policy should accept an image that fully covers the crop frame",
    );
  } finally {
    await runtime.dispose();
  }
}

async function testPlaceholderVisibilityAndResourceLifecycle(): Promise<void> {
  const { runtime, controller } = await createHarness();
  const getSlotNode = () =>
    runtime.services
      .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
      .getGraph()
      .layers.flatMap((layer) => layer.nodes)
      .find((node) => node.subjectId === IMAGE_SLOT_ID);
  const getSlotProjectionCount = () =>
    runtime.services
      .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
      .getGraph()
      .layers.flatMap((layer) => layer.nodes)
      .filter((node) => node.subjectId === IMAGE_SLOT_ID).length;
  try {
    assertEqual(
      getSlotProjectionCount(),
      1,
      "filled slot should compile one projection",
    );
    assertEqual(
      getSlotNode()?.id,
      IMAGE_SLOT_ID,
      "slot projection id should stay canonical",
    );
    assertEqual(
      getSlotNode()?.visual?.src,
      "/artwork.png",
      "filled slot should use its business asset",
    );
    assertEqual(
      (getSlotNode()?.data.imageGeometry as { fit?: string } | undefined)?.fit,
      "cover",
      "business artwork should use the object appearance",
    );
    assertEqual(
      getSlotNode()?.props.fit,
      "cover",
      "business render props should use cover",
    );
    const cleared = await controller.updateImageResources(
      { ids: [IMAGE_SLOT_ID] },
      { visible: true },
      { expectedCount: 1 },
    );
    assertEqual(cleared.ok, true, "slot resource should clear atomically");
    assertEqual(
      getSlotNode()?.visual?.src,
      "/placeholder.png",
      "empty slot should use its placeholder asset",
    );
    assertEqual(
      getSlotProjectionCount(),
      1,
      "empty slot should keep the same single projection",
    );
    assertEqual(
      (getSlotNode()?.data.imageGeometry as { fit?: string } | undefined)?.fit,
      "stretch",
      "placeholder fallback should override fit without mutating the object",
    );
    assertEqual(
      getSlotNode()?.props.fit,
      "stretch",
      "placeholder render props should expose the visual override",
    );
    const persistedSlot = controller
      .export()
      ?.surfaces[0]?.layers[0]?.objects.find(
        (object) => object.id === IMAGE_SLOT_ID,
      );
    assertEqual(
      persistedSlot && persistedSlot.type === "image"
        ? (persistedSlot as EditorImageObject).appearance.fit
        : undefined,
      "cover",
      "placeholder fallback should not mutate persistent appearance",
    );
    assertEqual(
      getSlotNode()?.props.excludeFromExport,
      true,
      "placeholder fallback should not export",
    );
    assertEqual(
      getSlotNode()?.visible,
      true,
      "placeholder fallback should remain visible in the editor",
    );
    assertEqual(
      controller.export()?.assets.some((asset) => asset.id === "artwork.asset"),
      false,
      "clearing the slot should reclaim its orphaned asset",
    );
    assertEqual(
      controller
        .export()
        ?.assets.some((asset) => asset.id === "artwork.placeholder.asset"),
      true,
      "clearing the slot should retain its placeholder asset",
    );
    const filled = await controller.updateImageResources(
      { tags: ["slot:artwork"] },
      {
        source: { kind: "url", url: "/replacement.png" },
        intrinsicSize: { width: 300, height: 200 },
        visible: true,
      },
      { expectedCount: 1 },
    );
    assertEqual(filled.ok, true, "slot resource should replace atomically");
    assertEqual(
      getSlotNode()?.visual?.src,
      "/replacement.png",
      "refilled slot should replace the fallback in the same projection",
    );
    assertEqual(
      (getSlotNode()?.data.imageGeometry as { fit?: string } | undefined)?.fit,
      "cover",
      "replacement artwork should restore the object appearance",
    );
    const refilledSlot = controller
      .export()
      ?.surfaces[0]?.layers[0]?.objects.find(
        (object) => object.id === IMAGE_SLOT_ID,
      );
    assert(
      refilledSlot?.type === "image" && refilledSlot.source?.kind === "asset",
      "upload should replace the empty image source with an asset source",
    );
    assertEqual(
      JSON.stringify(refilledSlot.behaviors),
      JSON.stringify(
        createImageSlotDocument().surfaces[0]!.layers[0]!.objects[0]!.behaviors,
      ),
      "upload should preserve the image-slot behavior and placeholder source",
    );
  } finally {
    await runtime.dispose();
  }
}

async function testSharedPlaceholderAssetLifecycle(): Promise<void> {
  const runtime = new Pooder();
  runtime.extensions.register(createImageSlotCapability());
  await runtime.extensions.flushActivation();
  const controller = registerEditorDocumentService(runtime);
  try {
    const document = createImageSlotDocument();
    const layer = document.surfaces[0]!.layers[0]!;
    const firstSlot = layer.objects[0]!;
    if (firstSlot.type === "image") firstSlot.source = null;
    document.assets = document.assets.filter(
      (asset) => asset.id !== "artwork.asset",
    );
    const secondSlot = JSON.parse(
      JSON.stringify(firstSlot),
    ) as typeof firstSlot;
    secondSlot.id = "artwork.secondary";
    layer.objects.push(secondSlot);

    assertEqual(
      (await controller.apply(document)).ok,
      true,
      "multiple slots should share one placeholder asset",
    );
    assertEqual(
      controller
        .export()
        ?.assets.filter((asset) => asset.id === "artwork.placeholder.asset")
        .length,
      1,
      "shared placeholder should exist exactly once",
    );
    assertEqual(
      (await controller.removeObject(IMAGE_SLOT_ID)).ok,
      true,
      "first shared slot should be removable",
    );
    assertEqual(
      controller
        .export()
        ?.assets.some((asset) => asset.id === "artwork.placeholder.asset"),
      true,
      "placeholder should survive while another slot references it",
    );
    assertEqual(
      (await controller.removeObject("artwork.secondary")).ok,
      true,
      "last shared slot should be removable",
    );
    assertEqual(
      controller
        .export()
        ?.assets.some((asset) => asset.id === "artwork.placeholder.asset"),
      false,
      "placeholder should be reclaimed after its final slot is removed",
    );
  } finally {
    await runtime.dispose();
  }
}

async function testRemovedImageSlotContractsAreRejected(): Promise<void> {
  const apply = async (document: EditorDocument) => {
    const runtime = new Pooder();
    runtime.extensions.register(createImageSlotCapability());
    await runtime.extensions.flushActivation();
    try {
      return await registerEditorDocumentService(runtime).apply(document);
    } finally {
      await runtime.dispose();
    }
  };
  const emptyPresentation = createImageSlotDocument();
  const slot = emptyPresentation.surfaces[0]!.layers[0]!.objects[0]!;
  const behavior = slot.behaviors?.find(
    (candidate) => candidate.type === "pooder.image-slot",
  )!;
  behavior.config = {
    ...(behavior.config as Record<string, unknown>),
    emptyPresentation: { assetId: "legacy", fit: "stretch" },
  };
  assertEqual(
    (await apply(emptyPresentation)).ok,
    false,
    "emptyPresentation should be rejected",
  );

  const configurableVisual = createImageSlotDocument();
  configurableVisual.surfaces[0]!.layers[0]!.objects[0]!.behaviors!.push({
    type: "pooder.configurable-visual",
    config: { key: "legacy" },
  });
  assertEqual(
    (await apply(configurableVisual)).ok,
    false,
    "configurable visual behavior should be rejected",
  );

  const missingPlaceholder = createImageSlotDocument();
  missingPlaceholder.assets = missingPlaceholder.assets.filter(
    (asset) => asset.id !== "artwork.placeholder.asset",
  );
  assertEqual(
    (await apply(missingPlaceholder)).ok,
    false,
    "image slot with a missing placeholder asset should be rejected",
  );

  const missingPlaceholderSource = createImageSlotDocument();
  const missingIdBehavior =
    missingPlaceholderSource.surfaces[0]!.layers[0]!.objects[0]!.behaviors![0]!;
  missingIdBehavior.config = { accepts: ["image/*"] };
  assertEqual(
    (await apply(missingPlaceholderSource)).ok,
    false,
    "image slot without placeholderSource should be rejected",
  );

  const nonImageSlot = createImageSlotDocument();
  const nonImageObject = nonImageSlot.surfaces[0]!.layers[0]!.objects[0]!;
  Object.assign(nonImageObject, {
    type: "shape",
    source: { kind: "inline", content: { shape: "rect", params: {} } },
    appearance: { fill: "#ffffff" },
  });
  assertEqual(
    (await apply(nonImageSlot)).ok,
    false,
    "image-slot behavior on a non-image object should be rejected",
  );
}

function getWorkingMatrix(runtime: Pooder): number[] {
  const scene = runtime.services
    .getOrThrow<SceneService>(SCENE_SERVICE)
    .getSceneHandle(`image-slot:${IMAGE_SLOT_ID}:scene`);
  const working = scene
    ?.selectElements()
    .find((element) => element.id === `image-slot:${IMAGE_SLOT_ID}:working`);
  assert(working?.placement, "image-slot working projection should exist");
  return [...working.placement.localToScene.values];
}

function getCommittedMatrix(runtime: Pooder): number[] {
  const node = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph()
    .layers.flatMap((layer) => layer.nodes)
    .find((candidate) => candidate.id === IMAGE_SLOT_ID);
  assert(node, "committed image render node should exist");
  return [...node.placement.localToScene.values];
}

async function projectCanvasMatrix(
  runtime: Pooder,
  facade: ImageSlotCapabilityApi,
  placement: EditorImagePlacement,
): Promise<number[]> {
  const original = facade.getViewState().draft?.placement;
  assert(original, "active image-slot draft should expose placement");
  assertEqual(
    facade.updatePlacement(placement).ok,
    true,
    "expected placement should render",
  );
  const expected = getWorkingMatrix(runtime);
  assertEqual(
    facade.updatePlacement({ ...original, fit: placement.fit }).ok,
    true,
    "fit mode should remain active before canvas projection",
  );
  const result = await runtime.commands.execute<{
    ok: boolean;
    reason?: string;
  }>(IMAGE_SLOT_UPDATE_PLACEMENT_COMMAND_ID, {
    objectId: IMAGE_SLOT_ID,
    phase: "commit",
    sceneMatrix: coordinateMatrix("object-local", "scene", [
      expected[0]!,
      expected[1]!,
      expected[2]!,
      expected[3]!,
      expected[4]!,
      expected[5]!,
    ]),
  });
  assertEqual(
    result.ok,
    true,
    `canvas projection should resolve (${result.reason ?? "ok"})`,
  );
  assertMatrixClose(
    getWorkingMatrix(runtime),
    expected,
    `${placement.fit} working canvas projection`,
  );
  return expected;
}

async function testImageSlotCommitAndReopenMatrices(): Promise<void> {
  const { runtime, facade } = await createHarness();
  try {
    for (const [index, fit] of ["cover", "contain", "stretch"].entries()) {
      assertEqual(
        (await facade.openSession({ objectId: IMAGE_SLOT_ID })).ok,
        true,
        `${fit} session should open`,
      );
      const expected = await projectCanvasMatrix(runtime, facade, {
        fit: fit as EditorImagePlacement["fit"],
        anchorX: 0.25 + index * 0.15,
        anchorY: 0.7 - index * 0.1,
        zoom: 1.2 + index * 0.1,
        rotation: 17 + index * 9,
        opacity: 0.85,
        clip: "frame",
      });
      const committed = await facade.commitSession();
      assertEqual(committed.type, "placed", `${fit} session should commit`);
      const committedMatrix = getCommittedMatrix(runtime);
      assertMatrixClose(
        committedMatrix,
        expected,
        `${fit} working/committed bitmap matrix`,
      );
      console.log(
        `MATRIX ${fit} working=${JSON.stringify(expected)} committed=${JSON.stringify(committedMatrix)}`,
      );

      assertEqual(
        (await facade.openSession({ objectId: IMAGE_SLOT_ID })).ok,
        true,
        `${fit} committed session should reopen`,
      );
      assertMatrixClose(
        getWorkingMatrix(runtime),
        getCommittedMatrix(runtime),
        `${fit} reopened bitmap matrix`,
      );
      assertEqual(
        (await facade.rollbackSession()).ok,
        true,
        `${fit} reopened session should rollback`,
      );
    }
  } finally {
    await runtime.dispose();
  }
}

async function testImageSlotRollbackDoesNotDrift(): Promise<void> {
  const { runtime, facade } = await createHarness();
  try {
    const committedBefore = getCommittedMatrix(runtime);
    assertEqual(
      (await facade.openSession({ objectId: IMAGE_SLOT_ID })).ok,
      true,
      "rollback session should open",
    );
    facade.updatePlacement({
      anchorX: 0.1,
      anchorY: 0.9,
      zoom: 1.75,
      rotation: 41,
    });
    assert(
      getWorkingMatrix(runtime).some(
        (value, index) => Math.abs(value - committedBefore[index]!) > EPSILON,
      ),
      "rollback scenario should first move the working bitmap",
    );
    assertEqual(
      (await facade.rollbackSession()).ok,
      true,
      "active session should rollback",
    );
    assertMatrixClose(
      getCommittedMatrix(runtime),
      committedBefore,
      "rollback committed bitmap matrix",
    );
    assertEqual(
      (await facade.openSession({ objectId: IMAGE_SLOT_ID })).ok,
      true,
      "rolled-back session should reopen",
    );
    assertMatrixClose(
      getWorkingMatrix(runtime),
      committedBefore,
      "rollback reopen bitmap matrix",
    );
    console.log(
      `MATRIX rollback/reopen committed=${JSON.stringify(committedBefore)} reopened=${JSON.stringify(getWorkingMatrix(runtime))}`,
    );
    await facade.rollbackSession();
  } finally {
    await runtime.dispose();
  }
}

async function testImageSlotRejectsMissingContainerGeometry(): Promise<void> {
  const runtime = new Pooder();
  runtime.extensions.register(createImageSlotCapability());
  await runtime.extensions.flushActivation();
  try {
    const facade = runtime.capabilities.get<ImageSlotCapabilityApi>(
      IMAGE_SLOT_CAPABILITY_ID,
    );
    assert(facade, "image-slot facade should be registered");
    facade.syncDocument(createImageSlotDocument(), {
      mutate: async () => ({
        ok: false,
        reason: "not-used",
        diagnostics: [],
      }),
      updateObject: async () => ({
        ok: false,
        reason: "not-used",
        diagnostics: [],
      }),
    });
    const result = await facade.openSession({ objectId: IMAGE_SLOT_ID });
    assertEqual(result.ok, false, "session should reject missing geometry");
    assertEqual(
      result.ok ? "" : result.reason,
      "geometry-unavailable",
      "session should report explicit container geometry failure",
    );
  } finally {
    await runtime.dispose();
  }
}

async function main(): Promise<void> {
  await runExistingCapabilityRegressions();
  await testImageSlotRejectsMissingContainerGeometry();
  await testStrictPolicyAcceptsAFrameCoveringCrop();
  await testPlaceholderVisibilityAndResourceLifecycle();
  await testSharedPlaceholderAssetLifecycle();
  await testRemovedImageSlotContractsAreRejected();
  await testImageSlotCommitAndReopenMatrices();
  await testImageSlotRollbackDoesNotDrift();
  console.log("ok");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
