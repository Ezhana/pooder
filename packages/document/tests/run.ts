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

const TEST_DOCUMENT_CONFIG = {};
const TEST_SURFACE_FRAMES = {
  previewBounds: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
  productionFrame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
  viewportFocusFrame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
};

function testNormalizeDefaults() {
  const doc = normalizeEditorDocument({
    version: EDITOR_DOCUMENT_VERSION,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        title: "Front",
        size: { width: 100, height: 120, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "artwork",
            exportable: false,
            tags: [" layer-tag ", "", "layer-tag"],
            objects: [
              {
                id: "image-1",
                type: "image",
                exportable: false,
                tags: [" mockup ", "", "mockup"],
                frame: { x: 0, y: 0, width: 20, height: 20 },
                effects: [
                  {
                    type: "image-placement",
                    target: { objectId: " image-1 " },
                    order: "20",
                    phase: "interaction",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  assertEqual(doc.version, EDITOR_DOCUMENT_VERSION, "version should normalize");
  assertDeepEqual(doc.config, TEST_DOCUMENT_CONFIG, "config should normalize");
  assertEqual(doc.views?.[0]?.id, "front", "default view should use surface id");
  assertEqual(
    doc.surfaces[0].layers[0].visible,
    true,
    "layer visibility should default",
  );
  assertDeepEqual(
    doc.surfaces[0].layers[0].tags,
    ["layer-tag"],
    "layer tags should normalize",
  );
  assertEqual(
    "exportable" in (doc.surfaces[0].layers[0] as unknown as Record<string, unknown>),
    false,
    "layer exportable should be ignored",
  );
  assertEqual(
    doc.surfaces[0].layers[0].objects?.[0]?.visible,
    true,
    "object visibility should default",
  );
  assertDeepEqual(
    doc.surfaces[0].layers[0].objects?.[0]?.tags,
    ["mockup"],
    "object tags should normalize",
  );
  assertEqual(
    "exportable" in (
      doc.surfaces[0].layers[0].objects?.[0] as unknown as Record<string, unknown>
    ),
    false,
    "object exportable should be ignored",
  );
  assertEqual(
    doc.surfaces[0].layers[0].objects?.[0]?.effects?.[0]?.require,
    "strict",
    "effect require should default",
  );
  assertDeepEqual(
    doc.surfaces[0].layers[0].objects?.[0]?.effects?.[0]?.target,
    { objectId: "image-1" },
    "effect target should normalize",
  );
  assertEqual(
    doc.surfaces[0].layers[0].objects?.[0]?.effects?.[0]?.order,
    20,
    "effect order should normalize",
  );
  assertEqual(
    doc.surfaces[0].layers[0].objects?.[0]?.effects?.[0]?.phase,
    "interaction",
    "effect phase should normalize",
  );
  assert(
    !("interaction" in (doc.surfaces[0].layers[0].objects?.[0] ?? {})),
    "objects should not expose legacy interaction fields",
  );
}

function testLegacyObjectInteractionIsIgnored() {
  const doc = normalizeEditorDocument({
    version: EDITOR_DOCUMENT_VERSION,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 120, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "artwork",
            objects: [
              {
                id: "valid",
                type: "rect",
                frame: { x: 0, y: 0, width: 20, height: 20 },
                interaction: {
                  selectable: true,
                  evented: false,
                  locked: true,
                  cursor: "move",
                },
              },
              {
                id: "invalid",
                type: "rect",
                frame: { x: 0, y: 0, width: 20, height: 20 },
                interaction: {
                  selectable: "true",
                  evented: 1,
                  locked: null,
                },
              },
              {
                id: "empty",
                type: "rect",
                frame: { x: 0, y: 0, width: 20, height: 20 },
                interaction: {},
              },
            ],
          },
        ],
      },
    ],
  });

  const objects = doc.surfaces[0].layers[0].objects;
  assert(
    !("interaction" in (objects?.[0] ?? {})),
    "legacy interaction fields should not be part of normalized document objects",
  );
  assert(
    !("interaction" in (objects?.[1] ?? {})),
    "invalid legacy interaction fields should not be part of normalized document objects",
  );
  assert(
    !("interaction" in (objects?.[2] ?? {})),
    "empty legacy interaction fields should not be part of normalized document objects",
  );
}

function testLegacyObjectConstraintsAreIgnored() {
  const doc = normalizeEditorDocument({
    version: EDITOR_DOCUMENT_VERSION,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 120, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "artwork",
            objects: [
              {
                id: "valid",
                type: "rect",
                frame: { x: 0, y: 0, width: 20, height: 20 },
                constraints: {
                  drag: [
                    {
                      type: "rect",
                      rect: { x: 0, y: 0, width: 100, height: 100 },
                      mode: "contain",
                      target: "center",
                      ignored: true,
                    },
                    {
                      type: "object",
                      objectId: " frame ",
                      source: "frame",
                      mode: "contain",
                    },
                    { type: "rect", rect: { x: 0, y: 0, width: -1, height: 1 } },
                    { type: "object", objectId: "" },
                    { type: "path", pathId: "future" },
                  ],
                  resize: [{ type: "rect" }],
                },
              },
              {
                id: "empty",
                type: "rect",
                frame: { x: 0, y: 0, width: 20, height: 20 },
                constraints: { drag: [] },
              },
            ],
          },
        ],
      },
    ],
  });

  const objects = doc.surfaces[0].layers[0].objects;
  assert(
    !("constraints" in (objects?.[0] ?? {})),
    "legacy object constraints should not be part of normalized document objects",
  );
  assert(
    !("constraints" in (objects?.[1] ?? {})),
    "empty legacy constraints should not be part of normalized document objects",
  );
}

