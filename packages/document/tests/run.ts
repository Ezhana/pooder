import {
  EffectSchemaRegistry,
  DocumentExtensionRegistry,
  ObjectSchemaRegistry,
  cloneDocument,
  collectDocumentAssetReferences,
  createAssetReferenceBinding,
  collectDocumentCapabilityRequirements,
  collectDocumentExtensionRequirements,
  findDocumentObject,
  getDocumentObjects,
  isAssetSource,
  parseDocument,
  reclaimOrphanedDocumentAssets,
  replaceDocumentAssetReferences,
  resolveDocumentAsset,
  selectDocumentObjects,
  selectOneDocumentObject,
  surfaceContentRect,
  validateDocument,
  validateDocumentEffectSchemas,
  validateDocumentObjectSchemas,
  visitDocumentObjects,
  type PooderDocument,
} from "../src";
import { REPRESENTATIVE_V8_DOCUMENT_INPUT } from "./fixtures/representative-v8-document";

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

function representativeDocument(): PooderDocument {
  return parseDocument(REPRESENTATIVE_V8_DOCUMENT_INPUT);
}

function testStrictRoundTrip(): void {
  const document = representativeDocument();
  const restored = parseDocument(JSON.parse(JSON.stringify(document)));
  assertDeepEqual(restored, document, "strict v8 should round-trip exactly");
  assertDeepEqual(
    document.surfaces.map((surface) => surface.id),
    ["front", "back"],
    "surface order should be preserved",
  );
  assertDeepEqual(
    document.surfaces[0]?.objects.map((object) => object.id),
    ["front.content", "front.production"],
    "root group order should be preserved from bottom to top",
  );
  assertEqual(
    findDocumentObject(document, "front.feature.hole")?.id,
    "front.feature.hole",
    "nested object lookup should work",
  );
  assertDeepEqual(
    collectDocumentExtensionRequirements(document),
    [
      "pooder.kit.image-slot",
      "pooder.production-mask",
      "pooder.kit.edge-detection",
    ],
    "required extensions are document-scoped",
  );
}

function testUnknownAndLegacyFieldsAreRejected(): void {
  const v7 = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  v7.version = 7;
  assertEqual(
    validateDocument(v7)[0]?.code,
    "document-version-invalid",
    "v7 documents should be rejected without a runtime migrator",
  );

  for (const [field, value] of [
    ["config", {}],
    ["views", []],
    ["metadata", {}],
    ["extensions", {}],
  ] as const) {
    const input = JSON.parse(
      JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
    ) as Record<string, unknown>;
    input[field] = value;
    const diagnostic = validateDocument(input)[0];
    assertEqual(
      diagnostic?.code,
      "unknown-field",
      `${field} should be rejected`,
    );
    assertEqual(
      diagnostic?.path,
      `document.${field}`,
      `${field} path should be stable`,
    );
  }

  const surfaceExtension = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const firstSurface = (
    surfaceExtension.surfaces as Array<Record<string, unknown>>
  )[0]!;
  firstSurface.extension = { required: ["pooder.kit.image-slot"] };
  assertEqual(
    validateDocument(surfaceExtension)[0]?.code,
    "unknown-field",
    "surface.extension should be rejected",
  );
  assertEqual(
    validateDocument(surfaceExtension)[0]?.path,
    "surfaces[0].extension",
    "surface.extension path should be stable",
  );

  const input = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const surface = (input.surfaces as Array<Record<string, unknown>>)[0]!;
  const group = (surface.objects as Array<Record<string, unknown>>)[0]!;
  const object = (group.children as Array<Record<string, unknown>>)[0]!;
  object.frame = { x: 0, y: 0, width: 1, height: 1 };
  assertEqual(
    validateDocument(input)[0]?.path,
    "surfaces[0].objects[0].children[0].frame",
    "legacy object frame should be rejected at its exact path",
  );

  const groupRole = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const legacyGroup = (
    (groupRole.surfaces as Array<Record<string, unknown>>)[0]!.objects as Array<
      Record<string, unknown>
    >
  )[0]!;
  legacyGroup.role = "content";
  assertEqual(
    validateDocument(groupRole)[0]?.path,
    "surfaces[0].objects[0].role",
    "legacy group role should be rejected at its exact path",
  );

  const guideRole = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const guideGroups = (guideRole.surfaces as Array<Record<string, unknown>>)[0]!
    .objects as Array<Record<string, unknown>>;
  const guide = (
    (
      guideGroups[guideGroups.length - 1]!.children as Array<
        Record<string, unknown>
      >
    )[0]!.traits as Array<Record<string, unknown>>
  )[0]!;
  guide.role = "cut";
  assertEqual(
    validateDocument(guideRole)[0]?.code,
    "unknown-field",
    "guide role should be rejected",
  );

  const exportScope = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const exportObject = (
    (
      (exportScope.surfaces as Array<Record<string, unknown>>)[0]!
        .objects as Array<Record<string, unknown>>
    )[0]!.children as Array<Record<string, unknown>>
  )[0]!;
  exportObject.traits = [{ type: "core.export", scopes: ["design"] }];
  assertEqual(
    validateDocument(exportScope)[0]?.code,
    "unknown-field",
    "core.export scopes should be rejected",
  );

  const unnamespacedTag = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const taggedObject = (
    (
      (unnamespacedTag.surfaces as Array<Record<string, unknown>>)[0]!
        .objects as Array<Record<string, unknown>>
    )[0]!.children as Array<Record<string, unknown>>
  )[0]!;
  taggedObject.tags = ["cut"];
  assertEqual(
    validateDocument(unnamespacedTag)[0]?.code,
    "object-tag-namespace-required",
    "object tags should require namespaces",
  );

  const legacyObjectSource = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const legacyObject = (
    (
      (legacyObjectSource.surfaces as Array<Record<string, unknown>>)[0]!
        .objects as Array<Record<string, unknown>>
    )[0]!.children as Array<Record<string, unknown>>
  )[0]!;
  delete legacyObject.type;
  legacyObject.source = { kind: "image", assetId: "front-artwork" };
  assertEqual(
    validateDocument(legacyObjectSource)[0]?.code,
    "object-type-invalid",
    "legacy image-kind sources should be rejected without compatibility",
  );
}

