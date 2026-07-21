import type {
  SceneExportCrop,
  SceneExportFormat,
  SceneExportOptions,
  SceneExportResult,
  SceneExportService,
  CanvasService,
  SceneLayoutService,
  Service,
  ServiceContext,
} from "@pooder/core";
import { Canvas as FabricCanvas, type FabricObject, Point } from "fabric";
import {
  CANVAS_SERVICE,
  FABRIC_RENDER_GRAPH_ADAPTER,
  SCENE_EXPORT_SERVICE,
  SCENE_LAYOUT_SERVICE,
} from "./tokens";
import type { FabricRenderGraphAdapter } from "./scene/fabric-render-graph-adapter";
import { applyAlphaMask, renderOutputMask } from "./output-mask";

export type BrowserSceneExportFormat = SceneExportFormat;
export type BrowserSceneExportFrame = "cut" | "trim" | "bleed";

export interface BrowserSceneExportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type BrowserSceneExportCrop = SceneExportCrop;
export type BrowserSceneExportOptions = SceneExportOptions;
export type BrowserSceneExportResult = SceneExportResult;

interface ExportCanvasLike {
  add(object: FabricObject): void;
  dispose(): void;
  renderAll(): void;
  setDimensions(size: { width: number; height: number }): void;
  toDataURL(options: {
    format: BrowserSceneExportFormat;
    multiplier: number;
  }): string;
}

function normalizeFormat(format: unknown): BrowserSceneExportFormat {
  return format === "jpeg" ? "jpeg" : "png";
}

function normalizeOutputMaskMode(mode: unknown): "alpha" | "outline" | "shape" {
  if (mode === "alpha" || mode === "outline" || mode === "shape") {
    return mode;
  }
  throw new Error("browser-scene-export-output-mask-mode-unsupported");
}

function isInvalidOutputMaskError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "browser-scene-export-output-mask-invalid"
  );
}

function normalizeMultiplier(multiplier: unknown): number {
  const numeric = Number(multiplier);
  return Number.isFinite(numeric) ? Math.max(1, numeric) : 2;
}

function normalizeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const ids = values
    .map((value) => String(value || "").trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(ids));
}

