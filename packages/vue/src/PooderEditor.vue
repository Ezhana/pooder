<template>
  <div class="pooder-editor">
    <CanvasArea @canvas-ready="onCanvasReady" @resize="onResize" />
  </div>
</template>

<script setup lang="ts">
import { provide, onUnmounted } from "vue";
import {
  CommandService,
  ConfigurationService,
  Pooder,
  WorkbenchService,
} from "@pooder/core";
import {
  CanvasService,
  BackgroundTool,
  RulerTool,
  DielineTool,
  FilmTool,
  FeatureTool,
  ImageTool,
  WhiteInkTool,
  MirrorTool,
  SceneVisibilityService,
  SizeTool,
  SceneLayoutService,
} from "@pooder/kit";
import ToolPanel from "./components/ToolPanel.vue";
import CanvasArea from "./components/CanvasArea.vue";

const SCENE_LAYOUT_SERVICE_ID = "SceneLayoutService";
const SCENE_VISIBILITY_SERVICE_ID = "SceneVisibilityService";

const pooder = new Pooder();
provide("pooder", pooder);
const cmdSvc = pooder.getService<CommandService>("CommandService")!;
const cfgSvc = pooder.getService<ConfigurationService>("ConfigurationService")!;
const wbSvc = pooder.getService<WorkbenchService>("WorkbenchService")!;

const emit = defineEmits<{
  (e: "image-change", images: any[]): void;
}>();

const configDisposable = cfgSvc.onAnyChange((e) => {
  if (e.key === "image.items") {
    emit("image-change", e.value);
  }
});

const importConfig = (config: Record<string, any>) => {
  cfgSvc.import(config);
};

const exportConfig = () => {
  return cfgSvc.export();
};

const getImages = () => {
  return cfgSvc.get("image.items", []);
};

const generateCutImage = async (options?: { debug?: boolean }) => {
  try {
    const result = await cmdSvc.executeCommand<string | null>(
      "exportCutImage",
      options,
    );
    if (!result) {
      console.warn("[PooderEditor] generateCutImage returned null", {
        options,
        imageCount: (cfgSvc.get("image.items") || []).length,
        hasCanvasService: !!pooder.getService<CanvasService>("CanvasService"),
      });
    }
    return result;
  } catch (error) {
    console.error("[PooderEditor] generateCutImage failed", error);
    throw error;
  }
};

const upsertImage = async (
  url: string,
  options?: {
    id?: string;
    mode?: "replace" | "add";
    addOptions?: any;
    fitOnAdd?: boolean;
  },
) => {
  const result = await cmdSvc.executeCommand("upsertImage", url, {
    id: options?.id,
    mode: options?.mode,
    addOptions: options?.addOptions,
    fitOnAdd: options?.fitOnAdd,
  });

  return result;
};

const addImage = async (url: string, options?: any) => {
  const result = await upsertImage(url, {
    mode: "add",
    addOptions: options,
    fitOnAdd: true,
  });

  return result.id;
};

const updateImage = async (id: string, options?: any) => {
  return await cmdSvc.executeCommand("updateImage", id, options);
};

const clearImages = async () => {
  return await cmdSvc.executeCommand("clearImages");
};

const exportUserCroppedImage = async (options?: {
  multiplier?: number;
  format?: "png" | "jpeg";
  imageIds?: string[];
}) => {
  return (await cmdSvc.executeCommand(
    "exportUserCroppedImage",
    options,
  )) as ExportUserCroppedImageResult;
};

const focusImage = async (
  id: string | null,
  options?: { syncCanvasSelection?: boolean },
) => {
  return await cmdSvc.executeCommand("focusImage", id, options);
};

interface DetectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DetectEdgeResult {
  pathData: string;
  rawBounds?: DetectBounds;
  baseBounds?: DetectBounds;
  imageWidth?: number;
  imageHeight?: number;
}

interface DetectFrameDiagnostics {
  sourceWidth: number;
  sourceHeight: number;
  detectedBounds: DetectBounds | null;
  centerOffsetX: number;
  centerOffsetY: number;
  coverageX: number;
  coverageY: number;
}