function testV2ImagePlacementImageDoesNotRequireSource() {
  const diagnostics = validateKitEditorDocument({
    version: EDITOR_DOCUMENT_VERSION,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 120, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "image.user",
            objects: [
              {
                id: "image-target",
                type: "image",
                frame: { x: 0, y: 0, width: 100, height: 120 },
                effects: [{ type: "image-placement" }],
              },
            ],
          },
        ],
      },
    ],
  });

  assert(
    !diagnostics.some((item) => item.code.includes("src")),
    "image-placement image objects should not require asset or src",
  );
}

function testImageObjectDoesNotRequireSource() {
  const diagnostics = validateKitEditorDocument({
    version: EDITOR_DOCUMENT_VERSION,
    config: TEST_DOCUMENT_CONFIG,
    assets: [{ id: "template", type: "image" }],
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 120, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "image.user",
            objects: [
              {
                id: "image-target",
                type: "image",
                frame: { x: 0, y: 0, width: 100, height: 120 },
              },
            ],
          },
        ],
      },
    ],
  });

  assertDeepEqual(
    diagnostics,
    [],
    "image objects and image assets should allow empty src",
  );
}

function testSourceObjectNormalizesSource() {
  const doc = normalizeEditorDocument({
    version: EDITOR_DOCUMENT_VERSION,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 120, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "production",
            objects: [
              {
                id: "cutline",
                type: "object",
                frame: { x: 0, y: 0, width: 50, height: 50 },
                source: {
                  kind: "shape",
                  shape: "circle",
                  params: { radius: 25, ignored: true },
                },
                effects: [
                  {
                    type: "clip",
                    capabilityId: "pooder.kit.clip",
                    target: { objectId: " artwork " },
                  },
                ],
              },
              {
                id: "artwork",
                type: "object",
                frame: { x: 0, y: 0, width: 50, height: 50 },
                source: {
                  kind: "url",
                  url: " /art.png ",
                  intrinsicSize: { width: "200", height: "100" },
                },
              },
              {
                id: "invalid",
                type: "object",
                frame: { x: 0, y: 0, width: 10, height: 10 },
                source: { kind: "url", url: "" },
              },
            ],
          },
        ],
      },
    ],
  });

  const objects = doc.surfaces[0].layers[0].objects;
  assertEqual(objects?.length, 2, "invalid source object should be dropped");
  const cutline = objects?.[0];
  assertEqual(cutline?.type, "object", "shape source object should normalize");
  assertDeepEqual(
    cutline?.type === "object" ? cutline.source : undefined,
    {
      kind: "shape",
      shape: "circle",
      params: { radius: 25, ignored: true },
    },
    "shape source should normalize",
  );
  assertDeepEqual(
    cutline?.effects?.[0],
    {
      type: "clip",
      require: "strict",
      capabilityId: "pooder.kit.clip",
      target: { objectId: "artwork" },
    },
    "source object should keep existing effects",
  );
  assertDeepEqual(
    objects?.[1]?.type === "object" ? objects[1].source : undefined,
    {
      kind: "url",
      url: "/art.png",
      intrinsicSize: { width: 200, height: 100 },
    },
    "url source should trim url and normalize intrinsic size",
  );
}

function testV2DocumentIsRejected() {
  const diagnostics = validateKitEditorDocument({
    version: 2,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        frames: TEST_SURFACE_FRAMES,
        layers: [],
      },
    ],
  });

  assert(
    diagnostics.some((item) => item.code === "document-version-invalid"),
    "v2 document should be rejected",
  );
}

function testDocumentConfigIsRequired() {
  const diagnostics = validateKitEditorDocument({
    version: EDITOR_DOCUMENT_VERSION,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        frames: TEST_SURFACE_FRAMES,
        layers: [],
      },
    ],
  });

  assert(
    diagnostics.some((item) => item.code === "document-config-required"),
    "missing document config should be rejected",
  );
}

