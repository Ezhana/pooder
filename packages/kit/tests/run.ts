import {
  pickExitIndex,
  scoreOutsideAbove,
} from "../src/extensions/bridgeSelection";
import {
  sampleWrappedOffsets,
  wrappedDistance,
} from "../src/extensions/wrappedOffsets";
import {
  circularMorphology,
  createMask,
  fillHoles,
  findMinimalConnectRadius,
  isMaskConnected8,
} from "../src/extensions/maskOps";
import { computeDetectEdgeSize } from "../src/extensions/edgeScale";
import {
  IMAGE_PLACEMENT_CAPABILITY_ID,
  createImagePlacementCapabilityDefinition,
  normalizeImagePlacementLayerId,
  type ImagePlacementCapabilityApi,
} from "../src/extensions/image/capability";
import { buildImageSessionOverlaySpecs } from "../src/extensions/image/sessionOverlay";
import {
  DIELINE_GEOMETRY_CAPABILITY_ID,
  createDielineGeometryCapabilityDefinition,
  normalizeDielineGeometryLayerId,
  upsertScenePathElement,
  type DielineGeometryCapabilityApi,
} from "../src/extensions/dieline/capability";
import { buildDielineRenderBundle } from "../src/extensions/dieline/renderBuilder";
import {
  EDGE_DETECTION_CAPABILITY_ID,
  EdgeDetectionCapabilityExtension,
  type EdgeDetectionCapabilityApi,
} from "../src/extensions/edge-detection";
import { createDesignExportCommands } from "../src/extensions/design-export/commands";
import {
  DESIGN_EXPORT_CAPABILITY_ID,
  DesignExportCapabilityExtension,
  createDesignExportCapabilityDefinition,
  normalizeDesignExportLayerIds,
  type DesignExportCapabilityApi,
} from "../src/extensions/design-export";
import { createWhiteInkCommands } from "../src/extensions/white-ink/commands";
import { createWhiteInkConfigurations } from "../src/extensions/white-ink/config";
import {
  WHITE_INK_CAPABILITY_ID,
  WhiteInkCapabilityExtension,
  createWhiteInkCapabilityDefinition,
  getWhiteInkConfigKey,
  normalizeWhiteInkConfigNamespace,
  normalizeWhiteInkLayerId,
  type WhiteInkCapabilityApi,
} from "../src/extensions/white-ink";
import {
  CLIP_CAPABILITY_ID,
  ClipCapabilityExtension,
} from "../src/extensions/clip";
import {
  RULER_CAPABILITY_ID,
  RulerCapabilityExtension,
  createRulerCapabilityDefinition,
  getRulerConfigKey,
  normalizeRulerConfigNamespace,
  normalizeRulerLayerId,
  type RulerCapabilityApi,
} from "../src/extensions/ruler";
import {
  CONFIGURABLE_VISUAL_CAPABILITY_ID,
  type ConfigurableVisualCapabilityApi,
} from "../src/extensions/configurable-visual";
import { createDielineCommands } from "../src/extensions/dieline/commands";
import { createDielineConfigurations } from "../src/extensions/dieline/config";
import {
  normalizePointInGeometry,
  resolveFeaturePosition,
} from "../src/extensions/featureCoordinates";
import {
  FEATURE_CAPABILITY_ID,
  createFeatureCapabilityDefinition,
  type FeatureCapabilityApi,
} from "../src/extensions/feature/capability";
import { hasAnyImageInViewState } from "../src/extensions/image/model";
import {
  createDielineGeometryCapability,
  createClipCapability,
  createFeatureCapability,
  createConfigurableVisualCapability,
  createImagePlacementCapability,
  createWhiteInkCapability,
} from "../src/factories";
import {
  applyKitEditorDocument,
  createKitCapabilitiesForDocument,
} from "../src/document";
import {
  SCENE_EXPORT_SERVICE,
  CANVAS_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_LAYOUT_SERVICE,
  evaluateVisibilityExpr,
} from "@pooder/core";
import type {
  SceneLayoutSnapshot,
  SceneRect,
} from "../src/shared/scene/scene-layout-model";
import {
  COMMAND_SERVICE,
  SCENE_SERVICE,
  SESSION_SERVICE,
  type CapabilityDefinition,
  type CommandContribution,
  type CommandService,
  type ExtensionDefinition,
  Pooder,
  type RenderIntentService,
  type SceneService,
  type SessionService,
  ToolRegistryService,
} from "@pooder/core";

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

