import {
  EDITOR_DOCUMENT_VERSION,
  EffectSchemaRegistry,
  cloneEditorDocument,
  collectEditorDocumentCapabilityRequirements,
  findEditorDocumentObject,
  getEditorDocumentObjects,
  isGenericEditorEffect,
  isEditorVisualObject,
  normalizeEditorDocument,
  validateEditorDocument,
  validateEditorDocumentEffectSchemas,
  visitEditorDocumentObjects,
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
                  selection: { enabled: false },
                  manipulation: {
                    move: {
                      enabled: true,
                      constraints: [
                        {
                          activeWhen: { op: "const", value: true },
                          spec: {
                            type: "grid.snap",
                            application: {
                              preview: "evaluate",
                              commit: "apply",
                            },
                            params: { size: 5 },
                          },
                        },
                      ],
                    },
                    resize: { enabled: true },
                    rotate: { enabled: true },
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
      selection: { enabled: false },
      manipulation: {
        move: {
          enabled: true,
          constraints: [
            {
              activeWhen: { op: "const", value: true },
              spec: {
                type: "grid.snap",
                application: {
                  preview: "evaluate",
                  commit: "apply",
                },
                params: { size: 5 },
              },
            },
          ],
        },
        resize: { enabled: true },
        rotate: { enabled: true },
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

function testConstraintApplicationValidation() {
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
            id: "artwork",
            objects: [
              {
                id: "invalid-application",
                frame: { x: 0, y: 0, width: 20, height: 20 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 20, height: 20 },
                },
                interaction: {
                  manipulation: {
                    move: {
                      enabled: true,
                      constraints: [
                        {
                          spec: {
                            type: "grid.snap",
                            application: {
                              preview: "render-guide",
                              release: "apply",
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  });

  assert(
    diagnostics.some(
      (item) =>
        item.code === "interaction-constraint-application-mode-invalid",
    ),
    "constraint application should reject unsupported modes",
  );
  assert(
    diagnostics.some(
      (item) =>
        item.code === "interaction-constraint-application-phase-invalid",
    ),
    "constraint application should reject unsupported phases",
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
    cutline && isEditorVisualObject(cutline) ? cutline.source : undefined,
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
    objects?.[1] && isEditorVisualObject(objects[1])
      ? objects[1].source
      : undefined,
    {
      kind: "url",
      url: "/art.png",
      intrinsicSize: { width: 200, height: 100 },
    },
    "url source should trim url and normalize intrinsic size",
  );
}

function testV5DocumentIsRejected() {
  const diagnostics = validateEditorDocument({
    version: 5,
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
    "v5 document should be rejected",
  );
}

function testLegacyInteractionFieldsAreRejected() {
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
                frame: { x: 0, y: 0, width: 1, height: 1 },
                source: { kind: "shape", shape: "rect", params: {} },
                interaction: {
                  drag: { enabled: true },
                  transform: { enabled: true },
                  activation: {
                    action: { command: "legacy.open" },
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  });
  assert(
    diagnostics.filter((item) => item.code === "interaction-field-invalid")
      .length === 2,
    "legacy drag and transform fields should be rejected",
  );
  assert(
    diagnostics.some(
      (item) => item.code === "interaction-action-command-legacy",
    ),
    "legacy action.command should be rejected",
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

function testCompositeStructureAndEffectDependencies() {
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
            id: "objects",
            objects: [
              {
                id: "feature",
                frame: { x: 0, y: 0, width: 10, height: 10 },
                children: [
                  {
                    id: "operand",
                    frame: { x: 0, y: 0, width: 10, height: 10 },
                    source: { kind: "shape", shape: "circle", params: {} },
                    effects: [
                      {
                        type: "boolean",
                        targetId: "cutline",
                        operation: "add",
                      },
                    ],
                  },
                ],
              },
              {
                id: "cutline",
                frame: { x: 0, y: 0, width: 10, height: 10 },
                source: { kind: "shape", shape: "rect", params: {} },
                children: [],
                effects: [
                  {
                    type: "clip-source",
                    targetIds: ["operand"],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  const codes = diagnostics.map((item) => item.code);
  assert(
    codes.includes("object-structure-invalid"),
    "visual objects must not contain children",
  );
  assert(
    codes.includes("object-effect-dependency-cycle"),
    "boolean and clip-source dependency cycles must be rejected",
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

function testStructuralValidationDoesNotResolveCapabilities() {
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

  assertDeepEqual(
    diagnostics,
    [],
    "structural validation should not require runtime capability resolution",
  );
}

function testEffectsValidateWithoutCapabilityResolver() {
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
                effects: [{ type: "constraint" }],
                interaction: {
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
  });
  assertDeepEqual(
    diagnostics,
    [],
    "effect structure should validate without a capability resolver",
  );
}

function testValidationStagesRemainIndependent() {
  const documentDiagnostics = validateEditorDocument({
    version: EDITOR_DOCUMENT_VERSION,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        frames: TEST_SURFACE_FRAMES,
        layers: [{ id: "layer", effects: [{ payload: {} }] }],
      },
    ],
  });
  assertEqual(
    documentDiagnostics[0]?.stage,
    "document-schema",
    "invalid effect envelopes should identify the document schema stage",
  );

  const invalidPayloadDocument = {
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
            effects: [{ type: "custom", payload: { count: "invalid" } }],
          },
        ],
      },
    ],
  };
  const registry = new EffectSchemaRegistry([
    {
      effectType: "custom",
      capabilityId: "test.custom",
      validate: (payload) =>
        typeof (payload as Record<string, unknown> | undefined)?.count ===
        "number"
          ? []
          : [
              {
                code: "custom-count-invalid",
                message: "count must be a number.",
                path: "count",
              },
            ],
    },
  ]);

  assertDeepEqual(
    validateEditorDocument(invalidPayloadDocument),
    [],
    "document schema validation should not validate effect payloads",
  );
  const effectDiagnostics = validateEditorDocumentEffectSchemas(
    invalidPayloadDocument,
    registry,
  );
  assertEqual(
    effectDiagnostics[0]?.stage,
    "effect-schema",
    "effect payload failures should identify the effect schema stage",
  );

  const runtimeResult = collectEditorDocumentCapabilityRequirements(
    normalizeEditorDocument({
      ...invalidPayloadDocument,
      surfaces: [
        {
          ...invalidPayloadDocument.surfaces[0],
          layers: [
            {
              id: "layer",
              effects: [{ type: "custom", payload: { count: 1 } }],
            },
          ],
        },
      ],
    }),
    {
      availableCapabilityIds: [],
      resolveEffectCapabilityId: (effect) =>
        registry.resolveCapabilityId(effect.type),
    },
  );
  assertEqual(
    runtimeResult.diagnostics[0]?.stage,
    "runtime-capability",
    "missing runtime capabilities should identify the runtime stage",
  );
}

function testObjectInteractionNormalizesSeparatelyFromGenericEffects() {
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
                effects: [{ type: "constraint" }],
                interaction: {
                  manipulation: {
                    move: {
                      enabled: true,
                      constraints: [
                        {
                          spec: {
                            type: "rect.contain",
                            params: { padding: 2 },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  });

  const object = doc.surfaces[0].layers[0].objects?.[0];
  const effects = object?.effects ?? [];
  assertEqual(
    effects.length,
    1,
    "generic effects should remain separate from object interaction",
  );
  assert(
    isGenericEditorEffect(effects[0]),
    "generic constraint should remain a generic editor effect",
  );
  assertDeepEqual(
    object?.interaction?.manipulation?.move,
    {
      enabled: true,
      constraints: [
        {
          spec: { type: "rect.contain", params: { padding: 2 } },
        },
      ],
    },
    "object interaction should be the sole object-local interaction declaration",
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

function testCloneAndRecursiveObjectAccessors() {
  const document = normalizeEditorDocument({
    version: EDITOR_DOCUMENT_VERSION,
    config: { nested: { enabled: true } },
    metadata: { nested: { label: "original" } },
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "first",
            objects: [
              {
                id: "group",
                frame: { x: 0, y: 0, width: 1, height: 1 },
                children: [
                  {
                    id: "one",
                    frame: { x: 0, y: 0, width: 1, height: 1 },
                    source: { kind: "shape", shape: "rect", params: {} },
                  },
                ],
              },
            ],
          },
          {
            id: "second",
            objects: [
              {
                id: "two",
                frame: { x: 0, y: 0, width: 1, height: 1 },
                source: { kind: "text", text: "two" },
              },
            ],
          },
        ],
      },
    ],
  });

  const clone = cloneEditorDocument(document);
  assertDeepEqual(clone, document, "clone should preserve document data");
  assert(clone !== document, "clone should detach the document root");
  assert(
    clone.config !== document.config &&
      clone.metadata !== document.metadata &&
      clone.surfaces[0] !== document.surfaces[0],
    "clone should recursively detach nested values",
  );

  assertDeepEqual(
    getEditorDocumentObjects(document).map((object) => object.id),
    ["group", "one", "two"],
    "object accessor should preserve document order",
  );
  assertEqual(
    findEditorDocumentObject(document, "two")?.id,
    "two",
    "object lookup should traverse the hierarchy",
  );
  const paths: string[] = [];
  visitEditorDocumentObjects(document, ({ path }) => paths.push(path));
  assertDeepEqual(
    paths,
    [
      "surfaces[0].layers[0].objects[0]",
      "surfaces[0].layers[0].objects[0].children[0]",
      "surfaces[0].layers[1].objects[0]",
    ],
    "visitor should expose stable object paths",
  );
}

function main() {
  testNormalizeDefaults();
  testObjectInteractionNormalizesSupportedFields();
  testConstraintApplicationValidation();
  testLegacyObjectConstraintsAreIgnored();
  testImagePlacementObjectDoesNotRequireLegacySrc();
  testObjectWithoutSourceIsDropped();
  testSourceObjectNormalizesSource();
  testV5DocumentIsRejected();
  testLegacyInteractionFieldsAreRejected();
  testDocumentConfigIsRequired();
  testImageObjectRequiresFrame();
  testValidationStructureAndReferences();
  testCompositeStructureAndEffectDependencies();
  testCustomValidatorDiagnostics();
  testStructuralValidationDoesNotResolveCapabilities();
  testEffectsValidateWithoutCapabilityResolver();
  testValidationStagesRemainIndependent();
  testObjectInteractionNormalizesSeparatelyFromGenericEffects();
  testRequirePolicyDiagnostics();
  testCloneAndRecursiveObjectAccessors();
  console.log("ok");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
