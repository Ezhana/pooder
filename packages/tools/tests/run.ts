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
import type { EditorDocument, EditorImagePlacement } from "@pooder/document";
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
            id: "artwork",
            role: "content",
            visible: true,
            locked: false,
            objects: [
              {
                id: IMAGE_SLOT_ID,
                visible: true,
                locked: false,
                placement: {
                  localBounds: { x: 0, y: 0, width: 120, height: 80 },
                  localToParent: [1.05858, 0.44934, -0.33212, 0.78243, 92, 76],
                  pivot: { x: 60, y: 40 },
                },
                source: {
                  kind: "image",
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
                    config: { accepts: ["image/*"] },
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

async function createHarness(): Promise<{
  runtime: Pooder;
  controller: EditorDocumentService;
  facade: ImageSlotCapabilityApi;
}> {
  const runtime = new Pooder();
  runtime.extensions.register(createImageSlotCapability());
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
