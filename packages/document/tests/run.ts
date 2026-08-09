import {
  EffectSchemaRegistry,
  ObjectSchemaRegistry,
  cloneEditorDocument,
  collectEditorDocumentCapabilityRequirements,
  findEditorDocumentObject,
  getEditorDocumentObjects,
  parseEditorDocument,
  selectEditorDocumentObjects,
  selectOneEditorDocumentObject,
  validateEditorDocument,
  validateEditorDocumentEffectSchemas,
  validateEditorDocumentObjectSchemas,
  visitEditorDocumentObjects,
  type EditorDocument,
} from "../src";
import { REPRESENTATIVE_V7_DOCUMENT_INPUT } from "./fixtures/representative-v7-document";

declare const process: { exit(code: number): never };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message} (expected ${expectedJson}, got ${actualJson})`);
  }
}

function representativeDocument(): EditorDocument {
  return parseEditorDocument(REPRESENTATIVE_V7_DOCUMENT_INPUT);
}

function testStrictRoundTrip(): void {
  const document = representativeDocument();
  const restored = parseEditorDocument(JSON.parse(JSON.stringify(document)));
  assertDeepEqual(restored, document, "strict v7 should round-trip exactly");
  assertDeepEqual(
    document.surfaces.map((surface) => surface.id),
    ["front", "back"],
    "surface order should be preserved",
  );
  assertEqual(
    findEditorDocumentObject(document, "front.feature.hole")?.id,
    "front.feature.hole",
    "nested object lookup should work",
  );
}

function testUnknownAndLegacyFieldsAreRejected(): void {
  for (const [field, value] of [
    ["config", {}],
    ["views", []],
    ["metadata", {}],
  ] as const) {
    const input = JSON.parse(
      JSON.stringify(REPRESENTATIVE_V7_DOCUMENT_INPUT),
    ) as Record<string, unknown>;
    input[field] = value;
    const diagnostic = validateEditorDocument(input)[0];
    assertEqual(diagnostic?.code, "unknown-field", `${field} should be rejected`);
    assertEqual(diagnostic?.path, `document.${field}`, `${field} path should be stable`);
  }

  const input = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V7_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const surface = (input.surfaces as Array<Record<string, unknown>>)[0]!;
  const layer = (surface.layers as Array<Record<string, unknown>>)[0]!;
  const object = (layer.objects as Array<Record<string, unknown>>)[0]!;
  object.frame = { x: 0, y: 0, width: 1, height: 1 };
  assertEqual(
    validateEditorDocument(input)[0]?.path,
    "surfaces[0].layers[0].objects[0].frame",
    "legacy object frame should be rejected at its exact path",
  );

  const guideRole = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V7_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const guide = ((((guideRole.surfaces as Array<Record<string, unknown>>)[0]!
    .layers as Array<Record<string, unknown>>)[0]!.objects as Array<
    Record<string, unknown>
  >)[0]!.traits as Array<Record<string, unknown>>)[0]!;
  guide.role = "cut";
  assertEqual(
    validateEditorDocument(guideRole)[0]?.code,
    "unknown-field",
    "guide role should be rejected",
  );

  const exportScope = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V7_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const exportObject = (((exportScope.surfaces as Array<Record<string, unknown>>)[0]!
    .layers as Array<Record<string, unknown>>)[0]!.objects as Array<
    Record<string, unknown>
  >)[1]!;
  exportObject.traits = [{ type: "core.export", scopes: ["design"] }];
  assertEqual(
    validateEditorDocument(exportScope)[0]?.code,
    "unknown-field",
    "core.export scopes should be rejected",
  );

  const unnamespacedTag = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V7_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const taggedObject = (((unnamespacedTag.surfaces as Array<Record<string, unknown>>)[0]!
    .layers as Array<Record<string, unknown>>)[0]!.objects as Array<
    Record<string, unknown>
  >)[0]!;
  taggedObject.tags = ["cut"];
  assertEqual(
    validateEditorDocument(unnamespacedTag)[0]?.code,
    "object-tag-namespace-required",
    "object tags should require namespaces",
  );
}

function testInvalidNumbersAndUnionsAreRejected(): void {
  const nonFinite = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V7_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const geometry = (
    (nonFinite.surfaces as Array<Record<string, unknown>>)[0]!.geometry as Record<
      string,
      unknown
    >
  ).canvasBounds as Record<string, unknown>;
  geometry.width = Number.POSITIVE_INFINITY;
  assertEqual(
    validateEditorDocument(nonFinite)[0]?.code,
    "finite-number-required",
    "non-finite geometry should be rejected",
  );

  const invalidUnion = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V7_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const object = (((invalidUnion.surfaces as Array<Record<string, unknown>>)[0]!
    .layers as Array<Record<string, unknown>>)[0]!.objects as Array<
    Record<string, unknown>
  >)[0]!;
  object.children = [];
  assertEqual(
    validateEditorDocument(invalidUnion)[0]?.code,
    "object-union-invalid",
    "source/children union should be exclusive",
  );
}

function testGlobalIdsAndReferencesAreStrict(): void {
  const duplicate = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V7_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const surfaces = duplicate.surfaces as Array<Record<string, unknown>>;
  surfaces[1]!.id = surfaces[0]!.id;
  assert(
    validateEditorDocument(duplicate).some(
      (item) => item.code === "document-id-duplicate",
    ),
    "all document ids should be globally unique",
  );

  const missing = JSON.parse(
    JSON.stringify(REPRESENTATIVE_V7_DOCUMENT_INPUT),
  ) as Record<string, unknown>;
  const cutline = ((((missing.surfaces as Array<Record<string, unknown>>)[0]!
    .layers as Array<Record<string, unknown>>)[0]!.objects as Array<
    Record<string, unknown>
  >)[0]!.effects as Array<Record<string, unknown>>)[0]!;
  cutline.operandObjectId = "missing";
  assert(
    validateEditorDocument(missing).some(
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
  const missing = validateEditorDocumentObjectSchemas(
    document,
    new ObjectSchemaRegistry(),
  );
  assert(
    missing.some((item) => item.code === "object-trait-unregistered") &&
      missing.some((item) => item.code === "object-behavior-unregistered"),
    "unregistered extension traits and behaviors should be rejected",
  );
  assertDeepEqual(
    validateEditorDocumentObjectSchemas(document, objectRegistry),
    [],
    "registered object schemas should validate",
  );

  const effectDocument = cloneEditorDocument(document);
  const target = findEditorDocumentObject(effectDocument, "back.artwork");
  assert(target, "back artwork should exist");
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
    validateEditorDocumentEffectSchemas(effectDocument, effectRegistry),
    [],
    "registered effect schemas should validate",
  );
  const requirements = collectEditorDocumentCapabilityRequirements(effectDocument, {
    availableCapabilityIds: ["test.capability"],
    resolveEffectCapabilityId: (effect) =>
      effect.type === "test.effect" ? "test.capability" : undefined,
  });
  assertEqual(requirements.requirements.length, 1, "effect capability should be collected");
  assertDeepEqual(requirements.diagnostics, [], "available capability should satisfy effect");
}

function testCloneAndVisitors(): void {
  const document = representativeDocument();
  const clone = cloneEditorDocument(document);
  assertDeepEqual(clone, document, "clone should preserve strict document data");
  assert(clone !== document, "clone should detach the root");
  const visited: string[] = [];
  visitEditorDocumentObjects(document, ({ path }) => visited.push(path));
  assertEqual(
    visited.length,
    getEditorDocumentObjects(document).length,
    "visitor and object accessor should agree",
  );
}

function testObjectSelectors(): void {
  const document = representativeDocument();
  assertDeepEqual(
    selectEditorDocumentObjects(document, { tags: ["slot:front"] }).map(
      (object) => object.id,
    ),
    ["front.image-slot", "front.image-placeholder"],
    "tag selector should match all objects in a category",
  );
  assertEqual(
    selectOneEditorDocumentObject(document, { ids: ["front.dieline"] })?.id,
    "front.dieline",
    "id selector should resolve one exact object",
  );
  let ambiguous = false;
  try {
    selectOneEditorDocumentObject(document, { tags: ["slot:front"] });
  } catch {
    ambiguous = true;
  }
  assert(ambiguous, "single-object selector should reject multiple matches");
}

function main(): void {
  testStrictRoundTrip();
  testUnknownAndLegacyFieldsAreRejected();
  testInvalidNumbersAndUnionsAreRejected();
  testGlobalIdsAndReferencesAreStrict();
  testExtensionSchemasAreStrict();
  testCloneAndVisitors();
  testObjectSelectors();
  console.log("ok");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