function testInvalidNumbersAndUnionsAreRejected(): void {
  const nonFinite = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const bounds = (
    (nonFinite.surfaces as Array<Record<string, unknown>>)[0]!
      .bounds as Record<string, unknown>
  );
  bounds.width = Number.POSITIVE_INFINITY;
  assertEqual(
    validateDocument(nonFinite)[0]?.code,
    "finite-number-required",
    "non-finite geometry should be rejected",
  );

  const overflowingInsets = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  (
    (overflowingInsets.surfaces as Array<Record<string, unknown>>)[0] as Record<
      string,
      unknown
    >
  ).insets = { top: 50, right: 50, bottom: 50, left: 50 };
  assertEqual(
    validateDocument(overflowingInsets)[0]?.code,
    "surface-content-invalid",
    "insets that collapse content should be rejected",
  );

  const parsed = parseDocument(REPRESENTATIVE_V8_DOCUMENT_INPUT);
  assertDeepEqual(
    surfaceContentRect(parsed.surfaces[0]!),
    { x: 3, y: 3, width: 94, height: 114 },
    "content rect should apply insets to bounds",
  );

  const zeroInsetsInput = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  (
    (zeroInsetsInput.surfaces as Array<Record<string, unknown>>)[0] as Record<
      string,
      unknown
    >
  ).insets = { top: 0, right: 0, bottom: 0, left: 0 };
  assertEqual(
    parseDocument(zeroInsetsInput).surfaces[0]?.insets,
    undefined,
    "all-zero insets should be omitted",
  );

  const invalidUnion = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const object = (
    (
      (invalidUnion.surfaces as Array<Record<string, unknown>>)[0]!
        .objects as Array<Record<string, unknown>>
    )[0]!.children as Array<Record<string, unknown>>
  )[0]!;
  object.children = [];
  assertEqual(
    validateDocument(invalidUnion)[0]?.code,
    "unknown-field",
    "visual objects should reject children",
  );

  for (const [field, value] of [
    ["opacity", 0.5],
    ["effects", []],
    ["localFrame", { x: 0, y: 0, width: 1, height: 1 }],
    ["source", null],
    ["paint", {}],
    [
      "contentFit",
      { fit: "cover", anchorX: 0.5, anchorY: 0.5, zoom: 1, rotation: 0 },
    ],
  ] as const) {
    const invalidGroup = JSON.parse(
      JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
    ) as Record<string, unknown>;
    const group = (
      (invalidGroup.surfaces as Array<Record<string, unknown>>)[0]!
        .objects as Array<Record<string, unknown>>
    )[0]!;
    group[field] = value;
    const diagnostic = validateDocument(invalidGroup)[0];
    assertEqual(
      diagnostic?.code,
      "unknown-field",
      `group ${field} should be rejected`,
    );
    assertEqual(
      diagnostic?.path,
      `surfaces[0].objects[0].${field}`,
      `group ${field} rejection path should be stable`,
    );
  }

  const leafClip = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const clippedLeaf = (
    (
      (leafClip.surfaces as Array<Record<string, unknown>>)[0]!
        .objects as Array<Record<string, unknown>>
    )[0]!.children as Array<Record<string, unknown>>
  )[0]!;
  clippedLeaf.clip = "frame";
  assertEqual(
    validateDocument(leafClip)[0]?.code,
    "unknown-field",
    "leaf clip outside contentFit should be rejected",
  );

  for (const [path, value, expectedCode] of [
    ["opacity", -0.01, "unit-interval-required"],
    ["opacity", 1.01, "unit-interval-required"],
    ["contentFit.anchorX", -0.01, "unit-interval-required"],
    ["contentFit.anchorY", 1.01, "unit-interval-required"],
    ["contentFit.zoom", 0, "positive-number-required"],
    ["contentFit.clip", "outside", "image-clip-invalid"],
  ] as const) {
    const invalidNumber = JSON.parse(
      JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
    ) as Record<string, unknown>;
    const image = (
      (
        (invalidNumber.surfaces as Array<Record<string, unknown>>)[0]!
          .objects as Array<Record<string, unknown>>
      )[0]!.children as Array<Record<string, unknown>>
    )[0]!;
    if (path === "opacity") image.opacity = value;
    else {
      const contentFit = image.contentFit as Record<string, unknown>;
      contentFit[path.slice("contentFit.".length)] = value;
    }
    assertEqual(
      validateDocument(invalidNumber)[0]?.code,
      expectedCode,
      `${path}=${value} should be rejected`,
    );
  }
}