const TEST_DOCUMENT_CONFIG = {
  "scene.previewBounds": { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
  "scene.productionFrame": { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
  "scene.viewportFocusFrame": { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
};

function imagePlacementCommittedVisibility(slotId: string) {
  return {
    op: "not",
    expr: {
      op: "sessionScopeActive",
      scope: { subjectId: slotId, channel: "image-placement" },
    },
  };
}

class FakeCanvasService {
  private activeObject: any = null;
  private readonly eventHandlers = new Map<string, Set<(event?: any) => void>>();

  canvas = {
    width: 800,
    height: 600,
    contextTop: null,
    viewportTransform: [1, 0, 0, 1, 0, 0],
    on: () => {},
    off: () => {},
    getObjects: () => [],
    clearContext: () => {},
    discardActiveObject: () => {},
    setActiveObject: () => {},
    requestRenderAll: () => {},
    setViewportTransform: () => {},
  };

  viewport = {
    layout: {
      scale: 1,
      width: 800,
      height: 600,
      offsetX: 0,
      offsetY: 0,
    },
    updateContainer: (width: number, height: number) => {
      this.viewport.layout.width = width;
      this.viewport.layout.height = height;
    },
    setPadding: () => {},
    updatePhysical: () => {
      this.viewport.layout.scale = 1;
      this.viewport.layout.offsetX = 0;
      this.viewport.layout.offsetY = 0;
    },
  };

  requestRenderAll() {}

  getObjects(options: any = {}) {
    const objects = this.canvas.getObjects();
    return objects.filter((object: any) => {
      if (options.layerId && object.layerId !== options.layerId) return false;
      if (options.type && object.type !== options.type) return false;
      if (options.predicate && !options.predicate(object)) return false;
      return true;
    });
  }

  getObject(id: string, passId?: string) {
    return this.canvas.getObjects().find((object: any) => {
      if (object?.data?.id !== id) return false;
      if (!passId) return true;
      return object?.data?.passId === passId || object?.data?.layerId === passId;
    });
  }

  getActiveObject() {
    return this.activeObject;
  }

  setActiveObject(object: any) {
    this.activeObject = object;
  }

  discardActiveObject() {
    this.activeObject = null;
  }

  setViewportMirror() {}

  onCanvasEvent(eventName: string, handler: (event?: any) => void) {
    let handlers = this.eventHandlers.get(eventName);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(eventName, handlers);
    }
    handlers.add(handler);
  }

  offCanvasEvent(eventName: string, handler: (event?: any) => void) {
    this.eventHandlers.get(eventName)?.delete(handler);
  }

  getTopContext() {
    return this.canvas.contextTop;
  }

  clearTopContext(_context: unknown) {
    this.canvas.clearContext();
  }

  getViewportSize() {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  updateViewportLayout(options: {
    containerWidth: number;
    containerHeight: number;
    padding: number;
    widthMm: number;
    heightMm: number;
    offsetX?: number;
    offsetY?: number;
  }) {
    this.canvas.width = options.containerWidth;
    this.canvas.height = options.containerHeight;
    this.viewport.updateContainer(this.canvas.width, this.canvas.height);
    this.viewport.layout.scale = 1;
    this.viewport.layout.width = options.widthMm;
    this.viewport.layout.height = options.heightMm;
    this.viewport.layout.offsetX = (options.containerWidth - options.widthMm) / 2;
    this.viewport.layout.offsetY = (options.containerHeight - options.heightMm) / 2;
    return this.viewport.layout;
  }

  async loadImageSize() {
    return null;
  }

  getPassObjects() {
    return [];
  }

  getSceneScale() {
    return 1;
  }

  getScreenViewportRect() {
    return {
      left: 0,
      top: 0,
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }

  toSceneRect<
    T extends { left: number; top: number; width: number; height: number },
  >(rect: T) {
    return { ...rect };
  }

  toScreenRect<
    T extends { left: number; top: number; width: number; height: number },
  >(rect: T) {
    return { ...rect };
  }

  toSceneLength(value: number) {
    return value;
  }

  toScreenLength(value: number) {
    return value;
  }

  toScenePoint(point: { x: number; y: number }) {
    return { ...point };
  }

  toScreenPoint(point: { x: number; y: number }) {
    return { ...point };
  }
}

class FakeSceneExportService {
  calls: any[] = [];
  error: Error | null = new Error("browser-scene-export-empty");
  response: any = {
    crop: { left: 0, top: 0, width: 100, height: 80 },
    format: "png",
    height: 80,
    multiplier: 1,
    sourceElementIds: [],
    sourceLayerIds: [],
    url: "data:image/png;base64,test",
    width: 100,
  };

  async exportImage(options: Record<string, any>) {
    this.calls.push(options);
    if (this.error) {
      throw this.error;
    }
    return this.response;
  }
}

function createCommandExtension(
  id: string,
  options: {
    activation?: ExtensionDefinition["activation"];
    capabilities?: CapabilityDefinition[];
    commands?: CommandContribution[];
    tools?: Array<{
      id: string;
      name: string;
      interaction: "instant" | "session" | "hybrid";
    }>;
  } = {},
): ExtensionDefinition {
  return {
    id,
    activation: options.activation,
    contribute() {
      return {
        capabilities: options.capabilities ?? [],
        commands: options.commands ?? [],
        tools: options.tools ?? [],
      };
    },
    activate() {},
  };
}

function testWrappedOffsets() {
  assert(wrappedDistance(100, 10, 30) === 20, "distance 10->30 should be 20");
  assert(
    wrappedDistance(100, 90, 10) === 20,
    "distance 90->10 should wrap to 20",
  );

  const a = sampleWrappedOffsets(100, 10, 30, 5);
  assert(
    JSON.stringify(a) === JSON.stringify([10, 15, 20, 25, 30]),
    `unexpected sample: ${JSON.stringify(a)}`,
  );

  const b = sampleWrappedOffsets(100, 90, 10, 3);
  assert(
    JSON.stringify(b) === JSON.stringify([90, 0, 10]),
    `unexpected wrap sample: ${JSON.stringify(b)}`,
  );
}

function testBridgeSelection() {
  const idx = pickExitIndex([
    { insideAbove: true, insideBelow: true },
    { insideAbove: false, insideBelow: true },
    { insideAbove: false, insideBelow: false },
  ]);
  assert(idx === 1, `expected exit index 1, got ${idx}`);

  const none = pickExitIndex([{ insideAbove: true, insideBelow: true }]);
  assert(none === -1, `expected -1, got ${none}`);

  const score = scoreOutsideAbove([
    { outsideAbove: true },
    { outsideAbove: false },
    { outsideAbove: true },
  ]);
  assert(score === 2, `expected score 2, got ${score}`);
}

function testMaskOps() {
  const width = 50;
  const height = 50;
  const mask = new Uint8Array(width * height);
  mask[10 * width + 10] = 1;
  mask[10 * width + 20] = 1;

  const r = findMinimalConnectRadius(mask, width, height, 20);
  const closed = circularMorphology(mask, width, height, r, "closing");
  assert(
    isMaskConnected8(closed, width, height),
    `closed mask should be connected (r=${r})`,
  );
  if (r > 0) {
    const closedPrev = circularMorphology(
      mask,
      width,
      height,
      r - 1,
      "closing",
    );
    assert(
      !isMaskConnected8(closedPrev, width, height),
      `r should be minimal (r=${r})`,
    );
  }

  const donut = new Uint8Array(9 * 9);
  for (let y = 1; y <= 7; y++) {
    for (let x = 1; x <= 7; x++) donut[y * 9 + x] = 1;
  }
  for (let y = 3; y <= 5; y++) {
    for (let x = 3; x <= 5; x++) donut[y * 9 + x] = 0;
  }
  const filled = fillHoles(donut, 9, 9);
  assert(filled[4 * 9 + 4] === 1, "hole should be filled");

  const imgW = 2;
  const imgH = 1;
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 10, 10, 10, 254]);
  const imageData = {
    width: imgW,
    height: imgH,
    data: rgba,
  } as unknown as ImageData;
  const paddedWidth = imgW + 4;
  const paddedHeight = imgH + 4;
  const created = createMask(imageData, {
    threshold: 10,
    padding: 2,
    paddedWidth,
    paddedHeight,
    maskMode: "auto",
    alphaOpaqueCutoff: 250,
  });
  assert(
    created[2 * paddedWidth + 2] === 0,
    "white pixel should be background",
  );
  assert(
    created[2 * paddedWidth + 3] === 1,
    "non-white pixel should be foreground",
  );
}

function testEdgeScale() {
  const currentMax = 100;
  const baseBounds = { width: 50, height: 20 };
  const expandedBounds = { width: 70, height: 40 };
  const { width, height, scale } = computeDetectEdgeSize(
    currentMax,
    baseBounds,
    expandedBounds,
  );
  assert(scale === 2, `expected scale 2, got ${scale}`);
  assert(width === 140, `expected width 140, got ${width}`);
  assert(height === 80, `expected height 80, got ${height}`);
}

function testFeaturePlacementProjection() {
  const trimGeometry = {
    x: 100,
    y: 120,
    width: 120,
    height: 180,
  };
  const cutGeometry = {
    x: 100,
    y: 120,
    width: 150,
    height: 210,
  };
  const trimFeature = {
    x: 0.82,
    y: 0.68,
  };

  const trimCenter = resolveFeaturePosition(trimFeature, trimGeometry);
  const cutFeature = normalizePointInGeometry(trimCenter, cutGeometry);
  const cutCenter = resolveFeaturePosition(cutFeature, cutGeometry);

  assert(
    Math.abs(trimCenter.x - cutCenter.x) < 1e-6,
    `expected projected feature x to stay fixed, got ${trimCenter.x} vs ${cutCenter.x}`,
  );
  assert(
    Math.abs(trimCenter.y - cutCenter.y) < 1e-6,
    `expected projected feature y to stay fixed, got ${trimCenter.y} vs ${cutCenter.y}`,
  );
}

function testVisibilityDsl() {
  const layers = new Map([
    ["ruler-overlay", { exists: true, objectCount: 2 }],
    ["feature-overlay", { exists: true, objectCount: 0 }],
  ]);

  const context = {
    activeToolId: "pooder.kit.image",
    isSessionActive: (sessionId: string) => sessionId === "session.feature",
    isSessionScopeActive: (scope: { channel?: string | null }) =>
      scope.channel === "feature",
    hasAnyActiveSession: (scope?: { channel?: string | null }) =>
      !scope || scope.channel === "feature",
    layers,
  };

  assert(
    evaluateVisibilityExpr({ op: "const", value: true }, context) === true,
    "const true failed",
  );
  assert(
    evaluateVisibilityExpr({ op: "const", value: false }, context) === false,
    "const false failed",
  );
  assert(
    evaluateVisibilityExpr(
      { op: "activeToolIn", ids: ["pooder.kit.image"] },
      context,
    ) === true,
    "activeToolIn true failed",
  );
  assert(
    evaluateVisibilityExpr(
      { op: "activeToolIn", ids: ["pooder.kit.white-ink"] },
      context,
    ) === false,
    "activeToolIn false failed",
  );
  assert(
    evaluateVisibilityExpr(
      { op: "sessionActive", sessionId: "session.feature" },
      context,
    ) === true,
    "sessionActive true failed",
  );
  assert(
    evaluateVisibilityExpr(
      { op: "sessionActive", sessionId: "session.ruler" },
      context,
    ) === false,
    "sessionActive false failed",
  );
  assert(
    evaluateVisibilityExpr({ op: "anySessionActive" }, context) === true,
    "anySessionActive true failed",
  );
  assert(
    evaluateVisibilityExpr(
      { op: "layerExists", layerId: "ruler-overlay" },
      context,
    ) === true,
    "layerExists true failed",
  );
  assert(
    evaluateVisibilityExpr(
      { op: "layerExists", layerId: "missing-layer" },
      context,
    ) === false,
    "layerExists false failed",
  );

  const comparisons: Array<{
    cmp: ">" | ">=" | "==" | "<" | "<=";
    value: number;
    expected: boolean;
  }> = [
    { cmp: ">", value: 1, expected: true },
    { cmp: ">=", value: 2, expected: true },
    { cmp: "==", value: 2, expected: true },
    { cmp: "<", value: 2, expected: false },
    { cmp: "<=", value: 1, expected: false },
  ];
  comparisons.forEach((entry) => {
    assert(
      evaluateVisibilityExpr(
        {
          op: "layerObjectCount",
          layerId: "ruler-overlay",
          cmp: entry.cmp,
          value: entry.value,
        },
        context,
      ) === entry.expected,
      `layerObjectCount ${entry.cmp} failed`,
    );
  });

  assert(
    evaluateVisibilityExpr(
      {
        op: "not",
        expr: { op: "activeToolIn", ids: ["pooder.kit.white-ink"] },
      },
      context,
    ) === true,
    "not failed",
  );
  assert(
    evaluateVisibilityExpr(
      {
        op: "all",
        exprs: [
          { op: "layerExists", layerId: "ruler-overlay" },
          { op: "sessionScopeActive", scope: { channel: "feature" } },
        ],
      },
      context,
    ) === true,
    "all failed",
  );
  assert(
    evaluateVisibilityExpr(
      {
        op: "any",
        exprs: [
          { op: "layerExists", layerId: "missing-layer" },
          { op: "activeToolIn", ids: ["pooder.kit.image"] },
        ],
      },
      context,
    ) === true,
    "any failed",
  );
}

function testImageViewStateHelper() {
  assert(
    hasAnyImageInViewState(null) === false,
    "null image state should be empty",
  );
  assert(
    hasAnyImageInViewState({
      slots: [],
      hasAnyImage: false,
      activeSlotId: null,
      focusedSlot: null,
      hasWorkingChanges: false,
      sessionNotice: null,
    }) === false,
    "empty image state should report false",
  );
  assert(
    hasAnyImageInViewState({
      slots: [
        {
          id: "slot-1",
          frame: { left: 0, top: 0, width: 100, height: 100 },
          fit: "cover",
          hasImage: true,
          image: { src: "blob:test", opacity: 1 },
          layerId: "image",
          order: 0,
          visible: true,
        },
      ],
      hasAnyImage: true,
      activeSlotId: "slot-1",
      focusedSlot: null,
      hasWorkingChanges: true,
      sessionNotice: null,
    }) === true,
    "non-empty image state should report true",
  );
}

function testContributionCompatibility() {
  const designExportCommandNames = createDesignExportCommands({} as any).map(
    (entry) => entry.command,
  );
  const whiteInkCommandNames = createWhiteInkCommands({} as any).map(
    (entry) => entry.command,
  );
  const dielineCommandNames = createDielineCommands({} as any, {
    width: 0,
    height: 0,
  }).map((entry) => entry.command);

  const expectedDesignExportCommands = ["exportImage"];
  const expectedWhiteInkCommands = [
    "addWhiteInk",
    "upsertWhiteInk",
    "getWhiteInks",
    "getWhiteInkSettings",
    "setWhiteInkPrintEnabled",
    "setWhiteInkPreviewImageVisible",
    "getWorkingWhiteInks",
    "setWorkingWhiteInk",
    "updateWhiteInk",
    "removeWhiteInk",
    "clearWhiteInks",
    "resetWorkingWhiteInks",
    "completeWhiteInks",
    "setWhiteInkImage",
  ];
  const expectedDielineCommands = ["updateFeaturePosition", "detectEdge"];

  assert(
    JSON.stringify(designExportCommandNames) ===
      JSON.stringify(expectedDesignExportCommands),
    `design export command set changed: ${JSON.stringify(designExportCommandNames)}`,
  );
  assert(
    JSON.stringify(whiteInkCommandNames) ===
      JSON.stringify(expectedWhiteInkCommands),
    `white-ink command set changed: ${JSON.stringify(whiteInkCommandNames)}`,
  );
  assert(
    JSON.stringify(dielineCommandNames) ===
      JSON.stringify(expectedDielineCommands),
    `dieline command set changed: ${JSON.stringify(dielineCommandNames)}`,
  );

  const whiteInkConfigKeys = createWhiteInkConfigurations().map(
    (entry) => entry.id,
  );
  const dielineConfigKeys = createDielineConfigurations({
    shape: "rect",
    radius: 0,
    shapeStyle: {},
    showBleedLines: true,
    mainLine: { width: 1, color: "#000", dashLength: 1, style: "solid" },
    offsetLine: { width: 1, color: "#000", dashLength: 1, style: "solid" },
    insideColor: "#000",
    features: [],
  }).map((entry) => entry.id);

  const expectedWhiteInkConfigKeys = [
    "whiteInk.items",
    "whiteInk.printWithWhiteInk",
    "whiteInk.previewImageVisible",
    "whiteInk.debug",
  ];
  const expectedDielineConfigKeys = [
    "dieline.shape",
    "dieline.radius",
    "dieline.shapeStyle",
    "dieline.showBleedLines",
    "dieline.strokeWidth",
    "dieline.strokeColor",
    "dieline.dashLength",
    "dieline.style",
    "dieline.offsetStrokeWidth",
    "dieline.offsetStrokeColor",
    "dieline.offsetDashLength",
    "dieline.offsetStyle",
    "dieline.insideColor",
    "dieline.features",
  ];

  assert(
    JSON.stringify(whiteInkConfigKeys) ===
      JSON.stringify(expectedWhiteInkConfigKeys),
    `white-ink config keys changed: ${JSON.stringify(whiteInkConfigKeys)}`,
  );
  assert(
    JSON.stringify(dielineConfigKeys) ===
      JSON.stringify(expectedDielineConfigKeys),
    `dieline config keys changed: ${JSON.stringify(dielineConfigKeys)}`,
  );
}

function testKitCapabilityContractDefinitionsAndNormalization() {
  assertEqual(
    normalizeImagePlacementLayerId(" app.image ", "legacy.image"),
    "app.image",
    "image placement layer id should trim caller input",
  );
  assertEqual(
    normalizeImagePlacementLayerId("", "legacy.image"),
    "legacy.image",
    "image placement layer id should fall back",
  );
  assertEqual(
    normalizeDielineGeometryLayerId(" app.dieline ", "legacy.dieline"),
    "app.dieline",
    "dieline geometry layer id should trim caller input",
  );
  assertDeepEqual(
    normalizeDesignExportLayerIds(
      [" app.artwork ", "", "app.artwork", "app.white"],
      ["legacy.image"],
    ),
    ["app.artwork", "app.white"],
    "design export should trim, filter, and dedupe caller layer ids",
  );
  assertDeepEqual(
    normalizeDesignExportLayerIds(undefined, ["legacy.image"]),
    ["legacy.image"],
    "design export should use fallback layer ids",
  );
  assertEqual(
    normalizeWhiteInkConfigNamespace(" storefrontWhiteInk "),
    "storefrontWhiteInk",
    "white ink config namespace should trim caller input",
  );
  assertEqual(
    getWhiteInkConfigKey("storefrontWhiteInk", "print.enabled"),
    "storefrontWhiteInk.print.enabled",
    "white ink config keys should stay caller-namespaced",
  );
  assertEqual(
    normalizeWhiteInkLayerId(" app.white ", "legacy.white"),
    "app.white",
    "white ink layer id should trim caller input",
  );
  assertEqual(
    normalizeRulerConfigNamespace(" storefrontRuler "),
    "storefrontRuler",
    "ruler config namespace should trim caller input",
  );
  assertEqual(
    getRulerConfigKey("storefrontRuler", "thickness"),
    "storefrontRuler.thickness",
    "ruler config keys should stay caller-namespaced",
  );
  assertEqual(
    normalizeRulerLayerId(" app.ruler ", "legacy.ruler"),
    "app.ruler",
    "ruler layer id should trim caller input",
  );

  const definitions = [
    createImagePlacementCapabilityDefinition({} as ImagePlacementCapabilityApi, {
      capabilityId: "custom.image",
    }),
    createDielineGeometryCapabilityDefinition(
      {} as DielineGeometryCapabilityApi,
      { capabilityId: "custom.dieline" },
    ),
    createDesignExportCapabilityDefinition({} as DesignExportCapabilityApi, {
      capabilityId: "custom.export",
    }),
    createWhiteInkCapabilityDefinition({} as WhiteInkCapabilityApi, {
      capabilityId: "custom.white-ink",
    }),
    createRulerCapabilityDefinition({} as RulerCapabilityApi, {
      capabilityId: "custom.ruler",
    }),
    createFeatureCapabilityDefinition({} as FeatureCapabilityApi, {
      capabilityId: "custom.feature",
    }),
  ];

  assertDeepEqual(
    definitions.map((definition) => definition.id),
    [
      "custom.image",
      "custom.dieline",
      "custom.export",
      "custom.white-ink",
      "custom.ruler",
      "custom.feature",
    ],
    "capability definitions should accept caller-provided capability ids",
  );
  for (const definition of definitions) {
    assert(
      definition.metadata?.tags?.includes("kit"),
      `${definition.id} should be tagged as a kit capability`,
    );
    assert(
      (definition.commands || []).length > 0,
      `${definition.id} should document command bridge references`,
    );
  }
}

async function testDesignExportCapabilityExtension() {
  const runtime = new Pooder();
  const commandService =
    runtime.services.getOrThrow<CommandService>(COMMAND_SERVICE);
  const exportService = new FakeSceneExportService();

  exportService.error = null;
  exportService.response = {
    crop: { left: 1, top: 2, width: 30, height: 20 },
    format: "png",
    height: 60,
    multiplier: 3,
    sourceElementIds: ["element-1"],
    sourceLayerIds: ["app.design"],
    url: "data:image/png;base64,capability",
    width: 90,
  };

  runtime.extensions.register(
    new DesignExportCapabilityExtension({
      layers: {
        sourceLayerIds: ["app.design"],
      },
    }),
  );
  runtime.services.register(exportService as any, SCENE_EXPORT_SERVICE);
  await runtime.extensions.flushActivation();

  assertEqual(
    runtime.extensions.getState(DESIGN_EXPORT_CAPABILITY_ID)?.state,
    "active",
    "design export capability should activate",
  );
  assertEqual(
    commandService.getCommand("exportImage"),
    undefined,
    "design export capability should not register legacy exportImage",
  );

  const facade = runtime.capabilities.get<DesignExportCapabilityApi>(
    DESIGN_EXPORT_CAPABILITY_ID,
  );
  if (!facade) {
    throw new Error("design export capability facade should be registered");
  }

  const result = await facade.exportImage({
    crop: {
      type: "sceneRect",
      rect: { left: 1, top: 2, width: 30, height: 20 },
    },
    format: "png",
    multiplier: 3,
    sourceElementIds: ["element-1"],
  });
  const lastCall = exportService.calls[exportService.calls.length - 1];
  assertDeepEqual(
    lastCall.sourceLayerIds,
    ["app.design"],
    "design export capability should use caller default source layers",
  );
  assertDeepEqual(
    lastCall.sourceElementIds,
    ["element-1"],
    "design export capability should delegate source element ids",
  );
  assertDeepEqual(
    lastCall.crop,
    { type: "sceneRect", rect: { left: 1, top: 2, width: 30, height: 20 } },
    "design export capability should delegate explicit scene crop",
  );
  assertEqual(
    result.url,
    "data:image/png;base64,capability",
    "design export capability should map platform export url",
  );
  assertDeepEqual(
    result.sourceElementIds,
    ["element-1"],
    "design export capability should map platform source elements",
  );
  assertDeepEqual(
    result.crop,
    { left: 1, top: 2, width: 30, height: 20 },
    "design export capability should map platform crop",
  );

  await facade.exportImage();
  assertDeepEqual(
    exportService.calls[exportService.calls.length - 1]?.crop,
    { type: "frame", frame: "cut" },
    "design export capability should default to cut frame crop",
  );

  await runtime.dispose();
}

async function testKitCapabilityFactoriesDoNotRegisterTools() {
  const runtime = new Pooder();
  runtime.services.register(new FakeCanvasService() as any, CANVAS_SERVICE);
  runtime.services
    .getOrThrow<CommandService>(COMMAND_SERVICE)
    .registerCommand("getSceneGeometry", () => ({
      x: 50,
      y: 40,
      width: 100,
      height: 80,
      radius: 0,
      scale: 1,
      shape: "rect",
      shapeStyle: { fitMode: "stretch" },
    }));
  runtime.extensions.register(createImagePlacementCapability());
  runtime.extensions.register(createWhiteInkCapability());
  runtime.extensions.register(createDielineGeometryCapability());
  runtime.extensions.register(createClipCapability());
  runtime.extensions.register(createFeatureCapability());
  runtime.extensions.register(createConfigurableVisualCapability());
  await runtime.extensions.flushActivation();

  assert(
    runtime.extensions.getState(IMAGE_PLACEMENT_CAPABILITY_ID)?.state ===
      "active",
    "image placement capability factory should activate",
  );
  assert(
    runtime.extensions.getState(WHITE_INK_CAPABILITY_ID)?.state === "active",
    "white ink capability factory should activate",
  );
  assert(
    runtime.extensions.getState(DIELINE_GEOMETRY_CAPABILITY_ID)?.state ===
      "active",
    "dieline geometry capability factory should activate",
  );
  assert(
    runtime.extensions.getState(CLIP_CAPABILITY_ID)?.state === "active",
    "clip capability factory should activate",
  );
  assert(
    runtime.extensions.getState(FEATURE_CAPABILITY_ID)?.state === "active",
    "feature capability factory should activate",
  );
  assert(
    runtime.extensions.getState(CONFIGURABLE_VISUAL_CAPABILITY_ID)?.state ===
      "active",
    "configurable visual capability factory should activate",
  );
  const toolRegistry = runtime.services.getOrThrow<ToolRegistryService>(
    "ToolRegistryService",
  );
  for (const toolId of [
    IMAGE_PLACEMENT_CAPABILITY_ID,
    WHITE_INK_CAPABILITY_ID,
    DIELINE_GEOMETRY_CAPABILITY_ID,
    CLIP_CAPABILITY_ID,
    FEATURE_CAPABILITY_ID,
    CONFIGURABLE_VISUAL_CAPABILITY_ID,
  ]) {
    assert(
      !toolRegistry.hasTool(toolId),
      `${toolId} should not register a kit-owned product tool`,
    );
  }

  await runtime.dispose();
}

function testCreateKitCapabilitiesForDocument() {
  const capabilities = createKitCapabilitiesForDocument({
    version: 3,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        layers: [
          {
            id: "artwork",
            effects: [
              { type: "background" },
              { type: "dieline" },
              { type: "feature" },
              { type: "dieline" },
            ],
            objects: [
              {
                id: "slot",
                type: "image",
                frame: { x: 0, y: 0, width: 20, height: 20 },
                effects: [
                  { type: "image-placement", payload: { accepts: ["image"] } },
                  { type: "clip", payload: { source: { type: "dieline" } } },
                  { type: "configurable-visual" },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  assertDeepEqual(
    capabilities.map((item) => item.id).sort(),
    [
      DIELINE_GEOMETRY_CAPABILITY_ID,
      CLIP_CAPABILITY_ID,
      FEATURE_CAPABILITY_ID,
      CONFIGURABLE_VISUAL_CAPABILITY_ID,
      IMAGE_PLACEMENT_CAPABILITY_ID,
    ].sort(),
    "document helper should create supported kit capabilities once and ignore background effects",
  );
}

function testCreateKitCapabilitiesForDocumentInfersDielineLayers() {
  const capabilities = createKitCapabilitiesForDocument({
    version: 3,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        layers: [
          {
            id: "front.image.user",
            objects: [
              {
                id: "front.image.user",
                type: "image",
                frame: { x: 0, y: 0, width: 100, height: 100 },
                effects: [{ type: "image-placement" }],
              },
            ],
          },
          {
            id: "front.dieline-overlay",
            effects: [{ type: "dieline", payload: { shape: "circle" } }],
          },
        ],
      },
    ],
  });
  const dieline = capabilities.find(
    (item) => item.id === DIELINE_GEOMETRY_CAPABILITY_ID,
  ) as any;

  assert(dieline, "document helper should create the dieline capability");
  assertEqual(
    dieline.targetLayerId,
    "dieline-overlay",
    "document helper should leave dieline target layer ownership to the capability",
  );
  assertDeepEqual(
    dieline.imageClipLayerIds,
    ["image.user"],
    "document helper should not infer document clip layers from dieline",
  );
}

function createFakeCapabilityExtension(
  facades: Record<string, unknown>,
): ExtensionDefinition {
  return createCommandExtension("fake.document.capabilities", {
    capabilities: Object.entries(facades).map(([id, facade]) => ({
      id,
      facade,
    })),
  });
}

async function testApplyKitEditorDocument() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  runtime.services.register(canvasService as any, CANVAS_SERVICE);
  const document = {
    version: 3,
    config: TEST_DOCUMENT_CONFIG,
    assets: [
      { id: "template", type: "image", src: "/template.png" },
      { id: "photo", type: "image", src: "/photo.png" },
    ],
    surfaces: [
      {
        id: "front",
        title: "Front",
        size: { width: 100, height: 120, unit: "mm" },
        layers: [
          {
            id: "front-template",
            role: "background",
            objects: [
              {
                id: "front-bg",
                type: "rect",
                frame: { x: 0, y: 0, width: 100, height: 120 },
                style: { fill: "#eeeeee" },
                locked: true,
              },
              {
                id: "front-template-image",
                type: "image",
                src: "/template.png",
                frame: { x: 0, y: 0, width: 100, height: 120 },
                effects: [
                  {
                    type: "configurable-visual",
                    payload: { key: "customization.template.artwork" },
                  },
                ],
              },
            ],
          },
          {
            id: "front-artwork",
            role: "content",
            effects: [
              { type: "dieline", payload: { shape: "circle" } },
              {
                type: "feature",
                payload: { features: [{ id: "hole", x: 0.5, y: 0.1 }] },
              },
            ],
            objects: [
              {
                id: "front-slot",
                type: "image",
                src: "/photo.png",
                metadata: {
                  imagePlacement: {
                    source: { src: "/photo.png" },
                    transform: {
                      left: 0.6,
                      top: 0.4,
                      scale: 1.3,
                      angle: 22,
                      opacity: 1,
                    },
                    derived: {
                      src: "data:image/png;base64,cropped-front-slot",
                      width: 400,
                      height: 320,
                    },
                  },
                },
                effects: [
                  { type: "image-placement", payload: { accepts: ["image"] } },
                  { type: "clip", payload: { source: { type: "path", pathData: "M0 0L1 0L1 1Z" } } },
                ],
                frame: { x: 10, y: 20, width: 30, height: 40 },
              },
              {
                id: "white-source",
                type: "image",
                src: "/photo.png",
                effects: [{ type: "white-ink", payload: { src: "/white.png" } }],
                frame: { x: 0, y: 0, width: 10, height: 10 },
              },
            ],
          },
        ],
      },
      {
        id: "back",
        size: { width: 100, height: 120, unit: "mm" },
        layers: [{ id: "back-artwork" }],
      },
    ],
  };
  runtime.extensions.registerMany(createKitCapabilitiesForDocument(document));
  await runtime.extensions.flushActivation();

  const result = await applyKitEditorDocument(runtime, document);

  assert(
    result.ok,
    `document apply should succeed (${JSON.stringify(result.diagnostics)})`,
  );
  assertDeepEqual(
    result.appliedSurfaceIds,
    ["front"],
    "apply result should report surfaces represented by RenderIntent drafts",
  );
  const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
  assertEqual(
    scene.getLayer("front-artwork"),
    undefined,
    "document apply should not write SceneService layers",
  );
  assertEqual(
    scene.getElement("front-slot"),
    undefined,
    "document apply should not write SceneService elements",
  );
  const renderGraph = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph();
  const backgroundGraphNode = renderGraph.layers
    .find((layer) => layer.id === "front-template")
    ?.nodes.find((node) => node.id === "front-bg");
  assertEqual(
    backgroundGraphNode?.props.fill,
    "#eeeeee",
    "document apply should render background layers through ordinary objects",
  );
  const committedGraphNode = renderGraph.layers
    .find((layer) => layer.id === "front-artwork")
    ?.nodes.find((node) => node.id === "image:front-slot");
  assertDeepEqual(
    committedGraphNode?.transform,
    {
      left: 25,
      top: 40,
      originX: "center",
      originY: "center",
      scaleX: 0.075,
      scaleY: 0.125,
    },
    "document apply should compile committed image replacement to the slot-centered graph transform",
  );
  assertEqual(
    committedGraphNode?.props.selectable,
    false,
    "document apply should make committed images non-selectable through graph props",
  );
  assertEqual(
    committedGraphNode?.props.evented,
    true,
    "document apply should keep committed images clickable through graph props",
  );
  assertDeepEqual(
    {
      slotId: committedGraphNode?.data.slotId,
      source: committedGraphNode?.data.source,
      type: committedGraphNode?.data.type,
    },
    {
      slotId: "front-slot",
      source: "committed",
      type: "image-placement-image",
    },
    "document apply should expose committed image interaction data generically",
  );
  assertDeepEqual(
    committedGraphNode?.data.clip,
    { enabled: true, source: { type: "path", pathData: "M0 0L1 0L1 1Z", space: "scene" } },
    "clip effect should write normalized clip metadata into RenderIntent data",
  );
  const clipEffect = committedGraphNode?.effects.find(
    (effect) => effect.id === "clip.front-slot",
  );
  assertDeepEqual(
    clipEffect?.targetLayerIds,
    ["front-artwork"],
    "clip render intent should resolve the target layer from effect context",
  );
  assertDeepEqual(
    clipEffect?.targetSubjectIds,
    ["front-slot"],
    "clip render intent should resolve object-level target ids",
  );
  assertEqual(
    (renderGraph.layers
      .flatMap((layer) => layer.nodes)
      .find((node) => node.data.type === "feature")?.data.feature as any)?.id,
    "hole",
    "feature effect should compile to declarative render graph data",
  );
  assertEqual(
    runtime.config.get("scene.previewBounds"),
    TEST_DOCUMENT_CONFIG["scene.previewBounds"],
    "document apply should import document config",
  );
  assert(
    renderGraph.layers.flatMap((layer) => layer.nodes).some(
      (node) => node.data.type === "white-ink" && node.visual?.src === "/white.png",
    ),
    "white ink effect should compile to a RenderIntent graph node",
  );

  await runtime.dispose();
}

async function testApplyKitEditorDocumentObjectInteraction() {
  const runtime = new Pooder();
  const result = await applyKitEditorDocument(runtime, {
    version: 3,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        layers: [
          {
            id: "artwork",
            objects: [
              {
                id: "legacy-locked",
                type: "rect",
                locked: true,
                frame: { x: 0, y: 0, width: 20, height: 20 },
              },
              {
                id: "explicit-interaction",
                type: "rect",
                locked: true,
                interaction: {
                  selectable: true,
                  evented: true,
                  locked: false,
                },
                frame: { x: 25, y: 0, width: 20, height: 20 },
              },
              {
                id: "interaction-locked",
                type: "rect",
                locked: false,
                interaction: { locked: true },
                frame: { x: 50, y: 0, width: 20, height: 20 },
              },
            ],
          },
        ],
      },
    ],
  });

  assert(
    result.ok,
    `document interaction apply should succeed (${JSON.stringify(result.diagnostics)})`,
  );
  assertDeepEqual(
    result.document.surfaces[0].layers[0].objects?.[1]?.interaction,
    { selectable: true, evented: true, locked: false },
    "document interaction should remain on the normalized document",
  );

  const renderGraph = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph();
  const nodes = renderGraph.layers.flatMap((layer) => layer.nodes);
  const legacyLockedNode = nodes.find((node) => node.id === "legacy-locked");
  const explicitInteractionNode = nodes.find(
    (node) => node.id === "explicit-interaction",
  );
  const interactionLockedNode = nodes.find(
    (node) => node.id === "interaction-locked",
  );

  assertEqual(
    legacyLockedNode?.props.selectable,
    false,
    "missing interaction should keep legacy locked selectable behavior",
  );
  assertEqual(
    legacyLockedNode?.props.evented,
    false,
    "missing interaction should keep legacy locked evented behavior",
  );
  assertEqual(
    legacyLockedNode?.data.locked,
    true,
    "legacy locked should remain render graph locked data",
  );
  assertEqual(
    explicitInteractionNode?.props.selectable,
    true,
    "interaction selectable should explicitly override object locked",
  );
  assertEqual(
    explicitInteractionNode?.props.evented,
    true,
    "interaction evented should explicitly override object locked",
  );
  assertEqual(
    explicitInteractionNode?.data.locked,
    false,
    "interaction locked should override object locked in render graph data",
  );
  assertEqual(
    interactionLockedNode?.props.selectable,
    false,
    "interaction locked should drive selectable default",
  );
  assertEqual(
    interactionLockedNode?.props.evented,
    false,
    "interaction locked should drive evented default",
  );
  assertEqual(
    interactionLockedNode?.data.locked,
    true,
    "interaction locked should enter render graph locked data",
  );

  await runtime.dispose();
}

async function testApplyKitEditorDocumentMissingCapabilities() {
  const strictRuntime = new Pooder();
  const strictResult = await applyKitEditorDocument(strictRuntime, {
    version: 3,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        layers: [
          {
            id: "front-artwork",
            effects: [{ type: "dieline", require: "strict" }],
          },
        ],
      },
    ],
  });
  assert(!strictResult.ok, "strict missing capability should fail");
  assert(
    strictResult.diagnostics.some(
      (item) => item.code === "capability-required",
    ),
    "strict missing capability should return error diagnostic",
  );
  assert(
    !strictRuntime.services
      .getOrThrow<SceneService>(SCENE_SERVICE)
      .getLayer("front-artwork"),
    "strict missing capability should not write scene",
  );
  await strictRuntime.dispose();

  const optionalRuntime = new Pooder();
  const optionalResult = await applyKitEditorDocument(optionalRuntime, {
    version: 3,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        layers: [
          {
            id: "front-artwork",
            effects: [
              { type: "configurable-visual", require: "warn" },
              { type: "white-ink", require: "ignore" },
            ],
          },
        ],
      },
    ],
  });
  assert(optionalResult.ok, "optional missing capabilities should apply document");
  assert(
    optionalResult.diagnostics.some(
      (item) =>
        item.code === "capability-optional-missing" &&
        item.capabilityId === CONFIGURABLE_VISUAL_CAPABILITY_ID,
    ),
    "warn missing capability should return warning diagnostic",
  );
  assert(
    !optionalResult.diagnostics.some(
      (item) => item.capabilityId === WHITE_INK_CAPABILITY_ID,
    ),
    "ignore missing capability should not diagnose",
  );
  assert(
    !optionalRuntime.services
      .getOrThrow<SceneService>(SCENE_SERVICE)
      .getLayer("front-artwork"),
    "optional missing capabilities should not write scene",
  );
  await optionalRuntime.dispose();

  const missingCompilerRuntime = new Pooder();
  missingCompilerRuntime.extensions.register(
    createFakeCapabilityExtension({
      [CONFIGURABLE_VISUAL_CAPABILITY_ID]: {
        getConfig: () => ({}),
        refresh: () => {},
      } satisfies ConfigurableVisualCapabilityApi,
    }),
  );
  await missingCompilerRuntime.extensions.flushActivation();
  const missingCompilerResult = await applyKitEditorDocument(
    missingCompilerRuntime,
    {
      version: 3,
      config: TEST_DOCUMENT_CONFIG,
      surfaces: [
        {
          id: "front",
          size: { width: 1, height: 1, unit: "px" },
          layers: [
            {
              id: "front-artwork",
              objects: [
                {
                  id: "template",
                  type: "image",
                  src: "/template.png",
                  frame: { x: 0, y: 0, width: 1, height: 1 },
                  effects: [{ type: "configurable-visual", require: "strict" }],
                },
              ],
            },
          ],
        },
      ],
    },
  );
  assert(!missingCompilerResult.ok, "strict missing compiler should fail");
  assert(
    missingCompilerResult.diagnostics.some(
      (item) =>
        item.code === "compiler-missing" &&
        item.capabilityId === CONFIGURABLE_VISUAL_CAPABILITY_ID,
    ),
    "strict missing compiler should return compiler diagnostic",
  );
  await missingCompilerRuntime.dispose();

  const throwRuntime = new Pooder();
  throwRuntime.extensions.register({
    id: "test.throwing-render-compiler",
    contribute: () => ({
      capabilities: [{ id: CONFIGURABLE_VISUAL_CAPABILITY_ID, facade: {} }],
      renderIntentCompilers: [
        {
          capabilityId: CONFIGURABLE_VISUAL_CAPABILITY_ID,
          effectType: "configurable-visual",
          compile: () => {
            throw new Error("boom");
          },
        },
      ],
    }),
    activate() {},
  });
  await throwRuntime.extensions.flushActivation();
  const throwResult = await applyKitEditorDocument(throwRuntime, {
    version: 3,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        layers: [
          {
            id: "front-artwork",
            objects: [
              {
                id: "template",
                type: "image",
                src: "/template.png",
                frame: { x: 0, y: 0, width: 1, height: 1 },
                effects: [{ type: "configurable-visual", require: "warn" }],
              },
            ],
          },
        ],
      },
    ],
  });
  assert(throwResult.ok, "warn compiler failures should not fail apply");
  assert(
    throwResult.diagnostics.some(
      (item) =>
        item.code === "effect-compile-failed" &&
        item.severity === "warning",
    ),
    "warn compiler failures should return warning diagnostics",
  );
  await throwRuntime.dispose();
}

