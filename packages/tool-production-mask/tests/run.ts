import type { EditorDocument } from "@pooder/document";

import {
  POODER_PRODUCTION_MASK_CAPABILITY_ID,
  POODER_PRODUCTION_MASK_DOCUMENT_CONTRIBUTION,
  createProductionMaskCapability,
  type ProductionMaskCapabilityApi,
  type ProductionMaskDocumentState,
} from "../src";

declare const process: { exit(code: number): never };

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const alpha = {
  selection: "transparent" as const,
  mapping: "threshold" as const,
  threshold: 0.2,
  softness: 0.05,
  outputOpacity: 1,
};

const createState = (): ProductionMaskDocumentState => ({
  masks: {
    "front.reverse": {
      surfaceId: "front",
      process: "reverse",
      production: {
        enabled: true,
        referenceObjectId: "front.image",
        source: { kind: "asset", assetId: "reverse-mask" },
        alpha,
      },
      presentation: {
        originalVisible: true,
        originalMaskVisible: false,
        currentMaskVisible: true,
      },
    },
  },
});

const createDocument = (): EditorDocument => ({
  version: 7,
  assets: [
    {
      id: "artwork",
      type: "image",
      source: { kind: "url", url: "https://example.com/artwork.png" },
    },
    {
      id: "reverse-mask",
      type: "image",
      source: { kind: "url", url: "https://example.com/reverse.png" },
    },
  ],
  extensions: {
    [POODER_PRODUCTION_MASK_CAPABILITY_ID]: createState() as unknown as never,
  },
  surfaces: [
    {
      id: "front",
      geometry: {
        canvasBounds: { x: 0, y: 0, width: 100, height: 100 },
        productionBounds: { x: 0, y: 0, width: 100, height: 100 },
      },
      layers: [
        {
          id: "artwork",
          role: "content",
          visible: true,
          locked: false,
          objects: [
            {
              id: "front.image",
              tags: ["export:design"],
              visible: true,
              locked: false,
              placement: {
                localBounds: { x: 0, y: 0, width: 100, height: 100 },
                localToParent: [1, 0, 0, 1, 0, 0],
                pivot: { x: 0, y: 0 },
              },
              source: { kind: "image", assetId: "artwork" },
              appearance: {
                fit: "cover",
                anchorX: 0.5,
                anchorY: 0.5,
                zoom: 1,
                rotation: 0,
                opacity: 1,
                clip: "frame",
              },
            },
          ],
        },
      ],
    },
  ],
});

async function main() {
  const contribution = POODER_PRODUCTION_MASK_DOCUMENT_CONTRIBUTION;
  assert(
    contribution.stateSchema?.validate(createState(), {
      extensionId: POODER_PRODUCTION_MASK_CAPABILITY_ID,
      path: "extensions",
    }).length === 0,
    "valid production-mask extension state should pass schema validation",
  );
  assert(
    contribution.stateSchema
      ?.validate(
        {
          ...createState(),
          masks: {
            ...createState().masks,
            "front.reverse": {
              ...createState().masks["front.reverse"],
              presentation: { currentMaskVisible: "yes" },
            },
          },
        },
        {
          extensionId: POODER_PRODUCTION_MASK_CAPABILITY_ID,
          path: "extensions",
        },
      )
      .some((issue) => issue.path?.endsWith("presentation.originalVisible")),
    "invalid presentation state should be rejected",
  );

  const document = createDocument();
  assert(
    contribution.validateReferences?.(createState(), document).length === 0,
    "valid mask asset and object references should pass",
  );
  const missingReferences = createState();
  missingReferences.masks["front.reverse"].production.referenceObjectId = "missing-object";
  missingReferences.masks["front.reverse"].production.source = {
    kind: "asset",
    assetId: "missing-asset",
  };
  const referenceDiagnostics = contribution.validateReferences?.(
    missingReferences,
    document,
  );
  assert(
    referenceDiagnostics?.some((item) => item.code === "production-mask-object-missing") &&
      referenceDiagnostics.some((item) => item.code === "production-mask-asset-missing"),
    "missing mask object and asset references should be rejected",
  );

  const extension = createProductionMaskCapability();
  const contributions = extension.contribute();
  assert(
    (contributions.documentExtensions?.[0] as { id?: string } | undefined)?.id ===
      POODER_PRODUCTION_MASK_CAPABILITY_ID,
    "production masks should register their document contribution",
  );
  assert(
    contributions.renderIntentCompilers?.length === undefined,
    "production-mask state should not be carried by a render-intent compiler",
  );

  const facade = contributions.capabilities?.[0]?.facade as ProductionMaskCapabilityApi;
  assert(facade, "production-mask capability facade should be contributed");
  let persisted = document;
  facade.syncDocument(document, {
    async mutate(mutator) {
      persisted = JSON.parse(JSON.stringify(persisted)) as EditorDocument;
      mutator(persisted);
      return { ok: true, document: persisted };
    },
  });
  const productionBefore = JSON.stringify(createState().masks["front.reverse"].production);
  const updated = await facade.updatePreview({ currentMaskVisible: false });
  const persistedState = persisted.extensions[
    POODER_PRODUCTION_MASK_CAPABILITY_ID
  ] as unknown as ProductionMaskDocumentState;
  assert(updated.ok, "preview preference should persist through the document controller");
  assert(
    persistedState.masks["front.reverse"].presentation.currentMaskVisible === false,
    "preview preference should be written immediately",
  );
  assert(
    JSON.stringify(persistedState.masks["front.reverse"].production) === productionBefore,
    "preview persistence must not publish or rewrite session production state",
  );
  console.log("ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
