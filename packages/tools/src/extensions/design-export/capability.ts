import type { CapabilityDefinition } from "@pooder/core";
import type {
  CoordinateRect,
  RectMm,
  SceneExportCrop,
  SceneExportSourceResult,
  SceneExportSourceSelector,
} from "@pooder/core";

export const DESIGN_EXPORT_CAPABILITY_ID = "pooder.kit.design-export";

export type ExportImageFormat = "png" | "jpeg";

export type CutMode = "trim" | "outset" | "inset";

export type ExportPurpose = "design" | "mockup";

export type NamedExportCropFrame = "cut" | "trim" | "bleed";

export interface DesignExportCapabilityOptions {
  capabilityId?: string;
  source?: SceneExportSourceSelector;
}

export type ExportCropInput =
  | SceneExportCrop
  | CoordinateRect<"scene">
  | NamedExportCropFrame;

export interface ExportImageOptions {
  sceneId: string;
  format?: ExportImageFormat;
  multiplier?: number;
  source?: SceneExportSourceSelector;
  /**
   * Explicit crop for this scene. Defaults to the content rect after `size.cutMode`.
   */
  crop?: ExportCropInput;
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
  exportImage(options: ExportImageOptions): Promise<ExportImageResult>;
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

export interface ResolveExportCropInput {
  purpose: ExportPurpose;
  content: RectMm;
  crop?: ExportCropInput;
  cutMode?: unknown;
  cutMarginMm?: unknown;
  minMm?: unknown;
}

export function resolveExportCrop(input: ResolveExportCropInput): SceneExportCrop {
  const crop = input.crop;
  if (isSceneExportCrop(crop)) return crop;
  if (isSceneCoordinateRect(crop)) {
    return { type: "sceneRect", rect: crop };
  }
  const namedFrame = crop === "cut" || crop === "trim" || crop === "bleed" ? crop : undefined;
  const applyCutMargin = input.purpose === "design" || namedFrame === "bleed";
  const rect = applyCutMargin
    ? applyCutMarginToRect(
        input.content,
        normalizeCutMode(input.cutMode),
        Math.max(0, Number(input.cutMarginMm) || 0),
        Math.max(0.1, Number(input.minMm) || 0.1),
      )
    : input.content;
  return { type: "sceneRect", rect: sceneCropFromRectMm(rect) };
}

function isSceneExportCrop(value: unknown): value is SceneExportCrop {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "sceneRect" || type === "elementBounds";
}

function isSceneCoordinateRect(value: unknown): value is CoordinateRect<"scene"> {
  if (!value || typeof value !== "object") return false;
  const rect = value as Partial<CoordinateRect<"scene">>;
  return (
    rect.space === "scene" &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
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