async function testImagePlacementCapabilityExtension() {
  const runtime = new Pooder();
  const facade: ImagePlacementCapabilityApi = {
    beginSession: async () => ({ ok: true }),
    requestUpload: async () => ({ ok: true }),
    setImageSource: async () => ({ ok: true }),
    setImageTransform: async () => ({ ok: true }),
    applyImageOperation: async () => ({ ok: true }),
    clearImage: async () => ({ ok: true }),
    completeSession: async () => ({ ok: true }),
    exportPlacementImage: async () => ({
      format: "png",
      height: 1,
      imageIds: [],
      multiplier: 1,
      slotIds: [],
      url: "data:image/png;base64,test",
      width: 1,
    }),
    focusSlot: (id) => ({ ok: true, id }),
    getViewState: () => ({
      activeSlotId: null,
      focusedSlot: null,
      hasAnyImage: false,
      hasWorkingChanges: false,
      sessionNotice: null,
      slots: [],
    }),
    resetSession: () => {},
    validatePlacement: async () => ({ ok: true }),
    validateSession: async () => ({ ok: true }),
  };
  runtime.extensions.register({
    id: "test.image-placement",
    activate() {},
    contribute() {
      return {
        capabilities: [
          createImagePlacementCapabilityDefinition(facade, {
            layers: {
              imageLayerId: "app.image",
              overlayLayerId: "app.image.overlay",
            },
          }),
        ],
      };
    },
  });

  await runtime.extensions.flushActivation();

  const registeredFacade =
    runtime.capabilities.get<ImagePlacementCapabilityApi>(
      IMAGE_PLACEMENT_CAPABILITY_ID,
    );
  if (!registeredFacade) {
    throw new Error("image placement capability facade should be registered");
  }
  assertDeepEqual(
    registeredFacade.getViewState().slots,
    [],
    "image placement capability facade should expose image state",
  );

  const toolRegistry = runtime.services.getOrThrow<ToolRegistryService>(
    "ToolRegistryService",
  );
  assert(
    !toolRegistry.hasTool(IMAGE_PLACEMENT_CAPABILITY_ID),
    "image placement capability registration should not require a tool",
  );
  await runtime.dispose();
}

