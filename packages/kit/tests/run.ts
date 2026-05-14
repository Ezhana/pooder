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
  BACKGROUND_CAPABILITY_ID,
  BackgroundCapabilityExtension,
  createBackgroundCapabilityDefinition,
  getBackgroundConfigKey,
  normalizeBackgroundConfigNamespace,
  normalizeBackgroundLayerId,
  type BackgroundCapabilityApi,
} from "../src/extensions/background";
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
  SIZE_CAPABILITY_ID,
  SizeCapabilityExtension,
  type SizeCapabilityApi,
} from "../src/extensions/size";
import {
  TEMPLATE_OVERLAY_CAPABILITY_ID,
  TemplateOverlayCapabilityExtension,
  createTemplateOverlayCapabilityDefinition,
  type TemplateOverlayCapabilityApi,
} from "../src/extensions/template-overlay";
import { createDielineCommands } from "../src/extensions/dieline/commands";
import { createDielineConfigurations } from "../src/extensions/dieline/config";
import {
  normalizeTemplateOverlayConfig,
  patchTemplateOverlayConfig,
} from "../src/extensions/template-overlay/model";
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
  createImagePlacementCapability,
  createSizeCapability,
  createWhiteInkCapability,
} from "../src/factories";
import {
  applyKitEditorDocument,
  createKitCapabilitiesForDocument,
} from "../src/document";
import {
  SCENE_EXPORT_SERVICE,
  CANVAS_SERVICE,
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
  TOOL_SESSION_SERVICE,
  type CapabilityDefinition,
  type CommandContribution,
  type CommandService,
  type ExtensionDefinition,
  Pooder,
  type SceneService,
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

class FakeCanvasService {
  private activeObject: any = null;
  private readonly eventHandlers = new Map<string, Set<(event?: any) => void>>();
  private readonly renderProducers = new Map<string, () => unknown>();

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

  registerRenderProducer(id?: string, producer?: () => unknown) {
    if (id && producer) {
      this.renderProducers.set(id, producer);
    }

    return {
      dispose: () => {
        if (id) {
          this.renderProducers.delete(id);
        }
      },
    };
  }

  async getRenderProducerResult(id: string) {
    return await this.renderProducers.get(id)?.();
  }

  async flushRenderFromProducers() {}

  requestRenderFromProducers() {}

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
    width?: number;
    height?: number;
    padding?: unknown;
    frame?: unknown;
  }) {
    if (typeof options.width === "number") this.canvas.width = options.width;
    if (typeof options.height === "number") this.canvas.height = options.height;
    this.viewport.updateContainer(this.canvas.width, this.canvas.height);
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

function testTemplateOverlayConfig() {
  const normalized = normalizeTemplateOverlayConfig({
    version: 1,
    clip: {
      enabled: true,
      targetLayerIds: [" image.user ", "image.user", ""],
    },
    slots: {
      normal: {
        src: " /normal.png ",
        opacity: 2,
        placement: {
          space: "surfaceFrameRatio",
          x: 0,
          y: "0",
          width: 1,
          height: 1,
        },
      },
      back: {
        src: "/back.png",
        enabled: false,
      },
      render: {
        src: "",
      },
      unknown: {
        src: "/unknown.png",
      },
    },
  });

  assertEqual(normalized.version, 1, "template overlay version should be v1");
  assertEqual(
    normalized.slots.normal?.src,
    "/normal.png",
    "template overlay should trim slot src",
  );
  assertEqual(
    normalized.clip?.targetLayerIds?.length,
    1,
    "template overlay should normalize clip target layer ids",
  );
  assertEqual(
    normalized.slots.normal?.opacity,
    1,
    "template overlay opacity should be clamped",
  );
  assertEqual(
    normalized.slots.normal?.placement?.height,
    1,
    "template overlay should normalize slot placement",
  );
  assertEqual(
    normalized.slots.back?.src,
    "/back.png",
    "template overlay should preserve the back slot in config",
  );
  assertEqual(
    normalized.slots.back?.enabled,
    false,
    "template overlay should preserve slot enabled",
  );
  assert(
    !normalized.slots.render,
    "template overlay should drop empty src slots",
  );
  assert(
    !("unknown" in normalized.slots),
    "template overlay should drop unknown slots",
  );

  const patched = patchTemplateOverlayConfig(normalized, {
    clip: {
      enabled: false,
    },
    slots: {
      normal: {
        opacity: 0.25,
      },
      frame: {
        src: "/frame.png",
        placement: {
          space: "surfaceFrameRatio",
          x: 0.1,
          y: 0.12,
          width: 0.3,
          height: 0.2,
        },
      },
      back: null,
    },
  });

  assertEqual(
    patched.slots.normal?.src,
    "/normal.png",
    "template overlay patch should preserve existing slot src",
  );
  assertEqual(
    patched.slots.normal?.opacity,
    0.25,
    "template overlay patch should update slot opacity",
  );
  assertEqual(
    patched.clip?.enabled,
    false,
    "template overlay patch should update clip config",
  );
  assertEqual(
    patched.slots.frame?.src,
    "/frame.png",
    "template overlay patch should add slots",
  );
  assertEqual(
    patched.slots.frame?.placement?.x,
    0.1,
    "template overlay patch should add slot placement",
  );
  assert(
    !patched.slots.back,
    "template overlay patch should remove null slots",
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
    isSessionActive: (toolId: string) => toolId === "pooder.kit.feature",
    hasAnyActiveSession: () => true,
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
      { op: "sessionActive", toolId: "pooder.kit.feature" },
      context,
    ) === true,
    "sessionActive true failed",
  );
  assert(
    evaluateVisibilityExpr(
      { op: "sessionActive", toolId: "pooder.kit.ruler" },
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
          { op: "sessionActive", toolId: "pooder.kit.feature" },
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
    normalizeBackgroundConfigNamespace(" storefrontBackground "),
    "storefrontBackground",
    "background config namespace should trim caller input",
  );
  assertEqual(
    getBackgroundConfigKey("storefrontBackground", "layers"),
    "storefrontBackground.layers",
    "background config keys should stay caller-namespaced",
  );
  assertEqual(
    normalizeBackgroundLayerId("", "legacy.background"),
    "legacy.background",
    "background layer id should fall back",
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
    createBackgroundCapabilityDefinition({} as BackgroundCapabilityApi, {
      capabilityId: "custom.background",
    }),
    createRulerCapabilityDefinition({} as RulerCapabilityApi, {
      capabilityId: "custom.ruler",
    }),
    createTemplateOverlayCapabilityDefinition(
      {} as TemplateOverlayCapabilityApi,
      { capabilityId: "custom.template-overlay" },
    ),
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
      "custom.background",
      "custom.ruler",
      "custom.template-overlay",
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
  runtime.extensions.register(createSizeCapability());
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
    runtime.extensions.getState(SIZE_CAPABILITY_ID)?.state === "active",
    "size capability factory should activate",
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
    SIZE_CAPABILITY_ID,
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
    version: 2,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        layers: [
          {
            id: "artwork",
            effects: [
              { type: "dieline" },
              { type: "feature" },
              { type: "template-overlay", require: "warn" },
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
      IMAGE_PLACEMENT_CAPABILITY_ID,
      TEMPLATE_OVERLAY_CAPABILITY_ID,
    ].sort(),
    "document helper should create each referenced kit capability once",
  );
}

function testCreateKitCapabilitiesForDocumentInfersDielineLayers() {
  const capabilities = createKitCapabilitiesForDocument({
    version: 2,
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
    "front.dieline-overlay",
    "document helper should target the document dieline layer",
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
  const templateCalls: any[] = [];
  const dielineCalls: any[] = [];
  const featureCalls: any[] = [];
  runtime.extensions.register(
    createFakeCapabilityExtension({
      [TEMPLATE_OVERLAY_CAPABILITY_ID]: {
        getConfig: () => ({ version: 1, slots: {} }),
        patchConfig: async (patch: any) => {
          templateCalls.push(patch);
          return { version: 1, slots: patch.slots ?? {} };
        },
        replaceConfig: async (config: any) => config,
        clearConfig: async () => ({ version: 1, slots: {} }),
        refresh: () => {},
      } satisfies TemplateOverlayCapabilityApi,
      [IMAGE_PLACEMENT_CAPABILITY_ID]: {
        beginSession: async () => ({ ok: true }),
        requestUpload: async () => ({ ok: true }),
        setImageSource: async () => ({ ok: true }),
        setImageTransform: async () => ({ ok: true }),
        applyImageOperation: async () => ({ ok: true }),
        clearImage: async () => ({ ok: true }),
        focusSlot: () => ({ ok: true }),
        getViewState: () => ({}) as any,
        resetSession: () => {},
        validateSession: async () => ({ ok: true }),
        completeSession: async () => ({ ok: true }),
        exportPlacementImage: async () => ({}) as any,
      } satisfies ImagePlacementCapabilityApi,
      [DIELINE_GEOMETRY_CAPABILITY_ID]: {
        getState: () => ({}) as any,
        getGeometry: () => null,
        updateFeaturePosition: () => {},
        applyDetectedPath: () => {},
        refresh: () => {
          dielineCalls.push({ type: "refresh" });
        },
        upsertPathElement: (options: any) => {
          dielineCalls.push(options);
          return null;
        },
      } satisfies DielineGeometryCapabilityApi,
      [FEATURE_CAPABILITY_ID]: {
        addDoubleLayerHole: () => false,
        addFeature: () => false,
        beginSession: async () => ({ ok: true }),
        clearFeatures: () => true,
        completeSession: () => ({ ok: true }),
        getFeatures: () => [],
        getMarkerRenderSpecs: () => [],
        getWorkingFeatures: () => [],
        projectPlacements: () => [],
        refresh: () => {},
        replaceFeatures: (features: any[], options: any) => {
          featureCalls.push({ features, options });
          return { ok: true };
        },
        resetSession: async () => ({ ok: true }),
        resolvePlacements: () => [],
        rollbackSession: async () => ({ ok: true }),
        updateWorkingGroupPosition: () => ({ ok: true }),
      } satisfies FeatureCapabilityApi,
    }),
  );
  runtime.extensions.register(new ClipCapabilityExtension());
  await runtime.extensions.flushActivation();

  const result = await applyKitEditorDocument(runtime, {
    version: 2,
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
            effects: [
              {
                type: "template-overlay",
                payload: {
                  slots: {
                    normal: {
                      enabled: true,
                      src: "/layer-template.png",
                    },
                  },
                },
              },
            ],
            objects: [
              {
                id: "front-template-image",
                type: "image",
                assetId: "template",
                frame: { x: 0, y: 0, width: 100, height: 120 },
                effects: [{ type: "template-overlay" }],
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
                assetId: "photo",
                effects: [
                  { type: "image-placement", payload: { accepts: ["image"] } },
                  { type: "clip", payload: { source: { type: "dieline" } } },
                ],
                frame: { x: 10, y: 20, width: 30, height: 40 },
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
  });

  assert(result.ok, "document apply should succeed");
  assertDeepEqual(
    result.appliedSurfaceIds,
    ["front", "back"],
    "apply result should report surfaces",
  );
  const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
  assert(!!scene.getLayer("front-artwork"), "front layer should be added");
  assertEqual(
    scene.getElement("front-slot")?.type,
    "rect",
    "image placement target should be projected as scene rect anchor",
  );
  assertEqual(
    scene.getElement("front-template-image")?.type,
    "image",
    "template image should be projected as scene image",
  );
  assertEqual(
    runtime.config.get("dieline.shape"),
    "circle",
    "dieline payload should update config",
  );
  assertEqual(
    templateCalls.length,
    1,
    "only explicit layer template overlay effects should call facade",
  );
  assertEqual(
    templateCalls[0]?.slots?.normal?.src,
    "/layer-template.png",
    "template overlay should use explicit layer payload",
  );
  assertEqual(
    ((scene.getElement("front-slot")?.data as any)?.imagePlacement?.image as any)
      ?.src,
    "/photo.png",
    "image placement target should resolve default image asset source",
  );
  assertDeepEqual(
    (scene.getElement("front-slot")?.data as any)?.clip,
    { enabled: true, source: { type: "dieline" } },
    "clip effect should write normalized object clip metadata",
  );
  const clipProducerResult = (await canvasService.getRenderProducerResult(
    CLIP_CAPABILITY_ID,
  )) as any;
  const clipEffect = clipProducerResult?.passes?.[0]?.effects?.[0];
  assertDeepEqual(
    clipEffect?.targetPassIds,
    ["front-artwork"],
    "clip render producer should resolve the target pass from the scene element layer",
  );
  assertDeepEqual(
    clipEffect?.targetElementIds,
    ["front-slot"],
    "clip render producer should resolve object-level target ids",
  );
  assert(dielineCalls.length > 0, "dieline effect should refresh facade");
  assertEqual(
    featureCalls[0]?.features?.[0]?.id,
    "hole",
    "feature effect should replace features",
  );
  assertEqual(
    runtime.config.get("size.actualWidthMm"),
    100,
    "document surface should seed size width config",
  );

  await runtime.dispose();
}

async function testApplyKitEditorDocumentMissingCapabilities() {
  const strictRuntime = new Pooder();
  const strictResult = await applyKitEditorDocument(strictRuntime, {
    version: 2,
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
    version: 2,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        layers: [
          {
            id: "front-artwork",
            effects: [
              { type: "template-overlay", require: "warn" },
              { type: "white-ink", require: "ignore" },
            ],
          },
        ],
      },
    ],
  });
  assert(optionalResult.ok, "optional missing capabilities should apply scene");
  assert(
    optionalResult.diagnostics.some(
      (item) =>
        item.code === "capability-optional-missing" &&
        item.capabilityId === TEMPLATE_OVERLAY_CAPABILITY_ID,
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
    !!optionalRuntime.services
      .getOrThrow<SceneService>(SCENE_SERVICE)
      .getLayer("front-artwork"),
    "optional missing capabilities should still write scene",
  );
  await optionalRuntime.dispose();
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
    cutMarginMm: 10,
    cutMode: "outset",
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
            id: "template-overlay",
            sourceLayerIds: ["front.template-overlay"],
            placement: "above",
            interactive: false,
          },
        ],
      },
    },
  });
  const imageExtension = createImagePlacementCapability();
  runtime.extensions.register(imageExtension);
  await runtime.extensions.flushActivation();

  const facade = runtime.capabilities.getOrThrow<ImagePlacementCapabilityApi>(
    IMAGE_PLACEMENT_CAPABILITY_ID,
  );
  await facade.beginSession("slot");

  const render = (await canvasService.getRenderProducerResult(
    IMAGE_PLACEMENT_CAPABILITY_ID,
  )) as any;
  const imagePass = render.passes.find(
    (pass: any) => pass.targetLayerId === "artwork",
  );
  const imageSessionPass = render.passes.find(
    (pass: any) => pass.id === "image.user.session.image",
  );
  const sessionPass = render.passes.find(
    (pass: any) => pass.id === "image-overlay.session.controls",
  );
  const sessionOverlayPass = render.passes.find(
    (pass: any) => pass.id === "image.user.session.overlay",
  );
  assert(
    !imagePass?.objects.some((spec: any) => spec.id === "image:slot"),
    "committed image object should be hidden while its working session is active",
  );
  assertEqual(
    imageSessionPass.stack,
    800,
    "image session working object should render above business document layers",
  );
  const sessionImage = imageSessionPass.objects.find(
    (spec: any) => spec.id === "session-image:slot",
  );
  assert(sessionImage, "image session should render a separate working object");
  assertEqual(
    sessionImage.props.selectable,
    true,
    "session image should be selectable",
  );
  assertEqual(
    sessionImage.props.lockUniScaling,
    true,
    "session image should keep aspect ratio while scaling",
  );
  assertEqual(
    sessionImage.props.lockRotation,
    false,
    "session image should support rotation",
  );
  assert(
    sessionPass.objects.some((spec: any) => spec.id === "image.cropShapeHatch"),
    "image session should render dieline hatch overlay",
  );
  assertDeepEqual(
    sessionOverlayPass.projections?.[0],
    {
      id: "slot.template-overlay",
      sourceLayerIds: ["front.template-overlay"],
      sourceElementIds: undefined,
      opacity: undefined,
      interactive: false,
      hideSource: undefined,
    },
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
    committedImage.metadata?.sourceSrc,
    "/photo.png",
    "completed session should keep the original source image in metadata",
  );
  assertDeepEqual(
    committedImage.metadata?.sourceTransform,
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
    ["session-image:slot"],
    "complete session should export the active working slot image",
  );
  assertDeepEqual(
    exportService.calls[0]?.sourceLayerIds,
    ["image.user.session.image"],
    "complete session should export the working image from the session pass",
  );

  const committedRender = (await canvasService.getRenderProducerResult(
    IMAGE_PLACEMENT_CAPABILITY_ID,
  )) as any;
  const committedImagePass = committedRender.passes.find(
    (pass: any) => pass.targetLayerId === "artwork",
  );
  const clearedImageSessionPass = committedRender.passes.find(
    (pass: any) => pass.id === "image.user.session.image",
  );
  assertEqual(
    committedImagePass?.targetLayerId,
    "artwork",
    "completed slot should render through the slot business layer",
  );
  assert(
    committedImagePass?.objects.some((spec: any) => spec.id === "image:slot"),
    "completed slot should render the processed production image object",
  );
  assert(
    !clearedImageSessionPass?.objects.some(
      (spec: any) => spec.id === "session-image:slot",
    ),
    "completed slot should clear the framework session image pass",
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

  const producerResult = (await canvasService.getRenderProducerResult(
    DIELINE_GEOMETRY_CAPABILITY_ID,
  )) as any;
  const pass = producerResult?.passes?.find(
    (item: any) => item.id === "dieline-overlay",
  );
  assert(pass, "dieline render producer should expose the dieline overlay pass");

  const sessions = runtime.services.getOrThrow(TOOL_SESSION_SERVICE);
  const context = {
    activeToolId: null,
    hasAnyActiveSession: () => sessions.hasAnyActiveSession(),
    isSessionActive: (toolId: string) => sessions.hasActiveSession(toolId),
  };

  assertEqual(
    evaluateVisibilityExpr(pass.visibility, context),
    true,
    "dieline overlay should be visible when no edit session is active",
  );

  await sessions.begin(IMAGE_PLACEMENT_CAPABILITY_ID);
  assertEqual(
    evaluateVisibilityExpr(pass.visibility, context),
    false,
    "dieline overlay should be hidden during image placement sessions",
  );
  sessions.deactivateSession(IMAGE_PLACEMENT_CAPABILITY_ID);

  await sessions.begin(WHITE_INK_CAPABILITY_ID);
  assertEqual(
    evaluateVisibilityExpr(pass.visibility, context),
    false,
    "dieline overlay should be hidden during white ink sessions",
  );
  sessions.deactivateSession(WHITE_INK_CAPABILITY_ID);

  await sessions.begin(DIELINE_GEOMETRY_CAPABILITY_ID);
  assertEqual(
    evaluateVisibilityExpr(pass.visibility, context),
    true,
    "dieline overlay should remain visible during dieline sessions",
  );

  sessions.deactivateSession(DIELINE_GEOMETRY_CAPABILITY_ID);

  assertEqual(
    evaluateVisibilityExpr(pass.visibility, context),
    true,
    "dieline overlay should be restored after edit sessions end",
  );
  assertDeepEqual(
    pass.effects ?? [],
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
    cutMarginMm: 10,
    cutMode: "outset",
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
        runtime.config.update("size.cutMode", "trim");
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
  assertEqual(
    runtime.config.get("size.cutMode"),
    "trim",
    "dieline geometry should normalize cut mode when requested",
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

async function testBackgroundCapabilityExtension() {
  const runtime = new Pooder();

  runtime.services.register(new FakeCanvasService() as any, CANVAS_SERVICE);
  runtime.extensions.register(
    new BackgroundCapabilityExtension({
      configNamespace: "storefrontBackground",
      layers: {
        backgroundLayerId: "app.background",
      },
    }),
  );

  await runtime.extensions.flushActivation();

  assertEqual(
    runtime.extensions.getState(BACKGROUND_CAPABILITY_ID)?.state,
    "active",
    "background capability should activate",
  );

  const facade = runtime.capabilities.get<BackgroundCapabilityApi>(
    BACKGROUND_CAPABILITY_ID,
  );
  if (!facade) {
    throw new Error("background capability facade should be registered");
  }

  const toolRegistry = runtime.services.getOrThrow<ToolRegistryService>(
    "ToolRegistryService",
  );
  assert(
    !toolRegistry.hasTool(BACKGROUND_CAPABILITY_ID),
    "background capability registration should not require a tool",
  );
  assert(
    runtime.config.getDefinition("storefrontBackground.config"),
    "background capability should accept caller config namespace",
  );

  facade.upsertLayer({
    id: "hero",
    kind: "color",
    anchor: "viewport",
    fit: "cover",
    opacity: 1,
    order: 1,
    enabled: true,
    exportable: false,
    color: "#fff",
  });
  assert(
    facade.getConfig().layers.some((layer) => layer.id === "hero"),
    "background capability should expose config mutation facade",
  );

  await runtime.dispose();
}

async function testTemplateOverlayCapabilityExtension() {
  const runtime = new Pooder();

  runtime.services.register(new FakeCanvasService() as any, CANVAS_SERVICE);
  runtime.extensions.register(
    new TemplateOverlayCapabilityExtension({
      configNamespace: "storefrontTemplate",
      layers: {
        clipTargetLayerIds: ["app.image"],
        normalLayerId: "app.template.normal",
      },
    }),
  );

  await runtime.extensions.flushActivation();

  assertEqual(
    runtime.extensions.getState(TEMPLATE_OVERLAY_CAPABILITY_ID)?.state,
    "active",
    "template overlay capability should activate",
  );

  const facade = runtime.capabilities.get<TemplateOverlayCapabilityApi>(
    TEMPLATE_OVERLAY_CAPABILITY_ID,
  );
  if (!facade) {
    throw new Error("template overlay capability facade should be registered");
  }

  const toolRegistry = runtime.services.getOrThrow<ToolRegistryService>(
    "ToolRegistryService",
  );
  assert(
    !toolRegistry.hasTool(TEMPLATE_OVERLAY_CAPABILITY_ID),
    "template overlay capability registration should not require a tool",
  );
  assert(
    runtime.config.getDefinition("storefrontTemplate.config"),
    "template overlay capability should accept caller config namespace",
  );

  const patched = await facade.patchConfig({
    clip: { enabled: true, targetLayerIds: ["app.image"] },
  });
  assert(
    patched.clip?.targetLayerIds?.[0] === "app.image",
    "template overlay capability should expose config mutation facade",
  );

  await runtime.dispose();
}

async function testTemplateOverlayConfigSyncsSceneProjectionSources() {
  const runtime = new Pooder();

  runtime.services.register(new FakeCanvasService() as any, CANVAS_SERVICE);
  runtime.config.update("size.actualWidthMm", 200);
  runtime.config.update("size.actualHeightMm", 100);
  runtime.config.update("size.cutMode", "trim");
  runtime.config.update("size.cutMarginMm", 0);

  const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
  scene.addLayer({ id: "front.template-overlay" });
  scene.addElement({
    id: "front.template.normal",
    layerId: "front.template-overlay",
    type: "image",
    src: "/old-template.png",
    width: 200,
    height: 100,
    metadata: {
      templateOverlay: {
        targetOverlaySlot: "normal",
      },
    },
    transform: {
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
    },
  });
  runtime.extensions.register(new TemplateOverlayCapabilityExtension());
  await runtime.extensions.flushActivation();

  const facade = runtime.capabilities.get<TemplateOverlayCapabilityApi>(
    TEMPLATE_OVERLAY_CAPABILITY_ID,
  );
  if (!facade) {
    throw new Error("template overlay capability facade should be registered");
  }

  await facade.replaceConfig({
    version: 1,
    slots: {
      normal: {
        enabled: true,
        src: "/new-template.png",
        placement: {
          space: "surfaceFrameRatio",
          x: 0.25,
          y: 0.1,
          width: 0.5,
          height: 0.4,
        },
      },
    },
  });

  const source = scene.getElement("front.template.normal") as any;
  assertEqual(
    source.src,
    "/new-template.png",
    "template overlay config should update scene projection source src",
  );
  assertEqual(
    source.width,
    100,
    "template overlay config should update scene projection source width",
  );
  assertEqual(
    source.height,
    40,
    "template overlay config should update scene projection source height",
  );
  assertEqual(
    source.transform.left,
    350,
    "template overlay config should update scene projection source x",
  );
  assertEqual(
    source.transform.top,
    260,
    "template overlay config should update scene projection source y",
  );

  await runtime.dispose();
}

async function testSizeCapabilityExtension() {
  const runtime = new Pooder();

  runtime.services.register(new FakeCanvasService() as any, CANVAS_SERVICE);
  runtime.extensions.register(new SizeCapabilityExtension());

  await runtime.extensions.flushActivation();

  assertEqual(
    runtime.extensions.getState(SIZE_CAPABILITY_ID)?.state,
    "active",
    "size capability should activate",
  );

  const facade =
    runtime.capabilities.get<SizeCapabilityApi>(SIZE_CAPABILITY_ID);
  if (!facade) {
    throw new Error("size capability facade should be registered");
  }

  const toolRegistry = runtime.services.getOrThrow<ToolRegistryService>(
    "ToolRegistryService",
  );
  assert(
    !toolRegistry.hasTool(SIZE_CAPABILITY_ID),
    "size capability registration should not require a tool",
  );

  facade.setUnit("cm");
  assertEqual(
    runtime.config.get("size.unit"),
    "cm",
    "size capability should mutate shared size config",
  );
  assert(
    !!facade.getState(),
    "size capability should expose current size state",
  );

  await runtime.dispose();
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
  testTemplateOverlayConfig();
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
  await testApplyKitEditorDocumentMissingCapabilities();
  await testImagePlacementCapabilityExtension();
  await testImagePlacementSessionUsesEditableWorkingObject();
  await testEdgeDetectionCapabilityExtension();
  await testDielineOverlayVisibilityFollowsEditingSessions();
  testImageSessionShapeOverlayUsesDielineGeometry();
  await testDielineGeometryCapabilityExtension();
  await testWhiteInkCapabilityExtension();
  await testBackgroundCapabilityExtension();
  await testTemplateOverlayCapabilityExtension();
  await testTemplateOverlayConfigSyncsSceneProjectionSources();
  await testSizeCapabilityExtension();
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
