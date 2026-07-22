import type {
  CoordinateRect,
  CanvasService,
  SceneExportOutputMaskTransparentColor,
  SceneExportOutputMaskMode,
} from "@pooder/core";
import { Canvas as FabricCanvas, type FabricObject, Point } from "fabric";

export interface OutputMaskRenderCanvas {
  add(object: FabricObject): void;
  dispose(): void;
  renderAll(): void;
  setDimensions(size: { width: number; height: number }): void;
  toDataURL(options: { format: "png"; multiplier: number }): string;
}

export interface RenderOutputMaskOptions {
  crop: CoordinateRect<"scene">;
  height: number;
  mode: SceneExportOutputMaskMode;
  multiplier: number;
  sceneScale: number;
  source: FabricObject;
  sourceInTargetSpace?: boolean;
  transparentColor?: SceneExportOutputMaskTransparentColor;
  width: number;
}

const OUTPUT_MASK_ALPHA_THRESHOLD = 8;

function createBrowserCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === "undefined") {
    throw new Error("browser-scene-export-output-mask-browser-required");
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function createFabricMaskCanvas(
  width: number,
  height: number,
): OutputMaskRenderCanvas {
  const exportCanvas = new FabricCanvas(createBrowserCanvas(width, height), {
    renderOnAddRemove: false,
    selection: false,
    enableRetinaScaling: false,
    preserveObjectStacking: true,
  } as any);
  exportCanvas.setDimensions({ width, height });
  return exportCanvas;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("browser-scene-export-output-mask-image-load-failed"));
    image.src = src;
  });
}

function readObjectType(source: any): string {
  return String(
    source?.type || source?.data?.documentObjectType || "",
  ).toLowerCase();
}

function readImageSource(source: any): string {
  const fromGetSrc =
    typeof source?.getSrc === "function" ? source.getSrc() : undefined;
  return String(
    fromGetSrc ||
      source?.src ||
      source?._element?.src ||
      source?.data?.src ||
      "",
  ).trim();
}

function getSourceCenter(source: any): { x: number; y: number } {
  return source?.getCenterPoint
    ? source.getCenterPoint()
    : new Point(source?.left ?? 0, source?.top ?? 0);
}

function normalizeScaleBase(sceneScale: number): number {
  return Number.isFinite(sceneScale) && sceneScale > 0 ? sceneScale : 1;
}

function assertMaskSourceSupported(
  source: FabricObject,
  mode: SceneExportOutputMaskMode,
) {
  const type = readObjectType(source);

  if (mode === "shape") {
    if (type === "path" || type === "rect") return;
    throw new Error("browser-scene-export-output-mask-source-unsupported");
  }

  if (type !== "image") {
    throw new Error("browser-scene-export-output-mask-source-unsupported");
  }

  if (!readImageSource(source)) {
    throw new Error("browser-scene-export-output-mask-source-src-missing");
  }
}

function prepareShapeMaskClone(clone: any, mode: SceneExportOutputMaskMode) {
  if (mode !== "shape") return;

  clone.set?.({
    fill: "#000",
    opacity: 1,
    stroke: undefined,
  });
}

function hasAnyAlpha(alpha: Uint8ClampedArray): boolean {
  return alpha.some((value) => value > OUTPUT_MASK_ALPHA_THRESHOLD);
}

export function createAlphaMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = OUTPUT_MASK_ALPHA_THRESHOLD,
): Uint8ClampedArray | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) {
    return null;
  }

  const alpha = new Uint8ClampedArray(width * height);
  for (let index = 0; index < alpha.length; index += 1) {
    alpha[index] = (data[index * 4 + 3] ?? 0) > alphaThreshold ? 255 : 0;
  }

  return hasAnyAlpha(alpha) ? alpha : null;
}

const clampColorChannel = (value: number): number => {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(255, Math.round(value)))
    : 0;
};