function testGlobalIdsAndReferencesAreStrict(): void {
  const duplicate = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const surfaces = duplicate.surfaces as Array<Record<string, unknown>>;
  surfaces[1]!.id = surfaces[0]!.id;
  assert(
    validateDocument(duplicate).some(
      (item) => item.code === "document-id-duplicate",
    ),
    "all document ids should be globally unique",
  );

  const missing = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V8_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const missingGroups = (missing.surfaces as Array<Record<string, unknown>>)[0]!
    .objects as Array<Record<string, unknown>>;
  const cutline = (
    (
      missingGroups[missingGroups.length - 1]!.children as Array<
        Record<string, unknown>
      >
    )[0]!.effects as Array<Record<string, unknown>>
  )[0]!;
  cutline.operandObjectId = "missing";
  assert(
    validateDocument(missing).some(
      (item) => item.code === "object-effect-target-missing",
    ),
    "missing effect references should be rejected",
  );
}

function testExtensionSchemasAreStrict(): void {
  const document = representativeDocument();
  const objectRegistry = new ObjectSchemaRegistry()
    .registerTrait({ traitType: "popecho.feature-operand" })
    .registerBehavior({
      behaviorType: "pooder.image-slot",
      capabilityId: "pooder.kit.image-slot",
    });
  const missing = validateDocumentObjectSchemas(
    document,
    new ObjectSchemaRegistry(),
  );
  assert(
    missing.some((item) => item.code === "object-trait-unregistered") &&
      missing.some((item) => item.code === "object-behavior-unregistered"),
    "unregistered extension traits and behaviors should be rejected",
  );
  assertDeepEqual(
    validateDocumentObjectSchemas(document, objectRegistry),
    [],
    "registered object schemas should validate",
  );

  const effectDocument = cloneDocument(document);
  const target = findDocumentObject(effectDocument, "back.artwork");
  assert(target?.type === "shape", "back artwork should be a shape");
  target.effects = [{ type: "test.effect", payload: { count: 1 } }];
  const effectRegistry = new EffectSchemaRegistry([
    {
      effectType: "test.effect",
      capabilityId: "test.capability",
      validate: (payload) =>
        (payload as { count?: unknown }).count === 1
          ? []
          : [{ code: "count-invalid", message: "count must equal 1" }],
    },
  ]);
  assertDeepEqual(
    validateDocumentEffectSchemas(effectDocument, effectRegistry),
    [],
    "registered effect schemas should validate",
  );
  const requirements = collectDocumentCapabilityRequirements(
    effectDocument,
    {
      availableCapabilityIds: ["test.capability"],
      resolveEffectCapabilityId: (effect) =>
        effect.type === "test.effect" ? "test.capability" : undefined,
    },
  );
  assertEqual(
    requirements.requirements.length,
    1,
    "effect capability should be collected",
  );
  assertDeepEqual(
    requirements.diagnostics,
    [],
    "available capability should satisfy effect",
  );
}

function testCloneAndVisitors(): void {
  const document = representativeDocument();
  const clone = cloneDocument(document);
  assertDeepEqual(
    clone,
    document,
    "clone should preserve strict document data",
  );
  assert(clone !== document, "clone should detach the root");
  const visited: string[] = [];
  visitDocumentObjects(document, ({ path }) => visited.push(path));
  assertEqual(
    visited.length,
    getDocumentObjects(document).length,
    "visitor and object accessor should agree",
  );
}

