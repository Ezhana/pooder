import {
  EDITOR_DOCUMENT_VERSION,
  collectEditorDocumentCapabilityRequirements,
  isGenericEditorEffect,
  normalizeEditorDocument,
  validateEditorDocument,
  type EditorDocument,
  type EditorEffect,
} from "../src";

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
const TEST_EFFECT_CAPABILITY_IDS: Record<string, string> = {
  dieline: "test.dieline",
  feature: "test.feature",
  "configurable-visual": "test.configurable-visual",
  "image-placement": "test.image-placement",
  constraint: "test.constraint",
};
const TEST_SURFACE_FRAMES = {
  previewBounds: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
  productionFrame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
  viewportFocusFrame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
};

function resolveTestEffectCapabilityId(
  effect: EditorEffect,
): string | undefined {
  return effect.capabilityId || TEST_EFFECT_CAPABILITY_IDS[effect.type];
}

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
                exportable: false,
                tags: [" mockup ", "", "mockup"],
                frame: { x: 0, y: 0, width: 20, height: 20 },
                source: { kind: "url", url: "/image.png" },
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
  assertEqual(
    doc.views?.[0]?.id,
    "front",
    "default view should use surface id",
  );
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
    "exportable" in
      (doc.surfaces[0].layers[0] as unknown as Record<string, unknown>),
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
    "exportable" in
      (doc.surfaces[0].layers[0].objects?.[0] as unknown as Record<
        string,
        unknown
      >),
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
    "objects should not expose absent interaction fields",
  );
}

function testObjectInteractionNormalizesSupportedFields() {
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
                frame: { x: 0, y: 0, width: 20, height: 20 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 20, height: 20 },
                },
                interaction: {
                  transform: { enabled: true },
                  drag: {
                    enabled: true,
                    constraints: [
                      {
                        activeWhen: { op: "const", value: true },
                        spec: { type: "grid.snap", params: { size: 5 } },
                      },
                    ],
                  },
                  enabledWhen: {
                    op: "truthy",
                    ref: { source: "context", key: "can.interact" },
                  },
                },
              },
              {
                id: "invalid",
                frame: { x: 0, y: 0, width: 20, height: 20 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 20, height: 20 },
                },
                interaction: {
                  selectable: "true",
                  evented: 1,
                  locked: null,
                },
              },
              {
                id: "empty",
                frame: { x: 0, y: 0, width: 20, height: 20 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 20, height: 20 },
                },
                interaction: {},
              },
            ],
          },
        ],
      },
    ],
  });

  const objects = doc.surfaces[0].layers[0].objects;
  assertDeepEqual(
    objects?.[0]?.interaction,
    {
      enabledWhen: {
        op: "truthy",
        ref: { source: "context", key: "can.interact" },
      },
      transform: { enabled: true },
      drag: {
        enabled: true,
        constraints: [
          {
            activeWhen: { op: "const", value: true },
            spec: { type: "grid.snap", params: { size: 5 } },
          },
        ],
      },
    },
    "supported interaction fields should normalize",
  );
  assert(
    !("interaction" in (objects?.[1] ?? {})),
    "unsupported renderer interaction fields should not be part of normalized document objects",
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
                frame: { x: 0, y: 0, width: 20, height: 20 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 20, height: 20 },
                },
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
                    {
                      type: "rect",
                      rect: { x: 0, y: 0, width: -1, height: 1 },
                    },
                    { type: "object", objectId: "" },
                    { type: "path", pathId: "future" },
                  ],
                  resize: [{ type: "rect" }],
                },
              },
              {
                id: "empty",
                frame: { x: 0, y: 0, width: 20, height: 20 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 20, height: 20 },
                },
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

function testImagePlacementObjectDoesNotRequireLegacySrc() {
  const diagnostics = validateEditorDocument({
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
                frame: { x: 0, y: 0, width: 100, height: 120 },
                source: { kind: "url", url: "/placeholder.png" },
                effects: [
                  {
                    type: "image-placement",
                    capabilityId: "test.image-placement",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  assert(
    !diagnostics.some((item) => item.code.includes("src")),
    "image-placement source objects should not require legacy src fields",
  );
}

function testObjectWithoutSourceIsDropped() {
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
            id: "image.user",
            objects: [
              {
                id: "image-target",
                frame: { x: 0, y: 0, width: 100, height: 120 },
              },
              {
                id: "legacy-image",
                type: "image",
                frame: { x: 0, y: 0, width: 100, height: 120 },
              },
              {
                id: "legacy-path",
                type: "path",
                path: "M0 0H1V1Z",
                frame: { x: 0, y: 0, width: 100, height: 120 },
              },
              {
                id: "legacy-rect",
                type: "rect",
                width: 100,
                height: 120,
                frame: { x: 0, y: 0, width: 100, height: 120 },
              },
              {
                id: "legacy-text",
                type: "text",
                text: "Legacy",
                frame: { x: 0, y: 0, width: 100, height: 120 },
              },
            ],
          },
        ],
      },
    ],
  });

  assertEqual(
    doc.surfaces[0].layers[0].objects?.length ?? 0,
    0,
    "objects without source and legacy type-only objects should be dropped",
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
                frame: { x: 0, y: 0, width: 50, height: 50 },
                source: {
                  kind: "url",
                  url: " /art.png ",
                  intrinsicSize: { width: "200", height: "100" },
                },
              },
              {
                id: "invalid",
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
  assertDeepEqual(
    cutline?.source,
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
    objects?.[1]?.source,
    {
      kind: "url",
      url: "/art.png",
      intrinsicSize: { width: 200, height: 100 },
    },
    "url source should trim url and normalize intrinsic size",
  );
}

