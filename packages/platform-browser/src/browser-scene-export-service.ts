import {
  GEOMETRY_SOURCE_SERVICE,
  RENDER_INTENT_SERVICE,
  coordinateMatrix,
  type CanvasService,
  type GeometrySourceService,
  type Matrix2D,
  type RenderGraphLayer,
  type RenderGraphNode,
  type RenderIntentService,
  type RenderObjectSpec,
  type SceneExportCrop,
  type SceneExportFormat,
  type SceneExportOptions,
  type SceneExportResult,
  type SceneExportOutputMaskTransparentColor,
  type SceneExportService,
  type Service,
  type ServiceContext,
} from "@pooder/core";
import { Canvas as FabricCanvas, type FabricObject } from "fabric";
import {
  CANVAS_SERVICE,
  FABRIC_RENDER_GRAPH_ADAPTER,
  SCENE_EXPORT_SERVICE,
} from "./tokens";
import type { FabricRenderGraphAdapter } from "./scene/fabric-render-graph-adapter";
import { applyAlphaMask, renderOutputMask } from "./output-mask";

export type BrowserSceneExportFormat = SceneExportFormat;
export interface BrowserSceneExportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export type BrowserSceneExportCrop = SceneExportCrop;
export type BrowserSceneExportOptions = SceneExportOptions;
export type BrowserSceneExportResult = SceneExportResult;

type DetachedObjectFactory = CanvasService & {
  createDetachedRenderObject(
    spec: RenderObjectSpec,
    sceneToTarget: Matrix2D<"scene", "screen">,
  ): Promise<FabricObject | undefined>;
};

interface ExportEntry {
  layer: RenderGraphLayer;
  node: RenderGraphNode;
  spec: RenderObjectSpec;
}

function normalizeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function normalizeMultiplier(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, number) : 2;
}

function isInvalidOutputMaskError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "browser-scene-export-output-mask-invalid"
  );
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

export class BrowserSceneExportService implements Service, SceneExportService {
  static readonly token = SCENE_EXPORT_SERVICE;

  private canvasService?: DetachedObjectFactory;
  private geometrySource?: GeometrySourceService;
  private renderIntentService?: RenderIntentService;
  private renderGraphAdapter?: FabricRenderGraphAdapter;
  private serviceContext?: ServiceContext;

  init(context: ServiceContext): void {
    this.serviceContext = context;
    this.canvasService = context.get(CANVAS_SERVICE) as
      | DetachedObjectFactory
      | undefined;
    this.geometrySource = context.get(GEOMETRY_SOURCE_SERVICE);
    this.renderIntentService = context.get(RENDER_INTENT_SERVICE);
    this.renderGraphAdapter = context.get(FABRIC_RENDER_GRAPH_ADAPTER);
    if (
      !this.canvasService ||
      !this.geometrySource ||
      !this.renderIntentService
    ) {
      throw new Error(
        "[BrowserSceneExportService] Canvas, RenderIntent, and GeometrySource services are required.",
      );
    }
  }

  dispose(): void {
    this.canvasService = undefined;
    this.geometrySource = undefined;
    this.renderIntentService = undefined;
    this.renderGraphAdapter = undefined;
    this.serviceContext = undefined;
  }

