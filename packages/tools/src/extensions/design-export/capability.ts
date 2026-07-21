import type { CapabilityDefinition } from "@pooder/core";
import type {
  CoordinateRect,
  SceneExportCrop,
  SceneExportOptions,
  SceneExportSourceResult,
  SceneExportSourceSelector,
} from "@pooder/core";

export const DESIGN_EXPORT_CAPABILITY_ID = "pooder.kit.design-export";

export type ExportImageFormat = "png" | "jpeg";

export interface DesignExportCapabilityOptions {
  capabilityId?: string;
  source?: SceneExportSourceSelector;
}

export interface ExportImageOptions extends Omit<SceneExportOptions, "crop"> {
  format?: ExportImageFormat;
  multiplier?: number;
  crop?: SceneExportCrop;
}

export interface ExportImageResult {
  url: string;
  width: number;
  height: number;
  format: ExportImageFormat;
  multiplier: number;
  source: SceneExportSourceResult;
  crop: CoordinateRect<"scene">;
}

export interface DesignExportCapabilityApi {
  exportImage(options?: ExportImageOptions): Promise<ExportImageResult>;
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