function testObjectSelectors(): void {
  const document = representativeDocument();
  assertDeepEqual(
    selectDocumentObjects(document, { tags: ["slot:front"] }).map(
      (object) => object.id,
    ),
    ["front.image-slot"],
    "tag selector should match the image slot",
  );
  assertEqual(
    selectOneDocumentObject(document, { ids: ["front.dieline"] })?.id,
    "front.dieline",
    "id selector should resolve one exact object",
  );
  assertEqual(
    selectOneDocumentObject(document, { tags: ["slot:front"] })?.id,
    "front.image-slot",
    "single-object selector should resolve the image slot",
  );
  assertDeepEqual(
    selectDocumentObjects(document, {
      surfaceIds: ["back"],
      tags: ["slot:front"],
    }).map((object) => object.id),
    [],
    "surfaceIds should not match tags on another surface",
  );
  assertDeepEqual(
    selectDocumentObjects(document, { surfaceIds: ["back"] }).map(
      (object) => object.id,
    ),
    ["back.content", "back.artwork"],
    "surfaceIds should collect only that surface's objects",
  );
}

function testCentralAssetReferenceLifecycle(): void {
  const document = representativeDocument();
  document.extension = { required: [], states: {} };
  const slot = findDocumentObject(document, "front.image-slot");
  assert(
    slot?.type === "image",
    "fixture image slot should be an image object",
  );
  slot.behaviors = undefined;

  const references = collectDocumentAssetReferences(document);
  assertDeepEqual(
    references.map((reference) => reference.source.assetId),
    ["front-artwork"],
    "collector should include declared object asset sources only",
  );
  assertEqual(
    resolveDocumentAsset(document, slot.source, "image")?.id,
    "front-artwork",
    "resolver should enforce the expected asset type",
  );
  assertEqual(
    replaceDocumentAssetReferences(document, "front-artwork", {
      kind: "asset",
      assetId: "image-slot-placeholder",
    }),
    1,
    "replacement should update every collected reference",
  );
  assertEqual(
    slot.source?.assetId,
    "image-slot-placeholder",
    "replacement should mutate the typed source binding",
  );
  const removed = reclaimOrphanedDocumentAssets(document, {
    extensionRegistry: new DocumentExtensionRegistry(),
  });
  assert(
    removed.includes("front-artwork") && removed.includes("front-white-ink"),
    "orphan reclamation should remove every unreferenced asset",
  );
  assertDeepEqual(
    document.assets.map((asset) => asset.id),
    ["image-slot-placeholder"],
    "orphan reclamation should retain referenced assets",
  );
}

function testOrphanReclamationUsesRegisteredExtensionReferences(): void {
  const document = representativeDocument();
  const extensionRegistry = new DocumentExtensionRegistry().register({
    id: "pooder.production-mask",
    behaviors: [
      {
        behaviorType: "pooder.image-slot",
        capabilityId: "pooder.kit.image-slot",
        collectAssetReferences: (behavior, context) => {
          const config = behavior.config as Record<string, unknown>;
          const source = config.placeholderSource;
          return isAssetSource(source)
            ? [
                createAssetReferenceBinding(
                  source,
                  "image",
                  `${context.path}.behaviors[pooder.image-slot].config.placeholderSource`,
                  (replacement) => {
                    config.placeholderSource = replacement;
                  },
                ),
              ]
            : [];
        },
      },
    ],
    collectAssetReferences: (state) => {
      const masks = (state as { masks?: Record<string, unknown> }).masks ?? {};
      return Object.entries(masks).flatMap(([maskId, value]) => {
        const production = (value as { production?: Record<string, unknown> })
          .production;
        const source = production?.source;
        return production && isAssetSource(source)
          ? [
              createAssetReferenceBinding(
                source,
                "image",
                `extension.states.pooder.production-mask.masks.${maskId}.production.source`,
                (replacement) => {
                  production.source = replacement;
                },
              ),
            ]
          : [];
      });
    },
  });

  assertDeepEqual(
    reclaimOrphanedDocumentAssets(document, { extensionRegistry }),
    [],
    "orphan reclamation should retain object, behavior, and extension assets",
  );
}

function main(): void {
  testStrictRoundTrip();
  testUnknownAndLegacyFieldsAreRejected();
  testInvalidNumbersAndUnionsAreRejected();
  testGlobalIdsAndReferencesAreStrict();
  testExtensionSchemasAreStrict();
  testCloneAndVisitors();
  testObjectSelectors();
  testCentralAssetReferenceLifecycle();
  testOrphanReclamationUsesRegisteredExtensionReferences();
  console.log("ok");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