async function testImagePlacementSessionUsesEditableWorkingObject() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  const exportService = new FakeSceneExportService();
  exportService.error = null;
  exportService.response = {
    crop: { left: 100, top: 120, width: 200, height: 160 },
    format: "png",
    height: 320,
    multiplier: 2,
    sourceElementIds: ["slot"],
    sourceLayerIds: ["image.user"],
    url: "data:image/png;base64,cropped-slot",
    width: 400,
  };
  runtime.services.register(canvasService as any, CANVAS_SERVICE);
  runtime.services.register(exportService as any, SCENE_EXPORT_SERVICE);

  const rectByCenter = (
    centerX: number,
    centerY: number,
    width: number,
    height: number,
  ): SceneRect => ({
    centerX,
    centerY,
    height,
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
  });
  const layout: SceneLayoutSnapshot = {
    bleedRect: rectByCenter(400, 300, 360, 360),
    canvasHeight: 600,
    canvasWidth: 800,
    cutHeightMm: 120,
    cutRect: rectByCenter(400, 300, 360, 360),
    cutWidthMm: 120,
    scale: 3,
    trimHeightMm: 100,
    trimRect: rectByCenter(400, 300, 300, 300),
    trimWidthMm: 100,
  };
  runtime.services.register(
    {
      getLayout: () => layout,
      getGeometry: () => ({
        height: layout.trimRect.height,
        offset: (layout.cutRect.width - layout.trimRect.width) / 2,
        radius: 0,
        scale: layout.scale,
        shape: "circle",
        shapeStyle: { fitMode: "stretch" },
        unit: "px",
        width: layout.trimRect.width,
        x: layout.trimRect.centerX,
        y: layout.trimRect.centerY,
      }),
    } as any,
    SCENE_LAYOUT_SERVICE,
  );

  const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
  scene.addLayer({ id: "artwork" });
  scene.addElement({
    id: "slot",
    layerId: "artwork",
    type: "rect",
    width: 200,
    height: 160,
    data: {
      imagePlacement: {
        enabled: true,
        frame: { x: 100, y: 120, width: 200, height: 160 },
        image: {
          src: "/photo.png",
          metadata: { width: 100, height: 80 },
          left: 0.5,
          top: 0.5,
          scale: 1,
          angle: 0,
        },
        sessionProjections: [
          {
            id: "business-helper",
            sourceLayerIds: ["front.business-helper"],
            placement: "above",
            interactive: false,
          },
        ],
      },
    },
  });
  const renderIntentService =
    runtime.services.getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE);
  renderIntentService.setDocumentIntents([
    {
      id: "front-business-helper",
      subject: {
        kind: "object",
        surfaceId: "legacy",
        layerId: "front.business-helper",
        objectId: "front-business-helper",
      },
      visual: { type: "rect" },
      ordering: {
        layerId: "front.business-helper",
        stack: 500,
        layerOrder: 0,
      },
      props: { width: 10, height: 10 },
    },
  ]);
  const imageExtension = createImagePlacementCapability();
  runtime.extensions.register(imageExtension);
  await runtime.extensions.flushActivation();

  const facade = runtime.capabilities.getOrThrow<ImagePlacementCapabilityApi>(
    IMAGE_PLACEMENT_CAPABILITY_ID,
  );
  await facade.beginSession("slot");
  const renderGraph = renderIntentService.getGraph();
  const imageLayer = renderGraph.layers.find((layer) => layer.id === "artwork");
  const imageSessionLayer = renderGraph.layers.find(
    (layer) => layer.id === "image.session.image",
  );
  const sessionLayer = renderGraph.layers.find(
    (layer) => layer.id === "image.session.controls",
  );
  const sessionOverlayLayer = renderGraph.layers.find(
    (layer) => layer.id === "image.session.overlay",
  );
  const committedImageNode = imageLayer?.nodes.find(
    (node: any) => node.id === "image:slot",
  );
  assertDeepEqual(
    committedImageNode?.visibility,
    imagePlacementCommittedVisibility("slot"),
    "committed image object should carry graph visibility while its working session is active",
  );
  assertEqual(
    imageSessionLayer?.stack,
    800,
    "image session working object should render above business document layers",
  );
  const sessionImage = imageSessionLayer?.nodes.find(
    (node: any) => node.id === "session-image:image-placement:slot",
  );
  assert(sessionImage, "image session should render a separate working object");
  const sessionImageNode = sessionImage!;
  assertEqual(
    sessionImageNode.props.selectable,
    true,
    "session image should be selectable",
  );
  assertEqual(
    sessionImageNode.props.lockUniScaling,
    true,
    "session image should keep aspect ratio while scaling",
  );
  assertEqual(
    sessionImageNode.props.lockRotation,
    false,
    "session image should support rotation",
  );
  assert(
    sessionLayer?.nodes.some((node: any) => node.id === "image.cropShapeHatch"),
    "image session should render dieline hatch overlay",
  );
  assert(
    sessionOverlayLayer?.nodes.some((node) =>
      node.id.startsWith("projection:pooder.kit.image-placement.runtime.projection.above.slot.business-helper"),
    ),
    "image session should project declared business helpers above the working image",
  );
  const snapTarget = {
    data: {
      slotId: "slot",
      source: "working",
      type: "image-placement-image",
    },
    left: 103,
    top: 180,
    width: 50,
    height: 50,
    scaleX: 1,
    scaleY: 1,
    getBoundingRect: () => ({ left: 103, top: 180, width: 50, height: 50 }),
    set(values: Record<string, number>) {
      Object.assign(this, values);
    },
    setCoords() {},
  };
  (imageExtension as any).applyMoveSnapToTarget(snapTarget);
  assertEqual(
    snapTarget.left,
    100,
    "image session should snap a moving image edge to the slot edge",
  );

  await facade.setImageTransform("slot", {
    angle: 22,
    left: 0.6,
    scale: 1.3,
    top: 0.4,
  });
  await facade.completeSession();
  const committedImage = (scene.getElement("slot")?.data as any)?.imagePlacement
    ?.image;
  assertEqual(
    committedImage.src,
    "data:image/png;base64,cropped-slot",
    "completed session should write the cropped production image to the slot",
  );
  assertEqual(
    committedImage.angle,
    0,
    "cropped production image should reset session rotation in the slot",
  );
  assertEqual(
    committedImage.scale,
    1,
    "cropped production image should reset session scale in the slot",
  );
  assertEqual(
    committedImage.left,
    0.5,
    "cropped production image should be centered in the slot",
  );
  assertEqual(
    committedImage.metadata?.source?.src,
    "/photo.png",
    "completed session should keep the original source image in metadata",
  );
  assertDeepEqual(
    committedImage.metadata?.transform,
    {
      left: 0.6,
      top: 0.4,
      scale: 1.3,
      angle: 22,
      opacity: 1,
    },
    "completed session should keep the editable source transform in metadata",
  );
  assertDeepEqual(
    exportService.calls[0]?.crop,
    { type: "sceneRect", rect: { left: 100, top: 120, width: 200, height: 160 } },
    "complete session should crop the working image by the slot frame",
  );
  assertDeepEqual(
    exportService.calls[0]?.sourceElementIds,
    ["session-image:image-placement:slot"],
    "complete session should export the active working slot image",
  );
  assertDeepEqual(
    exportService.calls[0]?.sourceLayerIds,
    ["image.session.image"],
    "complete session should export the working image from the session pass",
  );

  const graph = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph();
  const artworkGraphLayer = graph.layers.find((layer) => layer.id === "artwork");
  const committedGraphNode = artworkGraphLayer?.nodes.find(
    (node) => node.id === "image:slot",
  );
  assertEqual(
    artworkGraphLayer?.id,
    "artwork",
    "completed slot should render through the graph anchored business layer",
  );
  assert(
    committedGraphNode?.visual?.src === "data:image/png;base64,cropped-slot",
    "completed slot should write the processed production image node",
  );
  assertDeepEqual(
    committedGraphNode?.transform,
    {
      left: 200,
      top: 200,
      originX: "center",
      originY: "center",
      scaleX: 0.5,
      scaleY: 0.5,
    },
    "completed slot should compile the committed bitmap into a slot-centered graph transform",
  );
  assertEqual(
    committedGraphNode?.props.selectable,
    false,
    "completed slot committed image should be non-selectable through graph props",
  );
  assertEqual(
    committedGraphNode?.props.evented,
    true,
    "completed slot committed image should remain clickable through graph props",
  );
  assertDeepEqual(
    {
      slotId: committedGraphNode?.data.slotId,
      source: committedGraphNode?.data.source,
      type: committedGraphNode?.data.type,
    },
    {
      slotId: "slot",
      source: "committed",
      type: "image-placement-image",
    },
    "completed slot should expose generic committed image interaction data",
  );
  assertDeepEqual(
    committedGraphNode?.visibility,
    imagePlacementCommittedVisibility("slot"),
    "completed slot should declaratively hide the graph-backed committed image while editing",
  );
  assert(
    !graph.layers
      .find((layer) => layer.id === "image.session.image")
      ?.nodes.some((node: any) => node.id === "session-image:image-placement:slot"),
    "completed slot should clear the framework session image layer",
  );
  await facade.exportPlacementImage({ slotIds: ["slot"] });
  assertDeepEqual(
    exportService.calls[exportService.calls.length - 1]?.sourceLayerIds,
    ["artwork"],
    "placement image export should use the committed slot business layer",
  );
  assertDeepEqual(
    exportService.calls[exportService.calls.length - 1]?.sourceElementIds,
    ["image:slot"],
    "placement image export should target the committed production image object",
  );

  await facade.beginSession("slot");
  const reopenedState = facade.getViewState();
  assertEqual(
    reopenedState.focusedSlot?.image?.src,
    "/photo.png",
    "reopened image session should edit from the original source image",
  );
  assertEqual(
    reopenedState.focusedSlot?.image?.scale,
    1.3,
    "reopened image session should restore the source transform",
  );
  facade.resetSession("slot");
  const resetGraph = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph();
  const resetGraphNode = resetGraph.layers
    .find((layer) => layer.id === "artwork")
    ?.nodes.find((node) => node.id === "image:slot");
  assertEqual(
    resetGraphNode?.visual?.src,
    "data:image/png;base64,cropped-slot",
    "resetting a reopened image session should keep the committed production image",
  );
  assertDeepEqual(
    resetGraphNode?.transform,
    {
      left: 200,
      top: 200,
      originX: "center",
      originY: "center",
      scaleX: 0.5,
      scaleY: 0.5,
    },
    "resetting a reopened image session should keep the committed graph transform",
  );
  assertEqual(
    resetGraphNode?.props.selectable,
    false,
    "resetting a reopened image session should keep committed images non-selectable",
  );
  assertEqual(
    resetGraphNode?.props.evented,
    true,
    "resetting a reopened image session should keep committed images clickable",
  );
  assertDeepEqual(
    {
      slotId: resetGraphNode?.data.slotId,
      source: resetGraphNode?.data.source,
      type: resetGraphNode?.data.type,
    },
    {
      slotId: "slot",
      source: "committed",
      type: "image-placement-image",
    },
    "resetting a reopened image session should keep committed click target data",
  );

  await facade.beginSession("slot");
  await facade.setImageSource("slot", {
    src: "/photo.png",
    metadata: { width: 100, height: 80 },
  });
  await facade.setImageTransform("slot", { left: -1 });
  const warnResult = await facade.completeSession("slot");
  assertEqual(
    (warnResult as any).ok,
    true,
    "image placement should default to warn and allow outside-frame completion",
  );

  runtime.config.update("image.session.placementPolicy", "strict");
  await facade.beginSession("slot");
  await facade.setImageSource("slot", {
    src: "/photo.png",
    metadata: { width: 100, height: 80 },
  });
  await facade.setImageTransform("slot", { left: -1 });
  const strictResult = await facade.completeSession("slot");
  assertEqual(
    (strictResult as any).ok,
    false,
    "strict image placement policy should block outside-frame completion",
  );

  await runtime.dispose();
}

