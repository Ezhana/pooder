import type { CapabilityDefinition } from "@pooder/core";
import type {
  CoordinateRect,
  RectMm,
  SceneExportCrop,
  SceneExportOutputMask,
  SceneExportSourceResult,
  SceneExportSourceSelector,
} from "@pooder/core";

export const EXPORT_CAPABILITY_ID = "pooder.export";

export type ExportImageFormat = "png" | "jpeg";

export type CutMode = "trim" | "outset" | "inset";

export type ExportPurpose = "design" | "mockup";

export type ExportCropPolicy = "content" | "bleed";

export interface ExportCapabilityOptions {
  capabilityId?: string;
}

export type ExportCropInput =
  | SceneExportCrop
  | CoordinateRect<"scene">
  | ExportCropPolicy;

export interface ExportImageOptions {
  sceneId: string;
  purpose: ExportPurpose;
  crop?: ExportCropInput;
  source?: SceneExportSourceSelector;
  outputMask?: SceneExportOutputMask;
  format?: ExportImageFormat;
  multiplier?: number;
  preserveClipPaths?: boolean;
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

export interface ExportCapabilityApi {
  exportImage(options: ExportImageOptions): Promise<ExportImageResult>;
}

export const DEFAULT_DESIGN_EXPORT_TAGS = ["export:design"] as const;
export const DEFAULT_MOCKUP_EXPORT_TAGS = ["export:mockup"] as const;

/** Auto-mask for mockup only applies to this known white-backed key. */
export const DEFAULT_MOCKUP_OUTPUT_MASK_KEY = "templateFrame";

export const DEFAULT_MOCKUP_OUTPUT_MASK_TRANSPARENT_COLOR = {
  red: 255,
  green: 255,
  blue: 255,
  tolerance: 8,
} as const;

export function defaultSourceForPurpose(
  purpose: ExportPurpose,
): SceneExportSourceSelector {
  return {
    tags:
      purpose === "mockup"
        ? DEFAULT_MOCKUP_EXPORT_TAGS
        : DEFAULT_DESIGN_EXPORT_TAGS,
  };
}

export function resolveDefaultOutputMask(
  purpose: ExportPurpose,
  keys: readonly string[],
  explicit?: SceneExportOutputMask,
): SceneExportOutputMask | undefined {
  if (explicit) return explicit;
  if (purpose !== "mockup") return undefined;
  const uniqueKeys = [
    ...new Set(
      keys.map((key) => String(key || "").trim()).filter((key) => key.length > 0),
    ),
  ];
  if (uniqueKeys.length === 0) return undefined;
  if (uniqueKeys.length > 1) {
    throw new Error("export-output-mask-ambiguous");
  }
  const [sourceKey] = uniqueKeys;
  if (!sourceKey || sourceKey !== DEFAULT_MOCKUP_OUTPUT_MASK_KEY) {
    throw new Error("export-output-mask-required");
  }
  return {
    mode: "outline",
    sourceKey,
    transparentColor: { ...DEFAULT_MOCKUP_OUTPUT_MASK_TRANSPARENT_COLOR },
  };
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

export function resolveExportCrop(
  input: ResolveExportCropInput,
): SceneExportCrop {
  const crop = input.crop;
  if (isSceneExportCrop(crop)) return crop;
  if (isSceneCoordinateRect(crop)) {
    return { type: "sceneRect", rect: crop };
  }
  const applyBleed = crop === "bleed" || (crop !== "content" && input.purpose === "design");
  const rect = applyBleed
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

function isSceneCoordinateRect(
  value: unknown,
): value is CoordinateRect<"scene"> {
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

export function createExportCapabilityDefinition(
  facade: ExportCapabilityApi,
  options: ExportCapabilityOptions = {},
): CapabilityDefinition<ExportCapabilityApi> {
  return {
    id: options.capabilityId || EXPORT_CAPABILITY_ID,
    metadata: {
      name: "Export",
      description:
        "Document-aware raster export. Purpose selects membership and crop; " +
        "SceneExportService remains the primitive.",
      tags: ["export", "image"],
    },
    facade,
  };
}
