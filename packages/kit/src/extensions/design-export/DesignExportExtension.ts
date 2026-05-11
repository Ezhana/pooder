import {
  ExtensionContext,
  ExtensionContributions,
  ExtensionDefinition,
} from "@pooder/core";
import {
  BROWSER_SCENE_EXPORT_SERVICE,
  BrowserSceneExportService,
  type BrowserSceneExportCrop,
  type BrowserSceneExportOptions,
} from "@pooder/platform-browser";
import {
  IMAGE_OBJECT_LAYER_ID,
  WHITE_INK_OBJECT_LAYER_ID,
} from "../../shared/constants/layers";
import { createDesignExportCommands } from "./commands";

export type ExportImageFormat = "png" | "jpeg";

export interface ExportImageOptions
  extends Omit<BrowserSceneExportOptions, "crop" | "sourceLayerIds"> {
  format?: ExportImageFormat;
  multiplier?: number;
  layerIds?: readonly string[];
  sourceLayerIds?: readonly string[];
  crop?: BrowserSceneExportCrop;
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

function normalizeLayerIds(layerIds: unknown): string[] {
  const values = Array.isArray(layerIds) ? layerIds : DEFAULT_EXPORT_LAYER_IDS;
  const normalized = values
    .map((layerId) => String(layerId || "").trim())
    .filter((layerId) => layerId.length > 0);
  return Array.from(new Set(normalized));
}

export class DesignExportExtension implements ExtensionDefinition {
  id = "pooder.kit.design-export";
  public metadata = {
    name: "DesignExportExtension",
  };
  activation = {
    requiresServices: [BROWSER_SCENE_EXPORT_SERVICE],
  };

  private exportService?: BrowserSceneExportService;

  activate(context: ExtensionContext) {
    this.exportService = context.services.getOrThrow<BrowserSceneExportService>(
      BROWSER_SCENE_EXPORT_SERVICE,
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
    if (!this.exportService) {
      throw new Error("design-export-not-initialized");
    }

    const layerIds = normalizeLayerIds(
      options.sourceLayerIds ?? options.layerIds,
    );
    try {
      const result = await this.exportService.exportImage({
        ...options,
        crop: options.crop ?? { type: "frame", frame: "cut" },
        includeHidden: options.includeHidden ?? true,
        sourceLayerIds: layerIds,
      });

      return {
        url: result.url,
        width: result.width,
        height: result.height,
        format: result.format,
        multiplier: result.multiplier,
        layerIds: result.sourceLayerIds,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "browser-scene-export-empty") {
          throw new Error("no-design-objects-to-export");
        }
        if (error.message === "browser-scene-export-browser-required") {
          throw new Error("design-export-browser-required");
        }
        if (
          error.message === "browser-scene-export-frame-unavailable" ||
          error.message === "browser-scene-export-crop-unavailable"
        ) {
          throw new Error("design-export-frame-unavailable");
        }
        if (error.message === "browser-scene-export-failed") {
          throw new Error("design-export-failed");
        }
      }
      throw error;
    }
  }
}