async function testImagePlacementCompleteSyncsCanvasTransform() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  const exportService = new FakeSceneExportService();
  exportService.error = null;
  exportService.response = {
    crop: { left: 100, top: 120, width: 200, height: 160 },
    format: "png",
    height: 320,
    multiplier: 2,
    sourceElementIds: ["slot"],
    sourceLayerIds: ["image.user"],
    url: "data:image/png;base64,cropped-slot",
    width: 400,
  };
  let renderedSessionScale = 0;
  runtime.services.register(canvasService as any, CANVAS_SERVICE);
  runtime.services.register(exportService as any, SCENE_EXPORT_SERVICE);

  const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
  scene.addLayer({ id: "artwork" });
  scene.addElement({
    id: "slot",
    layerId: "artwork",
    type: "rect",
    width: 200,
    height: 160,
    data: {
      imagePlacement: {
        enabled: true,
        frame: { x: 100, y: 120, width: 200, height: 160 },
        image: {
          src: "/photo.png",
          metadata: { width: 100, height: 80 },
          left: 0.5,
          top: 0.5,
          scale: 1,
          angle: 0,
        },
      },
    },
    transform: { left: 100, top: 120 },
  });

  runtime.extensions.register(createImagePlacementCapability());
  await runtime.extensions.flushActivation();
  const facade = runtime.capabilities.getOrThrow<ImagePlacementCapabilityApi>(
    IMAGE_PLACEMENT_CAPABILITY_ID,
  );

  await facade.beginSession("slot");
  const canvasTarget: any = {
    angle: 12,
    data: {
      id: "session-image:image-placement:slot",
      layerId: "image.session.image",
      slotId: "slot",
      source: "working",
      type: "image-placement-image",
    },
    getCenterPoint: () => ({ x: 150, y: 152 }),
    getObjectScaling: () => ({ x: 3, y: 3 }),
    height: 80,
    left: 150,
    scaleX: 3,
    scaleY: 3,
    top: 152,
    width: 100,
  };
  canvasService.canvas.getObjects = () => [canvasTarget] as any;
  canvasService.setActiveObject(canvasTarget);
  exportService.exportImage = async (options: Record<string, any>) => {
    const graph = runtime.services
      .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
      .getGraph();
    const sessionNode = graph.layers
      .find((layer) => layer.id === "image.session.image")
      ?.nodes.find((node) => node.id === "session-image:image-placement:slot");
    renderedSessionScale = Number(sessionNode?.props.scaleX || 0);
    return FakeSceneExportService.prototype.exportImage.call(exportService, options);
  };

  await facade.completeSession("slot");
  const committedImage = (scene.getElement("slot")?.data as any)?.imagePlacement
    ?.image;
  assertDeepEqual(
    committedImage.metadata?.transform,
    {
      left: 0.25,
      top: 0.2,
      scale: 1.5,
      angle: 12,
      opacity: 1,
    },
    "complete session should sync the latest canvas object transform before cropping",
  );
  assertEqual(
    renderedSessionScale,
    3,
    "complete session should re-render the crop source with the synced canvas source size",
  );

  await runtime.dispose();
}