function testImageObjectRequiresFrame() {
  const diagnostics = validateKitEditorDocument({
    version: EDITOR_DOCUMENT_VERSION,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "layer",
            objects: [
              {
                id: "image",
                type: "image",
                src: "/image.png",
              },
            ],
          },
        ],
      },
    ],
  });

  assert(
    diagnostics.some((item) => item.code === "object-frame-required"),
    "image object without frame should be invalid",
  );
}

function testValidationStructureAndReferences() {
  const diagnostics = validateKitEditorDocument({
    version: EDITOR_DOCUMENT_VERSION,
    config: TEST_DOCUMENT_CONFIG,
    assets: [{ id: "template", type: "image", src: "/template.png" }],
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "layer",
            objects: [
              {
                id: "img",
                type: "image",
                frame: { x: 0, y: 0, width: 1, height: 1 },
              },
            ],
          },
          { id: "layer" },
        ],
      },
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
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
    codes.includes("view-surface-missing"),
    "missing view surface should be invalid",
  );
}

function testCustomValidatorDiagnostics() {
  const diagnostics = validateEditorDocument(
    {
      version: EDITOR_DOCUMENT_VERSION,
      config: TEST_DOCUMENT_CONFIG,
      surfaces: [
        {
          id: "front",
          size: { width: 1, height: 1, unit: "px" },
        frames: TEST_SURFACE_FRAMES,
          layers: [
            {
              id: "layer",
              effects: [{ type: "custom-effect", capabilityId: "custom" }],
            },
          ],
        },
      ],
    },
    {
      validators: [
        ({ effect, path, addDiagnostic }) => {
          if (effect?.type !== "custom-effect") return;
          addDiagnostic({
            severity: "error",
            code: "custom-effect-invalid",
            message: "Custom effect is invalid.",
            path,
          });
        },
      ],
    },
  );

  assert(
    diagnostics.some((item) => item.code === "custom-effect-invalid"),
    "custom validators should append diagnostics",
  );
}

function testCustomEffectRequiresCapabilityId() {
  const diagnostics = validateEditorDocument({
    version: EDITOR_DOCUMENT_VERSION,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        frames: TEST_SURFACE_FRAMES,
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
  assertEqual(
    resolveKitEditorDocumentEffectCapabilityId({ type: "clip" }),
    "pooder.kit.clip",
    "clip should resolve to kit capability",
  );
  assertEqual(
    resolveKitEditorDocumentEffectCapabilityId({ type: "feature" }),
    "pooder.kit.feature",
    "feature should resolve to kit capability",
  );
  assertEqual(
    resolveKitEditorDocumentEffectCapabilityId({ type: "mirror" }),
    "pooder.kit.mirror",
    "mirror should resolve to kit capability",
  );
  assertEqual(
    resolveKitEditorDocumentEffectCapabilityId({ type: "interaction" }),
    "pooder.kit.interaction",
    "interaction should resolve to kit capability",
  );
  assertEqual(
    resolveKitEditorDocumentEffectCapabilityId({ type: "constraint" }),
    "pooder.kit.interaction",
    "constraint should resolve to kit interaction capability",
  );
  assertEqual(
    resolveKitEditorDocumentEffectCapabilityId({ type: "interaction-component" }),
    undefined,
    "legacy interaction-component should not resolve to a kit capability",
  );

  const diagnostics = validateKitEditorDocument({
    version: EDITOR_DOCUMENT_VERSION,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "layer",
            effects: [{ type: "dieline" }, { type: "feature" }],
            objects: [
              {
                id: "image",
                type: "rect",
                frame: { x: 0, y: 0, width: 1, height: 1 },
                width: 1,
                height: 1,
                effects: [
                  { type: "clip" },
                  { type: "mirror" },
                  { type: "interaction" },
                  { type: "constraint" },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  assertDeepEqual(diagnostics, [], "known kit effect should validate");
}

function testRequirePolicyDiagnostics() {
  const doc: EditorDocument = {
    version: EDITOR_DOCUMENT_VERSION,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "layer",
            effects: [
              { type: "dieline", require: "strict" },
              { type: "configurable-visual", require: "warn" },
              { type: "image-placement", require: "ignore" },
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
        item.capabilityId === "pooder.kit.configurable-visual",
    ),
    "warn missing capability should produce warning",
  );
  assert(
    !result.diagnostics.some(
      (item) => item.capabilityId === "pooder.kit.image-placement",
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
  testLegacyObjectInteractionIsIgnored();
  testLegacyObjectConstraintsAreIgnored();
  testV2ImagePlacementImageDoesNotRequireSource();
  testImageObjectDoesNotRequireSource();
  testSourceObjectNormalizesSource();
  testV2DocumentIsRejected();
  testDocumentConfigIsRequired();
  testImageObjectRequiresFrame();
  testValidationStructureAndReferences();
  testCustomValidatorDiagnostics();
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
