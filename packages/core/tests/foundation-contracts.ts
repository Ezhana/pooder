import {
  GEOMETRY_SOURCE_SERVICE,
  INTERACTION_SERVICE,
  Pooder,
  coordinateMatrix,
  createStaticGeometrySource,
  type GeometrySourceService,
  type InteractionService,
} from "../src";

declare const process: {
  exit(code: number): never;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message} (expected ${String(expected)}, got ${String(actual)})`,
    );
  }
}

async function testGeometryRepresentationsRemainPurposeScoped() {
  const runtime = new Pooder();
  try {
    const geometry = runtime.services.getOrThrow<GeometrySourceService>(
      GEOMETRY_SOURCE_SERVICE,
    );
    geometry.registerSource(
      createStaticGeometrySource({
        sourceId: "foundation",
        geometries: [
          {
            kind: "rect",
            ref: {
              sourceId: "foundation",
              geometryId: "boundary",
              purpose: "preview",
            },
            space: "scene",
            bounds: { left: 0, top: 0, width: 80, height: 60 },
            rect: { left: 0, top: 0, width: 80, height: 60 },
            localToScene: coordinateMatrix(
              "scene",
              "scene",
              [1, 0, 0, 1, 0, 0],
            ),
          },
          {
            kind: "rect",
            ref: {
              sourceId: "foundation",
              geometryId: "boundary",
              purpose: "export",
            },
            space: "scene",
            bounds: { left: -5, top: -5, width: 90, height: 70 },
            rect: { left: -5, top: -5, width: 90, height: 70 },
            localToScene: coordinateMatrix(
              "scene",
              "scene",
              [1, 0, 0, 1, 0, 0],
            ),
          },
        ],
      }),
    );

    assertEqual(
      geometry.getBounds({
        sourceId: "foundation",
        geometryId: "boundary",
        purpose: "preview",
      }).value?.width,
      80,
      "preview GeometryRef should resolve preview geometry",
    );
    assertEqual(
      geometry.getBounds({
        sourceId: "foundation",
        geometryId: "boundary",
        purpose: "export",
      }).value?.width,
      90,
      "export GeometryRef should resolve export geometry",
    );
  } finally {
    await runtime.dispose();
  }
}

async function testMultiObjectInteractionPreviewsAndCommitsAtomically() {
  const runtime = new Pooder();
  try {
    const interaction =
      runtime.services.getOrThrow<InteractionService>(INTERACTION_SERVICE);
    const input = {
      spec: { manipulation: { move: { enabled: true } } },
      runtimeContext: {},
      coordinateSpace: "scene" as const,
      transform: {
        frame: { left: 15, top: 27, width: 20, height: 10 },
      },
      sourceTransform: {
        frame: { left: 10, top: 20, width: 20, height: 10 },
      },
      sourceSceneMatrix: coordinateMatrix(
        "object-local",
        "scene",
        [1, 0, 0, 1, 10, 20],
      ),
      sceneMatrix: coordinateMatrix(
        "object-local",
        "scene",
        [1, 0, 0, 1, 15, 27],
      ),
      subject: {
        subjectId: "multi-object-selection",
        projectionTargets: ["object-a", "object-b"].map((projectionId) => ({
          projectionId,
          geometryRef: {
            sourceId: "render-intent",
            geometryId: projectionId,
            purpose: "preview" as const,
          },
        })),
      },
    };

    const preview = interaction.previewManipulation("move", input);
    assertEqual(preview.phase, "preview", "preview should remain non-terminal");
    assertEqual(
      preview.projectionPatches.length,
      2,
      "preview should update every visual projection",
    );
    assertEqual(
      preview.documentPatch,
      undefined,
      "preview must not produce a document commit",
    );

    let commitEvents = 0;
    interaction.onDidCommitManipulation(() => {
      commitEvents += 1;
    });
    const commit = interaction.commitManipulation("move", input);
    assertEqual(commit.phase, "commit", "commit should be terminal");
    assertEqual(
      commit.projectionPatches.length,
      2,
      "commit should update every visual projection",
    );
    assertEqual(commitEvents, 1, "one logical operation should commit once");
    assert(
      commit.documentPatch?.type === "translate",
      "commit should produce one canonical document translation",
    );
  } finally {
    await runtime.dispose();
  }
}

async function main() {
  await testGeometryRepresentationsRemainPurposeScoped();
  console.log(
    "PASS keeps GeometryRef preview and export representations separate",
  );
  await testMultiObjectInteractionPreviewsAndCommitsAtomically();
  console.log("PASS previews and commits multi-object interactions atomically");
  console.log("All core foundation contracts passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
