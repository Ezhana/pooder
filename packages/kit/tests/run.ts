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
  normalizeImagePlacementConfigNamespace,
  normalizeImagePlacementLayerId,
  type ImagePlacementCapabilityApi,
} from "../src/extensions/image/capability";
import {
  DIELINE_GEOMETRY_CAPABILITY_ID,
  createDielineGeometryCapabilityDefinition,
  normalizeDielineGeometryLayerId,
  upsertScenePathElement,
  type DielineGeometryCapabilityApi,
} from "../src/extensions/dieline/capability";
import {
  EDGE_DETECTION_CAPABILITY_ID,
  EdgeDetectionCapabilityExtension,
  type EdgeDetectionCapabilityApi,
} from "../src/extensions/edge-detection";
import { createImageCommands } from "../src/extensions/image/commands";
import { createImageConfigurations } from "../src/extensions/image/config";
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
  evaluateVisibilityExpr,
} from "@pooder/core";
import {
  COMMAND_SERVICE,
  SCENE_SERVICE,
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

  registerRenderProducer() {
    return {
      dispose: () => {},
    };
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
      items: [],
      hasAnyImage: false,
      focusedId: null,
      focusedItem: null,
      isToolActive: false,
      isImageSelectionActive: false,
      hasWorkingChanges: false,
      source: "committed",
      placementPolicy: "free",
      sessionNotice: null,
    }) === false,
    "empty image state should report false",
  );
  assert(
    hasAnyImageInViewState({
      items: [
        {
          id: "img-1",
          url: "blob:test",
          opacity: 1,
        },
      ],
      hasAnyImage: true,
      focusedId: "img-1",
      focusedItem: {
        id: "img-1",
        url: "blob:test",
        opacity: 1,
      },
      isToolActive: true,
      isImageSelectionActive: true,
      hasWorkingChanges: true,
      source: "working",
      placementPolicy: "free",
      sessionNotice: null,
    }) === true,
    "non-empty image state should report true",
  );
}