  async exportImage(
    options: BrowserSceneExportOptions,
  ): Promise<BrowserSceneExportResult> {
    const sceneId = String(options?.sceneId || "").trim();
    if (!sceneId) throw new Error("browser-scene-export-scene-required");
    if (!options?.crop) throw new Error("browser-scene-export-crop-required");
    const entries = this.selectEntries(options);
    if (!entries.length) throw new Error("browser-scene-export-empty");

    const crop = this.resolveCrop(options.crop, entries);
    if (!isPositiveRect(crop)) {
      throw new Error("browser-scene-export-crop-unavailable");
    }
    const multiplier = normalizeMultiplier(options.multiplier);
    const width = Math.max(1, Math.round(crop.width * multiplier));
    const height = Math.max(1, Math.round(crop.height * multiplier));
    const format = options.outputMask
      ? "png"
      : options.format === "jpeg"
        ? "jpeg"
        : "png";
    const sceneToTarget = coordinateMatrix("scene", "screen", [
      multiplier,
      0,
      0,
      multiplier,
      -crop.left * multiplier,
      -crop.top * multiplier,
    ]);
    const exportCanvas = this.createExportCanvas(width, height);

    try {
      for (const entry of entries) {
        const object =
          await this.requireCanvasService().createDetachedRenderObject(
            {
              ...entry.spec,
              effects:
                options.preserveClipPaths === false ? [] : entry.spec.effects,
            },
            sceneToTarget,
          );
        if (object) exportCanvas.add(object);
      }
      exportCanvas.renderAll();
      const exportedUrl = exportCanvas.toDataURL({ format, multiplier: 1 });
      const url = options.outputMask
        ? await this.applyOutputMaskWithFallback(
            exportedUrl,
            options.outputMask.sourceKey,
            {
              crop,
              height,
              multiplier,
              mode: options.outputMask.mode ?? "alpha",
              sceneToTarget,
              sceneId,
              transparentColor: options.outputMask.transparentColor,
              width,
            },
          )
        : exportedUrl;
      return {
        url,
        width,
        height,
        format,
        multiplier,
        source: {
          layerIds: Array.from(new Set(entries.map(({ layer }) => layer.id))),
          elementIds: Array.from(
            new Set(entries.flatMap(({ node }) => node.exportKeys)),
          ),
          tags: Array.from(new Set(entries.flatMap(({ node }) => node.tags))),
        },
        crop: { ...crop, space: "scene" },
        sceneId,
      };
    } finally {
      exportCanvas.dispose();
    }
  }

  private selectEntries(options: BrowserSceneExportOptions): ExportEntry[] {
    const selector = options.source;
    const layerIds = new Set(normalizeIds(selector?.layerIds));
    const elementIds = new Set(normalizeIds(selector?.elementIds));
    const tags = new Set(normalizeIds(selector?.tags));
    const includeHidden = options.includeHidden === true;
    const sceneId = String(options.sceneId || "").trim();
    const entries: ExportEntry[] = [];
    const renderIntents = this.requireRenderIntentService();
    const graph =
      renderIntents.getDocumentGraph?.() ?? renderIntents.getGraph();
    for (const layer of graph.layers) {
      if (sceneId && layer.sceneId !== sceneId) continue;
      if (layerIds.size && !layerIds.has(layer.id)) continue;
      for (const node of layer.nodes) {
        const authoritativeVisible = layer.visible && node.visible;
        if (
          !includeHidden &&
          selector?.visible === undefined &&
          !authoritativeVisible
        )
          continue;
        if (
          selector?.visible !== undefined &&
          authoritativeVisible !== selector.visible
        )
          continue;
        if (
          elementIds.size &&
          !node.exportKeys.some((key) => elementIds.has(key))
        )
          continue;
        if (tags.size && !node.tags.some((tag) => tags.has(tag))) continue;
        if (node.props.excludeFromExport === true) continue;
        const spec =
          this.requireRenderGraphAdapter().createExportRenderObjectSpec(
            layer,
            node,
          );
        if (spec) entries.push({ layer, node, spec });
      }
    }
    return entries;
  }

  private resolveCrop(
    crop: BrowserSceneExportCrop,
    entries: ExportEntry[],
  ): BrowserSceneExportRect {
    if (crop.type === "sceneRect") return { ...crop.rect };
    const ids = new Set(normalizeIds(crop.elementIds));
    const bounds = entries
      .filter(
        ({ node }) => !ids.size || node.exportKeys.some((key) => ids.has(key)),
      )
      .map(
        ({ node }) =>
          this.requireGeometrySource().getBounds(
            node.exportGeometryRef,
            "scene",
          ).value,
      )
      .filter((value): value is BrowserSceneExportRect => Boolean(value));
    if (!bounds.length) {
      throw new Error("browser-scene-export-bounds-unavailable");
    }
    const left = Math.min(...bounds.map((rect) => rect.left));
    const top = Math.min(...bounds.map((rect) => rect.top));
    const right = Math.max(...bounds.map((rect) => rect.left + rect.width));
    const bottom = Math.max(...bounds.map((rect) => rect.top + rect.height));
    return { left, top, width: right - left, height: bottom - top };
  }