async function testImagePlacementKeepsWorkingImagesAcrossSlotSwitches() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  runtime.services.register(canvasService as any, CANVAS_SERVICE);

  const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
  scene.addLayer({ id: "artwork" });
  scene.addElement({
    id: "slot-a",
    layerId: "artwork",
    type: "rect",
    width: 100,
    height: 100,
    data: {
      imagePlacement: {
        enabled: true,
        frame: { x: 0, y: 0, width: 100, height: 100 },
      },
    },
  });
  scene.addElement({
    id: "slot-b",
    layerId: "artwork",
    type: "rect",
    width: 100,
    height: 100,
    data: {
      imagePlacement: {
        enabled: true,
        frame: { x: 120, y: 0, width: 100, height: 100 },
      },
    },
  });
  scene.addElement({
    id: "committed-slot",
    layerId: "artwork",
    type: "rect",
    width: 100,
    height: 100,
    data: {
      imagePlacement: {
        enabled: true,
        frame: { x: 240, y: 0, width: 100, height: 100 },
        image: {
          src: "/committed.png",
          metadata: { width: 100, height: 100 },
          left: 0.5,
          top: 0.5,
          scale: 1,
          angle: 0,
        },
      },
    },
  });

  runtime.extensions.register(
    createImagePlacementCapability({
      requestUpload: async (slot) => ({
        src: `/upload-${slot.id}.png`,
        metadata: { width: 100, height: 100 },
      }),
    }),
  );
  await runtime.extensions.flushActivation();
  const facade = runtime.capabilities.getOrThrow<ImagePlacementCapabilityApi>(
    IMAGE_PLACEMENT_CAPABILITY_ID,
  );
  const renderIntentService =
    runtime.services.getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE);

  await facade.requestUpload("slot-a");
  await facade.setImageTransform("slot-a", { scale: 1.8 });
  facade.resetSession("slot-a");
  const resetUploadedSlot = facade
    .getViewState()
    .slots.find((slot) => slot.id === "slot-a");
  assertEqual(
    resetUploadedSlot?.image?.src,
    "/upload-slot-a.png",
    "resetting after upload should keep the uploaded draft image",
  );
  assertEqual(
    resetUploadedSlot?.image?.scale,
    1,
    "resetting after upload should restore the upload baseline transform",
  );
  await facade.beginSession("slot-b");
  let imageSessionLayer = renderIntentService
    .getGraph()
    .layers.find((layer) => layer.id === "image.session.image");
  assert(
    imageSessionLayer?.nodes.some((node: any) => node.id === "session-image:image-placement:slot-a"),
    "uploaded working image should remain visible after focusing another slot",
  );

  await facade.requestUpload("slot-b");
  imageSessionLayer = renderIntentService
    .getGraph()
    .layers.find((layer) => layer.id === "image.session.image");
  const workingObjectIds = imageSessionLayer?.nodes.map((node: any) => node.id) ?? [];
  assert(
    workingObjectIds.includes("session-image:image-placement:slot-a") &&
      workingObjectIds.includes("session-image:image-placement:slot-b"),
    "multiple uploaded working images should render together before commit",
  );
  assert(
    renderIntentService.getVisibilityContextValue(
      `${IMAGE_PLACEMENT_CAPABILITY_ID}.image-placement.active-slot.slot-a`,
    ) === true,
    "slot-a committed visibility context should stay active while its working image exists",
  );

  await facade.beginSession("committed-slot");
  await facade.setImageTransform("committed-slot", { scale: 1.5, left: 0.2 });
  facade.resetSession("committed-slot");
  const restoredSlot = facade
    .getViewState()
    .slots.find((slot) => slot.id === "committed-slot");
  assertEqual(
    restoredSlot?.image?.src,
    "/committed.png",
    "resetting an edit session should restore the committed image source",
  );
  assertEqual(
    restoredSlot?.image?.scale,
    1,
    "resetting an edit session should discard uncommitted transform changes",
  );
  assert(
    renderIntentService.getVisibilityContextValue(
      `${IMAGE_PLACEMENT_CAPABILITY_ID}.image-placement.active-slot.committed-slot`,
    ) !== true,
    "resetting an edit session should reveal the committed image again",
  );

  await runtime.dispose();
}

async function testEdgeDetectionCapabilityExtension() {
  const runtime = new Pooder();

  runtime.extensions.register(new EdgeDetectionCapabilityExtension());
  await runtime.extensions.flushActivation();

  const facade = runtime.capabilities.get<EdgeDetectionCapabilityApi>(
    EDGE_DETECTION_CAPABILITY_ID,
  );
  assert(!!facade, "edge detection capability facade should be registered");

  const toolRegistry = runtime.services.getOrThrow<ToolRegistryService>(
    "ToolRegistryService",
  );
  assert(
    !toolRegistry.hasTool(EDGE_DETECTION_CAPABILITY_ID),
    "edge detection capability registration should not require a tool",
  );

  await runtime.dispose();
}

