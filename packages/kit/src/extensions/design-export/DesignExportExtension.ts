import {
  CONFIGURATION_SERVICE,
  ConfigurationService,
  ExtensionContext,
  ExtensionContributions,
  ExtensionDefinition,
} from "@pooder/core";
import { Canvas as FabricCanvas, Point } from "fabric";
import {
  CANVAS_SERVICE,
  CanvasService,
} from "@pooder/platform-browser";
import {
  IMAGE_OBJECT_LAYER_ID,
  WHITE_INK_OBJECT_LAYER_ID,
} from "../../shared/constants/layers";
import { resolveSurfaceFrameRect } from "../../shared/scene/frame";
import { createDesignExportCommands } from "./commands";

export type ExportImageFormat = "png" | "jpeg";

export interface ExportImageOptions {
  format?: ExportImageFormat;
  multiplier?: number;
  layerIds?: readonly string[];
}

export interface ExportImageResult {
  url: string;
  width: number;
  height: number;
  format: ExportImageFormat;
  multiplier: number;
  layerIds: string[];
}

const DEFAULT_EXPORT_LAYER_IDS = [
  IMAGE_OBJECT_LAYER_ID,
  WHITE_INK_OBJECT_LAYER_ID,
] as const;

function normalizeFormat(format: unknown): ExportImageFormat {
  return format === "jpeg" ? "jpeg" : "png";
}

function normalizeMultiplier(multiplier: unknown): number {
  const numeric = Number(multiplier);
  return Number.isFinite(numeric) ? Math.max(1, numeric) : 2;
}

function normalizeLayerIds(layerIds: unknown): string[] {
  const values = Array.isArray(layerIds) ? layerIds : DEFAULT_EXPORT_LAYER_IDS;
  const normalized = values
    .map((layerId) => String(layerId || "").trim())
    .filter((layerId) => layerId.length > 0);
  return Array.from(new Set(normalized));
}

function isPositiveRect(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export class DesignExportExtension implements ExtensionDefinition {
  id = "pooder.kit.design-export";
  public metadata = {
    name: "DesignExportExtension",
  };
  activation = {
    requiresServices: [CANVAS_SERVICE, CONFIGURATION_SERVICE],
  };

  private canvasService?: CanvasService;
  private configService?: ConfigurationService;

  activate(context: ExtensionContext) {
    this.canvasService = context.services.getOrThrow<CanvasService>(
      CANVAS_SERVICE,
    );
    this.configService = context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
  }

  contribute(): ExtensionContributions {
    return {
      commands: createDesignExportCommands(this),
    };
  }

  async exportImage(
    options: ExportImageOptions = {},
  ): Promise<ExportImageResult> {
    if (!this.canvasService || !this.configService) {
      throw new Error("design-export-not-initialized");
    }

    const canvasService = this.canvasService;
    const configService = this.configService;

    await canvasService.flushRenderFromProducers();

    const frame = resolveSurfaceFrameRect(canvasService, configService);
    if (!isPositiveRect(frame)) {
      throw new Error("design-export-frame-unavailable");
    }

    const layerIds = normalizeLayerIds(options.layerIds);
    const layerIdSet = new Set(layerIds);
    const sourceObjects = canvasService.canvas
      .getObjects()
      .filter((obj: any) => layerIdSet.has(String(obj?.data?.layerId || "")));

    if (!sourceObjects.length) {
      throw new Error("no-design-objects-to-export");
    }
    if (typeof document === "undefined") {
      throw new Error("design-export-browser-required");
    }

    const multiplier = normalizeMultiplier(options.multiplier);
    const format = normalizeFormat(options.format);
    const width = Math.max(1, Math.round(frame.width * multiplier));
    const height = Math.max(1, Math.round(frame.height * multiplier));
    const sceneScale = canvasService.getSceneScale();
    const scaleBase = sceneScale > 0 ? sceneScale : 1;
    const exportedLayerIds = new Set<string>();

    const el = document.createElement("canvas");
    const exportCanvas = new FabricCanvas(el, {
      renderOnAddRemove: false,
      selection: false,
      enableRetinaScaling: false,
      preserveObjectStacking: true,
    } as any);
    exportCanvas.setDimensions({ width, height });

    try {
      for (const source of sourceObjects as any[]) {
        const layerId = String(source?.data?.layerId || "");
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
          left: (sceneCenter.x - frame.left) * multiplier,
          top: (sceneCenter.y - frame.top) * multiplier,
          scaleX: ((source.scaleX || 1) / scaleBase) * multiplier,
          scaleY: ((source.scaleY || 1) / scaleBase) * multiplier,
          angle: source.angle || 0,
          selectable: false,
          evented: false,
          visible: true,
        });
        delete (clone as any).__pooderEffectClipKey;
        clone.setCoords();
        exportCanvas.add(clone);
        exportedLayerIds.add(layerId);
      }

      exportCanvas.renderAll();
      const url = exportCanvas.toDataURL({ format, multiplier: 1 });
      if (!url) {
        throw new Error("design-export-failed");
      }

      return {
        url,
        width,
        height,
        format,
        multiplier,
        layerIds: Array.from(exportedLayerIds),
      };
    } finally {
      exportCanvas.dispose();
    }
  }
}
