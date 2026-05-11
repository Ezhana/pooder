import {
  EDITOR_DOCUMENT_VERSION,
  collectEditorDocumentCapabilityRequirements,
  normalizeEditorDocument,
  validateEditorDocument,
  type EditorDocument,
} from "../src";
import {
  collectKitEditorDocumentCapabilityRequirements,
  resolveKitEditorDocumentEffectCapabilityId,
  validateKitEditorDocument,
} from "../src/kit";

declare const process: {
  exit(code: number): never;
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
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

function testNormalizeDefaults() {
  const doc = normalizeEditorDocument({
    version: 1,
    surfaces: [
      {
        id: "front",
        title: "Front",
        size: { width: 100, height: 120, unit: "mm" },
        layers: [
          {
            id: "artwork",
            objects: [
              {
                id: "slot-1",
                type: "slot",
                accepts: ["image"],
                frame: { x: 0, y: 0, width: 20, height: 20 },
                effects: [{ type: "image-placement" }],
              },
            ],
          },
        ],
      },
    ],
  });

  assertEqual(doc.version, EDITOR_DOCUMENT_VERSION, "version should normalize");
  assertEqual(doc.views?.[0]?.id, "front", "default view should use surface id");
  assertEqual(
    doc.surfaces[0].layers[0].visible,
    true,
    "layer visibility should default",
  );
  assertEqual(
    doc.surfaces[0].layers[0].exportable,
    true,
    "layer exportable should default",
  );
  assertEqual(
    doc.surfaces[0].layers[0].objects?.[0]?.visible,
    true,
    "object visibility should default",
  );
  assertEqual(
    doc.surfaces[0].layers[0].objects?.[0]?.effects?.[0]?.require,
    "strict",
    "effect require should default",
  );
}

function testValidationStructureAndReferences() {
  const diagnostics = validateKitEditorDocument({
    version: 1,
    assets: [{ id: "template", type: "image", src: "/template.png" }],
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        layers: [
          {
            id: "layer",
            objects: [
              { id: "tpl", type: "template", assetId: "template" },
              { id: "img", type: "image", assetId: "missing" },
            ],
          },
          { id: "layer" },
        ],
      },
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        layers: [],
      },
    ],
    views: [{ id: "tab", surfaceIds: ["missing-surface"] }],
  });

  const codes = diagnostics.map((item) => item.code).sort();
  assert(
    codes.includes("surface-id-duplicate"),
    "duplicate surface should be invalid",
  );
  assert(
    codes.includes("layer-id-duplicate"),
    "duplicate layer should be invalid",
  );
  assert(
    codes.includes("object-asset-missing"),
    "missing image asset should be invalid",
  );
  assert(
    codes.includes("view-surface-missing"),
    "missing view surface should be invalid",
  );
}

function testCustomEffectRequiresCapabilityId() {
  const diagnostics = validateEditorDocument({
    version: 1,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        layers: [{ id: "layer", effects: [{ type: "custom-effect" }] }],
      },
    ],
  });

  assert(
    diagnostics.some((item) => item.code === "effect-capability-required"),
    "custom effect without capabilityId should be invalid",
  );
}

function testKitEffectCapabilityResolution() {
  assertEqual(
    resolveKitEditorDocumentEffectCapabilityId({ type: "dieline" }),
    "pooder.kit.dieline-geometry",
    "dieline should resolve to kit capability",
  );

  const diagnostics = validateKitEditorDocument({
    version: 1,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        layers: [{ id: "layer", effects: [{ type: "dieline" }] }],
      },
    ],
  });
  assertDeepEqual(diagnostics, [], "known kit effect should validate");
}

function testRequirePolicyDiagnostics() {
  const doc: EditorDocument = {
    version: 1,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        layers: [
          {
            id: "layer",
            effects: [
              { type: "dieline", require: "strict" },
              { type: "template-overlay", require: "warn" },
              { type: "white-ink", require: "ignore" },
            ],
          },
        ],
      },
    ],
  };

  const result = collectKitEditorDocumentCapabilityRequirements(doc, {
    availableCapabilityIds: [],
  });
  assert(
    result.diagnostics.some(
      (item) =>
        item.code === "capability-required" &&
        item.severity === "error" &&
        item.capabilityId === "pooder.kit.dieline-geometry",
    ),
    "strict missing capability should produce error",
  );
  assert(
    result.diagnostics.some(
      (item) =>
        item.code === "capability-optional-missing" &&
        item.severity === "warning" &&
        item.capabilityId === "pooder.kit.template-overlay",
    ),
    "warn missing capability should produce warning",
  );
  assert(
    !result.diagnostics.some(
      (item) => item.capabilityId === "pooder.kit.white-ink",
    ),
    "ignore missing capability should not produce diagnostic",
  );

  const generic = collectEditorDocumentCapabilityRequirements(doc, {
    resolveEffectCapabilityId: resolveKitEditorDocumentEffectCapabilityId,
  });
  assertEqual(generic.requirements.length, 2, "ignored effect should be skipped");
}

function main() {
  testNormalizeDefaults();
  testValidationStructureAndReferences();
  testCustomEffectRequiresCapabilityId();
  testKitEffectCapabilityResolution();
  testRequirePolicyDiagnostics();
  console.log("ok");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