interface DetectMarginDiagnostics {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface DetectPostCommitDiagnostics {
  frame: DetectFrameDiagnostics;
  margin: DetectMarginDiagnostics | null;
  expectedExpand: number;
  marginDeltaFromExpected: DetectMarginDiagnostics | null;
  marginAsymmetry: { x: number; y: number } | null;
}

interface ExportUserCroppedImageResult {
  url: string;
  width: number;
  height: number;
  multiplier: number;
  format: "png" | "jpeg";
  imageIds: string[];
}

interface ImageRenderSnapshot {
  id: string;
  centerX: number;
  centerY: number;
  objectScale: number;
  sourceWidth: number;
  sourceHeight: number;
}

interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type ImageUpdateTarget = "auto" | "config";
type DetectCompensationBoundsSource =
  | "auto"
  | "raw"
  | "base"
  | "expected-expand";
type DetectCompensationCenterStrategy = "shift-only" | "scaled-center";
type DetectCompensationShiftStrategy = "source" | "bounds";
type DetectCompensationScaleStrategy =
  | "none"
  | "long-edge"
  | "width"
  | "height"
  | "area";

interface DetectCompensationOptions {
  boundsSource?: DetectCompensationBoundsSource;
  centerStrategy?: DetectCompensationCenterStrategy;
  shiftStrategy?: DetectCompensationShiftStrategy;
  scaleStrategy?: DetectCompensationScaleStrategy;
}

type DetectSizeAdjustStrategy = "long-edge";

interface DetectSizeAdjustOptions {
  enabled?: boolean;
  boundsSource?: DetectCompensationBoundsSource;
  strategy?: DetectSizeAdjustStrategy;
}

interface DetectSizeAdjustResult {
  widthMm: number;
  heightMm: number;
  aspectRatio: number;
  longEdgeMm: number;
  bounds: DetectBounds;
  boundsSource: DetectCompensationBoundsSource;
  strategy: DetectSizeAdjustStrategy;
}

const IMAGE_OBJECT_LAYER_ID = "image.user";
const clampNormalized = (value: number): number => {
  return Math.max(-1, Math.min(2, value));
};

const toFrameRect = (layout: any): FrameRect | null => {
  const cut = layout?.cutRect;
  if (!cut) return null;
  const width = Number(cut.width);
  const height = Number(cut.height);
  const left = Number(cut.left);
  const top = Number(cut.top);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { left, top, width, height };
};

const snapshotImageRenderStates = (
  canvasService?: CanvasService | null,
): ImageRenderSnapshot[] => {
  if (!canvasService) return [];

  const objects = canvasService.canvas.getObjects();
  const snapshots: ImageRenderSnapshot[] = [];

  for (const obj of objects as any[]) {
    if (obj?.data?.layerId !== IMAGE_OBJECT_LAYER_ID) continue;
    const id = obj?.data?.id;
    if (typeof id !== "string") continue;

    const center = obj.getCenterPoint ? obj.getCenterPoint() : null;
    const centerX = Number(center?.x ?? obj.left);
    const centerY = Number(center?.y ?? obj.top);
    const objectScale = Number(obj.scaleX);
    const sourceWidth = Number(obj.width);
    const sourceHeight = Number(obj.height);

    if (
      !Number.isFinite(centerX) ||
      !Number.isFinite(centerY) ||
      !Number.isFinite(objectScale) ||
      !Number.isFinite(sourceWidth) ||
      !Number.isFinite(sourceHeight) ||
      sourceWidth <= 0 ||
      sourceHeight <= 0
    ) {
      continue;
    }

    snapshots.push({
      id,
      centerX,
      centerY,
      objectScale,
      sourceWidth,
      sourceHeight,
    });
  }

  return snapshots;
};

const filterSnapshotsByIds = (
  snapshots: ImageRenderSnapshot[],
  ids?: string[],
): ImageRenderSnapshot[] => {
  if (!ids || ids.length === 0) return snapshots;
  const idSet = new Set(ids);
  return snapshots.filter((item) => idSet.has(item.id));
};

const applyDetectedDielineConfig = (result: DetectEdgeResult) => {
  cfgSvc.update("dieline.shape", "custom");
  cfgSvc.update("dieline.pathData", result.pathData);
  cfgSvc.update("size.cutMode", "trim");
  cfgSvc.update("size.cutMarginMm", 0);
};

const isValidBounds = (
  bounds?: DetectBounds | null,
): bounds is DetectBounds => {
  return (
    !!bounds &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
};

const syncCommittedImageDataForIds = async (
  imageIds: string[],
  options?: {
    multiplier?: number;
    format?: "png" | "jpeg";
  },
  debug = false,
) => {
  const normalizedIds = [...new Set(imageIds)].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (!normalizedIds.length)
    return [] as Array<{ id: string; width: number; height: number }>;

  const exportedById = new Map<
    string,
    { url: string; width: number; height: number }
  >();
  for (const id of normalizedIds) {
    const exported = await exportUserCroppedImage({
      multiplier: options?.multiplier ?? 2,
      format: options?.format ?? "png",
      imageIds: [id],
    });
    if (!exported?.url) continue;
    exportedById.set(id, {
      url: exported.url,
      width: exported.width,
      height: exported.height,
    });
  }

  if (!exportedById.size)
    return [] as Array<{ id: string; width: number; height: number }>;

  const items = Array.isArray(cfgSvc.get("image.items", []))
    ? (cfgSvc.get("image.items", []) as any[])
    : [];
  const nextItems = items.map((item: any) => {
    const id = typeof item?.id === "string" ? item.id : "";
    const exported = exportedById.get(id);
    if (!exported) return item;
    const sourceUrl =
      typeof item?.sourceUrl === "string" && item.sourceUrl.length > 0
        ? item.sourceUrl
        : typeof item?.url === "string"
          ? item.url
          : "";
    return {
      ...item,
      url: exported.url,
      sourceUrl,
      committedUrl: exported.url,
    };
  });
  cfgSvc.update("image.items", nextItems);

  const summaries = normalizedIds
    .map((id) => {
      const exported = exportedById.get(id);
      if (!exported) return null;
      return {
        id,
        width: exported.width,
        height: exported.height,
      };
    })
    .filter(
      (item): item is { id: string; width: number; height: number } => !!item,
    );

  if (debug) {
    console.info("[PooderEditor] detectDieline committed image sync", {
      imageIds: normalizedIds,
      synced: summaries,
      count: summaries.length,
    });
  }

  return summaries;
};

const clearCommittedImageOverrideForIds = (
  imageIds: string[],
  debug = false,
) => {
  const normalizedIds = [...new Set(imageIds)].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (!normalizedIds.length) return [] as string[];

  const idSet = new Set(normalizedIds);
  const items = Array.isArray(cfgSvc.get("image.items", []))
    ? (cfgSvc.get("image.items", []) as any[])
    : [];
  const clearedIds: string[] = [];
  const nextItems = items.map((item: any) => {
    const id = typeof item?.id === "string" ? item.id : "";
    if (!idSet.has(id)) return item;
    const committedUrl =
      typeof item?.committedUrl === "string" ? item.committedUrl : "";
    if (!committedUrl) return item;
    clearedIds.push(id);
    return {
      ...item,
      committedUrl: undefined,
    };
  });

  if (clearedIds.length > 0) {
    cfgSvc.update("image.items", nextItems);
  }

  if (debug && clearedIds.length > 0) {
    console.info("[PooderEditor] detectDieline committed override clear", {
      requestedIds: normalizedIds,
      clearedIds,
      count: clearedIds.length,
    });
  }

  return clearedIds;
};

const buildDetectFrameDiagnostics = (
  result: DetectEdgeResult,
  sourceImage: ExportUserCroppedImageResult,
): DetectFrameDiagnostics => {
  const bounds = result.rawBounds || result.baseBounds || null;
  if (!bounds) {
    return {
      sourceWidth: sourceImage.width,
      sourceHeight: sourceImage.height,
      detectedBounds: null,
      centerOffsetX: 0,
      centerOffsetY: 0,
      coverageX: 0,
      coverageY: 0,
    };
  }

  const sourceCenterX = sourceImage.width / 2;
  const sourceCenterY = sourceImage.height / 2;
  const boundsCenterX = bounds.x + bounds.width / 2;
  const boundsCenterY = bounds.y + bounds.height / 2;

  return {
    sourceWidth: sourceImage.width,
    sourceHeight: sourceImage.height,
    detectedBounds: bounds,
    centerOffsetX: boundsCenterX - sourceCenterX,
    centerOffsetY: boundsCenterY - sourceCenterY,
    coverageX: sourceImage.width > 0 ? bounds.width / sourceImage.width : 0,
    coverageY: sourceImage.height > 0 ? bounds.height / sourceImage.height : 0,
  };
};

const buildDetectMarginDiagnostics = (
  result: DetectEdgeResult,
): DetectMarginDiagnostics | null => {
  if (!isValidBounds(result.rawBounds) || !isValidBounds(result.baseBounds)) {
    return null;
  }
  const raw = result.rawBounds;
  const base = result.baseBounds;
  return {
    left: base.x - raw.x,
    top: base.y - raw.y,
    right: raw.x + raw.width - (base.x + base.width),
    bottom: raw.y + raw.height - (base.y + base.height),
  };
};

const buildDetectPostCommitDiagnostics = (
  result: DetectEdgeResult,
  sourceImage: ExportUserCroppedImageResult,
  expectedExpand: number,
): DetectPostCommitDiagnostics => {
  const frame = buildDetectFrameDiagnostics(result, sourceImage);
  const margin = buildDetectMarginDiagnostics(result);
  const marginDeltaFromExpected = margin
    ? {
        left: margin.left - expectedExpand,
        top: margin.top - expectedExpand,
        right: margin.right - expectedExpand,
        bottom: margin.bottom - expectedExpand,
      }
    : null;
  const marginAsymmetry = margin
    ? {
        x: margin.right - margin.left,
        y: margin.bottom - margin.top,
      }
    : null;

  return {
    frame,
    margin,
    expectedExpand,
    marginDeltaFromExpected,
    marginAsymmetry,
  };
};

const detectPostCommitDiagnostics = async (
  imageIds: string[],
  expectedExpand: number,
  options?: {
    multiplier?: number;
    format?: "png" | "jpeg";
    detect?: {
      expand?: number;
      smoothing?: boolean;
      simplifyTolerance?: number;
      threshold?: number;
    };
  },
): Promise<DetectPostCommitDiagnostics | null> => {
  if (!imageIds.length) return null;

  const verifySource = await exportUserCroppedImage({
    multiplier: options?.multiplier ?? 2,
    format: options?.format ?? "png",
    imageIds,
  });
  const verifyUrl = verifySource?.url;
  if (!verifyUrl) return null;

  try {
    const verifyResult = (await cmdSvc.executeCommand("detectEdge", verifyUrl, {
      expand: options?.detect?.expand ?? 0,
      smoothing: options?.detect?.smoothing ?? true,
      simplifyTolerance: options?.detect?.simplifyTolerance ?? 2,
      threshold: options?.detect?.threshold,
      debug: false,
    })) as DetectEdgeResult | null;

    if (!verifyResult) return null;
    return buildDetectPostCommitDiagnostics(
      verifyResult,
      verifySource,
      expectedExpand,
    );
  } finally {
    URL.revokeObjectURL(verifyUrl);
  }
};

const settleDetectImageRender = async (imageIds: string[]) => {
  if (!imageIds.length) return;
  const settled = await exportUserCroppedImage({
    multiplier: 1,
    format: "png",
    imageIds,
  });
  if (settled?.url) {
    URL.revokeObjectURL(settled.url);
  }
};

interface DetectAlignmentPlan {
  shiftX: number;
  shiftY: number;
  centerScaleX: number;
  centerScaleY: number;
  objectScaleFactor: number;
  ratioX: number;
  ratioY: number;
  bounds: DetectBounds | null;
  sourceWidth: number;
  sourceHeight: number;
  boundsSource: DetectCompensationBoundsSource;
  centerStrategy: DetectCompensationCenterStrategy;
  shiftStrategy: DetectCompensationShiftStrategy;
  scaleStrategy: DetectCompensationScaleStrategy;
  shiftRatioX: number;
  shiftRatioY: number;
}

const normalizeDetectCompensationOptions = (
  options?: DetectCompensationOptions,
): Required<DetectCompensationOptions> => {
  return {
    boundsSource: options?.boundsSource ?? "expected-expand",
    centerStrategy: options?.centerStrategy ?? "shift-only",
    shiftStrategy: options?.shiftStrategy ?? "source",
    scaleStrategy: options?.scaleStrategy ?? "area",
  };
};

const normalizeDetectSizeAdjustOptions = (
  options?: DetectSizeAdjustOptions,
): Required<DetectSizeAdjustOptions> => {
  return {
    enabled: options?.enabled !== false,
    boundsSource: options?.boundsSource ?? "expected-expand",
    strategy: options?.strategy ?? "long-edge",
  };
};

const buildExpectedExpandedBounds = (
  baseBounds?: DetectBounds,
  expectedExpand = 0,
): DetectBounds | null => {
  if (!isValidBounds(baseBounds)) return null;
  const expand = Math.max(0, expectedExpand);
  return {
    x: baseBounds.x - expand,
    y: baseBounds.y - expand,
    width: baseBounds.width + expand * 2,
    height: baseBounds.height + expand * 2,
  };
};

const resolveCompensationBounds = (
  result: DetectEdgeResult,
  boundsSource: DetectCompensationBoundsSource,
  expectedExpand = 0,
  options?: {
    preferRawOnAuto?: boolean;
  },
): DetectBounds | null => {
  const expectedExpanded = buildExpectedExpandedBounds(
    result.baseBounds,
    expectedExpand,
  );
  if (boundsSource === "expected-expand") {
    return expectedExpanded || result.rawBounds || result.baseBounds || null;
  }
  if (boundsSource === "raw") return result.rawBounds || null;
  if (boundsSource === "base") return result.baseBounds || null;
  if (options?.preferRawOnAuto) {
    return result.rawBounds || expectedExpanded || result.baseBounds || null;
  }
  return expectedExpanded || result.rawBounds || result.baseBounds || null;
};

const applyDetectSizeAdjust = (
  result: DetectEdgeResult,
  options?: DetectSizeAdjustOptions,
  debug = false,
  expectedExpand = 0,
): DetectSizeAdjustResult | null => {
  const normalized = normalizeDetectSizeAdjustOptions(options);
  if (!normalized.enabled) return null;

  const bounds = resolveCompensationBounds(
    result,
    normalized.boundsSource,
    expectedExpand,
    {
      preferRawOnAuto: false,
    },
  );
  if (!isValidBounds(bounds)) return null;

  const currentWidthMm = Number(cfgSvc.get("size.actualWidthMm", 0));
  const currentHeightMm = Number(cfgSvc.get("size.actualHeightMm", 0));
  const longEdgeMm = Math.max(currentWidthMm, currentHeightMm);
  const boundsLongEdge = Math.max(bounds.width, bounds.height);

  if (
    !Number.isFinite(longEdgeMm) ||
    !Number.isFinite(boundsLongEdge) ||
    longEdgeMm <= 0 ||
    boundsLongEdge <= 0
  ) {
    return null;
  }

  const scale = longEdgeMm / boundsLongEdge;
  const widthMm = bounds.width * scale;
  const heightMm = bounds.height * scale;
  const aspectRatio = widthMm / Math.max(0.001, heightMm);

  if (
    !Number.isFinite(widthMm) ||
    !Number.isFinite(heightMm) ||
    !Number.isFinite(aspectRatio) ||
    widthMm <= 0 ||
    heightMm <= 0 ||
    aspectRatio <= 0
  ) {
    return null;
  }

  cfgSvc.update("size.actualWidthMm", widthMm);
  cfgSvc.update("size.actualHeightMm", heightMm);
  cfgSvc.update("size.aspectRatio", aspectRatio);

  const adjusted = {
    widthMm,
    heightMm,
    aspectRatio,
    longEdgeMm,
    bounds,
    boundsSource: normalized.boundsSource,
    strategy: normalized.strategy,
  };

  if (debug) {
    console.info("[PooderEditor] detectDieline size adjust(raw)", {
      rawBounds: result.rawBounds ?? null,
      baseBounds: result.baseBounds ?? null,
      expectedExpandedBounds: buildExpectedExpandedBounds(
        result.baseBounds,
        expectedExpand,
      ),
      expectedExpand,
      options: normalized,
      adjusted,
    });
  }

  return adjusted;
};

const computeCompensationScaleFactor = (
  imageWidth: number,
  imageHeight: number,
  boundsWidth: number,
  boundsHeight: number,
  scaleStrategy: DetectCompensationScaleStrategy,
): number => {
  if (
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    boundsWidth <= 0 ||
    boundsHeight <= 0
  ) {
    return 1;
  }

  switch (scaleStrategy) {
    case "none":
      return 1;
    case "width":
      return imageWidth / boundsWidth;
    case "height":
      return imageHeight / boundsHeight;
    case "area":
      return Math.sqrt((imageWidth * imageHeight) / (boundsWidth * boundsHeight));
    case "long-edge":
    default: {
      const longEdgeImage = Math.max(imageWidth, imageHeight);
      const longEdgeBounds = Math.max(boundsWidth, boundsHeight);
      return longEdgeBounds > 0 ? longEdgeImage / longEdgeBounds : 1;
    }
  }
};

const computeDetectAlignmentPlan = (
  result: DetectEdgeResult,
  frame: FrameRect,
  compensation?: DetectCompensationOptions,
  expectedExpand = 0,
): DetectAlignmentPlan => {
  const normalizedCompensation =
    normalizeDetectCompensationOptions(compensation);
  const expanded = resolveCompensationBounds(
    result,
    normalizedCompensation.boundsSource,
    expectedExpand,
    {
      // For position correction, raw bounds better preserve actual detected
      // center even when expand is asymmetric near image edges.
      preferRawOnAuto: true,
    },
  );
  const imageWidth = Number(result.imageWidth ?? 0);
  const imageHeight = Number(result.imageHeight ?? 0);

  if (
    !expanded ||
    !Number.isFinite(expanded.x) ||
    !Number.isFinite(expanded.y) ||
    !Number.isFinite(expanded.width) ||
    !Number.isFinite(expanded.height) ||
    expanded.width <= 0 ||
    expanded.height <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return {
      shiftX: 0,
      shiftY: 0,
      centerScaleX: 1,
      centerScaleY: 1,
      objectScaleFactor: 1,
      ratioX: 1,
      ratioY: 1,
      bounds: null,
      sourceWidth: Math.max(0, imageWidth),
      sourceHeight: Math.max(0, imageHeight),
      boundsSource: normalizedCompensation.boundsSource,
      centerStrategy: normalizedCompensation.centerStrategy,
      shiftStrategy: normalizedCompensation.shiftStrategy,
      scaleStrategy: normalizedCompensation.scaleStrategy,
      shiftRatioX: 1,
      shiftRatioY: 1,
    };
  }

  const ratioX = frame.width / expanded.width;
  const ratioY = frame.height / expanded.height;
  const sourceRatioX = frame.width / Math.max(1, imageWidth);
  const sourceRatioY = frame.height / Math.max(1, imageHeight);
  const shiftRatioX =
    normalizedCompensation.shiftStrategy === "bounds" ? ratioX : sourceRatioX;
  const shiftRatioY =
    normalizedCompensation.shiftStrategy === "bounds" ? ratioY : sourceRatioY;
  const centerScaleX =
    normalizedCompensation.centerStrategy === "scaled-center"
      ? imageWidth / expanded.width
      : 1;
  const centerScaleY =
    normalizedCompensation.centerStrategy === "scaled-center"
      ? imageHeight / expanded.height
      : 1;
  const objectScaleFactor = computeCompensationScaleFactor(
    imageWidth,
    imageHeight,
    expanded.width,
    expanded.height,
    normalizedCompensation.scaleStrategy,
  );

  // Custom dieline path is centered by expanded bounds in geometry.ts,
  // so compensation must use expanded center to avoid one-sided drift.
  const objectCenterX = expanded.x + expanded.width / 2;
  const objectCenterY = expanded.y + expanded.height / 2;
  const imageCenterX = imageWidth / 2;
  const imageCenterY = imageHeight / 2;

  return {
    shiftX: (objectCenterX - imageCenterX) * shiftRatioX,
    shiftY: (objectCenterY - imageCenterY) * shiftRatioY,
    centerScaleX,
    centerScaleY,
    objectScaleFactor:
      Number.isFinite(objectScaleFactor) && objectScaleFactor > 0
        ? objectScaleFactor
        : 1,
    ratioX,
    ratioY,
    bounds: expanded,
    sourceWidth: imageWidth,
    sourceHeight: imageHeight,
    boundsSource: normalizedCompensation.boundsSource,
    centerStrategy: normalizedCompensation.centerStrategy,
    shiftStrategy: normalizedCompensation.shiftStrategy,
    scaleStrategy: normalizedCompensation.scaleStrategy,
    shiftRatioX,
    shiftRatioY,
  };
};

const compensateImagesForDetectedDieline = async (
  result: DetectEdgeResult,
  snapshots: ImageRenderSnapshot[],
  debug = false,
  target: ImageUpdateTarget = "auto",
  compensation?: DetectCompensationOptions,
  expectedExpand = 0,
) => {
  if (!snapshots.length) return;

  const layout = await cmdSvc.executeCommand("getSceneLayout");
  const frame = toFrameRect(layout);
  if (!frame) return;

  const plan = computeDetectAlignmentPlan(
    result,
    frame,
    compensation,
    expectedExpand,
  );
  const {
    shiftX,
    shiftY,
    centerScaleX,
    centerScaleY,
    objectScaleFactor,
    ratioX,
    ratioY,
    bounds,
    sourceWidth,
    sourceHeight,
    boundsSource,
    centerStrategy,
    shiftStrategy,
    scaleStrategy,
    shiftRatioX,
    shiftRatioY,
  } = plan;
  const frameCenterX = frame.left + frame.width / 2;
  const frameCenterY = frame.top + frame.height / 2;
  console.info("[PooderEditor] detectDieline alignment plan", {
    target,
    frame,
    bounds,
    expectedExpandedBounds: buildExpectedExpandedBounds(
      result.baseBounds,
      expectedExpand,
    ),
    expectedExpand,
    sourceWidth,
    sourceHeight,
    ratioX,
    ratioY,
    shiftX,
    shiftY,
    centerScaleX,
    centerScaleY,
    objectScaleFactor,
    boundsSource,
    centerStrategy,
    shiftStrategy,
    scaleStrategy,
    shiftRatioX,
    shiftRatioY,
    snapshotCount: snapshots.length,
  });

  for (const snapshot of snapshots) {
    const coverScale = Math.max(
      frame.width / Math.max(1, snapshot.sourceWidth),
      frame.height / Math.max(1, snapshot.sourceHeight),
    );
    const baseNormalizedScale = snapshot.objectScale / coverScale;
    const targetScale = Math.max(
      0.05,
      baseNormalizedScale * objectScaleFactor,
    );
    const targetCenterX =
      frameCenterX +
      (snapshot.centerX - frameCenterX) * centerScaleX -
      shiftX;
    const targetCenterY =
      frameCenterY +
      (snapshot.centerY - frameCenterY) * centerScaleY -
      shiftY;

    const left = clampNormalized(
      (targetCenterX - frame.left) / Math.max(1, frame.width),
    );
    const top = clampNormalized(
      (targetCenterY - frame.top) / Math.max(1, frame.height),
    );

    await cmdSvc.executeCommand(
      "updateImage",
      snapshot.id,
      {
        scale: targetScale,
        left,
        top,
      },
      {
        target,
      },
    );
  }
};

const compensateImagesByCenterOffset = async (
  offsetX: number,
  offsetY: number,
  sourceWidth: number,
  sourceHeight: number,
  snapshots: ImageRenderSnapshot[],
  target: ImageUpdateTarget = "config",
) => {
  if (!snapshots.length) return;
  if (
    !Number.isFinite(offsetX) ||
    !Number.isFinite(offsetY) ||
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return;
  }

  const layout = await cmdSvc.executeCommand("getSceneLayout");
  const frame = toFrameRect(layout);
  if (!frame) return;

  const shiftX = (offsetX * frame.width) / sourceWidth;
  const shiftY = (offsetY * frame.height) / sourceHeight;

  for (const snapshot of snapshots) {
    const targetCenterX = snapshot.centerX - shiftX;
    const targetCenterY = snapshot.centerY - shiftY;
    const left = clampNormalized(
      (targetCenterX - frame.left) / Math.max(1, frame.width),
    );
    const top = clampNormalized(
      (targetCenterY - frame.top) / Math.max(1, frame.height),
    );

    await cmdSvc.executeCommand(
      "updateImage",
      snapshot.id,
      {
        left,
        top,
      },
      {
        target,
      },
    );
  }
};

const detectDieline = async (url: string) => {
  const canvasService = pooder.getService<CanvasService>("CanvasService");
  const snapshots = snapshotImageRenderStates(canvasService);

  const result = (await cmdSvc.executeCommand("detectEdge", url, {
    expand: 10, // 安全距离（像素）
    smoothing: true, // 是否平滑
    simplifyTolerance: 2, // 平滑度容差，值越大越圆润
  })) as DetectEdgeResult | null;
  if (result) {
    applyDetectedDielineConfig(result);

    const images = cfgSvc.get("image.items") || [];
    const targetImage = images.find((img: any) => img.url === url);
    if (targetImage?.id) {
      const targetSnapshots = snapshots.filter(
        (item) => item.id === targetImage.id,
      );
      await compensateImagesForDetectedDieline(result, targetSnapshots);
    }

    return result.pathData;
  }
  return null;
};

const detectDielineFromFrame = async (options?: {
  detect?: {
    expand?: number;
    smoothing?: boolean;
    simplifyTolerance?: number;
    threshold?: number;
    debug?: boolean;
    syncCommitted?: boolean;
    sizeAdjust?: DetectSizeAdjustOptions;
    compensation?: DetectCompensationOptions;
  };
  export?: {
    multiplier?: number;
    format?: "png" | "jpeg";
    imageIds?: string[];
  };
  inspect?: {
    includeCroppedImage?: boolean;
    includeDiagnostics?: boolean;
  };
  commit?: boolean;
}) => {
  const debug = options?.detect?.debug === true;
  const includeCroppedImage = options?.inspect?.includeCroppedImage === true;
  const includeDiagnostics = options?.inspect?.includeDiagnostics === true;
  const expectedExpand = Math.max(0, Number(options?.detect?.expand ?? 0));
  const canvasService = pooder.getService<CanvasService>("CanvasService");
  const snapshots = snapshotImageRenderStates(canvasService);
  const sourceImage = await exportUserCroppedImage({
    multiplier: options?.export?.multiplier ?? 2,
    format: options?.export?.format ?? "png",
    imageIds: options?.export?.imageIds,
  });
  const sourceUrl = sourceImage?.url;
  if (!sourceUrl) {
    console.warn("[PooderEditor] detectDielineFromFrame no source image");
    return null;
  }

  try {
    const result = (await cmdSvc.executeCommand("detectEdge", sourceUrl, {
      expand: options?.detect?.expand ?? 0,
      smoothing: options?.detect?.smoothing ?? true,
      simplifyTolerance: options?.detect?.simplifyTolerance ?? 2,
      threshold: options?.detect?.threshold,
      debug,
    })) as DetectEdgeResult | null;

    if (!result) {
      console.warn(
        "[PooderEditor] detectDielineFromFrame detectEdge returned null",
      );
      return null;
    }
    const diagnostics = buildDetectFrameDiagnostics(result, sourceImage);

    if (options?.commit === false) {
      return {
        ...result,
        ...(includeCroppedImage ? { sourceImage } : {}),
        ...(includeDiagnostics ? { diagnostics } : {}),
      };
    }

    applyDetectedDielineConfig(result);
    const sizeAdjusted = applyDetectSizeAdjust(
      result,
      options?.detect?.sizeAdjust,
      debug,
      expectedExpand,
    );
    if (sizeAdjusted) {
      await settleDetectImageRender(sourceImage.imageIds);
    }
    const committedOverrideClearedIds = clearCommittedImageOverrideForIds(
      sourceImage.imageIds,
      debug,
    );
    if (committedOverrideClearedIds.length > 0) {
      await settleDetectImageRender(sourceImage.imageIds);
    }

    let alignmentResult: DetectEdgeResult = result;
    const shouldAlignmentRedetect =
      sourceImage.imageIds.length > 0 &&
      (!!sizeAdjusted || committedOverrideClearedIds.length > 0);
    if (shouldAlignmentRedetect) {
      const alignmentSource = await exportUserCroppedImage({
        multiplier: options?.export?.multiplier ?? 2,
        format: options?.export?.format ?? "png",
        imageIds: sourceImage.imageIds,
      });
      const alignmentUrl = alignmentSource?.url;
      if (alignmentUrl) {
        try {
          const redetected = (await cmdSvc.executeCommand(
            "detectEdge",
            alignmentUrl,
            {
              expand: options?.detect?.expand ?? 0,
              smoothing: options?.detect?.smoothing ?? true,
              simplifyTolerance: options?.detect?.simplifyTolerance ?? 2,
              threshold: options?.detect?.threshold,
              debug: false,
            },
          )) as DetectEdgeResult | null;
          if (redetected) {
            alignmentResult = redetected;
            console.info("[PooderEditor] detectDielineFromFrame alignment redetect", {
              sourceWidth: alignmentSource.width,
              sourceHeight: alignmentSource.height,
              rawBounds: redetected.rawBounds ?? null,
              baseBounds: redetected.baseBounds ?? null,
            });
          }
        } finally {
          URL.revokeObjectURL(alignmentUrl);
        }
      }
    }

    const imageUpdateTarget: ImageUpdateTarget = "config";
    const latestSnapshots = filterSnapshotsByIds(
      snapshotImageRenderStates(canvasService),
      sourceImage.imageIds,
    );
    const targetSnapshots =
      latestSnapshots.length > 0
        ? latestSnapshots
        : filterSnapshotsByIds(snapshots, sourceImage.imageIds);
    await compensateImagesForDetectedDieline(
      alignmentResult,
      targetSnapshots,
      debug,
      imageUpdateTarget,
      options?.detect?.compensation,
      expectedExpand,
    );

    // Optional committed bitmap sync; disabled by default because committed mode
    // renders with normalized transforms and can override position compensation.
    const shouldSyncCommitted = options?.detect?.syncCommitted === true;
    if (shouldSyncCommitted && sourceImage.imageIds.length > 0) {
      await syncCommittedImageDataForIds(
        sourceImage.imageIds,
        {
          multiplier: options?.export?.multiplier ?? 2,
          format: options?.export?.format ?? "png",
        },
        debug,
      );
    }

    const diagnosticsOptions = {
      multiplier: options?.export?.multiplier ?? 2,
      format: options?.export?.format ?? "png",
      detect: {
        expand: options?.detect?.expand ?? 0,
        smoothing: options?.detect?.smoothing ?? true,
        simplifyTolerance: options?.detect?.simplifyTolerance ?? 2,
        threshold: options?.detect?.threshold,
      },
    };

    let postCommitDiagnostics = await detectPostCommitDiagnostics(
      sourceImage.imageIds,
      expectedExpand,
      diagnosticsOptions,
    );

    const centerOffsetTolerancePx = 2;
    if (postCommitDiagnostics) {
      const shouldApplyCenterNudge =
        Math.abs(postCommitDiagnostics.frame.centerOffsetX) >
          centerOffsetTolerancePx ||
        Math.abs(postCommitDiagnostics.frame.centerOffsetY) >
          centerOffsetTolerancePx;

      if (shouldApplyCenterNudge) {
        const nudgeOffsetX = postCommitDiagnostics.frame.centerOffsetX;
        const nudgeOffsetY = postCommitDiagnostics.frame.centerOffsetY;
        const nudgeSourceWidth = postCommitDiagnostics.frame.sourceWidth;
        const nudgeSourceHeight = postCommitDiagnostics.frame.sourceHeight;
        const latestNudgeSnapshots = filterSnapshotsByIds(
          snapshotImageRenderStates(canvasService),
          sourceImage.imageIds,
        );
        const nudgeSnapshots =
          latestNudgeSnapshots.length > 0
            ? latestNudgeSnapshots
            : targetSnapshots;
        if (nudgeSnapshots.length > 0) {
          await compensateImagesByCenterOffset(
            nudgeOffsetX,
            nudgeOffsetY,
            nudgeSourceWidth,
            nudgeSourceHeight,
            nudgeSnapshots,
            imageUpdateTarget,
          );
          await settleDetectImageRender(sourceImage.imageIds);
          const nudgeDiagnostics = await detectPostCommitDiagnostics(
            sourceImage.imageIds,
            expectedExpand,
            diagnosticsOptions,
          );
          if (nudgeDiagnostics) {
            postCommitDiagnostics = nudgeDiagnostics;
          }
          console.info("[PooderEditor] detectDielineFromFrame center nudge", {
            offsetX: nudgeOffsetX,
            offsetY: nudgeOffsetY,
            sourceWidth: nudgeSourceWidth,
            sourceHeight: nudgeSourceHeight,
            tolerance: centerOffsetTolerancePx,
            snapshotCount: nudgeSnapshots.length,
          });
        }
      }
    }

    if (postCommitDiagnostics) {
      console.info(
        "[PooderEditor] detectDielineFromFrame post-commit diagnostics",
        postCommitDiagnostics,
      );
    } else if (sourceImage.imageIds.length > 0) {
      console.warn(
        "[PooderEditor] detectDielineFromFrame post-commit detectEdge returned null",
      );
    }

    return {
      ...result,
      ...(includeCroppedImage ? { sourceImage } : {}),
      ...(includeDiagnostics ? { diagnostics, postCommitDiagnostics } : {}),
    };
  } finally {
    if (sourceUrl && !includeCroppedImage) {
      URL.revokeObjectURL(sourceUrl);
    }
  }
};

const uploadAndDetectEdge = async (
  url: string,
  options?: {
    expand?: number;
    smoothing?: boolean;
    simplifyTolerance?: number;
  },
) => {
  const canvasService = pooder.getService<CanvasService>("CanvasService");
  const imageId = await addImage(url);
  const snapshots = snapshotImageRenderStates(canvasService).filter(
    (item) => item.id === imageId,
  );
  const result = (await cmdSvc.executeCommand("detectEdge", url, {
    expand: options?.expand ?? 10,
    smoothing: options?.smoothing ?? true,
    simplifyTolerance: options?.simplifyTolerance ?? 2,
  })) as DetectEdgeResult | null;
  if (!result) return null;

  applyDetectedDielineConfig(result);
  await compensateImagesForDetectedDieline(result, snapshots);

  return { imageId, url, pathData: result.pathData };
};

defineExpose({
  importConfig,
  exportConfig,
  getImages,
  generateCutImage,
  addImage,
  upsertImage,
  updateImage,
  clearImages,
  exportUserCroppedImage,
  focusImage,
  detectDieline,
  detectDielineFromFrame,
  uploadAndDetectEdge,
  activateTool: async (id: string | null) => await wbSvc.switchTool(id),
  deactivateTool: async () => await wbSvc.deactivate(),
  on: (event: string, handler: any) => pooder.eventBus.on(event, handler),
  off: (event: string, handler: any) => pooder.eventBus.off(event, handler),
  emit: (event: string, data: any) => pooder.eventBus.emit(event, data),
  executeCommand: (id: string, ...args: any[]) =>
    cmdSvc.executeCommand(id, ...args),
  getConfig: (key: string) => cfgSvc.get(key),
  updateConfig: (key: string, val: any) => cfgSvc.update(key, val),
  services: {
    workbench: wbSvc,
    command: cmdSvc,
    config: cfgSvc,
  },
});

const onCanvasReady = (canvasEl: HTMLCanvasElement) => {
  const canvasService = new CanvasService(canvasEl, {
    eventBus: pooder.eventBus,
  });

  pooder.registerService(canvasService, "CanvasService");
  pooder.registerService(new SceneLayoutService(), SCENE_LAYOUT_SERVICE_ID);
  pooder.registerService(
    new SceneVisibilityService(),
    SCENE_VISIBILITY_SERVICE_ID,
  );

  const tools = [
    new BackgroundTool(),
    new SizeTool(),
    new ImageTool(),
    // new FilmTool(),
    new WhiteInkTool(),
    new MirrorTool(),
    new DielineTool(),
    new RulerTool(),
    new FeatureTool(),
  ];

  tools.forEach((tool) => {
    pooder.extensionManager.register(tool);
  });
};

const onResize = (width: number, height: number) => {
  const canvasService = pooder.getService<CanvasService>("CanvasService");
  if (canvasService) {
    canvasService.resize(width, height);
  }
};

onUnmounted(() => {
  configDisposable.dispose();
  pooder.extensionManager.destroy();
  pooder.unregisterService(SCENE_VISIBILITY_SERVICE_ID);
  pooder.unregisterService(SCENE_LAYOUT_SERVICE_ID);
  pooder.unregisterService("CanvasService");
});
</script>

<style scoped>
.pooder-editor {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