const normalizeTransparentColor = (
  color: SceneExportOutputMaskTransparentColor | undefined,
): Required<SceneExportOutputMaskTransparentColor> | null => {
  if (!color) return null;

  return {
    red: clampColorChannel(color.red),
    green: clampColorChannel(color.green),
    blue: clampColorChannel(color.blue),
    tolerance: clampColorChannel(color.tolerance ?? 0),
  };
};

const matchesTransparentColor = (
  data: Uint8ClampedArray,
  dataIndex: number,
  color: Required<SceneExportOutputMaskTransparentColor>,
) => {
  return (
    Math.abs((data[dataIndex] ?? 0) - color.red) <= color.tolerance &&
    Math.abs((data[dataIndex + 1] ?? 0) - color.green) <= color.tolerance &&
    Math.abs((data[dataIndex + 2] ?? 0) - color.blue) <= color.tolerance
  );
};

export function applyTransparentColorToAlpha(
  data: Uint8ClampedArray,
  transparentColor?: SceneExportOutputMaskTransparentColor,
  alphaThreshold = OUTPUT_MASK_ALPHA_THRESHOLD,
): Uint8ClampedArray {
  const color = normalizeTransparentColor(transparentColor);
  if (!color) return data;

  const next = new Uint8ClampedArray(data);
  for (let dataIndex = 0; dataIndex < next.length; dataIndex += 4) {
    if (
      (next[dataIndex + 3] ?? 0) > alphaThreshold &&
      matchesTransparentColor(next, dataIndex, color)
    ) {
      next[dataIndex + 3] = 0;
    }
  }

  return next;
}

export function createBoundaryOutputMaskAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = OUTPUT_MASK_ALPHA_THRESHOLD,
): Uint8ClampedArray | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) {
    return null;
  }

  const pixelCount = width * height;
  const boundary = new Uint8Array(pixelCount);
  const outside = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let boundaryCount = 0;
  let queueStart = 0;
  let queueEnd = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    if ((data[index * 4 + 3] ?? 0) > alphaThreshold) {
      boundary[index] = 1;
      boundaryCount += 1;
    }
  }

  if (boundaryCount === 0) return null;

  const enqueueOutside = (index: number) => {
    if (boundary[index] || outside[index]) return;
    outside[index] = 1;
    queue[queueEnd] = index;
    queueEnd += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueueOutside(x);
    enqueueOutside((height - 1) * width + x);
  }

  for (let y = 0; y < height; y += 1) {
    enqueueOutside(y * width);
    enqueueOutside(y * width + width - 1);
  }

  while (queueStart < queueEnd) {
    const index = queue[queueStart] ?? 0;
    queueStart += 1;

    const x = index % width;
    const y = Math.floor(index / width);

    if (x > 0) enqueueOutside(index - 1);
    if (x < width - 1) enqueueOutside(index + 1);
    if (y > 0) enqueueOutside(index - width);
    if (y < height - 1) enqueueOutside(index + width);
  }

  const alpha = new Uint8ClampedArray(pixelCount);
  let enclosedCount = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (outside[index]) continue;
    alpha[index] = 255;
    if (!boundary[index]) enclosedCount += 1;
  }

  return enclosedCount > 0 ? alpha : null;
}

export function applyAlphaMaskData(
  data: Uint8ClampedArray,
  alpha: Uint8ClampedArray,
): Uint8ClampedArray {
  const next = new Uint8ClampedArray(data);
  const pixelCount = Math.min(alpha.length, Math.floor(next.length / 4));

  for (let index = 0; index < pixelCount; index += 1) {
    const dataIndex = index * 4 + 3;
    next[dataIndex] = Math.round(
      ((next[dataIndex] ?? 0) * (alpha[index] ?? 0)) / 255,
    );
  }

  return next;
}

function toMaskAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  mode: SceneExportOutputMaskMode,
  transparentColor?: SceneExportOutputMaskTransparentColor,
): Uint8ClampedArray | null {
  const maskData = applyTransparentColorToAlpha(data, transparentColor);

  if (mode === "outline") {
    return createBoundaryOutputMaskAlpha(maskData, width, height);
  }

  return createAlphaMask(maskData, width, height);
}