function isPositiveRect(rect: BrowserSceneExportRect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function readLayerId(object: any): string {
  return String(object?.data?.layerId || object?.data?.passId || "").trim();
}

function readElementId(object: any): string {
  return readExportKeys(object)[0] || "";
}

function readExportKeys(object: any): string[] {
  const keys = object?.data?.exportKeys;
  if (!Array.isArray(keys)) return [];
  return normalizeIds(keys);
}

function readExportTags(object: any): string[] {
  return normalizeIds(object?.data?.tags);
}

function readOutputMaskKeys(object: any): string[] {
  return normalizeIds([
    object?.data?.outputMaskKey,
    ...(Array.isArray(object?.data?.outputMaskKeys)
      ? object.data.outputMaskKeys
      : []),
  ]);
}

function cloneRect(rect: BrowserSceneExportRect): BrowserSceneExportRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function normalizeSourceSelector(source: BrowserSceneExportOptions["source"]) {
  return {
    layerIds: normalizeIds(source?.layerIds),
    elementIds: normalizeIds(source?.elementIds),
    tags: normalizeIds(source?.tags),
    visible: typeof source?.visible === "boolean" ? source.visible : undefined,
  };
}

export class BrowserSceneExportService implements Service, SceneExportService {
  static readonly token = SCENE_EXPORT_SERVICE;

  private canvasService?: CanvasService;
  private sceneLayoutService?: SceneLayoutService;
  private renderGraphAdapter?: FabricRenderGraphAdapter;

  init(context: ServiceContext) {
    this.canvasService = context.get(CANVAS_SERVICE);
    this.sceneLayoutService = context.get(SCENE_LAYOUT_SERVICE);
    this.renderGraphAdapter = context.get(FABRIC_RENDER_GRAPH_ADAPTER);

    if (!this.canvasService || !this.sceneLayoutService) {
      throw new Error(
        "[BrowserSceneExportService] CanvasService and SceneLayoutService are required.",
      );
    }
  }

  dispose() {
    this.canvasService = undefined;
    this.sceneLayoutService = undefined;
    this.renderGraphAdapter = undefined;
  }

  async exportImage(
    options: BrowserSceneExportOptions = {},
  ): Promise<BrowserSceneExportResult> {
    const canvasService = this.requireCanvasService();
    await this.renderGraphAdapter?.flush();

    const outputMask = options.outputMask;
    const format = outputMask ? "png" : normalizeFormat(options.format);
    const multiplier = normalizeMultiplier(options.multiplier);
    const source = normalizeSourceSelector(options.source);
    const sourceObjects = this.getSourceObjects({
      source,
    });

    if (!sourceObjects.length) {
      throw new Error("browser-scene-export-empty");
    }

    const crop = this.resolveCrop(options.crop, sourceObjects);
    if (!isPositiveRect(crop)) {
      throw new Error("browser-scene-export-crop-unavailable");
    }

    const width = Math.max(1, Math.round(crop.width * multiplier));
    const height = Math.max(1, Math.round(crop.height * multiplier));
    const sceneScale = canvasService.getSceneScale();
    const scaleBase = sceneScale > 0 ? sceneScale : 1;
    const exportCanvas = this.createExportCanvas(width, height);
    const exportedLayerIds = new Set<string>();
    const exportedElementIds = new Set<string>();
    const exportedTags = new Set<string>();

    try {
      for (const source of sourceObjects as any[]) {
        const clone = await source.clone();
        const center = source.getCenterPoint
          ? source.getCenterPoint()
          : new Point(source.left ?? 0, source.top ?? 0);
        const sceneCenter = canvasService.toScenePoint({
          space: "screen",
          x: center.x,
          y: center.y,
        });

        clone.set({
          ...(options.preserveClipPaths === false
            ? { clipPath: undefined }
            : {}),
          originX: "center",
          originY: "center",
          left: (sceneCenter.x - crop.left) * multiplier,
          top: (sceneCenter.y - crop.top) * multiplier,
          scaleX: ((source.scaleX || 1) / scaleBase) * multiplier,
          scaleY: ((source.scaleY || 1) / scaleBase) * multiplier,
          angle: source.angle || 0,
          selectable: false,
          evented: false,
          visible: true,
        });
        delete clone.__pooderEffectClipKey;
        clone.setCoords();
        exportCanvas.add(clone);

        const layerId = readLayerId(source);
        const elementId = readElementId(source);
        if (layerId) exportedLayerIds.add(layerId);
        if (elementId) exportedElementIds.add(elementId);
        readExportTags(source).forEach((tag) => exportedTags.add(tag));
      }

      exportCanvas.renderAll();
      const exportedUrl = exportCanvas.toDataURL({ format, multiplier: 1 });
      let url = exportedUrl;
      if (outputMask) {
        try {
          url = await this.applyOutputMask(exportedUrl, {
            crop,
            height,
            multiplier,
            outputMask,
            sceneScale: scaleBase,
            width,
          });
        } catch (error) {
          if (!isInvalidOutputMaskError(error)) {
            throw error;
          }
          console.warn(
            "[BrowserSceneExportService] Output mask is invalid; using the unmasked export.",
            error,
          );
        }
      }
      if (!url) {
        throw new Error("browser-scene-export-failed");
      }

      return {
        url,
        width,
        height,
        format,
        multiplier,
        source: {
          layerIds: Array.from(exportedLayerIds),
          elementIds: Array.from(exportedElementIds),
          tags: Array.from(exportedTags),
        },
        crop: { ...cloneRect(crop), space: "scene" },
      };
    } finally {
      exportCanvas.dispose();
    }
  }

  private getSourceObjects(options: {
    source: {
      layerIds: string[];
      elementIds: string[];
      tags: string[];
      visible?: boolean;
    };
  }): FabricObject[] {
    const layerIdSet = new Set(options.source.layerIds);
    const elementIdSet = new Set(options.source.elementIds);
    const tagSet = new Set(options.source.tags);
    const hasLayerFilter = layerIdSet.size > 0;
    const hasElementFilter = elementIdSet.size > 0;
    const hasTagFilter = tagSet.size > 0;

    return this.getCanvasObjects({
      visible: options.source.visible,
    }).filter((object: any) => {
      if (object?.excludeFromExport === true) return false;
      if (hasLayerFilter && !layerIdSet.has(readLayerId(object))) {
        return false;
      }
      if (
        hasElementFilter &&
        !readExportKeys(object).some((id) => elementIdSet.has(id))
      ) {
        return false;
      }
      if (
        hasTagFilter &&
        !readExportTags(object).some((tag) => tagSet.has(tag))
      ) {
        return false;
      }
      return true;
    });
  }

  private async applyOutputMask(
    sourceUrl: string,
    options: {
      crop: BrowserSceneExportRect;
      height: number;
      multiplier: number;
      outputMask: NonNullable<BrowserSceneExportOptions["outputMask"]>;
      sceneScale: number;
      width: number;
    },
  ): Promise<string> {
    const sourceKey = String(options.outputMask.sourceKey || "").trim();
    if (!sourceKey) {
      throw new Error("browser-scene-export-output-mask-source-key-required");
    }

    const source = this.resolveOutputMaskSource(sourceKey);
    const mode = normalizeOutputMaskMode(options.outputMask.mode || "alpha");
    const maskCanvas = await renderOutputMask({
      canvasService: this.requireCanvasService(),
      crop: { ...options.crop, space: "scene" },
      height: options.height,
      mode,
      multiplier: options.multiplier,
      sceneScale: options.sceneScale,
      source,
      transparentColor: options.outputMask.transparentColor,
      width: options.width,
    });

    return applyAlphaMask({
      height: options.height,
      maskCanvas,
      sourceUrl,
      width: options.width,
    });
  }

  private resolveOutputMaskSource(sourceKey: string): FabricObject {
    const source = this.getCanvasObjects({}).find((object: any) =>
      readOutputMaskKeys(object).includes(sourceKey),
    );

    if (!source) {
      throw new Error("browser-scene-export-output-mask-source-missing");
    }

    return source;
  }

  private getCanvasObjects(selector: { visible?: boolean }): FabricObject[] {
    const canvasService = this.requireCanvasService() as any;
    if (typeof canvasService.selectObjects === "function") {
      return canvasService.selectObjects({
        visible: selector.visible,
      }) as FabricObject[];
    }
    return (canvasService.canvas?.getObjects?.() || []).filter(
      (object: any) => {
        return (
          selector.visible === undefined || object?.visible === selector.visible
        );
      },
    ) as FabricObject[];
  }

  private resolveCrop(
    crop: BrowserSceneExportCrop | undefined,
    sourceObjects: FabricObject[],
  ): BrowserSceneExportRect {
    if (crop?.type === "sceneRect") {
      return cloneRect(crop.rect);
    }

    if (crop?.type === "frame") {
      return this.resolveFrameCrop(crop.frame);
    }

    return this.resolveElementBoundsCrop(sourceObjects, crop);
  }

  private resolveFrameCrop(
    frame: BrowserSceneExportFrame,
  ): BrowserSceneExportRect {
    const layout = this.requireSceneLayoutService().recomputeLayout();
    if (!layout) {
      throw new Error("browser-scene-export-frame-unavailable");
    }

    const rect =
      frame === "trim"
        ? layout.trimRect
        : frame === "bleed"
          ? layout.bleedRect
          : layout.cutRect;

    return this.requireCanvasService().toSceneRect({
      space: "screen",
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }

  private resolveElementBoundsCrop(
    sourceObjects: FabricObject[],
    crop: BrowserSceneExportCrop | undefined,
  ): BrowserSceneExportRect {
    const elementIds =
      crop?.type === "elementBounds" ? normalizeIds(crop.elementIds) : [];
    const elementIdSet = new Set(elementIds);
    const objects = elementIdSet.size
      ? sourceObjects.filter((object) =>
          readExportKeys(object).some((id) => elementIdSet.has(id)),
        )
      : sourceObjects;
    const bounds = objects
      .map((object: any) =>
        typeof object.getBoundingRect === "function"
          ? object.getBoundingRect()
          : undefined,
      )
      .filter((rect): rect is BrowserSceneExportRect => {
        return Boolean(rect && isPositiveRect(rect));
      });

    if (!bounds.length) {
      throw new Error("browser-scene-export-bounds-unavailable");
    }

    const left = Math.min(...bounds.map((rect) => rect.left));
    const top = Math.min(...bounds.map((rect) => rect.top));
    const right = Math.max(...bounds.map((rect) => rect.left + rect.width));
    const bottom = Math.max(...bounds.map((rect) => rect.top + rect.height));

    return this.requireCanvasService().toSceneRect({
      space: "screen",
      left,
      top,
      width: right - left,
      height: bottom - top,
    });
  }

  private createExportCanvas(width: number, height: number): ExportCanvasLike {
    if (typeof document === "undefined") {
      throw new Error("browser-scene-export-browser-required");
    }

    const el = document.createElement("canvas");
    const exportCanvas = new FabricCanvas(el, {
      renderOnAddRemove: false,
      selection: false,
      enableRetinaScaling: false,
      preserveObjectStacking: true,
    } as any);
    exportCanvas.setDimensions({ width, height });
    return exportCanvas;
  }

  private requireCanvasService(): CanvasService {
    if (!this.canvasService) {
      throw new Error(
        "[BrowserSceneExportService] CanvasService is not initialized.",
      );
    }
    return this.canvasService;
  }

  private requireSceneLayoutService(): SceneLayoutService {
    if (!this.sceneLayoutService) {
      throw new Error(
        "[BrowserSceneExportService] SceneLayoutService is not initialized.",
      );
    }
    return this.sceneLayoutService;
  }
}