  private async applyOutputMaskWithFallback(
    sourceUrl: string,
    sourceKey: string,
    options: {
      crop: BrowserSceneExportRect;
      height: number;
      multiplier: number;
      mode: "alpha" | "outline" | "shape";
      sceneToTarget: Matrix2D<"scene", "screen">;
      sceneId: string;
      transparentColor?: SceneExportOutputMaskTransparentColor;
      width: number;
    },
  ): Promise<string> {
    try {
      return await this.applyOutputMask(sourceUrl, sourceKey, options);
    } catch (error) {
      if (!isInvalidOutputMaskError(error)) throw error;
      console.warn(
        "[BrowserSceneExportService] Output mask is invalid; using the unmasked export.",
        error,
      );
      return sourceUrl;
    }
  }

  private async applyOutputMask(
    sourceUrl: string,
    sourceKey: string,
    options: {
      crop: BrowserSceneExportRect;
      height: number;
      multiplier: number;
      mode: "alpha" | "outline" | "shape";
      sceneToTarget: Matrix2D<"scene", "screen">;
      sceneId: string;
      transparentColor?: SceneExportOutputMaskTransparentColor;
      width: number;
    },
  ): Promise<string> {
    const key = String(sourceKey || "").trim();
    if (!key)
      throw new Error("browser-scene-export-output-mask-source-key-required");
    const entry = this.selectEntries({
      includeHidden: true,
      sceneId: options.sceneId,
      crop: { type: "elementBounds" },
    }).find(({ node }) => normalizeIds(node.data.outputMaskKeys).includes(key));
    if (!entry)
      throw new Error("browser-scene-export-output-mask-source-missing");
    const source = await this.requireCanvasService().createDetachedRenderObject(
      { ...entry.spec, effects: [] },
      options.sceneToTarget,
    );
    if (!source)
      throw new Error("browser-scene-export-output-mask-source-missing");
    const maskCanvas = await renderOutputMask({
      canvasService: this.requireCanvasService(),
      crop: { ...options.crop, space: "scene" },
      height: options.height,
      mode: options.mode,
      multiplier: options.multiplier,
      sceneScale: 1,
      source,
      sourceInTargetSpace: true,
      transparentColor: options.transparentColor,
      width: options.width,
    });
    return applyAlphaMask({
      height: options.height,
      maskCanvas,
      sourceUrl,
      width: options.width,
    });
  }

  private createExportCanvas(width: number, height: number) {
    if (typeof document === "undefined")
      throw new Error("browser-scene-export-browser-required");
    const canvas = new FabricCanvas(document.createElement("canvas"), {
      renderOnAddRemove: false,
      selection: false,
      enableRetinaScaling: false,
      preserveObjectStacking: true,
    } as any);
    canvas.setDimensions({ width, height });
    return canvas;
  }

  private requireCanvasService(): DetachedObjectFactory {
    if (!this.canvasService)
      throw new Error(
        "[BrowserSceneExportService] CanvasService is unavailable.",
      );
    return this.canvasService;
  }
  private requireGeometrySource(): GeometrySourceService {
    if (!this.geometrySource)
      throw new Error(
        "[BrowserSceneExportService] GeometrySourceService is unavailable.",
      );
    return this.geometrySource;
  }
  private requireRenderIntentService(): RenderIntentService {
    if (!this.renderIntentService)
      throw new Error(
        "[BrowserSceneExportService] RenderIntentService is unavailable.",
      );
    return this.renderIntentService;
  }
  private requireRenderGraphAdapter(): FabricRenderGraphAdapter {
    this.renderGraphAdapter ??= this.serviceContext?.get(
      FABRIC_RENDER_GRAPH_ADAPTER,
    );
    if (!this.renderGraphAdapter)
      throw new Error(
        "[BrowserSceneExportService] RenderGraphAdapter is unavailable.",
      );
    return this.renderGraphAdapter;
  }
}