function rewriteMaskCanvasAlpha(
  canvas: HTMLCanvasElement,
  options: {
    mode: SceneExportOutputMaskMode;
    transparentColor?: SceneExportOutputMaskTransparentColor;
  },
) {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("browser-scene-export-output-mask-canvas-unavailable");
  }

  let imageData: ImageData;
  try {
    imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    throw new Error("browser-scene-export-output-mask-unreadable");
  }

  const alpha = toMaskAlpha(
    imageData.data,
    canvas.width,
    canvas.height,
    options.mode,
    options.transparentColor,
  );
  if (!alpha) {
    throw new Error("browser-scene-export-output-mask-invalid");
  }

  for (let index = 0; index < alpha.length; index += 1) {
    const dataIndex = index * 4;
    imageData.data[dataIndex] = 0;
    imageData.data[dataIndex + 1] = 0;
    imageData.data[dataIndex + 2] = 0;
    imageData.data[dataIndex + 3] = alpha[index] ?? 0;
  }

  context.putImageData(imageData, 0, 0);
}

export async function renderOutputMask(
  options: RenderOutputMaskOptions & {
    canvasService: CanvasService;
    createMaskCanvas?: (
      width: number,
      height: number,
    ) => OutputMaskRenderCanvas;
  },
): Promise<HTMLCanvasElement> {
  assertMaskSourceSupported(options.source, options.mode);

  const maskCanvas = (options.createMaskCanvas ?? createFabricMaskCanvas)(
    options.width,
    options.height,
  );
  const scaleBase = normalizeScaleBase(options.sceneScale);

  try {
    const source = options.source as any;
    const clone = await source.clone();
    if (options.sourceInTargetSpace) {
      clone.set({
        clipPath: undefined,
        selectable: false,
        evented: false,
        visible: true,
      });
    } else {
      const center = getSourceCenter(source);
      const sceneCenter = options.canvasService.toScenePoint({
        space: "screen",
        x: center.x,
        y: center.y,
      });
      clone.set({
        clipPath: undefined,
        originX: "center",
        originY: "center",
        left: (sceneCenter.x - options.crop.left) * options.multiplier,
        top: (sceneCenter.y - options.crop.top) * options.multiplier,
        scaleX: ((source.scaleX || 1) / scaleBase) * options.multiplier,
        scaleY: ((source.scaleY || 1) / scaleBase) * options.multiplier,
        angle: source.angle || 0,
        selectable: false,
        evented: false,
        visible: true,
      });
    }
    prepareShapeMaskClone(clone, options.mode);
    clone.setCoords?.();
    maskCanvas.add(clone);
    maskCanvas.renderAll();

    const url = maskCanvas.toDataURL({ format: "png", multiplier: 1 });
    if (!url) {
      throw new Error("browser-scene-export-output-mask-failed");
    }

    const image = await loadImage(url);
    const canvas = createBrowserCanvas(options.width, options.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("browser-scene-export-output-mask-canvas-unavailable");
    }
    context.drawImage(image, 0, 0, options.width, options.height);
    rewriteMaskCanvasAlpha(canvas, {
      mode: options.mode,
      transparentColor: options.transparentColor,
    });
    return canvas;
  } finally {
    maskCanvas.dispose();
  }
}

export async function applyAlphaMask(options: {
  height: number;
  maskCanvas: HTMLCanvasElement;
  sourceUrl: string;
  width: number;
}): Promise<string> {
  const image = await loadImage(options.sourceUrl);
  const canvas = createBrowserCanvas(options.width, options.height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("browser-scene-export-output-mask-canvas-unavailable");
  }

  context.drawImage(image, 0, 0, options.width, options.height);
  context.globalCompositeOperation = "destination-in";
  context.drawImage(options.maskCanvas, 0, 0, options.width, options.height);
  context.globalCompositeOperation = "source-over";

  return canvas.toDataURL("image/png");
}