async function testDielineOverlayVisibilityFollowsEditingSessions() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  runtime.services.register(canvasService as any, CANVAS_SERVICE);
  runtime.extensions.register(createDielineGeometryCapability());
  await runtime.extensions.flushActivation();
  await Promise.resolve();

  const renderGraph = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph();
  const dielineLayer = renderGraph.layers.find(
    (item) => item.id === "dieline-overlay",
  );
  const dielineNode = dielineLayer?.nodes[0];
  assert(dielineLayer, "dieline render intent should expose the dieline overlay layer");

  const sessions = runtime.services.getOrThrow<SessionService>(SESSION_SERVICE);
  const context = {
    activeToolId: null,
    hasAnyActiveSession: (scope?: { channel?: string | null }) =>
      sessions.hasActiveSession({ scope }),
    isSessionScopeActive: (scope: { channel?: string | null }) =>
      sessions.hasActiveSession({ scope }),
  };

  assertEqual(
    evaluateVisibilityExpr(dielineNode?.visibility, context),
    true,
    "dieline overlay should be visible when no edit session is active",
  );

  sessions.createSession({
    sessionId: "image-placement:slot",
    scope: { channel: "image-placement", subjectId: "slot" },
  });
  assertEqual(
    evaluateVisibilityExpr(dielineNode?.visibility, context),
    false,
    "dieline overlay should be hidden during image placement sessions",
  );
  await sessions.cancelSession("image-placement:slot");

  sessions.createSession({
    sessionId: "white-ink:front",
    scope: { channel: "white-ink", subjectId: "front" },
  });
  assertEqual(
    evaluateVisibilityExpr(dielineNode?.visibility, context),
    false,
    "dieline overlay should be hidden during white ink sessions",
  );
  await sessions.cancelSession("white-ink:front");

  sessions.createSession({
    sessionId: "dieline:front",
    scope: { channel: DIELINE_GEOMETRY_CAPABILITY_ID, subjectId: "front" },
  });
  assertEqual(
    evaluateVisibilityExpr(dielineNode?.visibility, context),
    true,
    "dieline overlay should remain visible during dieline sessions",
  );

  await sessions.cancelSession("dieline:front");

  assertEqual(
    evaluateVisibilityExpr(dielineNode?.visibility, context),
    true,
    "dieline overlay should be restored after edit sessions end",
  );
  assertDeepEqual(
    dielineLayer?.effects ?? [],
    [],
    "dieline overlay should not emit implicit clip effects",
  );

  await runtime.dispose();
}

function testImageSessionShapeOverlayUsesDielineGeometry() {
  const rectByCenter = (
    centerX: number,
    centerY: number,
    width: number,
    height: number,
  ): SceneRect => ({
    centerX,
    centerY,
    height,
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
  });
  const layout: SceneLayoutSnapshot = {
    bleedRect: rectByCenter(400, 300, 360, 360),
    canvasHeight: 600,
    canvasWidth: 800,
    cutHeightMm: 120,
    cutRect: rectByCenter(400, 300, 360, 360),
    cutWidthMm: 120,
    scale: 3,
    trimHeightMm: 100,
    trimRect: rectByCenter(400, 300, 300, 300),
    trimWidthMm: 100,
  };
  const shapeStyle = { fitMode: "stretch" as const };
  const geometry = {
    height: layout.trimRect.height,
    offset: (layout.cutRect.width - layout.trimRect.width) / 2,
    radius: 0,
    scale: layout.scale,
    shape: "circle" as const,
    shapeStyle,
    unit: "px" as const,
    width: layout.trimRect.width,
    x: layout.trimRect.centerX,
    y: layout.trimRect.centerY,
  };

  const imageOverlaySpecs = buildImageSessionOverlaySpecs({
    geometry,
    layout,
    viewport: { left: 0, top: 0, width: 800, height: 600 },
    visual: {
      dashLength: 8,
      innerBackground: "rgba(0,0,0,0)",
      outerBackground: "#f5f5f5",
      strokeColor: "#808080",
      strokeStyle: "dashed",
      strokeWidth: 2,
    },
  });
  const outline = imageOverlaySpecs.find(
    (spec) => spec.id === "image.cropShapeOutline",
  );
  const hatch = imageOverlaySpecs.find(
    (spec) => spec.id === "image.cropShapeHatch",
  );
  const dieline = buildDielineRenderBundle({
    canvasHeight: layout.canvasHeight,
    canvasWidth: layout.canvasWidth,
    hasImages: true,
    includeImageClipEffect: false,
    sceneLayout: layout,
    state: {
      features: [],
      height: 100,
      insideColor: "transparent",
      mainLine: { color: "#f00", dashLength: 1, style: "solid", width: 1 },
      offset: 10,
      offsetLine: { color: "#f00", dashLength: 1, style: "solid", width: 1 },
      padding: 0,
      radius: 0,
      shape: "circle",
      shapeStyle,
      showBleedLines: true,
      width: 100,
    },
  }).specs.find((spec) => spec.id === "dieline.border");

  assert(outline, "image session should render a shape outline");
  assert(hatch, "image session should render a shape hatch overlay");
  assert(dieline, "dieline bundle should render the main border");
  assertEqual(
    (outline!.props as any).pathData,
    (dieline!.props as any).pathData,
    "image session shape outline should use the same geometry as the dieline border",
  );
  assert(
    String((hatch!.props as any).pathData).startsWith("M 220 120 L 580 120"),
    "image session hatch should still cover the cut frame before subtracting the dieline",
  );
}

async function testDielineGeometryCapabilityExtension() {
  const runtime = new Pooder();
  const state = {
    shape: "rect",
    radius: 0,
    shapeStyle: {},
    showBleedLines: true,
    mainLine: { width: 1, color: "#000", dashLength: 1, style: "solid" },
    offsetLine: { width: 1, color: "#000", dashLength: 1, style: "solid" },
    insideColor: "#000",
    features: [],
  };
  const facade: DielineGeometryCapabilityApi = {
    applyDetectedPath: (result, options = {}) => {
      runtime.config.update("storefrontDieline.shape", "custom");
      runtime.config.update("storefrontDieline.pathData", result.pathData);
      if (options.normalizeCutMode !== false) {
        runtime.config.update("scene.exportFrame", {
          heightMm: 100,
          widthMm: 100,
          xMm: 0,
          yMm: 0,
        });
      }
    },
    getGeometry: () => null,
    getState: () => state as any,
    refresh: () => {},
    updateFeaturePosition: () => {},
    upsertPathElement: (options = {}) =>
      upsertScenePathElement(runtime.services.getOrThrow(SCENE_SERVICE), {
        layerId: options.layerId || "app.dieline",
        elementId: options.elementId || "app.dieline.path",
        pathData: options.pathData || "M0 0 L1 1",
        order: options.order,
        style: options.style,
        metadata: options.metadata,
      }),
  };

  runtime.extensions.register({
    id: "test.dieline-geometry",
    activate() {},
    contribute() {
      return {
        capabilities: [
          createDielineGeometryCapabilityDefinition(facade, {
            configNamespace: "storefrontDieline",
            layers: {
              targetLayerId: "app.dieline",
              imageClipLayerIds: ["app.image"],
            },
          }),
        ],
        configurations: createDielineConfigurations(state, "storefrontDieline"),
      };
    },
  });

  await runtime.extensions.flushActivation();

  const registeredFacade =
    runtime.capabilities.get<DielineGeometryCapabilityApi>(
      DIELINE_GEOMETRY_CAPABILITY_ID,
    );
  if (!registeredFacade) {
    throw new Error("dieline geometry capability facade should be registered");
  }

  const toolRegistry = runtime.services.getOrThrow<ToolRegistryService>(
    "ToolRegistryService",
  );
  assert(
    !toolRegistry.hasTool(DIELINE_GEOMETRY_CAPABILITY_ID),
    "dieline geometry capability registration should not require a tool",
  );
  assert(
    runtime.config.getDefinition("storefrontDieline.shape"),
    "dieline geometry capability should accept caller config namespace",
  );

  registeredFacade.applyDetectedPath(
    {
      pathData: "M0 0 L10 0 L10 10 Z",
      imageWidth: 10,
      imageHeight: 10,
    },
    { normalizeCutMode: true },
  );

  assertEqual(
    runtime.config.get("storefrontDieline.shape"),
    "custom",
    "dieline geometry should write detected shape to caller namespace",
  );
  assertEqual(
    runtime.config.get("storefrontDieline.pathData"),
    "M0 0 L10 0 L10 10 Z",
    "dieline geometry should write detected path to caller namespace",
  );
  assertDeepEqual(
    runtime.config.get("scene.exportFrame"),
    { heightMm: 100, widthMm: 100, xMm: 0, yMm: 0 },
    "dieline geometry should normalize the export frame when requested",
  );

  const element = registeredFacade.upsertPathElement({
    elementId: "app.dieline.path",
    pathData: "M0 0 L1 1",
    style: { stroke: "#123456" },
    metadata: { source: "contract" },
  });
  assertEqual(
    element?.id,
    "app.dieline.path",
    "dieline geometry should upsert a caller-owned path element",
  );
  const sceneService = runtime.services.getOrThrow(SCENE_SERVICE);
  assert(
    sceneService.getLayer("app.dieline"),
    "dieline geometry should create the caller-owned target layer",
  );
  assertEqual(
    sceneService.getElement("app.dieline.path")?.type,
    "path",
    "dieline geometry should create a scene path element",
  );
  assertEqual(
    sceneService.getElement("app.dieline.path")?.style?.stroke,
    "#123456",
    "dieline geometry should preserve caller-owned path style",
  );

  const updatedElement = registeredFacade.upsertPathElement({
    elementId: "app.dieline.path",
    pathData: "M2 2 L3 3",
    style: { stroke: "#654321" },
  });
  if (!updatedElement || updatedElement.type !== "path") {
    throw new Error("dieline geometry upsert should return a path element");
  }
  assertEqual(
    updatedElement.path,
    "M2 2 L3 3",
    "dieline geometry should update existing caller-owned path elements",
  );
  assertEqual(
    sceneService.listElements({ layerId: "app.dieline" }).length,
    1,
    "dieline geometry upsert should not duplicate path elements",
  );

  await runtime.dispose();
}

async function testWhiteInkCapabilityExtension() {
  const runtime = new Pooder();

  runtime.services.register(new FakeCanvasService() as any, CANVAS_SERVICE);
  runtime.extensions.register(
    new WhiteInkCapabilityExtension({
      configNamespace: "storefrontWhiteInk",
      layers: {
        sourceLayerIds: ["app.image"],
        whiteLayerId: "app.white-ink",
        coverLayerId: "app.white-ink.cover",
        overlayLayerId: "app.white-ink.overlay",
      },
    }),
  );

  await runtime.extensions.flushActivation();

  assertEqual(
    runtime.extensions.getState(WHITE_INK_CAPABILITY_ID)?.state,
    "active",
    "white ink capability should activate without the legacy image extension",
  );

  const facade = runtime.capabilities.get<WhiteInkCapabilityApi>(
    WHITE_INK_CAPABILITY_ID,
  );
  if (!facade) {
    throw new Error("white ink capability facade should be registered");
  }

  const toolRegistry = runtime.services.getOrThrow<ToolRegistryService>(
    "ToolRegistryService",
  );
  assert(
    !toolRegistry.hasTool(WHITE_INK_CAPABILITY_ID),
    "white ink capability registration should not require a tool",
  );
  assert(
    runtime.config.getDefinition("storefrontWhiteInk.items"),
    "white ink capability should accept caller config namespace",
  );

  facade.setPrintEnabled(false);
  assertEqual(
    runtime.config.get("storefrontWhiteInk.printWithWhiteInk"),
    false,
    "white ink capability should write print settings to caller namespace",
  );
  assertDeepEqual(
    facade.getItems(),
    [],
    "white ink capability should expose white ink items",
  );

  await runtime.dispose();
}

