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
import { evaluateVisibilityExpr } from "../src/services/visibility";
import { createImageCommands } from "../src/extensions/image/commands";
import { createImageConfigurations } from "../src/extensions/image/config";
import { createWhiteInkCommands } from "../src/extensions/white-ink/commands";
import { createWhiteInkConfigurations } from "../src/extensions/white-ink/config";
import { createDielineCommands } from "../src/extensions/dieline/commands";
import { createDielineConfigurations } from "../src/extensions/dieline/config";
import {
  normalizePointInGeometry,
  resolveFeaturePosition,
} from "../src/extensions/featureCoordinates";
import { hasAnyImageInViewState } from "../src/extensions/image/model";
import { WhiteInkTool } from "../src/extensions/white-ink/WhiteInkTool";
import { DielineWorkflowExtension } from "../src/extensions/dieline-workflow";
import {
  COMMAND_SERVICE,
  type CommandContribution,
  type CommandService,
  type ExtensionDefinition,
  Pooder,
  ToolRegistryService,
} from "@pooder/core";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

class FakeCanvasService {
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

  getSceneScale() {
    return 1;
  }

  toSceneRect<T extends { left: number; top: number; width: number; height: number }>(
    rect: T,
  ) {
    return { ...rect };
  }

  toScreenRect<T extends { left: number; top: number; width: number; height: number }>(
    rect: T,
  ) {
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

  getScreenViewportRect() {
    return {
      left: 0,
      top: 0,
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }

  getPassObjects() {
    return [];
  }
}

function createCommandExtension(
  id: string,
  options: {
    activation?: ExtensionDefinition["activation"];
    commands?: CommandContribution[];
    tools?: Array<{ id: string; name: string; interaction: "instant" | "session" | "hybrid" }>;
  } = {},
): ExtensionDefinition {
  return {
    id,
    activation: options.activation,
    contribute() {
      return {
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
  const expectedDielineCommands = [
    "updateFeaturePosition",
    "exportCutImage",
    "detectEdge",
  ];

  assert(
    JSON.stringify(imageCommandNames) === JSON.stringify(expectedImageCommands),
    `image command set changed: ${JSON.stringify(imageCommandNames)}`,
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

async function testExtensionDependencyActivation() {
  const runtime = new Pooder();
  runtime.extensions.register(new WhiteInkTool());
  runtime.extensions.register({
    id: "pooder.kit.image",
    activation: {
      requiresServices: ["CanvasService"],
    },
    contribute() {
      return {
        tools: [
          {
            id: "pooder.kit.image",
            name: "Image",
            interaction: "session",
          },
        ],
      };
    },
    activate() {},
  });

  await runtime.extensions.flushActivation();

  assert(
    runtime.extensions.getState("pooder.kit.image")?.state === "pending",
    "image dependency should stay pending without CanvasService",
  );
  assert(
    runtime.extensions.getState("pooder.kit.white-ink")?.state === "pending",
    "white-ink tool should stay pending until its hard dependency is active",
  );

  runtime.services.register(new FakeCanvasService() as any, "CanvasService");
  await runtime.extensions.flushActivation();

  assert(
    runtime.extensions.getState("pooder.kit.image")?.state === "active",
    "image dependency should activate after CanvasService registration",
  );
  assert(
    runtime.extensions.getState("pooder.kit.white-ink")?.state === "active",
    "white-ink tool should activate after image and CanvasService are ready",
  );

  const toolRegistry = runtime.services.getOrThrow<ToolRegistryService>(
    "ToolRegistryService",
  );
  assert(
    toolRegistry.hasTool("pooder.kit.image"),
    "image dependency should register in the tool registry",
  );
  assert(
    toolRegistry.hasTool("pooder.kit.white-ink"),
    "white-ink tool should register in the tool registry",
  );
}

async function testDielineWorkflowExtensionActivation() {
  const runtime = new Pooder();
  const commandService =
    runtime.services.getOrThrow<CommandService>(COMMAND_SERVICE);

  runtime.extensions.register(new DielineWorkflowExtension());
  runtime.extensions.register(
    createCommandExtension("pooder.kit.image", {
      activation: {
        requiresServices: ["CanvasService"],
      },
      tools: [
        {
          id: "pooder.kit.image",
          name: "Image",
          interaction: "session",
        },
      ],
      commands: [
        {
          id: "upsertImage",
          command: "upsertImage",
          title: "Upsert Image",
          handler: async () => ({ id: "image-1", mode: "add" as const }),
        },
        {
          id: "exportUserCroppedImage",
          command: "exportUserCroppedImage",
          title: "Export User Cropped Image",
          handler: async () => ({
            url: "blob:frame",
            width: 100,
            height: 80,
            multiplier: 2,
            format: "png" as const,
            imageIds: ["image-1"],
          }),
        },
      ],
    }),
  );
  runtime.extensions.register(
    createCommandExtension("pooder.kit.dieline", {
      activation: {
        requiresServices: ["CanvasService"],
      },
      commands: [
        {
          id: "detectEdge",
          command: "detectEdge",
          title: "Detect Edge",
          handler: async () => ({
            pathData: "M0 0",
          }),
        },
      ],
    }),
  );

  await runtime.extensions.flushActivation();

  assertEqual(
    runtime.extensions.getState("pooder.kit.dieline-workflow")?.state,
    "pending",
    "workflow extension should stay pending until its hard dependencies are active",
  );
  assertEqual(
    commandService.getCommand("detectDielineFromFrame"),
    undefined,
    "workflow commands should not leak before activation",
  );

  runtime.services.register(new FakeCanvasService() as any, "CanvasService");
  await runtime.extensions.flushActivation();

  assertEqual(
    runtime.extensions.getState("pooder.kit.dieline-workflow")?.state,
    "active",
    "workflow extension should activate once image and dieline dependencies are ready",
  );
  assert(
    !!commandService.getCommand("detectDielineFromFrame"),
    "workflow command should register after activation",
  );
  assert(
    !!commandService.getCommand("uploadAndDetectEdge"),
    "uploadAndDetectEdge should register after activation",
  );
}

async function testDielineWorkflowExtensionCommands() {
  const runtime = new Pooder();
  const exportResponses = [
    {
      url: "blob:preview-source",
      width: 120,
      height: 80,
      multiplier: 2,
      format: "png" as const,
      imageIds: ["image-1"],
    },
    {
      url: "blob:commit-source",
      width: 120,
      height: 80,
      multiplier: 2,
      format: "png" as const,
      imageIds: ["image-1"],
    },
    {
      url: "blob:verify-source",
      width: 120,
      height: 80,
      multiplier: 2,
      format: "png" as const,
      imageIds: ["image-1"],
    },
  ];
  const detectResponses = [
    {
      pathData: "M0 0 L1 1",
      rawBounds: { x: 8, y: 10, width: 90, height: 56 },
      baseBounds: { x: 12, y: 14, width: 82, height: 48 },
      imageWidth: 120,
      imageHeight: 80,
    },
    {
      pathData: "M2 2 L3 3",
      rawBounds: { x: 6, y: 8, width: 96, height: 60 },
      baseBounds: { x: 12, y: 14, width: 84, height: 48 },
      imageWidth: 120,
      imageHeight: 80,
    },
    {
      pathData: "M4 4 L5 5",
      rawBounds: { x: 4, y: 6, width: 104, height: 68 },
      baseBounds: { x: 12, y: 14, width: 88, height: 52 },
      imageWidth: 120,
      imageHeight: 80,
    },
    {
      pathData: "M6 6 L7 7",
      rawBounds: { x: 10, y: 12, width: 88, height: 52 },
      baseBounds: { x: 14, y: 16, width: 80, height: 44 },
      imageWidth: 120,
      imageHeight: 80,
    },
  ];

  runtime.extensions.register(new DielineWorkflowExtension());
  runtime.extensions.register(
    createCommandExtension("pooder.kit.image", {
      commands: [
        {
          id: "upsertImage",
          command: "upsertImage",
          title: "Upsert Image",
          handler: async () => ({ id: "image-99", mode: "add" as const }),
        },
        {
          id: "exportUserCroppedImage",
          command: "exportUserCroppedImage",
          title: "Export User Cropped Image",
          handler: async () => exportResponses.shift() ?? null,
        },
      ],
    }),
  );
  runtime.extensions.register(
    createCommandExtension("pooder.kit.dieline", {
      commands: [
        {
          id: "detectEdge",
          command: "detectEdge",
          title: "Detect Edge",
          handler: async () => detectResponses.shift() ?? null,
        },
      ],
    }),
  );

  await runtime.extensions.flushActivation();

  const preview = await runtime.commands.execute<{
    pathData: string;
    diagnostics?: { sourceWidth: number };
    sourceImage?: { url: string };
    postCommitDiagnostics?: unknown;
  }>("detectDielineFromFrame", {
    commit: false,
    detect: {
      expand: 6,
    },
    inspect: {
      includeCroppedImage: true,
      includeDiagnostics: true,
    },
  });

  assertEqual(
    preview.pathData,
    "M0 0 L1 1",
    "preview branch should return the first detectEdge result",
  );
  assertEqual(
    preview.diagnostics?.sourceWidth,
    120,
    "preview branch should compute frame diagnostics",
  );
  assertEqual(
    preview.sourceImage?.url,
    "blob:preview-source",
    "preview branch should retain the exported source image when requested",
  );
  assertEqual(
    runtime.config.get("dieline.shape"),
    undefined,
    "preview branch should not commit dieline config",
  );

  const committed = await runtime.commands.execute<{
    pathData: string;
    postCommitDiagnostics?: { expectedExpand: number; margin?: { left: number } | null };
  }>("detectDielineFromFrame", {
    detect: {
      expand: 6,
    },
    inspect: {
      includeDiagnostics: true,
    },
  });

  assertEqual(
    committed.pathData,
    "M2 2 L3 3",
    "commit branch should return the committed detectEdge result",
  );
  assertEqual(
    runtime.config.get("dieline.shape"),
    "custom",
    "commit branch should update the dieline shape",
  );
  assertEqual(
    runtime.config.get("dieline.pathData"),
    "M2 2 L3 3",
    "commit branch should update the dieline path data",
  );
  assertEqual(
    runtime.config.get("size.cutMode"),
    "trim",
    "commit branch should normalize the cut mode",
  );
  assertEqual(
    committed.postCommitDiagnostics?.expectedExpand,
    6,
    "commit branch should report post-commit diagnostics when requested",
  );
  assertEqual(
    committed.postCommitDiagnostics?.margin?.left,
    8,
    "post-commit diagnostics should be derived from raw/base bounds",
  );

  const uploaded = await runtime.commands.execute<{
    imageId: string;
    pathData: string;
  }>("uploadAndDetectEdge", "https://example.com/image.png");

  assertEqual(
    uploaded.imageId,
    "image-99",
    "uploadAndDetectEdge should return the upserted image id",
  );
  assertEqual(
    uploaded.pathData,
    "M6 6 L7 7",
    "uploadAndDetectEdge should return the detectEdge path",
  );
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
  await testExtensionDependencyActivation();
  await testDielineWorkflowExtensionActivation();
  await testDielineWorkflowExtensionCommands();
  console.log("ok");
}

void main();
