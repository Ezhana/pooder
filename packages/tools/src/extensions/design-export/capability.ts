import type { CapabilityDefinition } from "@pooder/core";
import type {
  CoordinateRect,
  RectMm,
  SceneExportOptions,
  SceneExportSourceResult,
  SceneExportSourceSelector,
} from "@pooder/core";

export const DESIGN_EXPORT_CAPABILITY_ID = "pooder.kit.design-export";

export type ExportImageFormat = "png" | "jpeg";

export type CutMode = "trim" | "outset" | "inset";

export interface DesignExportCapabilityOptions {
  capabilityId?: string;
  source?: SceneExportSourceSelector;
}

export interface ExportImageOptions extends Omit<
  SceneExportOptions,
  "sceneId" | "crop"
> {
  format?: ExportImageFormat;
  multiplier?: number;
  /**
   * Explicit millimetre crop for the current document scene only.
   * Defaults to each scene's content rect, then `size.cutMode`.
   */
  crop?: CoordinateRect<"scene">;
}

export interface ExportImageResult {
  url: string;
  width: number;
  height: number;
  format: ExportImageFormat;
  multiplier: number;
  source: SceneExportSourceResult;
  crop: CoordinateRect<"scene">;
  sceneId: string;
}

export interface DesignExportCapabilityApi {
  exportImage(options?: ExportImageOptions): Promise<ExportImageResult[]>;
}

export function normalizeCutMode(value: unknown): CutMode {
  return value === "outset" || value === "inset" ? value : "trim";
}

export function applyCutMarginToRect(
  rect: RectMm,
  cutMode: CutMode,
  cutMarginMm: number,
  minMm: number,
): RectMm {
  if (cutMode === "trim" || cutMarginMm <= 0) return { ...rect };
  if (cutMode === "outset") {
    return {
      x: rect.x - cutMarginMm,
      y: rect.y - cutMarginMm,
      width: rect.width + cutMarginMm * 2,
      height: rect.height + cutMarginMm * 2,
    };
  }
  const width = Math.max(minMm, rect.width - cutMarginMm * 2);
  const height = Math.max(minMm, rect.height - cutMarginMm * 2);
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  };
}

export function sceneCropFromRectMm(rect: RectMm): CoordinateRect<"scene"> {
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    space: "scene",
  };
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
