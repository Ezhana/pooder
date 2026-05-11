import type { CapabilityDefinition } from "@pooder/core";
import type {
  CanvasRect,
  SceneExportCrop,
  SceneExportOptions,
} from "@pooder/core";

export const DESIGN_EXPORT_CAPABILITY_ID = "pooder.kit.design-export";

export type ExportImageFormat = "png" | "jpeg";

export interface DesignExportLayerOptions {
  sourceLayerIds?: readonly string[];
}

export interface DesignExportCapabilityOptions {
  capabilityId?: string;
  layers?: DesignExportLayerOptions;
}

export interface ExportImageOptions
  extends Omit<SceneExportOptions, "crop" | "sourceLayerIds"> {
  format?: ExportImageFormat;
  multiplier?: number;
  layerIds?: readonly string[];
  sourceLayerIds?: readonly string[];
  crop?: SceneExportCrop;
}

export interface ExportImageResult {
  url: string;
  width: number;
  height: number;
  format: ExportImageFormat;
  multiplier: number;
  layerIds: string[];
  sourceElementIds: string[];
  crop: CanvasRect;
}

export interface DesignExportCapabilityApi {
  exportImage(options?: ExportImageOptions): Promise<ExportImageResult>;
}

export function normalizeDesignExportLayerIds(
  layerIds: unknown,
  fallbackLayerIds: readonly string[],
): string[] {
  const values = Array.isArray(layerIds) ? layerIds : fallbackLayerIds;
  const normalized = values
    .map((layerId) => String(layerId || "").trim())
    .filter((layerId) => layerId.length > 0);
  return Array.from(new Set(normalized));
}

export function createDesignExportCapabilityDefinition(
  facade: DesignExportCapabilityApi,
  options: DesignExportCapabilityOptions = {},
): CapabilityDefinition<DesignExportCapabilityApi> {
  return {
    id: options.capabilityId || DESIGN_EXPORT_CAPABILITY_ID,
    metadata: {
      name: "Design Export",
      description:
        "Export selected design layers, elements, and scene crops without " +
        "requiring a kit-owned workflow tool.",
      tags: ["kit", "export", "image"],
    },
    commands: [{ id: "exportImage", title: "Export Image" }],
    facade,
  };
}
