import type { Service, ServiceContext } from "@pooder/core";
import { Canvas as FabricCanvas, type FabricObject, Point } from "fabric";
import CanvasService from "./canvas-service";
import { SceneLayoutService } from "./scene-layout-service";
import { CANVAS_SERVICE, SCENE_LAYOUT_SERVICE } from "./tokens";

export type BrowserSceneExportFormat = "png" | "jpeg";
export type BrowserSceneExportFrame = "cut" | "trim" | "bleed";

export interface BrowserSceneExportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type BrowserSceneExportCrop =
  | { type: "sceneRect"; rect: BrowserSceneExportRect }
  | { type: "elementBounds"; elementIds?: readonly string[] }
  | { type: "frame"; frame: BrowserSceneExportFrame };

export interface BrowserSceneExportOptions {
  format?: BrowserSceneExportFormat;
  multiplier?: number;
  sourceLayerIds?: readonly string[];
  sourceElementIds?: readonly string[];
  crop?: BrowserSceneExportCrop;
  includeHidden?: boolean;
}

export interface BrowserSceneExportResult {
  url: string;
  width: number;
  height: number;
  format: BrowserSceneExportFormat;
  multiplier: number;
  sourceLayerIds: string[];
  sourceElementIds: string[];
  crop: BrowserSceneExportRect;
}

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
  return String(object?.data?.sceneElementId || object?.data?.id || "").trim();
}

function cloneRect(rect: BrowserSceneExportRect): BrowserSceneExportRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export class BrowserSceneExportService implements Service {
  private canvasService?: CanvasService;
  private sceneLayoutService?: SceneLayoutService;

  init(context: ServiceContext) {
    this.canvasService = context.get(CANVAS_SERVICE);
    this.sceneLayoutService = context.get(SCENE_LAYOUT_SERVICE);

    if (!this.canvasService || !this.sceneLayoutService) {
      throw new Error(
        "[BrowserSceneExportService] CanvasService and SceneLayoutService are required.",
      );
    }
  }

  dispose() {
    this.canvasService = undefined;
    this.sceneLayoutService = undefined;
  }

  async exportImage(
    options: BrowserSceneExportOptions = {},
  ): Promise<BrowserSceneExportResult> {
    const canvasService = this.requireCanvasService();
    await canvasService.flushRenderFromProducers();

    const format = normalizeFormat(options.format);
    const multiplier = normalizeMultiplier(options.multiplier);
    const sourceLayerIds = normalizeIds(options.sourceLayerIds);
    const sourceElementIds = normalizeIds(options.sourceElementIds);
    const sourceObjects = this.getSourceObjects({
      includeHidden: options.includeHidden,
      sourceElementIds,
      sourceLayerIds,
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

    try {
      for (const source of sourceObjects as any[]) {
        const clone = await source.clone();
        const center = source.getCenterPoint
          ? source.getCenterPoint()
          : new Point(source.left ?? 0, source.top ?? 0);
        const sceneCenter = canvasService.toScenePoint({
          x: center.x,
          y: center.y,
        });

        clone.set({
          clipPath: undefined,
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
      }

      exportCanvas.renderAll();
      const url = exportCanvas.toDataURL({ format, multiplier: 1 });
      if (!url) {
        throw new Error("browser-scene-export-failed");
      }

      return {
        url,
        width,
        height,
        format,
        multiplier,
        sourceLayerIds: Array.from(exportedLayerIds),
        sourceElementIds: Array.from(exportedElementIds),
        crop: cloneRect(crop),
      };
    } finally {
      exportCanvas.dispose();
    }
  }

  private getSourceObjects(options: {
    includeHidden?: boolean;
    sourceLayerIds: string[];
    sourceElementIds: string[];
  }): FabricObject[] {
    const canvas = this.requireCanvasService().canvas;
    const layerIdSet = new Set(options.sourceLayerIds);
    const elementIdSet = new Set(options.sourceElementIds);
    const hasLayerFilter = layerIdSet.size > 0;
    const hasElementFilter = elementIdSet.size > 0;

    return (canvas.getObjects() as FabricObject[]).filter((object: any) => {
      if (object?.excludeFromExport === true) return false;
      if (!options.includeHidden && object?.visible === false) return false;
      if (hasLayerFilter && !layerIdSet.has(readLayerId(object))) {
        return false;
      }
      if (hasElementFilter && !elementIdSet.has(readElementId(object))) {
        return false;
      }
      return true;
    });
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
    const layout = this.requireSceneLayoutService().getLayout(true);
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
          elementIdSet.has(readElementId(object)),
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