async function testConfigurableVisualConfigPatchesOriginalRenderIntents() {
  const runtime = new Pooder();

  runtime.extensions.register(createConfigurableVisualCapability());
  await runtime.extensions.flushActivation();

  await applyKitEditorDocument(runtime, {
    version: 3,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 200, height: 100, unit: "mm" },
        layers: [
          {
            id: "front.flash-base",
            objects: [
              {
                id: "front.flash-base",
                type: "image",
                src: "/default-flash.png",
                frame: { x: 0, y: 0, width: 200, height: 100 },
                effects: [
                  {
                    type: "configurable-visual",
                    payload: { key: "flash-base" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  const renderIntentService = runtime.services.getOrThrow<RenderIntentService>(
    RENDER_INTENT_SERVICE,
  );
  const facade = runtime.capabilities.get<ConfigurableVisualCapabilityApi>(
    CONFIGURABLE_VISUAL_CAPABILITY_ID,
  );
  if (!facade) {
    throw new Error("configurable visual capability facade should be registered");
  }

  assertDeepEqual(
    runtime.config.export(),
    TEST_DOCUMENT_CONFIG,
    "unused configurable visual capability should not add a default config value",
  );

  const defaultNode = renderIntentService
    .getGraph()
    .layers.flatMap((layer) => layer.nodes)
    .find((node) => node.subjectId === "front.flash-base");
  assertEqual(
    defaultNode?.visual?.src,
    "/default-flash.png",
    "configurable visual should preserve document default src before config patch",
  );
  assertEqual(
    defaultNode?.visible,
    true,
    "configurable visual should preserve document default visibility before config patch",
  );

  runtime.config.update("configurableVisual", {
    "flash-base": {
      enabled: true,
      optionId: "flash-holo",
      optionName: "Holographic",
      src: "/runtime-flash.png",
    },
  });
  const patchedNode = renderIntentService
    .getGraph()
    .layers.flatMap((layer) => layer.nodes)
    .find((node) => node.subjectId === "front.flash-base");
  assertEqual(
    patchedNode?.visual?.src,
    "/runtime-flash.png",
    "configurable visual config should patch the original object src",
  );
  assertEqual(
    patchedNode?.visible,
    true,
    "enabled configurable visual config with src should make the object visible",
  );
  assert(
    Boolean(runtime.config.export().configurableVisual),
    "configurable visual config should be exported after user mutation",
  );

  runtime.config.update("configurableVisual", {
    "flash-base": {
      enabled: false,
      optionId: "flash-none",
      optionName: "No Flashing",
    },
  });
  const disabledNode = renderIntentService
    .getGraph()
    .layers.flatMap((layer) => layer.nodes)
    .find((node) => node.subjectId === "front.flash-base");
  assertEqual(
    disabledNode?.visible,
    false,
    "disabled configurable visual config should hide the original target object",
  );

  const runtimeWithPersistedConfig = new Pooder();
  runtimeWithPersistedConfig.extensions.register(
    createConfigurableVisualCapability(),
  );
  await runtimeWithPersistedConfig.extensions.flushActivation();
  await applyKitEditorDocument(runtimeWithPersistedConfig, {
    version: 3,
    config: {
      ...TEST_DOCUMENT_CONFIG,
      configurableVisual: {
        "flash-base": {
          enabled: true,
          src: "/persisted-flash.png",
        },
      },
    },
    surfaces: [
      {
        id: "front",
        size: { width: 200, height: 100, unit: "mm" },
        layers: [
          {
            id: "front.flash-base",
            objects: [
              {
                id: "front.flash-base",
                type: "image",
                frame: { x: 0, y: 0, width: 200, height: 100 },
                effects: [
                  {
                    type: "configurable-visual",
                    payload: { key: "flash-base" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  const persistedNode = runtimeWithPersistedConfig.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph()
    .layers.flatMap((layer) => layer.nodes)
    .find((node) => node.subjectId === "front.flash-base");
  assertEqual(
    persistedNode?.visual?.src,
    "/persisted-flash.png",
    "persisted configurable visual config should patch after document apply",
  );

  await runtime.dispose();
  await runtimeWithPersistedConfig.dispose();
}

async function testRulerCapabilityExtension() {
  const runtime = new Pooder();

  runtime.services.register(new FakeCanvasService() as any, CANVAS_SERVICE);
  runtime.extensions.register(
    new RulerCapabilityExtension({
      configNamespace: "storefrontRuler",
      layers: {
        rulerLayerId: "app.ruler",
      },
    }),
  );

  await runtime.extensions.flushActivation();

  assertEqual(
    runtime.extensions.getState(RULER_CAPABILITY_ID)?.state,
    "active",
    "ruler capability should activate",
  );

  const facade =
    runtime.capabilities.get<RulerCapabilityApi>(RULER_CAPABILITY_ID);
  if (!facade) {
    throw new Error("ruler capability facade should be registered");
  }

  const toolRegistry = runtime.services.getOrThrow<ToolRegistryService>(
    "ToolRegistryService",
  );
  assert(
    !toolRegistry.hasTool(RULER_CAPABILITY_ID),
    "ruler capability registration should not require a tool",
  );
  assert(
    runtime.config.getDefinition("storefrontRuler.thickness"),
    "ruler capability should accept caller config namespace",
  );

  facade.setTheme({ lineColor: "#111111" });
  assertEqual(
    facade.getTheme().lineColor,
    "#111111",
    "ruler capability should expose theme mutation facade",
  );

  await runtime.dispose();
}

async function testFeatureCapabilityDefinition() {
  const runtime = new Pooder();
  let committedFeatures: any[] = [];
  let workingFeatures: any[] = [];
  const fakeFacade: FeatureCapabilityApi = {
    addDoubleLayerHole: () => true,
    addFeature: (type = "subtract") => {
      workingFeatures.push({
        id: `feature-${workingFeatures.length + 1}`,
        operation: type,
        shape: "rect",
        x: 0.5,
        y: 0,
      });
      return true;
    },
    beginSession: async () => ({ ok: true }),
    clearFeatures: () => {
      workingFeatures = [];
      return true;
    },
    completeSession: () => ({ ok: true }),
    getFeatures: () => committedFeatures,
    getMarkerRenderSpecs: () => [],
    getWorkingFeatures: () => workingFeatures,
    projectPlacements: (placements, _geometry, scale) =>
      placements.map((placement) => ({
        ...placement.feature,
        x: placement.normalizedX,
        y: placement.normalizedY,
        width:
          placement.feature.width !== undefined
            ? placement.feature.width * scale
            : undefined,
        height:
          placement.feature.height !== undefined
            ? placement.feature.height * scale
            : undefined,
      })),
    refresh: () => {},
    replaceFeatures: (features, options = {}) => {
      if (options.target === "committed" || options.target === "both") {
        committedFeatures = features;
      }
      if (
        !options.target ||
        options.target === "working" ||
        options.target === "both"
      ) {
        workingFeatures = features;
      }
      return { ok: true };
    },
    resetSession: async () => ({ ok: true }),
    resolvePlacements: (features, geometry) =>
      features.map((feature) => ({
        feature,
        normalizedX: feature.x,
        normalizedY: feature.y,
        centerX: geometry.x - geometry.width / 2 + feature.x * geometry.width,
        centerY: geometry.y - geometry.height / 2 + feature.y * geometry.height,
      })),
    rollbackSession: async () => ({ ok: true }),
    updateWorkingGroupPosition: () => ({ ok: true }),
  };

  runtime.extensions.register({
    id: "test.feature-capability",
    activate() {},
    contribute() {
      return {
        capabilities: [
          createFeatureCapabilityDefinition(fakeFacade, {
            configNamespace: "storefrontFeature",
            layers: {
              imageClipLayerIds: ["app.image"],
              markerLayerId: "app.feature.markers",
              sessionDielineLayerId: "app.feature.dieline",
            },
          }),
        ],
      };
    },
  });

  await runtime.extensions.flushActivation();

  const facade =
    runtime.capabilities.get<FeatureCapabilityApi>(FEATURE_CAPABILITY_ID);
  if (!facade) {
    throw new Error("feature capability facade should be registered");
  }

  const toolRegistry = runtime.services.getOrThrow<ToolRegistryService>(
    "ToolRegistryService",
  );
  assert(
    !toolRegistry.hasTool(FEATURE_CAPABILITY_ID),
    "feature capability registration should not require a tool",
  );

  const feature = {
    id: "feature-1",
    operation: "subtract" as const,
    shape: "rect" as const,
    x: 0.25,
    y: 0.5,
    width: 10,
    height: 12,
    renderBehavior: "edge" as const,
  };
  facade.replaceFeatures([feature], { target: "both" });
  assertEqual(
    facade.getFeatures()[0]?.id,
    "feature-1",
    "feature capability should expose committed features",
  );

  await facade.beginSession();
  assert(
    facade.addFeature("add"),
    "feature capability should expose feature creation",
  );
  assertEqual(
    facade.getWorkingFeatures().length,
    2,
    "feature capability should maintain working feature state",
  );
  assert(
    facade.clearFeatures(),
    "feature capability should expose working feature clearing",
  );
  assertEqual(
    facade.getWorkingFeatures().length,
    0,
    "feature capability should clear working feature state",
  );

  const placements = facade.resolvePlacements([feature], {
    shape: "rect",
    shapeStyle: { fitMode: "stretch" },
    x: 50,
    y: 40,
    width: 100,
    height: 80,
    radius: 0,
    scale: 1,
  });
  assertEqual(
    Math.round(placements[0]?.centerX || 0),
    25,
    "feature capability should resolve feature placement geometry",
  );
  const projected = facade.projectPlacements(
    placements,
    { x: 50, y: 40, width: 100, height: 80 },
    2,
  );
  assertEqual(
    projected[0]?.width,
    20,
    "feature capability should project placed feature dimensions",
  );

  await runtime.dispose();
}

async function main() {
  testWrappedOffsets();
  testBridgeSelection();
  testMaskOps();
  testEdgeScale();
  testFeaturePlacementProjection();
  testVisibilityDsl();
  testImageViewStateHelper();
  testContributionCompatibility();
  testKitCapabilityContractDefinitionsAndNormalization();
  await testDesignExportCapabilityExtension();
  await testKitCapabilityFactoriesDoNotRegisterTools();
  testCreateKitCapabilitiesForDocument();
  testCreateKitCapabilitiesForDocumentInfersDielineLayers();
  await testApplyKitEditorDocument();
  await testApplyKitEditorDocumentObjectInteraction();
  await testApplyKitEditorDocumentMissingCapabilities();
  await testImagePlacementCapabilityExtension();
  await testImagePlacementSessionUsesEditableWorkingObject();
  await testImagePlacementCompleteSyncsCanvasTransform();
  await testImagePlacementKeepsWorkingImagesAcrossSlotSwitches();
  await testEdgeDetectionCapabilityExtension();
  await testDielineOverlayVisibilityFollowsEditingSessions();
  testImageSessionShapeOverlayUsesDielineGeometry();
  await testDielineGeometryCapabilityExtension();
  await testWhiteInkCapabilityExtension();
  await testConfigurableVisualConfigPatchesOriginalRenderIntents();
  await testRulerCapabilityExtension();
  await testFeatureCapabilityDefinition();
  console.log("ok");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