function testContributionCompatibility() {
  const imageCommandNames = createImageCommands({} as any).map(
    (entry) => entry.command,
  );
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

  const expectedImageCommands = [
    "addImage",
    "upsertImage",
    "applyImageOperation",
    "getImageViewState",
    "setImageTransform",
    "imageSessionReset",
    "validateImageSession",
    "completeImages",
    "exportUserCroppedImage",
    "focusImage",
    "removeImage",
    "updateImage",
    "clearImages",
    "bringToFront",
    "sendToBack",
  ];
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
    JSON.stringify(imageCommandNames) === JSON.stringify(expectedImageCommands),
    `image command set changed: ${JSON.stringify(imageCommandNames)}`,
  );
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

  const imageConfigKeys = createImageConfigurations().map((entry) => entry.id);
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

  const expectedImageConfigKeys = [
    "image.items",
    "image.debug",
    "image.control.cornerSize",
    "image.control.touchCornerSize",
    "image.control.cornerStyle",
    "image.control.cornerColor",
    "image.control.cornerStrokeColor",
    "image.control.transparentCorners",
    "image.control.borderColor",
    "image.control.borderScaleFactor",
    "image.control.padding",
    "image.frame.strokeColor",
    "image.frame.strokeWidth",
    "image.frame.strokeStyle",
    "image.frame.dashLength",
    "image.frame.innerBackground",
    "image.frame.outerBackground",
    "image.session.placementPolicy",
  ];
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
    JSON.stringify(imageConfigKeys) === JSON.stringify(expectedImageConfigKeys),
    `image config keys changed: ${JSON.stringify(imageConfigKeys)}`,
  );
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
    normalizeImagePlacementConfigNamespace(" storefrontImage "),
    "storefrontImage",
    "image placement config namespace should trim caller input",
  );
  assertEqual(
    normalizeImagePlacementConfigNamespace(""),
    "image",
    "image placement config namespace should fall back",
  );
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
    version: 1,
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

  assertDeepEqual(
    capabilities.map((item) => item.id).sort(),
    [
      DIELINE_GEOMETRY_CAPABILITY_ID,
      FEATURE_CAPABILITY_ID,
      IMAGE_PLACEMENT_CAPABILITY_ID,
      TEMPLATE_OVERLAY_CAPABILITY_ID,
    ].sort(),
    "document helper should create each referenced kit capability once",
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
  const templateCalls: any[] = [];
  const imageCalls: any[] = [];
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
        getViewState: () => ({}) as any,
        addImage: async () => "image-1",
        upsertImage: async (url: string, options: any) => {
          imageCalls.push({ url, options });
          return { id: options?.id ?? "image-1", mode: "add" as const };
        },
        setImageTransform: async () => {},
        applyImageOperation: async () => {},
        focusImage: () => ({ ok: true }),
        resetSession: () => {},
        validateSession: async () => ({ ok: true }),
        completeSession: async () => ({ ok: true }),
        exportUserCroppedImage: async () => ({}) as any,
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
  await runtime.extensions.flushActivation();

  const result = await applyKitEditorDocument(runtime, {
    version: 1,
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
                id: "front-template-image",
                type: "template",
                assetId: "template",
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
                type: "slot",
                accepts: ["image"],
                frame: { x: 10, y: 20, width: 30, height: 40 },
              },
              {
                id: "front-photo",
                type: "image",
                assetId: "photo",
                effects: [{ type: "image-placement" }],
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
    "slot should be projected as scene rect",
  );
  assertEqual(
    scene.getElement("front-template-image")?.type,
    "image",
    "template should be projected as scene image",
  );
  assertEqual(
    runtime.config.get("dieline.shape"),
    "circle",
    "dieline payload should update config",
  );
  assert(templateCalls.length > 0, "template effect should call facade");
  assertEqual(
    imageCalls[0]?.url,
    "/photo.png",
    "image placement effect should use image asset source",
  );
  assertEqual(
    imageCalls[0]?.options?.mode,
    "add",
    "document image placement should add new image objects",
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
    version: 1,
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
    version: 1,
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
    addImage: async () => "image-1",
    applyImageOperation: async () => {},
    completeSession: async () => ({ ok: true }),
    exportUserCroppedImage: async () => ({
      format: "png",
      height: 1,
      imageIds: [],
      multiplier: 1,
      url: "data:image/png;base64,test",
      width: 1,
    }),
    focusImage: (id) => ({ ok: true, id }),
    getViewState: () => ({
      focusedId: null,
      focusedItem: null,
      hasAnyImage: false,
      hasWorkingChanges: false,
      isImageSelectionActive: false,
      isToolActive: false,
      items: [],
      placementPolicy: "free",
      sessionNotice: null,
      source: "committed",
    }),
    resetSession: () => {},
    setImageTransform: async () => {},
    upsertImage: async () => ({ id: "image-1", mode: "add" }),
    validateSession: async () => ({ ok: true }),
  };
  runtime.extensions.register({
    id: "test.image-placement",
    activate() {},
    contribute() {
      return {
        capabilities: [
          createImagePlacementCapabilityDefinition(facade, {
            configNamespace: "storefrontImage",
            layers: {
              imageLayerId: "app.image",
              overlayLayerId: "app.image.overlay",
            },
          }),
        ],
        configurations: createImageConfigurations("storefrontImage"),
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
    registeredFacade.getViewState().items,
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
  assert(
    runtime.config.getDefinition("storefrontImage.items"),
    "image placement capability should accept caller config namespace",
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
  await testApplyKitEditorDocument();
  await testApplyKitEditorDocumentMissingCapabilities();
  await testImagePlacementCapabilityExtension();
  await testEdgeDetectionCapabilityExtension();
  await testDielineGeometryCapabilityExtension();
  await testWhiteInkCapabilityExtension();
  await testBackgroundCapabilityExtension();
  await testTemplateOverlayCapabilityExtension();
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
