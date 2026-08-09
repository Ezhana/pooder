import {
  CANVAS_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_SERVICE,
  Pooder,
  coordinateMatrix,
  createLocalToSceneMatrix,
  multiplyCoordinateMatrices,
  type RenderIntentService,
  type SceneService,
} from "@pooder/core";
import type { EditorDocument, EditorImageObject } from "@pooder/document";
import { registerEditorDocumentService } from "../../document-core/src";
import { FABRIC_RENDER_GRAPH_ADAPTER, FabricRenderGraphAdapter } from "../src";
import {
  IMAGE_SLOT_CAPABILITY_ID,
  IMAGE_SLOT_UPDATE_PLACEMENT_COMMAND_ID,
  ImageSlotCapabilityExtension,
  type ImageSlotCapabilityApi,
} from "../../tools/src/extensions/image-slot";

const OBJECT_ID = "nested-artwork";
const SECOND_OBJECT_ID = "nested-artwork-2";
const EPSILON = 1e-6;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message} (expected ${String(expected)}, got ${String(actual)})`,
    );
  }
}

function assertMatrixClose(
  actual: readonly number[] | undefined,
  expected: readonly number[] | undefined,
  message: string,
): void {
  assert(actual, `${message}: actual matrix missing`);
  assert(expected, `${message}: expected matrix missing`);
  actual.forEach((value, index) => {
    if (Math.abs(value - expected[index]!) > EPSILON) {
      throw new Error(
        `${message}: matrix[${index}] expected ${expected[index]}, got ${value}`,
      );
    }
  });
}

type MatrixValues = [number, number, number, number, number, number];

class ViewportCanvasService {
  readonly scale = 2.25;
  readonly offsetX = 137;
  readonly offsetY = -48;
  readonly reconcileCalls: Array<{ items: any[] }> = [];
  private readonly handlers = new Map<
    string,
    Array<(...args: any[]) => void>
  >();

  on(event: string, handler: (...args: any[]) => void) {
    const key = `typed:${event}`;
    const handlers = this.handlers.get(key) ?? [];
    handlers.push(handler);
    this.handlers.set(key, handlers);
    return {
      dispose: () =>
        this.handlers.set(
          key,
          (this.handlers.get(key) ?? []).filter((item) => item !== handler),
        ),
    };
  }

  onCanvasEvent(event: string, handler: (...args: any[]) => void) {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  offCanvasEvent(event: string, handler: (...args: any[]) => void) {
    this.handlers.set(
      event,
      (this.handlers.get(event) ?? []).filter((item) => item !== handler),
    );
  }

  emitCanvasEvent(event: string, payload: { target: any }) {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
    const kind =
      event === "object:moving"
        ? "move"
        : event === "object:scaling"
          ? "resize"
          : event === "object:rotating"
            ? "rotate"
            : event === "object:modified"
              ? "commit"
              : null;
    if (kind) {
      this.handlers
        .get("typed:transform")
        ?.forEach((handler) => handler({ kind, target: payload.target }));
    }
  }

  emitPointer(target: any) {
    this.handlers
      .get("typed:pointer")
      ?.forEach((handler) => handler({ kind: "down", target }));
  }

  async reconcileRenderGraphDrawList(items: any[]) {
    this.reconcileCalls.push({ items });
  }

  selectObjects() {
    return [];
  }

  getActiveObject() {
    return null;
  }
  setActiveObject() {}
  discardActiveObject() {}

  requestRenderAll() {}
  resize() {}
  setViewportLayout() {}
  getViewportSize() {
    return { width: 960, height: 720 };
  }
  getScreenViewportRect() {
    return { left: 0, top: 0, width: 960, height: 720 };
  }
  getSceneScale() {
    return this.scale;
  }
  toScreenLength(value: number) {
    return value * this.scale;
  }
  toSceneLength(value: number) {
    return value / this.scale;
  }
  toScreenMatrix(matrix: { values: readonly number[] }) {
    const [a, b, c, d, e, f] = matrix.values;
    return coordinateMatrix("object-local", "screen", [
      a! * this.scale,
      b! * this.scale,
      c! * this.scale,
      d! * this.scale,
      e! * this.scale + this.offsetX,
      f! * this.scale + this.offsetY,
    ]);
  }
  toSceneMatrix(matrix: { values: readonly number[] }) {
    const [a, b, c, d, e, f] = matrix.values;
    return coordinateMatrix("object-local", "scene", [
      a! / this.scale,
      b! / this.scale,
      c! / this.scale,
      d! / this.scale,
      (e! - this.offsetX) / this.scale,
      (f! - this.offsetY) / this.scale,
    ]);
  }
  toScenePoint(point: { x: number; y: number }) {
    return {
      space: "scene" as const,
      x: (point.x - this.offsetX) / this.scale,
      y: (point.y - this.offsetY) / this.scale,
    };
  }
  toScreenPoint(point: { x: number; y: number }) {
    return {
      space: "screen" as const,
      x: point.x * this.scale + this.offsetX,
      y: point.y * this.scale + this.offsetY,
    };
  }
  toSceneRect(rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  }) {
    return {
      space: "scene" as const,
      left: (rect.left - this.offsetX) / this.scale,
      top: (rect.top - this.offsetY) / this.scale,
      width: rect.width / this.scale,
      height: rect.height / this.scale,
    };
  }

  toScreenRect(rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  }) {
    return {
      space: "screen" as const,
      left: rect.left * this.scale + this.offsetX,
      top: rect.top * this.scale + this.offsetY,
      width: rect.width * this.scale,
      height: rect.height * this.scale,
    };
  }
}

function createEmptySlotObject(id: string, left: number): EditorImageObject {
  return {
    id,
    tags: ["slot:image"],
    visible: true,
    locked: false,
    placement: {
      localBounds: { x: 0, y: 0, width: 120, height: 80 },
      localToParent: [1, 0, 0, 1, left, 20],
      pivot: { x: 60, y: 40 },
    },
    source: { kind: "image" },
    appearance: {
      fit: "cover",
      anchorX: 0.5,
      anchorY: 0.5,
      zoom: 1,
      rotation: 0,
      opacity: 1,
      clip: "frame",
    },
    behaviors: [
      {
        type: "pooder.image-slot",
        config: {
          accepts: ["image/*"],
          placeholderSelector: { ids: [`${id}.placeholder`] },
        },
      },
    ],
  };
}

function createEmptySlotDocument(): EditorDocument {
  return {
    version: 7,
    assets: [],
    extensions: {},
    surfaces: [
      {
        id: "front",
        geometry: {
          canvasBounds: { x: 0, y: 0, width: 340, height: 120 },
          productionBounds: { x: 0, y: 0, width: 340, height: 120 },
        },
        layers: [
          {
            id: "front.image-slot",
            role: "content",
            visible: true,
            locked: false,
            objects: [
              createEmptySlotObject(OBJECT_ID, 20),
              {
                id: `${OBJECT_ID}.placeholder`,
                tags: ["placeholder:image-slot"],
                visible: true,
                locked: true,
                placement: {
                  localBounds: { x: 0, y: 0, width: 120, height: 80 },
                  localToParent: [1, 0, 0, 1, 20, 20],
                  pivot: { x: 60, y: 40 },
                },
                source: { kind: "shape", shape: "rect", params: {} },
                traits: [{ type: "core.placeholder" }],
              },
              createEmptySlotObject(SECOND_OBJECT_ID, 180),
              {
                id: `${SECOND_OBJECT_ID}.placeholder`,
                tags: ["placeholder:image-slot"],
                visible: true,
                locked: true,
                placement: {
                  localBounds: { x: 0, y: 0, width: 120, height: 80 },
                  localToParent: [1, 0, 0, 1, 180, 20],
                  pivot: { x: 60, y: 40 },
                },
                source: { kind: "shape", shape: "rect", params: {} },
                traits: [{ type: "core.placeholder" }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function createLayeredSlotDocument(): EditorDocument {
  const createVisualObject = (id: string, assetId: string): EditorImageObject => ({
    id,
    tags: ["export:mockup"],
    visible: true,
    locked: true,
    placement: {
      localBounds: { x: 0, y: 0, width: 340, height: 120 },
      localToParent: [1, 0, 0, 1, 0, 0] as MatrixValues,
      pivot: { x: 170, y: 60 },
    },
    source: { kind: "image" as const, assetId },
    appearance: {
      fit: "cover" as const,
      anchorX: 0.5,
      anchorY: 0.5,
      zoom: 1,
      rotation: 0,
      opacity: 1,
      clip: "frame" as const,
    },
  });
  const document = createEmptySlotDocument();
  document.assets.push(
    {
      id: "background.asset",
      type: "image",
      source: { kind: "url", url: "/background.png" },
      intrinsicSize: { width: 340, height: 120 },
    },
    {
      id: "foreground.asset",
      type: "image",
      source: { kind: "url", url: "/foreground.png" },
      intrinsicSize: { width: 340, height: 120 },
    },
  );
  const surface = document.surfaces[0]!;
  const slotLayer = surface.layers[0]!;
  surface.layers = [
    {
      id: "front.background",
      role: "content",
      visible: true,
      locked: true,
      objects: [createVisualObject("background", "background.asset")],
    },
    slotLayer,
    {
      id: "front.foreground",
      role: "overlay",
      visible: true,
      locked: true,
      objects: [createVisualObject("foreground", "foreground.asset")],
    },
  ];
  return document;
}

async function testImageSlotSessionPreservesDocumentLayerOrder(): Promise<void> {
  const runtime = new Pooder();
  const canvas = new ViewportCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as never, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);
  runtime.extensions.register(new ImageSlotCapabilityExtension());
  await runtime.extensions.flushActivation();
  const controller = registerEditorDocumentService(runtime);
  try {
    const applied = await controller.apply(createLayeredSlotDocument());
    assert(
      applied.ok,
      `layered image-slot document should apply (${JSON.stringify(applied.diagnostics)})`,
    );
    const facade = runtime.capabilities.get<ImageSlotCapabilityApi>(
      IMAGE_SLOT_CAPABILITY_ID,
    );
    assert(facade, "image-slot facade should exist");
    facade.syncDocument(applied.document, controller);
    assertEqual(
      (await facade.openSession({ objectId: OBJECT_ID })).ok,
      true,
      "layered image-slot session should open",
    );
    await facade.setResource({
      kind: "data-url",
      dataUrl: "data:image/png;base64,AA==",
      intrinsicSize: { width: 120, height: 80 },
    });
    await adapter.flush();
    const visibleItems = (canvas.reconcileCalls.at(-1)?.items ?? []).filter(
      (item) => item.spec?.props?.visible !== false,
    );
    const backgroundIndex = visibleItems.findIndex(
      (item) => item.spec?.id === "background",
    );
    const workingIndex = visibleItems.findIndex(
      (item) => item.spec?.data?.imageSlotObjectId === OBJECT_ID,
    );
    const foregroundIndex = visibleItems.findIndex(
      (item) => item.spec?.id === "foreground",
    );
    assert(
      backgroundIndex >= 0 && workingIndex >= 0 && foregroundIndex >= 0,
      `layered session items should render (${JSON.stringify(
        visibleItems.map((item) => ({ id: item.spec?.id, data: item.spec?.data })),
      )})`,
    );
    assert(
      backgroundIndex < workingIndex && workingIndex < foregroundIndex,
      "working image should preserve its document position between background and foreground layers",
    );
    await facade.rollbackSession();
  } finally {
    await runtime.dispose();
  }
}

async function testEmptyImageSlotPointerActivation(): Promise<void> {
  const runtime = new Pooder();
  const canvas = new ViewportCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as never, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);
  runtime.extensions.register(new ImageSlotCapabilityExtension());
  await runtime.extensions.flushActivation();
  const controller = registerEditorDocumentService(runtime);
  try {
    const applied = await controller.apply(createEmptySlotDocument());
    assert(
      applied.ok,
      `empty image-slot document should apply (${JSON.stringify(applied.diagnostics)})`,
    );
    const facade = runtime.capabilities.get<ImageSlotCapabilityApi>(
      IMAGE_SLOT_CAPABILITY_ID,
    );
    assert(facade, "empty image-slot facade should exist");
    facade.syncDocument(applied.document, controller);
    await adapter.flush();
    const hitTarget = canvas.reconcileCalls
      .at(-1)
      ?.items.find(
        (candidate) => candidate.key === `${SECOND_OBJECT_ID}:frame-hit-target`,
      );
    assert(hitTarget, "empty image-slot should expose a frame hit target");
    assertEqual(
      hitTarget.spec.data?.interactionSpec?.activation?.action?.commandId,
      "pooder.image-slot.open",
      "image-slot behavior should compile its activation command",
    );
    canvas.emitPointer({
      data: { ...hitTarget.spec.data, renderTarget: "render-graph" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEqual(
      facade.getViewState().phase,
      "active",
      "clicking an empty image-slot should activate its session",
    );
    assertEqual(
      facade.getViewState().draft?.objectId,
      SECOND_OBJECT_ID,
      "clicking an empty image-slot should open its session",
    );
    const scene = runtime.services
      .getOrThrow<SceneService>(SCENE_SERVICE)
      .getSceneHandle(`image-slot:${SECOND_OBJECT_ID}:scene`);
    const cropFrame = scene
      ?.selectElements()
      .find(
        (element) => element.id === `image-slot:${SECOND_OBJECT_ID}:crop-frame`,
      );
    assert(cropFrame?.transform, "active image-slot crop frame should render");
    const expectedScreenFrame = canvas.toScreenRect({
      left: 180,
      top: 20,
      width: 120,
      height: 80,
    });
    assertEqual(
      cropFrame.transform.left,
      expectedScreenFrame.left,
      "multi-slot crop frame should use the active object x position",
    );
    assertEqual(
      cropFrame.transform.top,
      expectedScreenFrame.top,
      "multi-slot crop frame should use the active object y position",
    );
    await facade.setResource({
      kind: "data-url",
      dataUrl: "data:image/png;base64,AA==",
      intrinsicSize: { width: 120, height: 80 },
    });
    await runtime.commands.execute(IMAGE_SLOT_UPDATE_PLACEMENT_COMMAND_ID, {
      objectId: SECOND_OBJECT_ID,
      phase: "preview",
      transform: {
        centerX: 240,
        centerY: 60,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
      },
      metadata: {
        rectSnap: {
          guides: [
            { axis: "x", position: 225 },
            { axis: "y", position: 55 },
          ],
        },
      },
    });
    const verticalGuide = scene
      ?.selectElements()
      .find(
        (element) =>
          element.id === `image-slot:${SECOND_OBJECT_ID}:snap-guide:x`,
      );
    const horizontalGuide = scene
      ?.selectElements()
      .find(
        (element) =>
          element.id === `image-slot:${SECOND_OBJECT_ID}:snap-guide:y`,
      );
    assert(
      verticalGuide?.transform && horizontalGuide?.transform,
      "active image-slot snap guides should render",
    );
    assertEqual(
      verticalGuide.transform.top,
      20,
      "vertical guide should use scene y",
    );
    assertEqual(
      horizontalGuide.transform.left,
      180,
      "horizontal guide should use scene x",
    );
    await facade.rollbackSession();
  } finally {
    await runtime.dispose();
  }
}

function createNestedDocument(): EditorDocument {
  return {
    version: 7,
    assets: [
      {
        id: "nested-artwork.asset",
        type: "image",
        source: { kind: "url", url: "/nested.png" },
        intrinsicSize: { width: 240, height: 135 },
      },
    ],
    extensions: {},
    surfaces: [
      {
        id: "front",
        geometry: {
          canvasBounds: { x: 0, y: 0, width: 300, height: 220 },
          productionBounds: { x: 0, y: 0, width: 300, height: 220 },
        },
        layers: [
          {
            id: "artwork",
            role: "content",
            visible: true,
            locked: false,
            objects: [
              {
                id: "composite-parent",
                tags: ["composite:test"],
                visible: true,
                locked: false,
                placement: {
                  localBounds: { x: 35, y: 24, width: 190, height: 145 },
                  localToParent: [
                    ...createLocalToSceneMatrix({
                      position: { x: 142, y: 105 },
                      pivot: { x: 130, y: 96.5 },
                      rotation: 19,
                      scaleX: 1.18,
                      scaleY: 0.82,
                    }).values,
                  ] as MatrixValues,
                  pivot: { x: 130, y: 96.5 },
                },
                interaction: {
                  selection: { enabled: true },
                },
                children: [
                  {
                    id: OBJECT_ID,
                    tags: ["slot:image"],
                    visible: true,
                    locked: false,
                    placement: {
                      localBounds: { x: 18, y: 26, width: 110, height: 72 },
                      localToParent: [
                        ...createLocalToSceneMatrix({
                          position: { x: 76, y: 64 },
                          pivot: { x: 73, y: 62 },
                          rotation: -11,
                          scaleX: 0.94,
                          scaleY: 1.08,
                        }).values,
                      ] as MatrixValues,
                      pivot: { x: 73, y: 62 },
                    },
                    source: { kind: "image", assetId: "nested-artwork.asset" },
                    appearance: {
                      fit: "cover",
                      anchorX: 0.35,
                      anchorY: 0.65,
                      zoom: 1.15,
                      rotation: 7,
                      opacity: 1,
                      clip: "frame",
                    },
                    behaviors: [
                      {
                        type: "pooder.image-slot",
                        config: {
                          accepts: ["image/*"],
                          placeholderSelector: { ids: [`${OBJECT_ID}.placeholder`] },
                        },
                      },
                    ],
                  },
                  {
                    id: `${OBJECT_ID}.placeholder`,
                    tags: ["placeholder:image-slot"],
                    visible: true,
                    locked: true,
                    placement: {
                      localBounds: { x: 18, y: 26, width: 110, height: 72 },
                      localToParent: [1, 0, 0, 1, 0, 0],
                      pivot: { x: 73, y: 62 },
                    },
                    source: { kind: "shape", shape: "rect", params: {} },
                    traits: [{ type: "core.placeholder" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function getWorkingMatrix(runtime: Pooder): MatrixValues {
  const scene = runtime.services
    .getOrThrow<SceneService>(SCENE_SERVICE)
    .getSceneHandle(`image-slot:${OBJECT_ID}:scene`);
  const element = scene
    ?.selectElements()
    .find((candidate) => candidate.id === `image-slot:${OBJECT_ID}:working`);
  assert(element?.placement, "working image placement should exist");
  return [...element.placement.localToScene.values] as MatrixValues;
}

function getCommittedMatrix(runtime: Pooder): MatrixValues {
  const node = runtime.services
    .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
    .getGraph()
    .layers.flatMap((layer) => layer.nodes)
    .find((candidate) => candidate.subjectId === OBJECT_ID);
  assert(node, "committed nested image node should exist");
  return [...node.placement.localToScene.values] as MatrixValues;
}

function transformBounds(
  matrix: MatrixValues,
  bounds: { left: number; top: number; width: number; height: number },
) {
  const corners = [
    [bounds.left, bounds.top],
    [bounds.left + bounds.width, bounds.top],
    [bounds.left, bounds.top + bounds.height],
    [bounds.left + bounds.width, bounds.top + bounds.height],
  ].map(([x, y]) => ({
    x: matrix[0] * x! + matrix[2] * y! + matrix[4],
    y: matrix[1] * x! + matrix[3] * y! + matrix[5],
  }));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export async function testImageSlotFabricViewportAndParentTransform(): Promise<void> {
  await testEmptyImageSlotPointerActivation();
  await testImageSlotSessionPreservesDocumentLayerOrder();
  const runtime = new Pooder();
  const canvas = new ViewportCanvasService();
  const adapter = new FabricRenderGraphAdapter();
  runtime.services.register(canvas as never, CANVAS_SERVICE);
  runtime.services.register(adapter, FABRIC_RENDER_GRAPH_ADAPTER);
  runtime.extensions.register(new ImageSlotCapabilityExtension());
  await runtime.extensions.flushActivation();
  const controller = registerEditorDocumentService(runtime);
  try {
    const applied = await controller.apply(createNestedDocument());
    assert(
      applied.ok,
      `nested image-slot document should apply (${JSON.stringify(applied.diagnostics)})`,
    );
    const facade = runtime.capabilities.get<ImageSlotCapabilityApi>(
      IMAGE_SLOT_CAPABILITY_ID,
    );
    assert(facade, "image-slot facade should exist");
    facade.syncDocument(applied.document, controller);
    assertEqual(
      (await facade.openSession({ objectId: OBJECT_ID })).ok,
      true,
      "nested image-slot session should open",
    );
    await adapter.flush();
    const item = canvas.reconcileCalls
      .at(-1)
      ?.items.find(
        (candidate) =>
          candidate.spec?.data?.imageSlotObjectId === OBJECT_ID &&
          candidate.spec?.data?.sceneElementId ===
            `image-slot:${OBJECT_ID}:working`,
      );
    assert(
      item?.spec?.placement,
      `working Fabric render spec should exist (${JSON.stringify(
        canvas.reconcileCalls.at(-1)?.items.map((candidate) => ({
          key: candidate.key,
          data: candidate.spec?.data,
        })),
      )})`,
    );
    assert(
      item.spec.data?.interactionSpec,
      "working spec should be manipulable",
    );
    const bounds = item.spec.placement.localBounds;
    const originalPlacement = facade.getViewState().draft?.placement;
    assert(
      originalPlacement,
      "nested image-slot draft should expose placement",
    );
    assertEqual(
      facade.updatePlacement({
        fit: "cover",
        anchorX: 0.58,
        anchorY: 0.31,
        zoom: 1.42,
        rotation: 28,
        opacity: 0.88,
        clip: "frame",
      }).ok,
      true,
      "representable nested target placement should render",
    );
    const expectedSceneMatrix = getWorkingMatrix(runtime);
    assertEqual(
      facade.updatePlacement(originalPlacement).ok,
      true,
      "nested draft should reset before Fabric projection",
    );
    let targetSceneMatrix = getWorkingMatrix(runtime);
    const parentNode = runtime.services
      .getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE)
      .getGraph()
      .layers.flatMap((layer) => layer.nodes)
      .find(
        (candidate) => candidate.id === "composite-parent:interaction-proxy",
      );
    assert(parentNode, "composite parent projection should exist");

    const target: any = {
      angle: 0,
      scaleX: 1,
      scaleY: 1,
      width: bounds.width,
      height: bounds.height,
      data: {
        ...item.spec.data,
        affinePlacement: item.spec.placement,
        renderTarget: "render-graph",
      },
      group: {
        calcTransformMatrix: () =>
          canvas.toScreenMatrix(parentNode.placement.localToScene).values,
      },
      calcTransformMatrix: () => {
        const centerToLocal = coordinateMatrix("object-local", "object-local", [
          1,
          0,
          0,
          1,
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        ]);
        return canvas.toScreenMatrix(
          multiplyCoordinateMatrices(
            coordinateMatrix("object-local", "scene", targetSceneMatrix),
            centerToLocal,
          ),
        ).values;
      },
      getBoundingRect: () => {
        const scene = transformBounds(targetSceneMatrix, bounds);
        return {
          left: scene.left * canvas.scale + canvas.offsetX,
          top: scene.top * canvas.scale + canvas.offsetY,
          width: scene.width * canvas.scale,
          height: scene.height * canvas.scale,
        };
      },
      set(values: Record<string, unknown>) {
        Object.assign(this, values);
      },
      setCoords() {},
    };
    targetSceneMatrix = [
      targetSceneMatrix[0],
      targetSceneMatrix[1],
      targetSceneMatrix[2],
      targetSceneMatrix[3],
      expectedSceneMatrix[4],
      expectedSceneMatrix[5],
    ];
    canvas.emitCanvasEvent("object:moving", { target });

    targetSceneMatrix = [
      expectedSceneMatrix[0],
      expectedSceneMatrix[1],
      expectedSceneMatrix[2],
      expectedSceneMatrix[3],
      targetSceneMatrix[4],
      targetSceneMatrix[5],
    ];
    canvas.emitCanvasEvent("object:scaling", { target });

    targetSceneMatrix = [...expectedSceneMatrix];
    canvas.emitCanvasEvent("object:rotating", { target });
    canvas.emitCanvasEvent("object:modified", { target });

    const working = getWorkingMatrix(runtime);
    assertMatrixClose(
      working,
      expectedSceneMatrix,
      "Fabric screen-to-scene working matrix under nested parent",
    );
    assertEqual(
      (await facade.commitSession()).type,
      "placed",
      "Fabric-projected nested session should commit",
    );
    const committed = getCommittedMatrix(runtime);
    assertMatrixClose(
      committed,
      working,
      "nested Fabric working/committed matrix",
    );
    assertEqual(
      (await facade.openSession({ objectId: OBJECT_ID })).ok,
      true,
      "nested committed session should reopen",
    );
    assertMatrixClose(
      getWorkingMatrix(runtime),
      committed,
      "nested Fabric committed/reopened matrix",
    );
    console.log(
      `MATRIX viewport=225% nested working=${JSON.stringify(working)} committed=${JSON.stringify(committed)}`,
    );
    await facade.rollbackSession();
  } finally {
    await runtime.dispose();
  }
}
