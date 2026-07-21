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
  type DesignExportCapabilityApi,
} from "../src/extensions/design-export";
import {
  IMAGE_MASK_CAPABILITY_ID,
  ImageMaskCapabilityExtension,
  createImageMaskCapabilityDefinition,
  type ImageMaskCapabilityApi,
} from "../src/extensions/image-mask";
import {
  SCENE_EXPORT_CAPABILITY_ID,
  SceneExportCapabilityExtension,
  createSceneExportCapabilityDefinition,
  type SceneExportCapabilityApi,
} from "../src/extensions/scene-export";
import {
  CLIP_CAPABILITY_ID,
  ClipCapabilityExtension,
  normalizeClipEffectPayload,
} from "../src/extensions/clip";
import {
  MIRROR_CAPABILITY_ID,
  MirrorCapabilityExtension,
  createMirrorCapabilityDefinition,
  type MirrorCapabilityApi,
} from "../src/extensions/mirror";
import {
  CONFIGURABLE_VISUAL_CAPABILITY_ID,
  type ConfigurableVisualCapabilityApi,
} from "../src/extensions/configurable-visual";
import { createDielineCommands } from "../src/extensions/dieline/commands";
import { createDielineConfigurations } from "../src/extensions/dieline/config";
import { listLegacyCommandBridges } from "../src/extensions/legacyCommandBridge";
import {
  normalizePointInGeometry,
  resolveFeaturePosition,
} from "../src/extensions/featureCoordinates";
import {
  createPaperPathGeometryBackend,
  createPaperPathGeometrySnapshot,
} from "../src/extensions/geometry";
import {
  FEATURE_CAPABILITY_ID,
  createFeatureCapabilityDefinition,
  type FeatureCapabilityApi,
} from "../src/extensions/feature/capability";
import { hasAnyImageInViewState } from "../src/extensions/image/model";
import { IMAGE_PLACEMENT_OPEN_SESSION_COMMAND_ID } from "../src/document/imagePlacementInteraction";
import {
  createDielineGeometryCapability,
  createClipCapability,
  createFeatureCapability,
  createConfigurableVisualCapability,
  createImageMaskCapability,
  createImagePlacementCapability,
  createMirrorCapability,
  createSceneExportCapability,
} from "../src/factories";
import {
  applyKitEditorDocument,
  createKitEditorDocumentController,
} from "../src/document";
import { createKitCapabilitiesForDocument } from "../src/document/capabilities";
import {
  SCENE_EXPORT_SERVICE,
  CANVAS_SERVICE,
  IMAGE_GEOMETRY_DATA_KEY,
  INTERACTION_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_LAYOUT_SERVICE,
  SURFACE_FRAME_SERVICE,
  createStaticGeometrySource,
  evaluateRuntimeCondition,
  GeometrySourceService,
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
  type InteractionService,
  Pooder,
  type RenderIntentService,
  type SceneChangeEvent,
  type SceneService,
  type SessionService,
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

async function testPaperPathGeometryProviderUtilities() {
  const snapshot = createPaperPathGeometrySnapshot({
    pathData: "M 0 0 L 100 0 L 100 100 Z",
    ref: { sourceId: "paper", geometryId: "triangle" },
    space: "scene",
  });
  const geometry = new GeometrySourceService();
  geometry.registerBackend(createPaperPathGeometryBackend());
  geometry.registerSource(
    createStaticGeometrySource({
      sourceId: "paper",
      geometries: [snapshot],
    }),
  );
  assertDeepEqual(
    geometry.getBounds(snapshot.ref),
    { left: 0, top: 0, width: 100, height: 100 },
    "paper path geometry should expose bounds through core utilities",
  );
  assertDeepEqual(
    geometry.nearestPoint(snapshot.ref, { x: 50, y: 10 }),
    { x: 50, y: 0 },
    "paper path geometry should expose nearest point through core utilities",
  );
  assertEqual(
    geometry.contains(snapshot.ref, { x: 90, y: 10 }),
    true,
    "paper path geometry should expose containment through core utilities",
  );
  assertDeepEqual(
    geometry.sample(snapshot.ref, 0),
    { x: 0, y: 0 },
    "paper path geometry should expose sampling through core utilities",
  );
  const normal = geometry.normalAt(snapshot.ref, { x: 50, y: 10 });
  assert(
    Boolean(normal && Number.isFinite(normal.x) && Number.isFinite(normal.y)),
    "paper path geometry should expose normals through core utilities",
  );
}

const TEST_DOCUMENT_CONFIG = {};
const TEST_SURFACE_FRAMES = {
  previewBounds: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
  productionFrame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
  viewportFocusFrame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
};

function imagePlacementCommittedVisibleWhen(placementId: string) {
  return {
    op: "not",
    expr: {
      op: "truthy",
      ref: {
        source: "context",
        key: `${IMAGE_PLACEMENT_CAPABILITY_ID}.image-placement.active-placement.${placementId}`,
      },
    },
  };
}

type ImagePlacementSessionInput =
  | string
  | {
      placementId: string;
      sessionId?: string;
    };

type ImagePlacementTestDriver = {
  beginSession(input: ImagePlacementSessionInput): Promise<unknown>;
  setImageSource(
    input: ImagePlacementSessionInput,
    source: { src: string; metadata?: Record<string, unknown> },
  ): Promise<unknown>;
  setImageTransform(
    input: ImagePlacementSessionInput,
    updates: {
      left?: number;
      top?: number;
      scale?: number;
      angle?: number;
      opacity?: number;
    },
  ): Promise<unknown>;
  completeSession(input?: ImagePlacementSessionInput): Promise<unknown>;
  exportPlacementImage(options?: {
    placementIds?: string[];
    multiplier?: number;
    format?: "png" | "jpeg";
  }): Promise<unknown>;
  resetSession(input?: ImagePlacementSessionInput): Promise<void>;
};

function getImagePlacementTestDriver(
  extension: unknown,
): ImagePlacementTestDriver {
  return extension as ImagePlacementTestDriver;
}

class FakeCanvasService {
  private activeObject: any = null;
  private readonly eventHandlers = new Map<
    string,
    Set<(event?: any) => void>
  >();

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

  selectObjects(options: any = {}) {
    const objects = this.canvas.getObjects();
    return objects.filter((object: any) => {
      const data = object?.data ?? {};
      const layerId = data.layerId ?? data.passId ?? object.layerId;
      const type = data.type ?? object.type;
      if (
        options.visible !== undefined &&
        object?.visible !== options.visible
      ) {
        return false;
      }
      if (options.layerIds?.length && !options.layerIds.includes(layerId)) {
        return false;
      }
      if (options.ids?.length && !options.ids.includes(data.id)) {
        return false;
      }
      if (options.types?.length && !options.types.includes(type)) {
        return false;
      }
      if (options.data) {
        return Object.entries(options.data).every(
          ([key, expected]) => data[key] === expected,
        );
      }
      return true;
    });
  }

  selectOneObject(options: any) {
    const objects = this.selectObjects(options);
    if (objects.length > 1) {
      throw new Error("canvas-selector-ambiguous");
    }
    return objects[0];
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

  on(eventName: string, handler: (event?: any) => void) {
    let handlers = this.eventHandlers.get(eventName);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(eventName, handlers);
    }
    handlers.add(handler);
    return {
      dispose: () => handlers?.delete(handler),
    };
  }

  onCanvasEvent(eventName: string, handler: (event?: any) => void) {
    let handlers = this.eventHandlers.get(eventName);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(eventName, handlers);
    }
    handlers.add(handler);
  }

  emit(eventName: string, event?: unknown) {
    this.eventHandlers.get(eventName)?.forEach((handler) => handler(event));
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
    this.viewport.layout.offsetX =
      (options.containerWidth - options.widthMm) / 2;
    this.viewport.layout.offsetY =
      (options.containerHeight - options.heightMm) / 2;
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
    source: {
      layerIds: [],
      elementIds: [],
      tags: [],
    },
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
  } = {},
): ExtensionDefinition {
  return {
    id,
    activation: options.activation,
    contribute() {
      return {
        capabilities: options.capabilities ?? [],
        commands: options.commands ?? [],
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

function testRuntimeConditionDsl() {
  const layers = new Map([
    ["measurement-overlay", { exists: true, objectCount: 2 }],
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
    evaluateRuntimeCondition({ op: "const", value: true }, context) === true,
    "const true failed",
  );
  assert(
    evaluateRuntimeCondition({ op: "const", value: false }, context) === false,
    "const false failed",
  );
  assert(
    evaluateRuntimeCondition(
      {
        op: "in",
        ref: { source: "activeToolId" },
        values: ["pooder.kit.image"],
      },
      context,
    ) === true,
    "activeToolId in true failed",
  );
  assert(
    evaluateRuntimeCondition(
      {
        op: "in",
        ref: { source: "activeToolId" },
        values: ["pooder.kit.measurement"],
      },
      context,
    ) === false,
    "activeToolId in false failed",
  );
  assert(
    evaluateRuntimeCondition(
      {
        op: "truthy",
        ref: {
          source: "workflowSession",
          field: "active",
          sessionId: "session.feature",
        },
      },
      context,
    ) === true,
    "workflowSession active true failed",
  );
  assert(
    evaluateRuntimeCondition(
      {
        op: "truthy",
        ref: {
          source: "workflowSession",
          field: "active",
          sessionId: "session.measurement",
        },
      },
      context,
    ) === false,
    "workflowSession active false failed",
  );
  assert(
    evaluateRuntimeCondition(
      {
        op: "truthy",
        ref: { source: "workflowSession", field: "anyActive" },
      },
      context,
    ) === true,
    "workflowSession anyActive true failed",
  );
  assert(
    evaluateRuntimeCondition(
      {
        op: "truthy",
        ref: {
          source: "renderLayer",
          layerId: "measurement-overlay",
          field: "exists",
        },
      },
      context,
    ) === true,
    "renderLayer exists true failed",
  );
  assert(
    evaluateRuntimeCondition(
      {
        op: "truthy",
        ref: {
          source: "renderLayer",
          layerId: "missing-layer",
          field: "exists",
        },
      },
      context,
    ) === false,
    "renderLayer exists false failed",
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
      evaluateRuntimeCondition(
        {
          op: "compare",
          ref: {
            source: "renderLayer",
            layerId: "measurement-overlay",
            field: "objectCount",
          },
          cmp: entry.cmp,
          value: entry.value,
        },
        context,
      ) === entry.expected,
      `renderLayer objectCount ${entry.cmp} failed`,
    );
  });

  assert(
    evaluateRuntimeCondition(
      {
        op: "not",
        expr: {
          op: "in",
          ref: { source: "activeToolId" },
          values: ["pooder.kit.measurement"],
        },
      },
      context,
    ) === true,
    "not failed",
  );
  assert(
    evaluateRuntimeCondition(
      {
        op: "all",
        exprs: [
          {
            op: "truthy",
            ref: {
              source: "renderLayer",
              layerId: "measurement-overlay",
              field: "exists",
            },
          },
          {
            op: "truthy",
            ref: {
              source: "workflowSession",
              field: "scopeActive",
              scope: { channel: "feature" },
            },
          },
        ],
      },
      context,
    ) === true,
    "all failed",
  );
  assert(
    evaluateRuntimeCondition(
      {
        op: "any",
        exprs: [
          {
            op: "truthy",
            ref: {
              source: "renderLayer",
              layerId: "missing-layer",
              field: "exists",
            },
          },
          {
            op: "in",
            ref: { source: "activeToolId" },
            values: ["pooder.kit.image"],
          },
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
      placements: [],
      hasAnyImage: false,
      activePlacementId: null,
      focusedPlacement: null,
      hasWorkingChanges: false,
      sessionNotice: null,
    }) === false,
    "empty image state should report false",
  );
  assert(
    hasAnyImageInViewState({
      placements: [
        {
          id: "placement-1",
          frame: { left: 0, top: 0, width: 100, height: 100 },
          fit: "cover",
          committedImage: null,
          commitTarget: { type: "document-object", objectId: "placement-1" },
          hasImage: true,
          hasCommittedImage: false,
          image: { src: "blob:test", opacity: 1 },
          layerId: "image",
          order: 0,
          sessionKey: "placement-1",
          visible: true,
        },
      ],
      hasAnyImage: true,
      activePlacementId: "placement-1",
      focusedPlacement: null,
      hasWorkingChanges: true,
      sessionNotice: null,
    }) === true,
    "non-empty image state should report true",
  );
}

function testContributionCompatibility() {
  const allowedLegacyCommands = new Set(
    listLegacyCommandBridges().map((bridge) => bridge.legacyCommand),
  );
  const designExportCommands = createDesignExportCommands({} as any);
  const dielineCommands = createDielineCommands({} as any, {
    width: 0,
    height: 0,
  });
  const designExportCommandNames = designExportCommands.map(
    (entry) => entry.command,
  );
  const dielineCommandNames = dielineCommands.map((entry) => entry.command);

  const expectedDesignExportCommands = ["exportImage"];
  const expectedDielineCommands = ["updateFeaturePosition", "detectEdge"];

  assert(
    JSON.stringify(designExportCommandNames) ===
      JSON.stringify(expectedDesignExportCommands),
    `design export command set changed: ${JSON.stringify(designExportCommandNames)}`,
  );
  assert(
    JSON.stringify(dielineCommandNames) ===
      JSON.stringify(expectedDielineCommands),
    `dieline command set changed: ${JSON.stringify(dielineCommandNames)}`,
  );
  for (const command of [...designExportCommands, ...dielineCommands]) {
    assert(
      command.command.includes(".") ||
        allowedLegacyCommands.has(command.command),
      `unnamespaced command "${command.command}" must be listed as a legacy bridge`,
    );
  }

  let exportCalls = 0;
  const exportCommand = createDesignExportCommands({
    exportImage: async () => {
      exportCalls += 1;
      return { ok: true };
    },
  })[0];
  void exportCommand.handler?.({});
  assertEqual(
    exportCalls,
    1,
    "exportImage bridge should delegate export facade",
  );

  const calls: string[] = [];
  const delegatedDielineCommands = createDielineCommands({
    updateFeaturePosition: (groupId: string, x: number, y: number) => {
      calls.push(`update:${groupId}:${x}:${y}`);
    },
    detectEdge: async () => {
      calls.push("detect");
      return { pathData: "" };
    },
  });
  delegatedDielineCommands[0]?.handler?.("group", 1, 2);
  void delegatedDielineCommands[1]?.handler?.("/image.png");
  assertDeepEqual(
    calls,
    ["update:group:1:2", "detect"],
    "dieline command bridges should delegate typed facade methods",
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
  ];

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
    normalizeClipEffectPayload({
      source: {
        type: "image",
        src: " data:image/png;base64,dieline ",
        space: "screen",
        props: { left: 1, top: 2, width: 100, height: 80 },
      },
    }),
    {
      enabled: true,
      source: {
        type: "image",
        src: "data:image/png;base64,dieline",
        space: "screen",
        props: { left: 1, top: 2, width: 100, height: 80 },
      },
    },
    "clip effect should normalize image clip sources",
  );
  const definitions = [
    createImagePlacementCapabilityDefinition(
      {} as ImagePlacementCapabilityApi,
      {
        capabilityId: "custom.image",
      },
    ),
    createDielineGeometryCapabilityDefinition(
      {} as DielineGeometryCapabilityApi,
      { capabilityId: "custom.dieline" },
    ),
    createDesignExportCapabilityDefinition({} as DesignExportCapabilityApi, {
      capabilityId: "custom.export",
    }),
    createImageMaskCapabilityDefinition({} as ImageMaskCapabilityApi, {
      capabilityId: "custom.image-mask",
    }),
    createSceneExportCapabilityDefinition({} as SceneExportCapabilityApi, {
      capabilityId: "custom.scene-export",
    }),
    createMirrorCapabilityDefinition({} as MirrorCapabilityApi, {
      capabilityId: "custom.mirror",
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
      "custom.image-mask",
      "custom.scene-export",
      "custom.mirror",
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
    source: {
      layerIds: ["app.design"],
      elementIds: ["element-1"],
      tags: ["design"],
    },
    url: "data:image/png;base64,capability",
    width: 90,
  };

  runtime.extensions.register(
    new DesignExportCapabilityExtension({
      source: { tags: ["design"] },
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
    source: {
      elementIds: ["element-1"],
      layerIds: ["app.design"],
    },
  });
  const lastCall = exportService.calls[exportService.calls.length - 1];
  assertDeepEqual(
    lastCall.source,
    {
      elementIds: ["element-1"],
      layerIds: ["app.design"],
    },
    "design export capability should delegate caller source selector",
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
    result.source,
    {
      layerIds: ["app.design"],
      elementIds: ["element-1"],
      tags: ["design"],
    },
    "design export capability should map platform source result",
  );
  assertDeepEqual(
    result.crop,
    { left: 1, top: 2, width: 30, height: 20 },
    "design export capability should map platform crop",
  );

  await facade.exportImage();
  const defaultDesignCall = exportService.calls[exportService.calls.length - 1];
  assertDeepEqual(
    defaultDesignCall.crop,
    { type: "frame", frame: "cut" },
    "design export capability should default to cut frame crop",
  );
  assertDeepEqual(
    defaultDesignCall.source,
    { tags: ["design"] },
    "design export capability should use configured default source",
  );

  await runtime.dispose();
}

async function testSceneExportCapabilityExtension() {
  const runtime = new Pooder();
  const commandService =
    runtime.services.getOrThrow<CommandService>(COMMAND_SERVICE);
  const exportService = new FakeSceneExportService();

  exportService.error = null;
  exportService.response = {
    crop: { left: 4, top: 5, width: 120, height: 90 },
    format: "png",
    height: 90,
    multiplier: 1,
    source: {
      layerIds: ["base", "artwork", "overlay"],
      elementIds: ["mockup-element"],
      tags: ["mockup"],
    },
    url: "data:image/png;base64,mockup",
    width: 120,
  };

  runtime.extensions.register(new SceneExportCapabilityExtension());
  runtime.services.register(exportService as any, SCENE_EXPORT_SERVICE);
  await runtime.extensions.flushActivation();

  assertEqual(
    runtime.extensions.getState(SCENE_EXPORT_CAPABILITY_ID)?.state,
    "active",
    "scene export capability should activate",
  );
  assertEqual(
    commandService.getCommand("exportImage"),
    undefined,
    "scene export capability should not register legacy exportImage",
  );

  const facade = runtime.capabilities.get<SceneExportCapabilityApi>(
    SCENE_EXPORT_CAPABILITY_ID,
  );
  if (!facade) {
    throw new Error("scene export capability facade should be registered");
  }

  const result = await facade.exportImage({
    crop: {
      type: "sceneRect",
      rect: { left: 4, top: 5, width: 120, height: 90 },
    },
    format: "png",
    includeHidden: true,
    multiplier: 1,
    source: {
      elementIds: ["mockup-element"],
      layerIds: ["base", "artwork", "overlay"],
      tags: ["mockup"],
    },
  });
  const lastCall = exportService.calls[exportService.calls.length - 1];

  assertDeepEqual(
    lastCall.source,
    {
      elementIds: ["mockup-element"],
      layerIds: ["base", "artwork", "overlay"],
      tags: ["mockup"],
    },
    "scene export capability should delegate caller source selector",
  );
  assertDeepEqual(
    lastCall.crop,
    { type: "sceneRect", rect: { left: 4, top: 5, width: 120, height: 90 } },
    "scene export capability should delegate explicit crop",
  );
  assertEqual(
    lastCall.includeHidden,
    true,
    "scene export capability should delegate includeHidden",
  );
  assertEqual(
    lastCall.preserveClipPaths,
    true,
    "scene export capability should preserve clip paths by default",
  );
  assertEqual(
    result.url,
    "data:image/png;base64,mockup",
    "scene export capability should map platform export url",
  );
  assertDeepEqual(
    result.source,
    {
      layerIds: ["base", "artwork", "overlay"],
      elementIds: ["mockup-element"],
      tags: ["mockup"],
    },
    "scene export capability should map platform source result",
  );
  assertDeepEqual(
    result.crop,
    { left: 4, top: 5, width: 120, height: 90 },
    "scene export capability should map platform crop",
  );

  await facade.exportImage({ preserveClipPaths: false });
  const defaultCall = exportService.calls[exportService.calls.length - 1];
  assertDeepEqual(
    defaultCall.crop,
    { type: "frame", frame: "cut" },
    "scene export capability should default to cut frame crop",
  );
  assertEqual(
    defaultCall.preserveClipPaths,
    false,
    "scene export capability should allow callers to disable clip path preservation",
  );

  await facade.exportImage({
    format: "jpeg",
    outputMask: { mode: "outline", sourceKey: " templateFrame " },
  });
  const maskCall = exportService.calls[exportService.calls.length - 1];
  assertEqual(
    maskCall.format,
    "png",
    "scene export capability should force png when output mask is requested",
  );
  assertDeepEqual(
    maskCall.outputMask,
    { mode: "outline", sourceKey: " templateFrame " },
    "scene export capability should delegate output mask options",
  );

  exportService.error = new Error("browser-scene-export-empty");
  try {
    await facade.exportImage();
    throw new Error("scene export should throw for empty source exports");
  } catch (error) {
    assertEqual(
      error instanceof Error ? error.message : "",
      "scene-export-empty",
      "scene export capability should map empty source errors",
    );
  }

  exportService.error = new Error("browser-scene-export-failed");
  try {
    await facade.exportImage();
    throw new Error("scene export should throw for failed exports");
  } catch (error) {
    assertEqual(
      error instanceof Error ? error.message : "",
      "scene-export-failed",
      "scene export capability should map platform export failures",
    );
  }

  exportService.error = new Error(
    "browser-scene-export-output-mask-source-missing",
  );
  try {
    await facade.exportImage({
      outputMask: { sourceKey: "templateFrame" },
    });
    throw new Error("scene export should throw for missing output mask source");
  } catch (error) {
    assertEqual(
      error instanceof Error ? error.message : "",
      "scene-export-output-mask-source-missing",
      "scene export capability should map platform output mask failures",
    );
  }

  await runtime.dispose();
}

async function testKitCapabilityFactoriesDoNotRegisterTools() {
  const runtime = new Pooder();
  runtime.services.register(new FakeCanvasService() as any, CANVAS_SERVICE);
  runtime.services.register(
    new FakeSceneExportService() as any,
    SCENE_EXPORT_SERVICE,
  );
  runtime.extensions.register(createImagePlacementCapability());
  runtime.extensions.register(createImageMaskCapability());
  runtime.extensions.register(createDielineGeometryCapability());
  runtime.extensions.register(createClipCapability());
  runtime.extensions.register(createFeatureCapability());
  runtime.extensions.register(createConfigurableVisualCapability());
  runtime.extensions.register(createMirrorCapability());
  runtime.extensions.register(createSceneExportCapability());
  await runtime.extensions.flushActivation();

  assert(
    runtime.extensions.getState(IMAGE_PLACEMENT_CAPABILITY_ID)?.state ===
      "active",
    "image placement capability factory should activate",
  );
  assert(
    runtime.extensions.getState(IMAGE_MASK_CAPABILITY_ID)?.state === "active",
    "image mask capability factory should activate",
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
  assert(
    runtime.extensions.getState(MIRROR_CAPABILITY_ID)?.state === "active",
    "mirror capability factory should activate",
  );
  assert(
    runtime.extensions.getState(SCENE_EXPORT_CAPABILITY_ID)?.state === "active",
    "scene export capability factory should activate",
  );
  await runtime.dispose();
}

function testCreateKitCapabilitiesForDocument() {
  const capabilities = createKitCapabilitiesForDocument({
    version: 6,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
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
                id: "placement",
                frame: { x: 0, y: 0, width: 20, height: 20 },
                source: { kind: "url", url: "/placement.png" },
                interaction: {
                  manipulation: {
                    move: {
                      enabled: true,
                      constraints: [{ spec: { type: "grid.snap" } }],
                    },
                  },
                },
                effects: [
                  { type: "image-placement", payload: { accepts: ["image"] } },
                  { type: "clip", payload: { source: { type: "dieline" } } },
                  { type: "configurable-visual" },
                  { type: "mirror" },
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
      MIRROR_CAPABILITY_ID,
    ].sort(),
    "document helper should create supported kit capabilities once and ignore background effects",
  );
}

function testCreateKitCapabilitiesForDocumentInfersDielineLayers() {
  const capabilities = createKitCapabilitiesForDocument({
    version: 6,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "front.image.user",
            objects: [
              {
                id: "front.image.user",
                frame: { x: 0, y: 0, width: 100, height: 100 },
                source: { kind: "url", url: "/placement.png" },
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
    version: 6,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        title: "Front",
        size: { width: 100, height: 120, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "front-template",
            role: "background",
            tags: ["template-overlay", "shared"],
            objects: [
              {
                id: "front-bg",
                frame: { x: 0, y: 0, width: 100, height: 120 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 100, height: 120 },
                },
                style: { fill: "#eeeeee" },
                locked: true,
              },
              {
                id: "front-template-image",
                tags: [" mockup ", "object-overlay", "shared", "mockup", ""],
                frame: { x: 0, y: 0, width: 100, height: 120 },
                source: { kind: "url", url: "/template.png" },
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
                id: "front-placement",
                source: { kind: "url", url: "/photo.png" },
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
                      src: "data:image/png;base64,cropped-front-placement",
                      width: 400,
                      height: 320,
                    },
                  },
                },
                effects: [
                  { type: "image-placement", payload: { accepts: ["image"] } },
                  {
                    type: "clip",
                    payload: {
                      source: { type: "path", pathData: "M0 0L1 0L1 1Z" },
                    },
                  },
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
        frames: TEST_SURFACE_FRAMES,
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
    scene.selectOneLayer({ ids: ["front-artwork"] }),
    undefined,
    "document apply should not write SceneService layers",
  );
  assertEqual(
    scene.selectOneElement({ ids: ["front-placement"] }),
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
  assertDeepEqual(
    backgroundGraphNode?.tags,
    ["template-overlay", "shared"],
    "document apply should write layer-level tags into render graph tags",
  );
  const templateImageGraphNode = renderGraph.layers
    .find((layer) => layer.id === "front-template")
    ?.nodes.find((node) => node.id === "front-template-image");
  assertDeepEqual(
    templateImageGraphNode?.tags,
    ["template-overlay", "shared", "mockup", "object-overlay"],
    "document apply should merge object tags with layer tags",
  );
  assertDeepEqual(
    templateImageGraphNode?.data.tags,
    ["template-overlay", "shared", "mockup", "object-overlay"],
    "document apply should expose canonical tags in render graph data",
  );
  const committedGraphNode = renderGraph.layers
    .find((layer) => layer.id === "front-artwork")
    ?.nodes.find((node) => node.id === "image:front-placement");
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
    "document apply should compile committed image replacement to the placement-centered graph transform",
  );
  assertEqual(
    committedGraphNode?.props.selectable,
    undefined,
    "document apply should leave renderer selection to InteractionSpec",
  );
  assertEqual(
    committedGraphNode?.props.evented,
    undefined,
    "document apply should leave renderer hit testing to InteractionSpec",
  );
  assertEqual(
    committedGraphNode?.props.hasControls,
    undefined,
    "document apply should leave renderer controls to InteractionSpec",
  );
  assertDeepEqual(
    {
      placementId: committedGraphNode?.data.placementId,
      source: committedGraphNode?.data.source,
      type: committedGraphNode?.data.type,
    },
    {
      placementId: "front-placement",
      source: "committed",
      type: "image-placement-image",
    },
    "document apply should expose committed image interaction data generically",
  );
  assertDeepEqual(
    committedGraphNode?.data.clip,
    {
      enabled: true,
      source: { type: "path", pathData: "M0 0L1 0L1 1Z", space: "scene" },
    },
    "clip effect should write normalized clip metadata into RenderIntent data",
  );
  const clipEffect = committedGraphNode?.effects.find(
    (effect) => effect.id === "clip.front-placement",
  );
  assertDeepEqual(
    {
      coordinateMode: clipEffect?.coordinateMode,
      sourceId: clipEffect?.source.id,
    },
    {
      coordinateMode: "absolute",
      sourceId: "clip.front-placement.path-source",
    },
    "clip render intent should attach a local object clip effect",
  );
  assertEqual(
    "targetLayerIds" in
      ((clipEffect ?? {}) as unknown as Record<string, unknown>),
    false,
    "clip render intent should not emit global target selectors",
  );
  assertEqual(
    "targetSubjectIds" in
      ((clipEffect ?? {}) as unknown as Record<string, unknown>),
    false,
    "clip render intent should not emit global subject selectors",
  );
  assertEqual(
    (
      renderGraph.layers
        .flatMap((layer) => layer.nodes)
        .find((node) => node.data.type === "feature")?.data.feature as any
    )?.id,
    "hole",
    "feature effect should compile to declarative render graph data",
  );
  assertEqual(
    runtime.services.getOrThrow(SURFACE_FRAME_SERVICE).getFrames("front")
      ?.previewBounds.widthMm,
    TEST_SURFACE_FRAMES.previewBounds.widthMm,
    "document apply should import surface frames",
  );
  await runtime.dispose();
}

async function testApplyKitEditorDocumentStacksGuideLayersAboveRuntimeOverlays() {
  const runtime = new Pooder();
  const document = {
    version: 6 as const,
    config: {},
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" as const },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "front.dieline-overlay",
            role: "guide" as const,
            order: 30,
            objects: [
              {
                id: "front.dieline.cutline",
                frame: { x: 0, y: 0, width: 100, height: 100 },
                source: {
                  kind: "shape" as const,
                  shape: "rect" as const,
                  params: { width: 100, height: 100 },
                },
              },
            ],
          },
        ],
      },
    ],
  };

  const result = await applyKitEditorDocument(runtime, document);
  assert(
    result.ok,
    `guide layer document should apply (${JSON.stringify(result.diagnostics)})`,
  );

  const guideLayer = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph()
    .layers.find((layer) => layer.id === "front.dieline-overlay");
  assertEqual(
    guideLayer?.stack,
    900,
    "guide layers should stack above image upload overlays",
  );

  await runtime.dispose();
}

async function testApplyKitEditorDocumentRefreshesImagePlacementOverlay() {
  const runtime = new Pooder();
  runtime.services.register(new FakeCanvasService() as any, CANVAS_SERVICE);
  const document = {
    version: 6,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 697, height: 957, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "front.image.user",
            role: "content",
            objects: [
              {
                id: "front.image.user",
                frame: { x: 0, y: 0, width: 697, height: 957 },
                source: { kind: "url", url: "/placeholder.png" },
                effects: [
                  {
                    type: "image-placement",
                    payload: {
                      accepts: ["image"],
                      fit: "cover",
                      placementId: "image.user",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  runtime.extensions.registerMany(createKitCapabilitiesForDocument(document));
  await runtime.extensions.flushActivation();

  const result = await applyKitEditorDocument(runtime, document);
  assert(result.ok, "document apply should succeed");

  const graphNodes = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph()
    .layers.flatMap((layer) => layer.nodes);
  assert(
    graphNodes.some((node) => node.id === "upload:front.image.user"),
    "document apply should refresh image placement upload overlay without waiting for resize",
  );
  assert(
    graphNodes.some((node) => node.id === "upload-label:front.image.user"),
    "document apply should refresh image placement upload label without waiting for resize",
  );

  await runtime.dispose();
}

async function testMirrorCapabilityDocumentEffectAndFacade() {
  const runtime = new Pooder();
  runtime.extensions.register(new MirrorCapabilityExtension());
  await runtime.extensions.flushActivation();

  const document = {
    version: 6,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "artwork",
            objects: [
              {
                id: "horizontal-object",
                frame: { x: 1, y: 2, width: 10, height: 20 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 10, height: 20 },
                },
                transform: {
                  left: 4,
                  top: 6,
                  scaleX: 2,
                  scaleY: 3,
                  originX: "center",
                  originY: "center",
                },
                effects: [
                  {
                    type: "mirror",
                    capabilityId: MIRROR_CAPABILITY_ID,
                    payload: { horizontal: true },
                  },
                ],
              },
              {
                id: "vertical-object",
                frame: { x: 10, y: 20, width: 10, height: 20 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 10, height: 20 },
                },
                transform: { scaleX: -4, scaleY: -5 },
                effects: [
                  {
                    type: "mirror",
                    capabilityId: MIRROR_CAPABILITY_ID,
                    payload: { vertical: true },
                  },
                ],
              },
              {
                id: "both-object",
                frame: { x: 20, y: 30, width: 10, height: 20 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 10, height: 20 },
                },
                transform: { scaleX: -2, scaleY: 3 },
                effects: [
                  {
                    type: "mirror",
                    capabilityId: MIRROR_CAPABILITY_ID,
                    payload: { horizontal: true, vertical: true },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const result = await applyKitEditorDocument(runtime, document);
  assert(
    result.ok,
    `mirror document effect should apply (${JSON.stringify(result.diagnostics)})`,
  );

  const renderIntentService = runtime.services.getOrThrow<RenderIntentService>(
    RENDER_INTENT_SERVICE,
  );
  const findNode = (objectId: string) =>
    renderIntentService
      .getGraph()
      .layers.flatMap((layer) => layer.nodes)
      .find((node) => node.subjectId === objectId);

  assertDeepEqual(
    findNode("horizontal-object")?.transform,
    {
      left: 4,
      top: 6,
      scaleX: -2,
      scaleY: 3,
      originX: "center",
      originY: "center",
    },
    "mirror effect should flip horizontal scale and preserve transform fields",
  );
  assertDeepEqual(
    findNode("horizontal-object")?.data.mirror,
    { horizontal: true, vertical: false },
    "mirror effect should expose normalized mirror state",
  );
  assertDeepEqual(
    {
      scaleX: findNode("vertical-object")?.transform?.scaleX,
      scaleY: findNode("vertical-object")?.transform?.scaleY,
    },
    { scaleX: 4, scaleY: -5 },
    "vertical mirror effect should only force the vertical scale sign",
  );
  assertDeepEqual(
    {
      scaleX: findNode("both-object")?.transform?.scaleX,
      scaleY: findNode("both-object")?.transform?.scaleY,
    },
    { scaleX: -2, scaleY: -3 },
    "double-axis mirror effect should force both scale signs",
  );

  const facade =
    runtime.capabilities.getOrThrow<MirrorCapabilityApi>(MIRROR_CAPABILITY_ID);
  assertDeepEqual(
    facade.getObjectMirror({ objectId: "horizontal-object" }),
    { horizontal: true, vertical: false },
    "mirror facade should read graph mirror state",
  );
  assert(
    facade.setObjectMirror(
      { objectId: "horizontal-object" },
      { horizontal: false, vertical: true },
    ),
    "mirror facade should patch an existing object",
  );
  assertDeepEqual(
    {
      scaleX: findNode("horizontal-object")?.transform?.scaleX,
      scaleY: findNode("horizontal-object")?.transform?.scaleY,
      mirror: findNode("horizontal-object")?.data.mirror,
    },
    {
      scaleX: 2,
      scaleY: -3,
      mirror: { horizontal: false, vertical: true },
    },
    "mirror facade should override document mirror state at runtime",
  );
  assertDeepEqual(
    facade.toggleObjectMirror({ objectId: "horizontal-object" }, "horizontal"),
    { horizontal: true, vertical: true },
    "mirror facade should toggle from the current graph state",
  );
  assertDeepEqual(
    {
      scaleX: findNode("horizontal-object")?.transform?.scaleX,
      scaleY: findNode("horizontal-object")?.transform?.scaleY,
    },
    { scaleX: -2, scaleY: -3 },
    "mirror facade toggle should update runtime transform signs",
  );
  assert(
    facade.clearObjectMirror({ objectId: "horizontal-object" }),
    "mirror facade should clear an existing runtime patch",
  );
  assertDeepEqual(
    {
      scaleX: findNode("horizontal-object")?.transform?.scaleX,
      scaleY: findNode("horizontal-object")?.transform?.scaleY,
      mirror: findNode("horizontal-object")?.data.mirror,
    },
    {
      scaleX: -2,
      scaleY: 3,
      mirror: { horizontal: true, vertical: false },
    },
    "mirror facade clear should restore document effect state",
  );
  assert(
    facade.setObjectMirror(
      { objectId: "missing-object" },
      { horizontal: true },
    ) === false,
    "mirror facade should reject missing objects",
  );

  await runtime.dispose();
}

async function testDocumentCompilerAndRuntimePatchUseSameMerge() {
  const baseDocument = {
    version: 6,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "artwork",
            objects: [
              {
                id: "object",
                frame: { x: 1, y: 2, width: 10, height: 20 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 10, height: 20 },
                },
                effects: [
                  {
                    type: "mirror",
                    payload: { horizontal: true, vertical: false },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const documentRuntime = new Pooder();
  documentRuntime.extensions.register(new MirrorCapabilityExtension());
  await documentRuntime.extensions.flushActivation();
  const documentResult = await applyKitEditorDocument(
    documentRuntime,
    baseDocument,
  );
  assert(
    documentResult.ok,
    `document patch apply should succeed (${JSON.stringify(documentResult.diagnostics)})`,
  );
  const documentNode = documentRuntime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph().layers[0]?.nodes[0];

  const runtimeDocument = {
    ...baseDocument,
    surfaces: [
      {
        ...baseDocument.surfaces[0],
        layers: [
          {
            ...baseDocument.surfaces[0].layers[0],
            objects: [
              {
                ...baseDocument.surfaces[0].layers[0].objects[0],
                effects: [],
              },
            ],
          },
        ],
      },
    ],
  };
  const runtimePatchRuntime = new Pooder();
  const runtimeResult = await applyKitEditorDocument(
    runtimePatchRuntime,
    runtimeDocument,
  );
  assert(
    runtimeResult.ok,
    `runtime patch base apply should succeed (${JSON.stringify(runtimeResult.diagnostics)})`,
  );
  runtimePatchRuntime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .patchIntentEntry({
      sourceId: `capability:${MIRROR_CAPABILITY_ID}`,
      phase: "layout",
      sequence: 0,
      patch: {
        id: "object",
        placement: {
          transform: {
            left: 1,
            top: 2,
            originX: "left",
            originY: "top",
            scaleX: -1,
            scaleY: 1,
          },
        },
        data: {
          mirror: { horizontal: true, vertical: false },
        },
      },
    });
  const runtimeNode = runtimePatchRuntime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph().layers[0]?.nodes[0];

  assertDeepEqual(
    {
      transform: documentNode?.transform,
      mirror: documentNode?.data.mirror,
    },
    {
      transform: runtimeNode?.transform,
      mirror: runtimeNode?.data.mirror,
    },
    "document compiler patches and runtime patches should merge consistently",
  );

  await documentRuntime.dispose();
  await runtimePatchRuntime.dispose();
}

async function testKitEditorDocumentControllerMutatesObjectSource() {
  const runtime = new Pooder();
  const controller = createKitEditorDocumentController(runtime);
  const document = {
    version: 6,
    config: {
      ...TEST_DOCUMENT_CONFIG,
      "dieline.shape": "rect",
    },
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 50, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "guide",
            objects: [
              {
                id: "cutline",
                frame: { x: 0, y: 0, width: 100, height: 50 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 100, height: 50 },
                },
              },
            ],
          },
        ],
      },
    ],
  };
  const applyResult = await controller.apply(document);
  assert(
    applyResult.ok,
    `document controller apply should succeed (${JSON.stringify(applyResult.diagnostics)})`,
  );

  const initialNode = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph()
    .layers.flatMap((layer) => layer.nodes)
    .find((item) => item.subjectId === "cutline");
  assertEqual(
    initialNode?.type,
    "path",
    "shape source object should render as a path on initial apply",
  );
  assertEqual(
    initialNode?.props.pathData,
    "M0 0H100V50H0Z",
    "shape source object should resolve rect source path on initial apply",
  );

  runtime.config.update("dieline.shape", "custom");
  const pathData = "M 0 0 L 40 0 L 40 20 Z";
  const detectedFrame = { x: 10, y: 12, width: 80, height: 40 };
  const updated = await controller.updateObjectSource(
    "cutline",
    {
      kind: "path",
      pathData,
      sourceSize: { width: 40, height: 20 },
    },
    {
      frame: detectedFrame,
      style: {
        fill: "transparent",
        stroke: "#ef4444",
        strokeWidth: 2,
      },
    },
  );

  assert(updated, "document controller should update object sources");
  const exported = controller.export() as any;
  const exportedObject = exported?.surfaces[0]?.layers[0]?.objects[0];
  assertEqual(
    exported?.config?.["dieline.shape"],
    "custom",
    "document controller should sync current runtime config before mutation",
  );
  assertDeepEqual(
    exportedObject?.source,
    {
      kind: "path",
      pathData,
      sourceSize: { width: 40, height: 20 },
    },
    "document controller export should include the mutated object source",
  );
  assertDeepEqual(
    exportedObject?.frame,
    detectedFrame,
    "document controller export should include frame updates",
  );
  assertDeepEqual(
    exportedObject?.style,
    {
      fill: "transparent",
      stroke: "#ef4444",
      strokeWidth: 2,
    },
    "document controller export should include object style updates",
  );

  const node = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph()
    .layers.flatMap((layer) => layer.nodes)
    .find((item) => item.subjectId === "cutline");
  assertEqual(
    node?.type,
    "path",
    "document controller mutation should update the render graph visual",
  );
  assertEqual(
    node?.props.pathData,
    pathData,
    "document controller mutation should update the render graph path",
  );
  assertDeepEqual(
    node?.frame,
    detectedFrame,
    "document controller mutation should update the render graph frame",
  );
  assertDeepEqual(
    node?.transform,
    {
      left: 10,
      top: 12,
      scaleX: 2,
      scaleY: 2,
    },
    "path source coordinates should scale into the updated frame",
  );

  exportedObject.source.pathData = "M 0 0 Z";
  assertEqual(
    (controller.export() as any)?.surfaces[0]?.layers[0]?.objects[0]?.source
      ?.pathData,
    pathData,
    "document controller export should return a clone",
  );

  const offsetPathData = "M 20 30 L 60 30 L 60 50 L 20 50 Z";
  const offsetFrame = { x: 10, y: 12, width: 80, height: 80 };
  const offsetUpdated = await controller.updateObjectSource(
    "cutline",
    {
      kind: "path",
      pathData: offsetPathData,
      sourceBounds: { x: 20, y: 30, width: 40, height: 20 },
      sourceSize: { width: 100, height: 100 },
    },
    {
      frame: offsetFrame,
    },
  );
  assert(
    offsetUpdated,
    "document controller should update offset path sources",
  );

  const offsetNode = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph()
    .layers.flatMap((layer) => layer.nodes)
    .find((item) => item.subjectId === "cutline");
  assertDeepEqual(
    offsetNode?.transform,
    {
      left: 26,
      top: 36,
      scaleX: 0.8,
      scaleY: 0.8,
    },
    "path source bounds should preserve source-space offset inside the target frame",
  );

  await runtime.dispose();
}

async function testApplyKitEditorDocumentObjectInteraction() {
  const runtime = new Pooder();
  const result = await applyKitEditorDocument(runtime, {
    version: 6,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "artwork",
            objects: [
              {
                id: "legacy-locked",
                locked: true,
                frame: { x: 0, y: 0, width: 20, height: 20 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 20, height: 20 },
                },
              },
              {
                id: "explicit-interaction",
                locked: true,
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
                        { spec: { type: "grid.snap", params: { size: 5 } } },
                      ],
                    },
                    resize: { enabled: true },
                    rotate: { enabled: true },
                  },
                },
                frame: { x: 25, y: 0, width: 20, height: 20 },
              },
              {
                id: "selection-only",
                locked: false,
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 20, height: 20 },
                },
                interaction: { selection: { enabled: true } },
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
  const renderGraph = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph();
  const nodes = renderGraph.layers.flatMap((layer) => layer.nodes);
  const legacyLockedNode = nodes.find((node) => node.id === "legacy-locked");
  const explicitInteractionNode = nodes.find(
    (node) => node.id === "explicit-interaction",
  );
  const selectionOnlyNode = nodes.find((node) => node.id === "selection-only");

  assertEqual(
    legacyLockedNode?.props.selectable,
    undefined,
    "document objects should not write selectable props by default",
  );
  assertEqual(
    legacyLockedNode?.props.evented,
    undefined,
    "document objects should not write evented props by default",
  );
  assertEqual(
    legacyLockedNode?.data.locked,
    true,
    "legacy locked should remain render graph locked data",
  );
  assertDeepEqual(
    explicitInteractionNode?.interaction,
    {
      manipulation: {
        move: {
          enabled: true,
          constraints: [{ spec: { type: "grid.snap", params: { size: 5 } } }],
        },
        resize: { enabled: true },
        rotate: { enabled: true },
      },
    },
    "document object interaction should create render intent interaction",
  );
  assertEqual(
    selectionOnlyNode?.data.locked,
    false,
    "selection interaction should not override object locked",
  );

  await runtime.dispose();
}

async function testApplyKitEditorDocumentDeclarativeObjectInteraction() {
  const runtime = new Pooder();
  const document = {
    version: 6,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "artwork",
            objects: [
              {
                id: "interaction-only",
                frame: { x: 0, y: 0, width: 20, height: 20 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 20, height: 20 },
                },
                interaction: {
                  manipulation: {
                    move: { enabled: true },
                    resize: { enabled: true },
                    rotate: { enabled: true },
                  },
                  enabledWhen: {
                    op: "truthy",
                    ref: {
                      source: "workflowSession",
                      field: "scopeActive",
                      scope: { channel: "layout-edit" },
                    },
                  },
                },
              },
              {
                id: "constraint-only",
                frame: { x: 25, y: 0, width: 20, height: 20 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 20, height: 20 },
                },
                interaction: {
                  manipulation: {
                    move: {
                      enabled: false,
                      constraints: [
                        {
                          spec: {
                            type: "rect.contain",
                            params: {
                              rect: { left: 0, top: 0, width: 90, height: 90 },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
              {
                id: "interactive-constrained",
                frame: { x: 50, y: 0, width: 20, height: 20 },
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
                          activeWhen: {
                            op: "in",
                            ref: { source: "activeToolId" },
                            values: ["move"],
                          },
                          spec: {
                            type: "rect.contain",
                            params: {
                              rect: { left: 0, top: 0, width: 90, height: 90 },
                            },
                          },
                        },
                        {
                          activeWhen: {
                            op: "truthy",
                            ref: { source: "context", key: "snap.enabled" },
                          },
                          spec: { type: "grid.snap", params: { size: 5 } },
                        },
                      ],
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
  };
  runtime.extensions.registerMany(createKitCapabilitiesForDocument(document));
  await runtime.extensions.flushActivation();
  const result = await applyKitEditorDocument(runtime, document);

  assert(
    result.ok,
    `declarative object interaction should apply (${JSON.stringify(result.diagnostics)})`,
  );
  const renderGraph = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph();
  const nodes = renderGraph.layers.flatMap((layer) => layer.nodes);
  assertDeepEqual(
    nodes.find((node) => node.id === "interaction-only")?.interaction,
    {
      enabledWhen: {
        op: "truthy",
        ref: {
          source: "workflowSession",
          field: "scopeActive",
          scope: { channel: "layout-edit" },
        },
      },
      manipulation: {
        move: { enabled: true },
        resize: { enabled: true },
        rotate: { enabled: true },
      },
    },
    "object interaction should preserve operation-level enabledWhen",
  );
  assertDeepEqual(
    nodes.find((node) => node.id === "constraint-only")?.interaction,
    {
      manipulation: {
        move: {
          enabled: false,
          constraints: [
            {
              spec: {
                type: "rect.contain",
                params: { rect: { left: 0, top: 0, width: 90, height: 90 } },
              },
            },
          ],
        },
      },
    },
    "object constraints alone should not enable interaction",
  );
  assertDeepEqual(
    nodes.find((node) => node.id === "interactive-constrained")?.interaction,
    {
      manipulation: {
        move: {
          enabled: true,
          constraints: [
            {
              activeWhen: {
                op: "in",
                ref: { source: "activeToolId" },
                values: ["move"],
              },
              spec: {
                type: "rect.contain",
                params: { rect: { left: 0, top: 0, width: 90, height: 90 } },
              },
            },
            {
              activeWhen: {
                op: "truthy",
                ref: { source: "context", key: "snap.enabled" },
              },
              spec: { type: "grid.snap", params: { size: 5 } },
            },
          ],
        },
        resize: { enabled: true },
        rotate: { enabled: true },
      },
    },
    "object interaction should preserve constraints in declaration order",
  );
  assertEqual(
    nodes.find((node) => node.id === "interactive-constrained")?.data
      .interactionComponents,
    undefined,
    "declarative interaction should not emit legacy interaction components",
  );

  await runtime.dispose();
}

async function testApplyKitEditorDocumentRejectsInteractionComponentEffects() {
  const runtime = new Pooder();
  const result = await applyKitEditorDocument(runtime, {
    version: 6,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "artwork",
            objects: [
              {
                id: "legacy",
                frame: { x: 0, y: 0, width: 20, height: 20 },
                source: {
                  kind: "shape",
                  shape: "rect",
                  params: { width: 20, height: 20 },
                },
                effects: [
                  {
                    type: "interaction-component",
                    phase: "interaction",
                    payload: {
                      constraints: [
                        {
                          type: "rect.contain",
                          params: {
                            rect: { left: 0, top: 0, width: 90, height: 90 },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  assertEqual(
    result.ok,
    false,
    "legacy interaction-component effects should not be supported",
  );
  assert(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "effect-capability-required" &&
        diagnostic.effectType === "interaction-component",
    ),
    "legacy interaction-component should require an explicit custom capability",
  );

  await runtime.dispose();
}

async function testApplyKitEditorDocumentMissingCapabilities() {
  const strictRuntime = new Pooder();
  const strictResult = await applyKitEditorDocument(strictRuntime, {
    version: 6,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        frames: TEST_SURFACE_FRAMES,
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
      .selectOneLayer({ ids: ["front-artwork"] }),
    "strict missing capability should not write scene",
  );
  await strictRuntime.dispose();

  const optionalRuntime = new Pooder();
  const optionalResult = await applyKitEditorDocument(optionalRuntime, {
    version: 6,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "front-artwork",
            effects: [
              { type: "configurable-visual", require: "warn" },
              { type: "image-placement", require: "ignore" },
            ],
          },
        ],
      },
    ],
  });
  assert(
    optionalResult.ok,
    "optional missing capabilities should apply document",
  );
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
      (item) => item.capabilityId === IMAGE_PLACEMENT_CAPABILITY_ID,
    ),
    "ignore missing capability should not diagnose",
  );
  assert(
    !optionalRuntime.services
      .getOrThrow<SceneService>(SCENE_SERVICE)
      .selectOneLayer({ ids: ["front-artwork"] }),
    "optional missing capabilities should not write scene",
  );
  await optionalRuntime.dispose();

  const missingCompilerRuntime = new Pooder();
  missingCompilerRuntime.extensions.register(
    createFakeCapabilityExtension({
      [CONFIGURABLE_VISUAL_CAPABILITY_ID]: {
        clearCommittedVisual: () => {},
        getConfig: () => ({}),
        refresh: () => {},
        setCommittedVisual: () => {},
      } satisfies ConfigurableVisualCapabilityApi,
    }),
  );
  await missingCompilerRuntime.extensions.flushActivation();
  const missingCompilerResult = await applyKitEditorDocument(
    missingCompilerRuntime,
    {
      version: 6,
      config: TEST_DOCUMENT_CONFIG,
      surfaces: [
        {
          id: "front",
          size: { width: 1, height: 1, unit: "px" },
          frames: TEST_SURFACE_FRAMES,
          layers: [
            {
              id: "front-artwork",
              objects: [
                {
                  id: "template",
                  frame: { x: 0, y: 0, width: 1, height: 1 },
                  source: { kind: "url", url: "/template.png" },
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
    version: 6,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 1, height: 1, unit: "px" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "front-artwork",
            objects: [
              {
                id: "template",
                frame: { x: 0, y: 0, width: 1, height: 1 },
                source: { kind: "url", url: "/template.png" },
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
        item.code === "effect-compile-failed" && item.severity === "warning",
    ),
    "warn compiler failures should return warning diagnostics",
  );
  await throwRuntime.dispose();
}

async function testImagePlacementCapabilityExtension() {
  const runtime = new Pooder();
  const facade: ImagePlacementCapabilityApi = {
    onDidChange: () => ({ dispose() {} }),
    applyOperation: async () => ({ ok: true }),
    clearImage: async () => ({ ok: true }),
    commitSession: async () => ({ ok: true }),
    exportPlacementImage: async () => ({
      url: "data:image/png;base64,image",
      width: 1,
      height: 1,
      multiplier: 1,
      format: "png",
      placementIds: [],
      frame: { left: 0, top: 0, width: 1, height: 1 },
    }),
    focusPlacement: (id) => ({ ok: true, id }),
    getViewState: () => ({
      activePlacementId: null,
      focusedPlacement: null,
      hasAnyImage: false,
      hasWorkingChanges: false,
      sessionNotice: null,
      placements: [],
    }),
    openSession: async () => ({ ok: true }),
    rollbackSession: async () => ({ ok: true }),
    setSource: async () => ({ ok: true }),
    setTransform: async () => ({ ok: true }),
    validateSession: async () => ({ ok: true }),
    registerSessionOverlayProvider: () => ({ dispose() {} }),
    refresh: async () => {},
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
    registeredFacade.getViewState().placements,
    [],
    "image placement capability facade should expose image state",
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
    source: {
      layerIds: ["image.user"],
      elementIds: ["placement"],
      tags: [],
    },
    url: "data:image/png;base64,cropped-placement",
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
    cutRect: rectByCenter(400, 300, 360, 360),
    offsetX: 0,
    offsetY: 0,
    revision: 1,
    scale: 3,
    surfaceId: "legacy",
    trimRect: rectByCenter(400, 300, 300, 300),
  };
  runtime.services
    .getOrThrow(SURFACE_FRAME_SERVICE)
    .setFrames("legacy", TEST_SURFACE_FRAMES);
  runtime.services.register(
    {
      getLayout: () => layout,
      invalidateLayout: () => {},
      onLayoutChange: () => ({ dispose() {} }),
      recomputeLayout: () => layout,
    } as any,
    SCENE_LAYOUT_SERVICE,
  );

  const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
  scene.addLayer({ id: "artwork" });
  scene.addElement({
    id: "placement",
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
            sourceTags: ["business-helper"],
            placement: "above",
          },
          {
            id: "hidden-helper",
            sourceTags: ["hidden-helper"],
            placement: "above",
          },
          {
            id: "conditional-hidden-helper",
            sourceTags: ["conditional-hidden-helper"],
            placement: "above",
          },
          {
            id: "conditional-visible-helper",
            sourceTags: ["conditional-visible-helper"],
            placement: "above",
          },
          {
            id: "global-helper",
            sourceTags: ["global-helper"],
            surfaceScope: "all",
            placement: "above",
          },
          {
            id: "ignored-helper",
            sourceLayerIds: ["front.ignored-helper"],
            placement: "above",
          },
        ],
      },
    },
  });
  const renderIntentService = runtime.services.getOrThrow<RenderIntentService>(
    RENDER_INTENT_SERVICE,
  );
  renderIntentService.setRuntimeConditionValue("show.hidden-helper", false);
  renderIntentService.setRuntimeConditionValue("show.visible-helper", true);
  renderIntentService.setDocumentIntents([
    {
      id: "front-business-helper",
      subject: {
        kind: "object",
        surfaceId: "image-placement.unscoped",
        layerId: "front.business-helper",
        objectId: "front-business-helper",
      },
      visual: { type: "rect" },
      export: { tags: ["business-helper"] },
      ordering: {
        layerId: "front.business-helper",
        stack: 500,
        layerOrder: 0,
      },
      props: { width: 10, height: 10 },
    },
    {
      id: "back-business-helper",
      subject: {
        kind: "object",
        surfaceId: "back",
        layerId: "back.business-helper",
        objectId: "back-business-helper",
      },
      visual: { type: "rect" },
      export: { tags: ["business-helper"] },
      ordering: {
        layerId: "back.business-helper",
        stack: 500,
        layerOrder: 0,
      },
      props: { width: 10, height: 10 },
    },
    {
      id: "front-hidden-helper",
      subject: {
        kind: "object",
        surfaceId: "image-placement.unscoped",
        layerId: "front.hidden-helper",
        objectId: "front-hidden-helper",
      },
      visual: { type: "rect" },
      ordering: {
        layerId: "front.hidden-helper",
        stack: 500,
        layerOrder: 0,
      },
      export: { visible: false, tags: ["hidden-helper"] },
      props: { width: 10, height: 10 },
    },
    {
      id: "front-conditional-hidden-helper",
      subject: {
        kind: "object",
        surfaceId: "image-placement.unscoped",
        layerId: "front.conditional-hidden-helper",
        objectId: "front-conditional-hidden-helper",
      },
      visual: { type: "rect" },
      ordering: {
        layerId: "front.conditional-hidden-helper",
        stack: 500,
        layerOrder: 0,
      },
      export: {
        tags: ["conditional-hidden-helper"],
        visibleWhen: {
          op: "truthy",
          ref: { source: "context", key: "show.hidden-helper" },
        },
      },
      props: { width: 10, height: 10 },
    },
    {
      id: "front-conditional-visible-helper",
      subject: {
        kind: "object",
        surfaceId: "image-placement.unscoped",
        layerId: "front.conditional-visible-helper",
        objectId: "front-conditional-visible-helper",
      },
      visual: { type: "rect" },
      ordering: {
        layerId: "front.conditional-visible-helper",
        stack: 500,
        layerOrder: 0,
      },
      export: {
        tags: ["conditional-visible-helper"],
        visibleWhen: {
          op: "truthy",
          ref: { source: "context", key: "show.visible-helper" },
        },
      },
      props: { width: 10, height: 10 },
    },
    {
      id: "back-global-helper",
      subject: {
        kind: "object",
        surfaceId: "back",
        layerId: "back.global-helper",
        objectId: "back-global-helper",
      },
      visual: { type: "rect" },
      export: { tags: ["global-helper"] },
      ordering: {
        layerId: "back.global-helper",
        stack: 500,
        layerOrder: 0,
      },
      props: { width: 10, height: 10 },
    },
    {
      id: "front-ignored-helper",
      subject: {
        kind: "object",
        surfaceId: "image-placement.unscoped",
        layerId: "front.ignored-helper",
        objectId: "front-ignored-helper",
      },
      visual: { type: "rect" },
      export: { tags: ["ignored-helper"] },
      ordering: {
        layerId: "front.ignored-helper",
        stack: 500,
        layerOrder: 0,
      },
      props: { width: 10, height: 10 },
    },
  ]);
  const imageExtension = createImagePlacementCapability();
  runtime.extensions.register(imageExtension);
  runtime.extensions.register(
    createDielineGeometryCapability({
      shape: "circle",
      shapeStyle: { fitMode: "stretch" },
    }),
  );
  await runtime.extensions.flushActivation();

  const facade = runtime.capabilities.getOrThrow<ImagePlacementCapabilityApi>(
    IMAGE_PLACEMENT_CAPABILITY_ID,
  );
  const driver = getImagePlacementTestDriver(imageExtension);
  await driver.beginSession("placement");
  const renderGraph = renderIntentService.getGraph();
  const imageLayer = renderGraph.layers.find((layer) => layer.id === "artwork");
  const sessionSceneId =
    "pooder.kit.image-placement.session:image-placement:placement";
  const sessionRoot = scene.getActiveRoot();
  const committedImageNode = imageLayer?.nodes.find(
    (node: any) => node.id === "image:placement",
  );
  assertDeepEqual(
    committedImageNode?.visibleWhen,
    imagePlacementCommittedVisibleWhen("placement"),
    "committed image object should carry graph visibleWhen while its working session is active",
  );
  assertEqual(
    sessionRoot?.id,
    sessionSceneId,
    "image session should install a session-owned active root",
  );
  const sessionImage = scene.selectOneElement({
    ids: ["session-image:image-placement:placement"],
    sceneId: sessionSceneId,
  });
  assert(sessionImage, "image session should render a separate working object");
  const sessionImageNode = sessionImage!;
  assertEqual(
    (sessionImageNode as any).width,
    100,
    "image sessions should preserve the source image intrinsic width",
  );
  assertEqual(
    (sessionImageNode as any).height,
    80,
    "image sessions should preserve the source image intrinsic height",
  );
  assertEqual(
    sessionImageNode.transform?.scaleX,
    2,
    "cover fit should resolve through scale without replacing intrinsic width",
  );
  assertEqual(
    sessionImageNode.transform?.scaleY,
    2,
    "cover fit should resolve through scale without replacing intrinsic height",
  );
  assertEqual(
    sessionImageNode.interaction?.selection?.enabled,
    true,
    "session image should expose typed selection interaction",
  );
  assertEqual(
    sessionImageNode.interaction?.manipulation?.resize?.enabled,
    true,
    "session image should expose typed resize interaction",
  );
  assertEqual(
    sessionImageNode.interaction?.manipulation?.rotate?.enabled,
    true,
    "session image should expose typed rotation interaction",
  );
  assert(
    Boolean(
      scene.selectOneElement({
        ids: ["image.cropShapeHatch"],
        sceneId: sessionSceneId,
      }),
    ),
    "image session should render dieline hatch overlay",
  );
  const projectedNodeIds =
    sessionRoot?.composition.entries.flatMap((entry) =>
      entry.source === "document"
        ? renderGraph.layers.flatMap((layer) =>
            layer.nodes
              .filter((node) => entry.filter?.({ layer, node }) ?? true)
              .map((node) => node.id),
          )
        : [],
    ) ?? [];
  assert(
    projectedNodeIds.includes("front-business-helper"),
    "image session should explicitly project declared document helpers",
  );
  assertEqual(
    projectedNodeIds.includes("back-business-helper"),
    false,
    "image session tag projections should default to the placement surface",
  );
  assert(
    projectedNodeIds.includes("back-global-helper"),
    "image session tag projections should allow cross-surface sources when requested",
  );
  assertEqual(
    projectedNodeIds.includes("front-ignored-helper"),
    false,
    "image session should ignore legacy projection configs without source tags",
  );
  const snapTarget = {
    data: {
      placementId: "placement",
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
  const interactionPreviewChanges: SceneChangeEvent[] = [];
  const interactionPreviewSubscription = scene.onDidChange((event) =>
    interactionPreviewChanges.push(event),
  );
  (imageExtension as any).handleCanvasObjectMoving(snapTarget);
  interactionPreviewSubscription.dispose();
  assertEqual(
    interactionPreviewChanges.length,
    1,
    "snap preview should publish one transactional scene change",
  );
  assertDeepEqual(
    interactionPreviewChanges[0]?.causes,
    [
      {
        type: "interaction-preview",
        sessionId: "image-placement:placement",
        toolId: IMAGE_PLACEMENT_CAPABILITY_ID,
      },
    ],
    "snap preview should preserve its interaction provenance",
  );
  const previewSceneChanges =
    interactionPreviewChanges[0]?.sceneChanges?.[sessionSceneId];
  assertEqual(
    previewSceneChanges?.elements.removed.includes(
      "session-image:image-placement:placement",
    ),
    false,
    "snap preview should keep the working image element stable",
  );
  assertEqual(
    previewSceneChanges?.elements.added.includes(
      "session-image:image-placement:placement",
    ),
    false,
    "snap preview should not recreate the working image element",
  );
  (imageExtension as any).applyMoveSnapToTarget(snapTarget);
  assertEqual(
    snapTarget.left,
    100,
    "image session should snap a moving image edge to the placement edge",
  );

  const movedTarget = {
    data: {
      placementId: "placement",
      source: "working",
      type: "image-placement-image",
    },
    left: 220,
    top: 216,
    width: 200,
    height: 160,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    getCenterPoint: () => ({ x: 220, y: 216 }),
    getObjectScaling: () => ({ x: 1, y: 1 }),
  };
  await (imageExtension as any).syncWorkingImageTransformFromTarget(
    movedTarget,
  );
  const movedSessionImage = scene.selectOneElement({
    ids: ["session-image:image-placement:placement"],
    sceneId: sessionSceneId,
  });
  assertEqual(
    movedSessionImage?.transform?.left,
    220,
    "dragged image session object should update the active root scene before session sync",
  );
  assertEqual(
    movedSessionImage?.transform?.top,
    216,
    "dragged image session object should keep its moved y position in the active root scene",
  );

  await driver.setImageTransform("placement", {
    angle: 22,
    left: 0.6,
    scale: 1.3,
    top: 0.4,
  });
  await driver.completeSession();
  const committedImage = (
    scene.selectOneElement({ ids: ["placement"] })?.data as any
  )?.imagePlacement?.image;
  assertEqual(
    committedImage.src,
    "data:image/png;base64,cropped-placement",
    "completed session should write the cropped production image to the placement",
  );
  assertEqual(
    committedImage.angle,
    0,
    "cropped production image should reset session rotation in the placement",
  );
  assertEqual(
    committedImage.scale,
    1,
    "cropped production image should reset session scale in the placement",
  );
  assertEqual(
    committedImage.left,
    0.5,
    "cropped production image should be centered in the placement",
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
  await driver.beginSession("placement");
  const reopenedPlacement = facade
    .getViewState()
    .placements.find((placement) => placement.id === "placement");
  assertEqual(
    reopenedPlacement?.image?.src,
    "/photo.png",
    "reopened sessions should restore the editable source instead of the cropped bitmap",
  );
  assertEqual(
    reopenedPlacement?.image?.scale,
    1.3,
    "reopened sessions should restore the committed source scale",
  );
  assertEqual(
    reopenedPlacement?.image?.angle,
    22,
    "reopened sessions should restore the committed source rotation",
  );
  const reopenedSessionImage = scene.selectOneElement({
    ids: ["session-image:image-placement:placement"],
    sceneId: sessionSceneId,
  });
  assertEqual(
    reopenedSessionImage?.transform?.angle,
    22,
    "the reopened session scene should publish the restored rotation",
  );
  await facade.rollbackSession("placement");
  assertDeepEqual(
    exportService.calls[0]?.crop,
    {
      type: "sceneRect",
      rect: { left: 100, top: 120, width: 200, height: 160 },
    },
    "complete session should crop the working image by the placement frame",
  );
  assertDeepEqual(
    exportService.calls[0]?.source?.elementIds,
    ["session-image:image-placement:placement"],
    "complete session should export the active working placement image",
  );
  assertDeepEqual(
    exportService.calls[0]?.source?.layerIds,
    ["image.session.image"],
    "complete session should export the working image from the session pass",
  );

  const graph = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph();
  const sessions = runtime.services.getOrThrow<SessionService>(SESSION_SERVICE);
  const artworkGraphLayer = graph.layers.find(
    (layer) => layer.id === "artwork",
  );
  const committedGraphNode = artworkGraphLayer?.nodes.find(
    (node) => node.id === "image:placement",
  );
  assertEqual(
    artworkGraphLayer?.id,
    "artwork",
    "completed placement should render through the graph anchored business layer",
  );
  assert(
    committedGraphNode?.visual?.src ===
      "data:image/png;base64,cropped-placement",
    "completed placement should write the processed production image node",
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
    "completed placement should compile the committed bitmap into a placement-centered graph transform",
  );
  assertEqual(
    committedGraphNode?.props.selectable,
    undefined,
    "completed placement should leave renderer selection to InteractionSpec",
  );
  assertEqual(
    committedGraphNode?.props.evented,
    undefined,
    "completed placement should leave renderer hit testing to InteractionSpec",
  );
  assertEqual(
    committedGraphNode?.props.hasControls,
    undefined,
    "completed placement should leave renderer controls to InteractionSpec",
  );
  assertDeepEqual(
    {
      placementId: committedGraphNode?.data.placementId,
      source: committedGraphNode?.data.source,
      type: committedGraphNode?.data.type,
    },
    {
      placementId: "placement",
      source: "committed",
      type: "image-placement-image",
    },
    "completed placement should expose generic committed image interaction data",
  );
  assertDeepEqual(
    committedGraphNode?.data[IMAGE_GEOMETRY_DATA_KEY],
    {
      source: {
        src: "/photo.png",
        size: { width: 100, height: 80 },
      },
      frame: { left: 100, top: 120, width: 200, height: 160 },
      fit: "cover",
      transform: {
        anchorX: 0.6,
        anchorY: 0.4,
        zoom: 1.3,
        rotation: 22,
        opacity: 1,
      },
      clip: { left: 100, top: 120, width: 200, height: 160 },
    },
    "completed placement should expose source-space geometry for dependent tools",
  );
  assert(
    committedGraphNode?.exportKeys.includes("image:placement"),
    "completed placement should expose the committed image id as an export key",
  );
  assertDeepEqual(
    committedGraphNode?.visibleWhen,
    imagePlacementCommittedVisibleWhen("placement"),
    "completed placement should declaratively hide the graph-backed committed image while editing",
  );
  assertEqual(
    evaluateRuntimeCondition(committedGraphNode?.visibleWhen, {
      isSessionScopeActive: (scope) => sessions.hasActiveSession({ scope }),
    }),
    true,
    "completed placement committed image should be visible after the image session is committed",
  );
  assert(
    !scene.getScene(sessionSceneId),
    "completed placement should remove the framework session scene",
  );
  await driver.exportPlacementImage({ placementIds: ["placement"] });
  assertDeepEqual(
    exportService.calls[exportService.calls.length - 1]?.source?.layerIds,
    ["artwork"],
    "placement image export should use the committed placement business layer",
  );
  assertDeepEqual(
    exportService.calls[exportService.calls.length - 1]?.source?.elementIds,
    ["image:placement"],
    "placement image export should target the committed production image object",
  );

  await driver.beginSession("placement");
  const reopenedState = facade.getViewState();
  assertEqual(
    reopenedState.focusedPlacement?.image?.src,
    "/photo.png",
    "reopened image session should edit from the original source image",
  );
  assertEqual(
    reopenedState.focusedPlacement?.image?.scale,
    1.3,
    "reopened image session should restore the source transform",
  );
  await driver.resetSession("placement");
  const resetGraph = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph();
  const resetGraphNode = resetGraph.layers
    .find((layer) => layer.id === "artwork")
    ?.nodes.find((node) => node.id === "image:placement");
  assertEqual(
    resetGraphNode?.visual?.src,
    "data:image/png;base64,cropped-placement",
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
    undefined,
    "resetting should leave renderer selection to InteractionSpec",
  );
  assertEqual(
    resetGraphNode?.props.evented,
    undefined,
    "resetting should leave renderer hit testing to InteractionSpec",
  );
  assertEqual(
    resetGraphNode?.props.hasControls,
    undefined,
    "resetting should leave renderer controls to InteractionSpec",
  );
  assertDeepEqual(
    {
      placementId: resetGraphNode?.data.placementId,
      source: resetGraphNode?.data.source,
      type: resetGraphNode?.data.type,
    },
    {
      placementId: "placement",
      source: "committed",
      type: "image-placement-image",
    },
    "resetting a reopened image session should keep committed click target data",
  );

  await driver.beginSession("placement");
  await driver.setImageSource("placement", {
    src: "/photo.png",
    metadata: { width: 100, height: 80 },
  });
  await driver.setImageTransform("placement", { left: -1 });
  const warnResult = await driver.completeSession("placement");
  assertEqual(
    (warnResult as any).ok,
    true,
    "image placement should default to warn and allow outside-frame completion",
  );

  runtime.config.update("image.session.placementPolicy", "strict");
  await driver.beginSession("placement");
  await driver.setImageSource("placement", {
    src: "/photo.png",
    metadata: { width: 100, height: 80 },
  });
  await driver.setImageTransform("placement", { left: -1 });
  const strictResult = await driver.completeSession("placement");
  assertEqual(
    (strictResult as any).ok,
    false,
    "strict image placement policy should block outside-frame completion",
  );

  await runtime.dispose();
}

async function testImagePlacementStretchSessionUsesFrameSize() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  runtime.services.register(canvasService as any, CANVAS_SERVICE);

  const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
  scene.addLayer({ id: "artwork" });
  scene.addElement({
    id: "placement",
    layerId: "artwork",
    type: "rect",
    width: 200,
    height: 160,
    data: {
      imagePlacement: {
        enabled: true,
        fit: "stretch",
        frame: { x: 100, y: 120, width: 200, height: 160 },
        image: {
          src: "/wide-photo.png",
          metadata: { width: 100, height: 50 },
          left: 0.5,
          top: 0.5,
          scale: 1,
          angle: 0,
        },
      },
    },
  });

  const imageExtension = createImagePlacementCapability();
  runtime.extensions.register(imageExtension);
  await runtime.extensions.flushActivation();

  const driver = getImagePlacementTestDriver(imageExtension);
  await driver.beginSession("placement");
  const sessionImage = scene.selectOneElement({
    ids: ["session-image:image-placement:placement"],
    sceneId: "pooder.kit.image-placement.session:image-placement:placement",
  });

  assertEqual(
    sessionImage?.type === "image" ? sessionImage.width : undefined,
    100,
    "stretch image session should preserve the source intrinsic width",
  );
  assertEqual(
    sessionImage?.type === "image" ? sessionImage.height : undefined,
    50,
    "stretch image session should preserve the source intrinsic height",
  );
  assertEqual(
    sessionImage?.transform?.scaleX,
    2,
    "stretch image session should resolve the frame width through x scale",
  );
  assertEqual(
    sessionImage?.transform?.scaleY,
    3.2,
    "stretch image session should resolve the frame height through y scale",
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
    source: {
      layerIds: ["image.user"],
      elementIds: ["placement"],
      tags: [],
    },
    url: "data:image/png;base64,cropped-placement",
    width: 400,
  };
  let renderedSessionScale = 0;
  runtime.services.register(canvasService as any, CANVAS_SERVICE);
  runtime.services.register(exportService as any, SCENE_EXPORT_SERVICE);

  const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
  scene.addLayer({ id: "artwork" });
  scene.addElement({
    id: "placement",
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

  const imageExtension = createImagePlacementCapability();
  runtime.extensions.register(imageExtension);
  await runtime.extensions.flushActivation();
  const facade = runtime.capabilities.getOrThrow<ImagePlacementCapabilityApi>(
    IMAGE_PLACEMENT_CAPABILITY_ID,
  );
  const driver = getImagePlacementTestDriver(imageExtension);

  await driver.beginSession("placement");
  const canvasTarget: any = {
    angle: 12,
    data: {
      id: "session-image:image-placement:placement",
      layerId: "image.session.image",
      placementId: "placement",
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
  canvasService.emit("transform", { kind: "commit", target: canvasTarget });
  exportService.exportImage = async (options: Record<string, any>) => {
    const sessionNode = scene.selectOneElement({
      ids: ["session-image:image-placement:placement"],
      sceneId: "pooder.kit.image-placement.session:image-placement:placement",
    });
    renderedSessionScale = Number(sessionNode?.transform?.scaleX || 0);
    return FakeSceneExportService.prototype.exportImage.call(
      exportService,
      options,
    );
  };

  await driver.completeSession("placement");
  const committedImage = (
    scene.selectOneElement({ ids: ["placement"] })?.data as any
  )?.imagePlacement?.image;
  assertDeepEqual(
    committedImage.metadata?.transform,
    {
      left: 0.25,
      top: 0.2,
      scale: 1.5,
      angle: 12,
      opacity: 1,
    },
    "complete session should await the typed canvas transform commit before cropping",
  );
  assertEqual(
    renderedSessionScale,
    3,
    "complete session should re-render the crop source with the synced canvas source size",
  );

  await runtime.dispose();
}

async function testImagePlacementCommittedExportUsesObjectUrl() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  const exportService = new FakeSceneExportService();
  const dataUrl = "data:image/png;base64,c21hbGw=";
  exportService.error = null;
  exportService.response = {
    crop: { left: 0, top: 0, width: 100, height: 100 },
    format: "png",
    height: 100,
    multiplier: 1,
    source: {
      layerIds: ["artwork"],
      elementIds: ["placement"],
      tags: [],
    },
    url: dataUrl,
    width: 100,
  };
  runtime.services.register(canvasService as any, CANVAS_SERVICE);
  runtime.services.register(exportService as any, SCENE_EXPORT_SERVICE);

  const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
  scene.addLayer({ id: "artwork" });
  scene.addElement({
    id: "placement",
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

  const originalFetch = (globalThis as any).fetch;
  const originalCreateObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
    URL,
    "createObjectURL",
  );
  let fetchedUrl = "";
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:cropped-large-placement",
  });
  (globalThis as any).fetch = async (url: string) => {
    fetchedUrl = url;
    return {
      blob: async () => new Blob(["cropped"]),
    };
  };

  try {
    const imageExtension = createImagePlacementCapability();
    runtime.extensions.register(imageExtension);
    await runtime.extensions.flushActivation();
    const driver = getImagePlacementTestDriver(imageExtension);

    await driver.beginSession("placement");
    await driver.setImageSource("placement", {
      src: "/photo.png",
      metadata: { height: 80, width: 100 },
    });
    await driver.completeSession("placement");

    const committedImage = (
      scene.selectOneElement({ ids: ["placement"] })?.data as any
    )?.imagePlacement?.image;
    assertEqual(
      fetchedUrl,
      dataUrl,
      "committed image data URL should be converted through fetch",
    );
    assertEqual(
      committedImage.src,
      "blob:cropped-large-placement",
      "committed image data URL should be stored as an object URL",
    );
    assertEqual(
      committedImage.metadata?.derived?.src,
      "blob:cropped-large-placement",
      "committed image metadata should store the object URL",
    );
    const committedGraphNode = runtime.services
      .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
      .getGraph()
      .layers.flatMap((layer) => layer.nodes)
      .find((node) => node.id === "image:placement");
    assertEqual(
      committedGraphNode?.visual?.src,
      "blob:cropped-large-placement",
      "committed image render patch should avoid the inline data URL",
    );
  } finally {
    if (originalCreateObjectUrlDescriptor) {
      Object.defineProperty(
        URL,
        "createObjectURL",
        originalCreateObjectUrlDescriptor,
      );
    } else {
      delete (URL as any).createObjectURL;
    }
    (globalThis as any).fetch = originalFetch;
    await runtime.dispose();
  }
}

async function testImagePlacementKeepsWorkingImagesAcrossPlacementSwitches() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  runtime.services.register(canvasService as any, CANVAS_SERVICE);

  const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
  scene.addLayer({ id: "artwork" });
  scene.addElement({
    id: "placement-a",
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
    id: "placement-b",
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
    id: "committed-placement",
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

  const imageExtension = createImagePlacementCapability();
  runtime.extensions.register(imageExtension);
  await runtime.extensions.flushActivation();
  const facade = runtime.capabilities.getOrThrow<ImagePlacementCapabilityApi>(
    IMAGE_PLACEMENT_CAPABILITY_ID,
  );
  const driver = getImagePlacementTestDriver(imageExtension);
  const renderIntentService = runtime.services.getOrThrow<RenderIntentService>(
    RENDER_INTENT_SERVICE,
  );

  await driver.setImageSource("placement-a", {
    src: "/upload-placement-a.png",
    metadata: { width: 100, height: 100 },
  });
  await driver.setImageTransform("placement-a", { scale: 1.8 });
  await driver.resetSession("placement-a");
  const resetUploadedPlacement = facade
    .getViewState()
    .placements.find((placement) => placement.id === "placement-a");
  assertEqual(
    resetUploadedPlacement?.image?.src,
    "/upload-placement-a.png",
    "resetting after upload should keep the uploaded draft image",
  );
  assertEqual(
    resetUploadedPlacement?.image?.scale,
    1,
    "resetting after upload should restore the upload baseline transform",
  );
  await driver.beginSession("placement-b");
  const placementBSceneId =
    "pooder.kit.image-placement.session:image-placement:placement-b";
  assert(
    Boolean(
      scene.selectOneElement({
        ids: ["session-image:image-placement:placement-a"],
        sceneId: placementBSceneId,
      }),
    ),
    "the focused root should retain uploaded working images from other placements",
  );

  await driver.setImageSource("placement-b", {
    src: "/upload-placement-b.png",
    metadata: { width: 100, height: 100 },
  });
  assert(
    Boolean(
      scene.selectOneElement({
        ids: ["session-image:image-placement:placement-a"],
        sceneId: placementBSceneId,
      }),
    ) &&
      Boolean(
        scene.selectOneElement({
          ids: ["session-image:image-placement:placement-b"],
          sceneId: placementBSceneId,
        }),
      ),
    "multiple uploaded working images should render together before commit",
  );
  assert(
    renderIntentService.getRuntimeConditionValue(
      `${IMAGE_PLACEMENT_CAPABILITY_ID}.image-placement.active-placement.placement-a`,
    ) === true,
    "placement-a committed condition context should stay active while its working image exists",
  );

  await driver.beginSession("committed-placement");
  await driver.setImageTransform("committed-placement", {
    scale: 1.5,
    left: 0.2,
  });
  await driver.resetSession("committed-placement");
  const restoredPlacement = facade
    .getViewState()
    .placements.find((placement) => placement.id === "committed-placement");
  assertEqual(
    restoredPlacement?.image?.src,
    "/committed.png",
    "resetting an edit session should restore the committed image source",
  );
  assertEqual(
    restoredPlacement?.image?.scale,
    1,
    "resetting an edit session should discard uncommitted transform changes",
  );
  assert(
    renderIntentService.getRuntimeConditionValue(
      `${IMAGE_PLACEMENT_CAPABILITY_ID}.image-placement.active-placement.committed-placement`,
    ) !== true,
    "resetting an edit session should reveal the committed image again",
  );

  await runtime.dispose();
}

async function testImagePlacementUsesAppOwnedSessionIdAndPreservesDraft() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  const exportService = new FakeSceneExportService();
  exportService.error = null;
  exportService.response = {
    crop: { left: 0, top: 0, width: 100, height: 100 },
    format: "png",
    height: 100,
    multiplier: 1,
    source: {
      layerIds: ["artwork"],
      elementIds: ["placement"],
      tags: [],
    },
    url: "data:image/png;base64,business-session",
    width: 100,
  };
  runtime.services.register(canvasService as any, CANVAS_SERVICE);
  runtime.services.register(exportService as any, SCENE_EXPORT_SERVICE);

  const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
  scene.addLayer({ id: "artwork" });
  scene.addElement({
    id: "placement",
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

  const imageExtension = createImagePlacementCapability();
  runtime.extensions.register(imageExtension);
  await runtime.extensions.flushActivation();
  const facade = runtime.capabilities.getOrThrow<ImagePlacementCapabilityApi>(
    IMAGE_PLACEMENT_CAPABILITY_ID,
  );
  const driver = getImagePlacementTestDriver(imageExtension);
  const sessions = runtime.services.getOrThrow<SessionService>(SESSION_SERVICE);
  const sessionInput = {
    placementId: "placement",
    sessionId: "customization:image-placement:sku:new:front:placement",
  };

  await driver.beginSession(sessionInput);
  await driver.setImageSource(sessionInput, {
    src: "/draft.png",
    metadata: { width: 100, height: 100 },
  });
  await driver.setImageTransform(sessionInput, { scale: 1.7 });

  const canvasTarget = {
    angle: 0,
    data: {
      id: "session-image:image-placement:placement",
      layerId: "image.session.image",
      placementId: "placement",
      source: "working",
      type: "image-placement-image",
    },
    getCenterPoint: () => ({ x: 50, y: 50 }),
    getObjectScaling: () => ({ x: 1.7, y: 1.7 }),
    height: 100,
    left: 50,
    scaleX: 1.7,
    scaleY: 1.7,
    top: 50,
    width: 100,
  };
  canvasService.canvas.getObjects = () => [canvasTarget] as any;
  canvasService.setActiveObject(canvasTarget);

  assert(
    Boolean(sessions.getHandle(sessionInput.sessionId)),
    "app-owned image session id should be registered in SessionService",
  );
  await driver.beginSession(sessionInput);
  assertEqual(
    facade.getViewState().focusedPlacement?.image?.scale,
    1.7,
    "reopening the same app-owned image session should preserve the draft",
  );
  await driver.beginSession({
    placementId: "placement",
    sessionId: "customization:image-placement:sku:new:front:other",
  });
  assertEqual(
    facade.getViewState().focusedPlacement?.image?.src,
    undefined,
    "a different app-owned image session should not reuse another session draft",
  );
  await driver.beginSession(sessionInput);
  assertEqual(
    facade.getViewState().focusedPlacement?.image?.scale,
    1.7,
    "returning to the original app-owned image session should restore its draft",
  );

  const completeResult = await driver.completeSession(sessionInput);
  assertEqual(
    (completeResult as any).ok,
    true,
    "canvas sync should complete the app-owned session without replacing its uploaded draft",
  );
  const committedImage = (
    scene.selectOneElement({ ids: ["placement"] })?.data as any
  )?.imagePlacement?.image;
  assertEqual(
    committedImage.src,
    "data:image/png;base64,business-session",
    "completed app-owned image session should commit the draft to the placement",
  );
  assertEqual(
    sessions.getHandle(sessionInput.sessionId),
    undefined,
    "completed app-owned image session should leave the active SessionService registry",
  );

  await runtime.dispose();
}

async function testImagePlacementInteractionCommandOwnsSessionLifecycle() {
  const runtime = new Pooder();
  runtime.services.register(new FakeCanvasService() as any, CANVAS_SERVICE);
  const scenes = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);
  scenes.addLayer({ id: "artwork" });
  scenes.addElement({
    id: "placement",
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

  runtime.extensions.register(createImagePlacementCapability({}));
  await runtime.extensions.flushActivation();
  const facade = runtime.capabilities.getOrThrow<ImagePlacementCapabilityApi>(
    IMAGE_PLACEMENT_CAPABILITY_ID,
  );
  const interaction =
    runtime.services.getOrThrow<InteractionService>(INTERACTION_SERVICE);
  const sessions = runtime.services.getOrThrow<SessionService>(SESSION_SERVICE);
  const sessionId = "front.image.user.1";
  const changes: string[] = [];
  const subscription = facade.onDidChange((event) => changes.push(event.type));

  const activation = await interaction.activate({
    spec: {
      activation: {
        action: { commandId: IMAGE_PLACEMENT_OPEN_SESSION_COMMAND_ID },
        session: {
          channel: "image-placement",
          groupId: "editor-interaction",
          sessionId,
          mode: "exclusive",
          scope: "subject",
          leavePolicy: "block",
        },
      },
    },
    runtimeContext: {},
    trigger: "primary-pointer",
    subjectId: "placement",
    surfaceId: "legacy",
    targetData: { imagePlacement: { sessionKey: sessionId } },
  });

  const handle = sessions.getHandle(sessionId);
  assertEqual(activation.activated, true, "typed interaction should activate");
  assertEqual(
    handle?.descriptor.ownerId,
    IMAGE_PLACEMENT_CAPABILITY_ID,
    "ImagePlacement capability should be the sole session lifecycle owner",
  );
  assertEqual(
    activation.sessionResult,
    handle,
    "InteractionService should return the command-owned session handle",
  );
  assert(
    changes.includes("session-opened"),
    "typed capability events should report interaction session activation",
  );
  assertEqual(
    scenes.getActiveRoot()?.owner.sessionId,
    sessionId,
    "interaction activation should install the session-owned root scene",
  );

  await facade.rollbackSession({ placementId: "placement", sessionId });
  const stateChangeCount = changes.filter((type) => type === "state").length;
  const foreignSession = await sessions.open({
    descriptor: {
      sessionId: "white-ink:front",
      ownerId: "popecho.white-ink",
      scope: {},
      interactionMode: "exclusive",
      leavePolicy: "block",
    },
    initialDraft: {},
  });
  const foreignScene = scenes.createScene({
    id: "popecho.white-ink.session:front",
    owner: { type: "session", sessionId: foreignSession.descriptor.sessionId },
    composition: { entries: [{ source: "local", layerIds: ["white-ink"] }] },
  });
  foreignSession.own(foreignScene);
  foreignScene.addLayer({ id: "white-ink" });
  foreignScene.addElement({
    id: "white-ink-preview",
    layerId: "white-ink",
    type: "rect",
    width: 10,
    height: 10,
  });
  await Promise.resolve();
  assertEqual(
    changes.filter((type) => type === "state").length,
    stateChangeCount,
    "foreign session scene updates must not feed back into image placement state",
  );
  await foreignSession.cancel();
  subscription.dispose();
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

  await runtime.dispose();
}

async function testDielineOverlayConditionFollowsEditingSessions() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  runtime.services.register(canvasService as any, CANVAS_SERVICE);
  runtime.services
    .getOrThrow(SURFACE_FRAME_SERVICE)
    .setFrames("legacy", TEST_SURFACE_FRAMES);
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
    cutRect: rectByCenter(400, 300, 360, 360),
    offsetX: 0,
    offsetY: 0,
    revision: 1,
    scale: 3,
    surfaceId: "legacy",
    trimRect: rectByCenter(400, 300, 300, 360),
  };
  runtime.services.register(
    {
      getLayout: () => layout,
    } as any,
    SCENE_LAYOUT_SERVICE,
  );
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
  assert(
    dielineLayer,
    "dieline render intent should expose the dieline overlay layer",
  );

  const sessions = runtime.services.getOrThrow<SessionService>(SESSION_SERVICE);
  const context = {
    activeToolId: null,
    hasAnyActiveSession: (scope?: { channel?: string | null }) =>
      sessions.hasActiveSession({ scope }),
    isSessionScopeActive: (scope: { channel?: string | null }) =>
      sessions.hasActiveSession({ scope }),
  };

  assertEqual(
    evaluateRuntimeCondition(dielineNode?.visibleWhen, context),
    true,
    "dieline overlay should be visible when no edit session is active",
  );

  sessions.createSession({
    sessionId: "image-placement:placement",
    scope: { channel: "image-placement", subjectId: "placement" },
  });
  assertEqual(
    evaluateRuntimeCondition(dielineNode?.visibleWhen, context),
    false,
    "dieline overlay should be hidden during image placement sessions",
  );
  await sessions.cancelSession("image-placement:placement");

  sessions.createSession({
    sessionId: "dieline:front",
    scope: { channel: DIELINE_GEOMETRY_CAPABILITY_ID, subjectId: "front" },
  });
  assertEqual(
    evaluateRuntimeCondition(dielineNode?.visibleWhen, context),
    true,
    "dieline overlay should remain visible during dieline sessions",
  );

  await sessions.cancelSession("dieline:front");

  assertEqual(
    evaluateRuntimeCondition(dielineNode?.visibleWhen, context),
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

function testImageSessionOverlayBuildsBaseCropControls() {
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
    cutRect: rectByCenter(400, 300, 360, 360),
    offsetX: 0,
    offsetY: 0,
    revision: 1,
    scale: 3,
    surfaceId: "legacy",
    trimRect: rectByCenter(400, 300, 300, 300),
  };

  const imageOverlaySpecs = buildImageSessionOverlaySpecs({
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
  assert(
    imageOverlaySpecs.some((spec) => spec.id === "image.cropMask.rect"),
    "image session should render the crop mask",
  );
  assert(
    imageOverlaySpecs.some((spec) => spec.id === "image.cropFrame"),
    "image session should render the crop frame",
  );
  assert(
    !imageOverlaySpecs.some((spec) => spec.id === "image.cropShapeOutline"),
    "image session base overlay should not own dieline shape rendering",
  );
}

function testImageSessionOverlayUsesPlacementSurfaceLayout() {
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
    cutRect: rectByCenter(400, 300, 360, 360),
    offsetX: 0,
    offsetY: 0,
    revision: 7,
    scale: 3,
    surfaceId: "back",
    trimRect: rectByCenter(400, 300, 300, 300),
  };
  const tool = createImagePlacementCapability() as any;
  const requestedSurfaceIds: Array<string | undefined> = [];
  let capturedContext: any = null;
  tool.canvasService = {
    getScreenViewportRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  tool.sceneLayoutService = {
    getLayout: (surfaceId?: string) => {
      requestedSurfaceIds.push(surfaceId);
      return surfaceId === "back" ? layout : null;
    },
  };
  tool.surfaceFrameService = {
    listSurfaceIds: () => ["front"],
  };
  tool.sessionOverlayProviders.set("capture", {
    id: "capture",
    getOverlaySpecs: (context: any) => {
      capturedContext = context;
      return [];
    },
  });

  const entries = tool.buildSessionOverlayEntries(
    {
      id: "placement",
      metadata: { documentSurfaceId: "back" },
    },
    "session",
  );

  assert(entries.length > 0, "image session should build base overlay specs");
  assertEqual(
    requestedSurfaceIds[0],
    "back",
    "image session should request the placement surface layout",
  );
  assertEqual(
    capturedContext?.surfaceId,
    "back",
    "overlay providers should receive the snapshot surface id",
  );
  assertEqual(
    capturedContext?.layout?.surfaceId,
    "back",
    "overlay providers should receive the matching layout snapshot",
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
        runtime.services.getOrThrow(SURFACE_FRAME_SERVICE).setFrames("front", {
          previewBounds: { heightMm: 100, widthMm: 100, xMm: 0, yMm: 0 },
          productionFrame: { heightMm: 100, widthMm: 100, xMm: 0, yMm: 0 },
          exportFrame: { heightMm: 100, widthMm: 100, xMm: 0, yMm: 0 },
          viewportFocusFrame: { heightMm: 100, widthMm: 100, xMm: 0, yMm: 0 },
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
    runtime.services.getOrThrow(SURFACE_FRAME_SERVICE).getFrames("front")
      ?.exportFrame,
    { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 },
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
    sceneService.selectOneLayer({ ids: ["app.dieline"] }),
    "dieline geometry should create the caller-owned target layer",
  );
  assertEqual(
    sceneService.selectOneElement({ ids: ["app.dieline.path"] })?.type,
    "path",
    "dieline geometry should create a scene path element",
  );
  assertEqual(
    sceneService.selectOneElement({ ids: ["app.dieline.path"] })?.style?.stroke,
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
    sceneService.selectElements({ layerIds: ["app.dieline"] }).length,
    1,
    "dieline geometry upsert should not duplicate path elements",
  );

  await runtime.dispose();
}

async function testImageMaskCapabilityExtension() {
  const runtime = new Pooder();

  runtime.extensions.register(new ImageMaskCapabilityExtension());

  await runtime.extensions.flushActivation();

  assertEqual(
    runtime.extensions.getState(IMAGE_MASK_CAPABILITY_ID)?.state,
    "active",
    "image mask capability should activate",
  );

  const facade = runtime.capabilities.get<ImageMaskCapabilityApi>(
    IMAGE_MASK_CAPABILITY_ID,
  );
  if (!facade) {
    throw new Error("image mask capability facade should be registered");
  }

  try {
    await facade.extractAlphaMask("data:image/png;base64,test");
    throw new Error("image mask should require a browser image environment");
  } catch (error) {
    assertEqual(
      error instanceof Error ? error.message : "",
      "image-mask-browser-required",
      "image mask capability should report missing browser APIs",
    );
  }

  await runtime.dispose();
}

async function testConfigurableVisualConfigPatchesOriginalRenderIntents() {
  const runtime = new Pooder();

  runtime.extensions.register(createConfigurableVisualCapability());
  await runtime.extensions.flushActivation();

  await applyKitEditorDocument(runtime, {
    version: 6,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 200, height: 100, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "front.flash-base",
            objects: [
              {
                id: "front.flash-base",
                frame: { x: 0, y: 0, width: 200, height: 100 },
                source: { kind: "url", url: "/default-flash.png" },
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
    throw new Error(
      "configurable visual capability facade should be registered",
    );
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
    "configurable visual should preserve document default visible state before config patch",
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
    version: 6,
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
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "front.flash-base",
            objects: [
              {
                id: "front.flash-base",
                frame: { x: 0, y: 0, width: 200, height: 100 },
                source: { kind: "url", url: "/default-flash.png" },
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

async function testImagePlacementConfigurableVisualCommitKeepsCommittedImageVisible() {
  const runtime = new Pooder();
  const canvasService = new FakeCanvasService();
  const exportService = new FakeSceneExportService();
  exportService.error = null;
  exportService.response = {
    crop: { left: 0, top: 0, width: 100, height: 100 },
    format: "png",
    height: 100,
    multiplier: 1,
    source: {
      layerIds: ["image.session.image"],
      elementIds: ["front.image.user"],
      tags: [],
    },
    url: "data:image/png;base64,committed-configurable-placement",
    width: 100,
  };
  runtime.services.register(canvasService as any, CANVAS_SERVICE);
  runtime.services.register(exportService as any, SCENE_EXPORT_SERVICE);
  runtime.extensions.register(createConfigurableVisualCapability());
  const imageExtension = createImagePlacementCapability({});
  runtime.extensions.register(imageExtension);
  await runtime.extensions.flushActivation();

  await applyKitEditorDocument(runtime, {
    version: 6,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "front.artwork",
            objects: [
              {
                id: "front.image.user",
                frame: { x: 0, y: 0, width: 100, height: 100 },
                source: { kind: "url", url: "/placeholder.png" },
                effects: [
                  {
                    type: "image-placement",
                    payload: {
                      accepts: ["image"],
                      commitTarget: {
                        type: "configurable-visual",
                        key: "front.image.user",
                      },
                      sessionKey: "front.image.user",
                    },
                  },
                  {
                    type: "configurable-visual",
                    payload: { key: "front.image.user" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  const driver = getImagePlacementTestDriver(imageExtension);
  const facade = runtime.capabilities.getOrThrow<ImagePlacementCapabilityApi>(
    IMAGE_PLACEMENT_CAPABILITY_ID,
  );
  const sessionInput = {
    placementId: "front.image.user",
    sessionId: "customization:image-placement:sku:new:front:front.image.user",
  };
  const originalCreateObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
    URL,
    "createObjectURL",
  );
  const originalRevokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
    URL,
    "revokeObjectURL",
  );
  const originalFetch = (globalThis as any).fetch;
  let createObjectUrlCalls = 0;
  const revokedObjectUrls: string[] = [];
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => {
      createObjectUrlCalls += 1;
      return "blob:committed-configurable-placement";
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => {
      revokedObjectUrls.push(url);
    },
  });
  (globalThis as any).fetch = async () => ({
    blob: async () => new Blob(["committed-configurable-placement"]),
  });

  await driver.beginSession(sessionInput);
  await driver.setImageSource(sessionInput, {
    src: "blob:front-image-original",
    metadata: { width: 100, height: 100 },
  });
  try {
    await driver.completeSession(sessionInput);
  } finally {
    if (originalCreateObjectUrlDescriptor) {
      Object.defineProperty(
        URL,
        "createObjectURL",
        originalCreateObjectUrlDescriptor,
      );
    } else {
      delete (URL as any).createObjectURL;
    }
    (globalThis as any).fetch = originalFetch;
  }

  const sessions = runtime.services.getOrThrow<SessionService>(SESSION_SERVICE);
  const configurableVisualConfig = runtime.config.get(
    "configurableVisual",
  ) as any;
  assertEqual(
    configurableVisualConfig?.["front.image.user"]?.source?.src,
    "blob:front-image-original",
    "configurable visual image placement commit should retain the editable original source",
  );
  assertEqual(
    configurableVisualConfig?.["front.image.user"]?.src,
    "blob:committed-configurable-placement",
    "configurable visual image placement commit should store a compact committed object URL",
  );
  assertEqual(
    createObjectUrlCalls,
    1,
    "configurable visual image placement commit should convert exported data URLs to object URLs",
  );
  const committedGraphNode = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph()
    .layers.flatMap((layer) => layer.nodes)
    .find((node) => node.subjectId === "front.image.user" && node.visual?.src);
  assertEqual(
    committedGraphNode?.visual?.src,
    "blob:committed-configurable-placement",
    "configurable visual image placement commit should keep a committed image in the render graph",
  );
  assertEqual(
    committedGraphNode?.props.evented,
    undefined,
    "configurable visual commits should leave hit testing to InteractionSpec",
  );
  assertEqual(
    evaluateRuntimeCondition(committedGraphNode?.visibleWhen, {
      isSessionScopeActive: (scope) => sessions.hasActiveSession({ scope }),
    }),
    true,
    "configurable visual image placement commit should be visible after the session is committed",
  );
  sessions.createSession({
    sessionId: "stale-image-placement-session",
    scope: { channel: "image-placement", subjectId: "front.image.user" },
  });
  assertEqual(
    evaluateRuntimeCondition(committedGraphNode?.visibleWhen, {
      getContextValue: () => undefined,
      isSessionScopeActive: (scope) => sessions.hasActiveSession({ scope }),
    }),
    true,
    "configurable visual image placement commit should ignore stale active sessions once working state is gone",
  );
  await driver.beginSession(sessionInput);
  assertEqual(
    facade.getViewState().focusedPlacement?.image?.src,
    "blob:front-image-original",
    "reopened configurable visual image session should edit from the retained original source",
  );
  await driver.resetSession(sessionInput);

  try {
    await runtime.dispose();
    assertDeepEqual(
      revokedObjectUrls,
      [],
      "configurable visual committed object URLs should outlive the runtime that generated them",
    );
  } finally {
    if (originalRevokeObjectUrlDescriptor) {
      Object.defineProperty(
        URL,
        "revokeObjectURL",
        originalRevokeObjectUrlDescriptor,
      );
    } else {
      delete (URL as any).revokeObjectURL;
    }
  }
}

async function testFeatureCapabilityUsesObjectEffectState() {
  const runtime = new Pooder();
  runtime.services.register(new FakeCanvasService() as any, CANVAS_SERVICE);
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
    cutRect: rectByCenter(400, 300, 360, 360),
    offsetX: 0,
    offsetY: 0,
    revision: 1,
    scale: 3,
    surfaceId: "front",
    trimRect: rectByCenter(400, 300, 300, 300),
  };
  runtime.services.register(
    {
      getLayout: () => layout,
      invalidateLayout: () => {},
      onLayoutChange: () => ({ dispose() {} }),
      recomputeLayout: () => layout,
    } as any,
    SCENE_LAYOUT_SERVICE,
  );
  const initialFeature = {
    id: "initial-hole",
    operation: "subtract" as const,
    shape: "circle" as const,
    x: 0.5,
    y: 0.1,
    radius: 4,
  };
  const document = {
    version: 6 as const,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" as const },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "front.dieline-overlay",
            role: "guide" as const,
            order: 30,
            objects: [
              {
                id: "front.dieline.cutline",
                frame: { x: 0, y: 0, width: 100, height: 100 },
                metadata: { role: "dieline" },
                source: {
                  kind: "shape" as const,
                  shape: "rect" as const,
                  params: { width: 100, height: 100 },
                },
                effects: [
                  {
                    type: "feature",
                    payload: { features: [initialFeature], target: "both" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  runtime.extensions.registerMany(createKitCapabilitiesForDocument(document));
  await runtime.extensions.flushActivation();

  const result = await applyKitEditorDocument(runtime, document);
  assert(
    result.ok,
    `feature object document should apply (${JSON.stringify(result.diagnostics)})`,
  );
  const initialCutlineNode = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph()
    .layers.flatMap((layer) => layer.nodes)
    .find((node) => node.subjectId === "front.dieline.cutline");
  assert(
    typeof initialCutlineNode?.props.pathData === "string" &&
      initialCutlineNode.props.pathData !== "M0 0H100V100H0Z",
    "object feature effect should render into the static cutline path",
  );
  assertEqual(
    initialCutlineNode?.data.featureEffectApplied,
    true,
    "object feature effect should mark the patched cutline render intent",
  );

  const facade = runtime.capabilities.get<FeatureCapabilityApi>(
    FEATURE_CAPABILITY_ID,
  );
  if (!facade) {
    throw new Error("feature capability facade should be registered");
  }

  assertEqual(
    facade.getFeatures()[0]?.id,
    "initial-hole",
    "feature capability should initialize committed state from object effect",
  );

  await facade.beginSession();
  assertEqual(
    facade.getWorkingFeatures()[0]?.id,
    "initial-hole",
    "feature session should initialize working state from object effect",
  );

  const sessionGraph = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph();
  const cutlineNode = sessionGraph.layers
    .flatMap((layer) => layer.nodes)
    .find((node) => node.subjectId === "front.dieline.cutline");
  assertEqual(
    cutlineNode?.visible,
    false,
    "active feature session should hide the static cutline guide",
  );
  assert(
    sessionGraph.layers
      .flatMap((layer) => layer.nodes)
      .some(
        (node) => node.id.startsWith("feature.session.dieline") && node.visible,
      ),
    "active feature session should render the session dieline",
  );

  const replacementFeature = {
    ...initialFeature,
    id: "replacement-hole",
    x: 0.25,
  };
  facade.replaceFeatures([replacementFeature], { target: "both" });
  assertEqual(
    facade.getFeatures()[0]?.id,
    "replacement-hole",
    "replaceFeatures target both should update committed feature state",
  );

  const completion = facade.completeSession();
  assert(completion.ok, "feature completion should succeed");
  assertEqual(
    facade.getFeatures()[0]?.id,
    "replacement-hole",
    "completeSession should preserve committed feature state",
  );
  const completedCutlineNode = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph()
    .layers.flatMap((layer) => layer.nodes)
    .find((node) => node.subjectId === "front.dieline.cutline");
  assertEqual(
    completedCutlineNode?.visible,
    true,
    "completed feature session should restore static cutline guide visibility",
  );

  await runtime.dispose();
}

async function testKitEditorDocumentControllerMutatesObjectEffects() {
  const runtime = new Pooder();
  runtime.services.register(new FakeCanvasService() as any, CANVAS_SERVICE);
  const document = {
    version: 6 as const,
    config: TEST_DOCUMENT_CONFIG,
    surfaces: [
      {
        id: "front",
        size: { width: 100, height: 100, unit: "mm" as const },
        frames: TEST_SURFACE_FRAMES,
        layers: [
          {
            id: "front.dieline-overlay",
            role: "guide" as const,
            objects: [
              {
                id: "front.dieline.cutline",
                frame: { x: 0, y: 0, width: 100, height: 100 },
                source: {
                  kind: "shape" as const,
                  shape: "rect" as const,
                  params: { width: 100, height: 100 },
                },
              },
            ],
          },
        ],
      },
    ],
  };
  const documentWithFeatureEffect = {
    ...document,
    surfaces: [
      {
        ...document.surfaces[0]!,
        layers: [
          {
            ...document.surfaces[0]!.layers[0]!,
            objects: [
              {
                ...(document.surfaces[0]!.layers[0]!.objects![0] as any),
                effects: [{ type: "feature", payload: { features: [] } }],
              },
            ],
          },
        ],
      },
    ],
  };
  const controller = createKitEditorDocumentController(runtime);

  runtime.extensions.registerMany(
    createKitCapabilitiesForDocument(documentWithFeatureEffect),
  );
  await runtime.extensions.flushActivation();
  const applyResult = await controller.apply(document);
  assert(
    applyResult.ok,
    "document controller should apply source object document",
  );

  const nextFeature = {
    id: "saved-hole",
    operation: "subtract" as const,
    shape: "circle" as const,
    x: 0.4,
    y: 0.2,
    radius: 3,
  };
  const updated = await controller.updateObjectEffects(
    "front.dieline.cutline",
    [
      {
        type: "feature",
        payload: { features: [nextFeature], target: "both" },
      },
    ],
  );
  assert(updated, "document controller should update object effects");
  const cutline = controller
    .export()
    ?.surfaces[0]?.layers[0]?.objects?.find(
      (object) => object.id === "front.dieline.cutline",
    );
  assertEqual(
    (cutline?.effects?.[0]?.payload as any)?.features?.[0]?.id,
    "saved-hole",
    "document controller export should include updated object feature effect",
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

  const facade = runtime.capabilities.get<FeatureCapabilityApi>(
    FEATURE_CAPABILITY_ID,
  );
  if (!facade) {
    throw new Error("feature capability facade should be registered");
  }

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
  await testPaperPathGeometryProviderUtilities();
  testFeaturePlacementProjection();
  testRuntimeConditionDsl();
  testImageViewStateHelper();
  testContributionCompatibility();
  testKitCapabilityContractDefinitionsAndNormalization();
  await testDesignExportCapabilityExtension();
  await testSceneExportCapabilityExtension();
  await testKitCapabilityFactoriesDoNotRegisterTools();
  testCreateKitCapabilitiesForDocument();
  testCreateKitCapabilitiesForDocumentInfersDielineLayers();
  await testApplyKitEditorDocument();
  await testApplyKitEditorDocumentStacksGuideLayersAboveRuntimeOverlays();
  await testApplyKitEditorDocumentRefreshesImagePlacementOverlay();
  await testMirrorCapabilityDocumentEffectAndFacade();
  await testDocumentCompilerAndRuntimePatchUseSameMerge();
  await testKitEditorDocumentControllerMutatesObjectSource();
  await testApplyKitEditorDocumentObjectInteraction();
  await testApplyKitEditorDocumentDeclarativeObjectInteraction();
  await testApplyKitEditorDocumentRejectsInteractionComponentEffects();
  await testApplyKitEditorDocumentMissingCapabilities();
  await testImagePlacementCapabilityExtension();
  await testImagePlacementSessionUsesEditableWorkingObject();
  await testImagePlacementStretchSessionUsesFrameSize();
  await testImagePlacementCompleteSyncsCanvasTransform();
  await testImagePlacementCommittedExportUsesObjectUrl();
  await testImagePlacementKeepsWorkingImagesAcrossPlacementSwitches();
  await testImagePlacementUsesAppOwnedSessionIdAndPreservesDraft();
  await testImagePlacementInteractionCommandOwnsSessionLifecycle();
  await testEdgeDetectionCapabilityExtension();
  await testDielineOverlayConditionFollowsEditingSessions();
  testImageSessionOverlayBuildsBaseCropControls();
  testImageSessionOverlayUsesPlacementSurfaceLayout();
  await testDielineGeometryCapabilityExtension();
  await testImageMaskCapabilityExtension();
  await testConfigurableVisualConfigPatchesOriginalRenderIntents();
  await testImagePlacementConfigurableVisualCommitKeepsCommittedImageVisible();
  await testFeatureCapabilityUsesObjectEffectState();
  await testKitEditorDocumentControllerMutatesObjectEffects();
  await testFeatureCapabilityDefinition();
  console.log("ok");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