function testV2DocumentIsRejected() {
  const diagnostics = validateEditorDocument({
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
  const diagnostics = validateEditorDocument({
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
  const diagnostics = validateEditorDocument({
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
                src: "/image.png",
                source: { kind: "url", url: "/image.png" },
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
  const diagnostics = validateEditorDocument({
    version: EDITOR_DOCUMENT_VERSION,
    config: TEST_DOCUMENT_CONFIG,
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
                frame: { x: 0, y: 0, width: 1, height: 1 },
                source: { kind: "url", url: "/template.png" },
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

function testInjectedEffectCapabilityResolution() {
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
              effects: [{ type: "dieline" }, { type: "feature" }],
              objects: [
                {
                  id: "image",
                  frame: { x: 0, y: 0, width: 1, height: 1 },
                  source: {
                    kind: "shape",
                    shape: "rect",
                    params: { width: 1, height: 1 },
                  },
                  effects: [
                    { type: "constraint" },
                    {
                      type: "object-constraint",
                      targetId: "frame",
                      strategy: "inside",
                    },
                    { type: "interactive", enabled: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { resolveEffectCapabilityId: resolveTestEffectCapabilityId },
  );
  assertDeepEqual(diagnostics, [], "injected known effects should validate");
}

function testObjectConstraintEffectNormalizesSeparatelyFromGenericConstraint() {
  const doc = normalizeEditorDocument({
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
                frame: { x: 0, y: 0, width: 1, height: 1 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 1, height: 1 },
                },
                effects: [
                  { type: "constraint" },
                  {
                    type: "object-constraint",
                    targetId: "frame",
                    strategy: "inside",
                    params: { padding: 2 },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  const effects = doc.surfaces[0].layers[0].objects?.[0]?.effects ?? [];
  assertEqual(
    effects.length,
    2,
    "generic and object constraints should both remain",
  );
  assert(
    isGenericEditorEffect(effects[0]),
    "generic constraint should remain a generic editor effect",
  );
  assertEqual(
    effects[1].type,
    "object-constraint",
    "object-local constraint should use a distinct type",
  );
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

  const result = collectEditorDocumentCapabilityRequirements(doc, {
    resolveEffectCapabilityId: resolveTestEffectCapabilityId,
    availableCapabilityIds: [],
  });
  assert(
    result.diagnostics.some(
      (item) =>
        item.code === "capability-required" &&
        item.severity === "error" &&
        item.capabilityId === "test.dieline",
    ),
    "strict missing capability should produce error",
  );
  assert(
    result.diagnostics.some(
      (item) =>
        item.code === "capability-optional-missing" &&
        item.severity === "warning" &&
        item.capabilityId === "test.configurable-visual",
    ),
    "warn missing capability should produce warning",
  );
  assert(
    !result.diagnostics.some(
      (item) => item.capabilityId === "test.image-placement",
    ),
    "ignore missing capability should not produce diagnostic",
  );

  const generic = collectEditorDocumentCapabilityRequirements(doc, {
    resolveEffectCapabilityId: resolveTestEffectCapabilityId,
  });
  assertEqual(
    generic.requirements.length,
    2,
    "ignored effect should be skipped",
  );
}

function main() {
  testNormalizeDefaults();
  testObjectInteractionNormalizesSupportedFields();
  testLegacyObjectConstraintsAreIgnored();
  testImagePlacementObjectDoesNotRequireLegacySrc();
  testObjectWithoutSourceIsDropped();
  testSourceObjectNormalizesSource();
  testV2DocumentIsRejected();
  testDocumentConfigIsRequired();
  testImageObjectRequiresFrame();
  testValidationStructureAndReferences();
  testCustomValidatorDiagnostics();
  testCustomEffectRequiresCapabilityId();
  testInjectedEffectCapabilityResolution();
  testObjectConstraintEffectNormalizesSeparatelyFromGenericConstraint();
  testRequirePolicyDiagnostics();
  console.log("ok");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
