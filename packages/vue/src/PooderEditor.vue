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

interface DetectSizeByLongEdge {
  widthMm: number;
  heightMm: number;
  scale: number;
  sizeLongEdgeMm: number;
  baseLongEdge: number;
  appliedBounds: DetectBounds;
  baseBounds: DetectBounds;
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

type ImageUpdateTarget = "auto" | "config" | "working";

const IMAGE_OBJECT_LAYER_ID = "image.user";
const IMAGE_TOOL_ID = "pooder.kit.image";

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
  cfgSvc.update("dieline.features", []);
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

const computeDetectSizeByLongEdge = (
  result: DetectEdgeResult,
): DetectSizeByLongEdge | null => {
  const baseBounds = result.baseBounds || result.rawBounds;
  const detectedBounds = result.rawBounds || result.baseBounds;
  if (!isValidBounds(baseBounds) || !isValidBounds(detectedBounds)) return null;

  const currentWidthMm = Number(cfgSvc.get("size.actualWidthMm", 0));
  const currentHeightMm = Number(cfgSvc.get("size.actualHeightMm", 0));
  const sizeLongEdgeMm = Math.max(currentWidthMm, currentHeightMm);
  const baseLongEdge = Math.max(baseBounds.width, baseBounds.height);
  const detectedLongEdge = Math.max(
    detectedBounds.width,
    detectedBounds.height,
  );

  if (
    !Number.isFinite(sizeLongEdgeMm) ||
    !Number.isFinite(baseLongEdge) ||
    !Number.isFinite(detectedLongEdge) ||
    sizeLongEdgeMm <= 0 ||
    baseLongEdge <= 0 ||
    detectedLongEdge <= 0
  ) {
    return null;
  }

  // Keep long-edge mapping against the actual applied contour bounds.
  const scale = sizeLongEdgeMm / detectedLongEdge;
  const widthMm = detectedBounds.width * scale;
  const heightMm = detectedBounds.height * scale;

  if (
    !Number.isFinite(widthMm) ||
    !Number.isFinite(heightMm) ||
    widthMm <= 0 ||
    heightMm <= 0
  ) {
    return null;
  }

  return {
    widthMm,
    heightMm,
    scale,
    sizeLongEdgeMm,
    baseLongEdge,
    appliedBounds: detectedBounds,
    baseBounds,
  };
};

const applyDetectSizeByLongEdge = (
  result: DetectEdgeResult,
  debug = false,
): DetectSizeByLongEdge | null => {
  const mappedSize = computeDetectSizeByLongEdge(result);
  if (!mappedSize) return null;

  cfgSvc.update("size.actualWidthMm", mappedSize.widthMm);
  cfgSvc.update("size.actualHeightMm", mappedSize.heightMm);
  cfgSvc.update(
    "size.aspectRatio",
    mappedSize.widthMm / Math.max(0.001, mappedSize.heightMm),
  );

  if (debug) {
    console.info("[PooderEditor] detectDielineFromFrame size mapping", {
      mappedSize,
      rawBounds: result.rawBounds,
      baseBounds: result.baseBounds,
    });
  }

  return mappedSize;
};

const summarizeRectForDebug = (rect: any) => {
  if (!rect) return null;
  const left = Number(rect.left);
  const top = Number(rect.top);
  const width = Number(rect.width);
  const height = Number(rect.height);
  const centerX = Number(rect.centerX);
  const centerY = Number(rect.centerY);
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(centerX) ||
    !Number.isFinite(centerY)
  ) {
    return null;
  }
  return { left, top, width, height, centerX, centerY };
};

const summarizeSceneLayoutForDebug = (layout: any) => {
  if (!layout) return null;
  const scale = Number(layout.scale);
  const canvasWidth = Number(layout.canvasWidth);
  const canvasHeight = Number(layout.canvasHeight);
  if (
    !Number.isFinite(scale) ||
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight)
  ) {
    return null;
  }

  return {
    scale,
    canvasWidth,
    canvasHeight,
    viewPadding: cfgSvc.get("size.viewPadding"),
    trimRect: summarizeRectForDebug(layout.trimRect),
    cutRect: summarizeRectForDebug(layout.cutRect),
    bleedRect: summarizeRectForDebug(layout.bleedRect),
  };
};

const getDetectCenterOffset = (
  result: DetectEdgeResult,
  sourceWidth: number,
  sourceHeight: number,
) => {
  const bounds = result.rawBounds || result.baseBounds;
  if (
    !isValidBounds(bounds) ||
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return null;
  }
  return {
    bounds,
    offsetX: bounds.x + bounds.width / 2 - sourceWidth / 2,
    offsetY: bounds.y + bounds.height / 2 - sourceHeight / 2,
  };
};

const normalizeImagePlacementForCompare = (items: any[]) => {
  return (items || []).map((item: any) => ({
    id: String(item?.id ?? ""),
    left: Number(item?.left ?? 0),
    top: Number(item?.top ?? 0),
    scale: Number(item?.scale ?? 1),
    angle: Number(item?.angle ?? 0),
    url: typeof item?.url === "string" ? item.url : "",
    sourceUrl: typeof item?.sourceUrl === "string" ? item.sourceUrl : "",
    committedUrl:
      typeof item?.committedUrl === "string" ? item.committedUrl : "",
  }));
};

const detectImageWorkingSessionDirty = async (): Promise<boolean> => {
  try {
    const workingItems =
      (await cmdSvc.executeCommand("getWorkingImages")) || [];
    const configItems = cfgSvc.get("image.items", []) || [];
    const workingNormalized = normalizeImagePlacementForCompare(workingItems);
    const configNormalized = normalizeImagePlacementForCompare(configItems);
    return (
      JSON.stringify(workingNormalized) !== JSON.stringify(configNormalized)
    );
  } catch {
    return false;
  }
};

const resolveDetectImageUpdateTarget = async (
  debug = false,
): Promise<ImageUpdateTarget> => {
  const activeToolId =
    typeof (wbSvc as any)?.activeToolId === "string"
      ? String((wbSvc as any).activeToolId)
      : null;

  if (activeToolId !== IMAGE_TOOL_ID) {
    if (debug) {
      console.info(
        "[PooderEditor] detectDielineFromFrame image update target",
        {
          activeToolId,
          target: "config",
          reason: "image-tool-inactive",
        },
      );
    }
    return "config";
  }

  const workingDirty = await detectImageWorkingSessionDirty();
  const target: ImageUpdateTarget = workingDirty ? "working" : "config";

  if (debug) {
    console.info("[PooderEditor] detectDielineFromFrame image update target", {
      activeToolId,
      workingDirty,
      target,
      reason: workingDirty
        ? "working-session-dirty-follow-working"
        : "working-session-clean-update-config",
    });
  }

  return target;
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

const computeDetectAlignmentShift = (
  result: DetectEdgeResult,
  frame: FrameRect,
): { shiftX: number; shiftY: number } => {
  const expanded = result.rawBounds || result.baseBounds;
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
    return { shiftX: 0, shiftY: 0 };
  }

  const ratioX = frame.width / expanded.width;
  const ratioY = frame.height / expanded.height;

  // Custom dieline path is centered by expanded bounds in geometry.ts,
  // so compensation must use expanded center to avoid one-sided drift.
  const objectCenterX = expanded.x + expanded.width / 2;
  const objectCenterY = expanded.y + expanded.height / 2;
  const imageCenterX = imageWidth / 2;
  const imageCenterY = imageHeight / 2;

  return {
    shiftX: (objectCenterX - imageCenterX) * ratioX,
    shiftY: (objectCenterY - imageCenterY) * ratioY,
  };
};

const compensateImagesForDetectedDieline = async (
  result: DetectEdgeResult,
  snapshots: ImageRenderSnapshot[],
  debug = false,
  target: ImageUpdateTarget = "auto",
) => {
  if (!snapshots.length) return;

  const layout = await cmdSvc.executeCommand("getSceneLayout");
  const frame = toFrameRect(layout);
  if (!frame) return;

  const { shiftX, shiftY } = computeDetectAlignmentShift(result, frame);
  const rawBounds = result.rawBounds;
  const baseBounds = result.baseBounds;
  const imageWidth = Number(result.imageWidth ?? 0);
  const imageHeight = Number(result.imageHeight ?? 0);

  if (debug) {
    const toCandidateShift = (bounds?: DetectBounds) => {
      if (!isValidBounds(bounds) || imageWidth <= 0 || imageHeight <= 0) {
        return null;
      }
      const dx = bounds.x + bounds.width / 2 - imageWidth / 2;
      const dy = bounds.y + bounds.height / 2 - imageHeight / 2;
      return {
        dx,
        dy,
        byBounds: {
          shiftX: dx * (frame.width / Math.max(1, bounds.width)),
          shiftY: dy * (frame.height / Math.max(1, bounds.height)),
        },
        byImage: {
          shiftX: dx * (frame.width / Math.max(1, imageWidth)),
          shiftY: dy * (frame.height / Math.max(1, imageHeight)),
        },
      };
    };
    const rawCandidate = toCandidateShift(rawBounds);
    const baseCandidate = toCandidateShift(baseBounds);

    console.info("[PooderEditor] detectDieline alignment", {
      frame,
      shiftX,
      shiftY,
      shiftNormalized: {
        x: frame.width > 0 ? shiftX / frame.width : 0,
        y: frame.height > 0 ? shiftY / frame.height : 0,
      },
      snapshotCount: snapshots.length,
      baseBounds,
      rawBounds,
      imageWidth,
      imageHeight,
      shiftCandidates: {
        raw: rawCandidate,
        base: baseCandidate,
      },
      shiftRawByBoundsX: rawCandidate?.byBounds?.shiftX,
      shiftRawByBoundsY: rawCandidate?.byBounds?.shiftY,
      shiftRawByImageX: rawCandidate?.byImage?.shiftX,
      shiftRawByImageY: rawCandidate?.byImage?.shiftY,
      shiftBaseByBoundsX: baseCandidate?.byBounds?.shiftX,
      shiftBaseByBoundsY: baseCandidate?.byBounds?.shiftY,
      shiftBaseByImageX: baseCandidate?.byImage?.shiftX,
      shiftBaseByImageY: baseCandidate?.byImage?.shiftY,
    });
  }

  for (const snapshot of snapshots) {
    const coverScale = Math.max(
      frame.width / Math.max(1, snapshot.sourceWidth),
      frame.height / Math.max(1, snapshot.sourceHeight),
    );
    const targetScale = Math.max(0.05, snapshot.objectScale / coverScale);
    const targetCenterX = snapshot.centerX - shiftX;
    const targetCenterY = snapshot.centerY - shiftY;

    const left = clampNormalized(
      (targetCenterX - frame.left) / Math.max(1, frame.width),
    );
    const top = clampNormalized(
      (targetCenterY - frame.top) / Math.max(1, frame.height),
    );

    if (debug) {
      console.info("[PooderEditor] detectDieline alignment item", {
        id: snapshot.id,
        target,
        frame,
        sourceSize: {
          width: snapshot.sourceWidth,
          height: snapshot.sourceHeight,
        },
        objectScale: snapshot.objectScale,
        coverScale,
        targetScale,
        centerBefore: { x: snapshot.centerX, y: snapshot.centerY },
        centerAfter: { x: targetCenterX, y: targetCenterY },
        normalizedAfter: { left, top },
      });
    }

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

const compensateImagesByDetectionOffset = async (
  offsetX: number,
  offsetY: number,
  sourceWidth: number,
  sourceHeight: number,
  snapshots: ImageRenderSnapshot[],
  debug = false,
  target: ImageUpdateTarget = "auto",
  label = "offset",
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

  if (debug) {
    console.info("[PooderEditor] detectDieline direct compensation", {
      label,
      target,
      sourceWidth,
      sourceHeight,
      offsetX,
      offsetY,
      frame,
      shiftX,
      shiftY,
      shiftNormalized: {
        x: frame.width > 0 ? shiftX / frame.width : 0,
        y: frame.height > 0 ? shiftY / frame.height : 0,
      },
      snapshotCount: snapshots.length,
    });
  }

  for (const snapshot of snapshots) {
    const targetCenterX = snapshot.centerX - shiftX;
    const targetCenterY = snapshot.centerY - shiftY;
    const left = clampNormalized(
      (targetCenterX - frame.left) / Math.max(1, frame.width),
    );
    const top = clampNormalized(
      (targetCenterY - frame.top) / Math.max(1, frame.height),
    );

    if (debug) {
      console.info("[PooderEditor] detectDieline direct compensation item", {
        label,
        id: snapshot.id,
        centerBefore: { x: snapshot.centerX, y: snapshot.centerY },
        centerAfter: { x: targetCenterX, y: targetCenterY },
        normalizedAfter: { left, top },
      });
    }

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
  const canvasService = pooder.getService<CanvasService>("CanvasService");
  const snapshots = snapshotImageRenderStates(canvasService);
  let layoutBeforeCommit: any = null;
  if (debug) {
    try {
      layoutBeforeCommit = await cmdSvc.executeCommand("getSceneLayout");
    } catch (error) {
      console.warn(
        "[PooderEditor] detectDielineFromFrame layout(before) failed",
        {
          error,
        },
      );
    }
  }

  const sourceImage = await exportUserCroppedImage({
    multiplier: options?.export?.multiplier ?? 2,
    format: options?.export?.format ?? "png",
    imageIds: options?.export?.imageIds,
  });
  const sourceUrl = sourceImage?.url;
  if (!sourceUrl) return null;

  try {
    if (debug) {
      console.info("[PooderEditor] detectDielineFromFrame sourceImage", {
        width: sourceImage.width,
        height: sourceImage.height,
        format: sourceImage.format,
        multiplier: sourceImage.multiplier,
        imageCount: sourceImage.imageIds.length,
        size: {
          actualWidthMm: cfgSvc.get("size.actualWidthMm"),
          actualHeightMm: cfgSvc.get("size.actualHeightMm"),
          viewPadding: cfgSvc.get("size.viewPadding"),
        },
        layoutBeforeCommit: summarizeSceneLayoutForDebug(layoutBeforeCommit),
        imageSnapshots: snapshots.map((item) => ({
          id: item.id,
          centerX: item.centerX,
          centerY: item.centerY,
          objectScale: item.objectScale,
          sourceWidth: item.sourceWidth,
          sourceHeight: item.sourceHeight,
        })),
      });
    }

    const result = (await cmdSvc.executeCommand("detectEdge", sourceUrl, {
      expand: options?.detect?.expand ?? 0,
      smoothing: options?.detect?.smoothing ?? true,
      simplifyTolerance: options?.detect?.simplifyTolerance ?? 2,
      threshold: options?.detect?.threshold,
      debug,
    })) as DetectEdgeResult | null;

    if (!result) return null;
    const diagnostics = buildDetectFrameDiagnostics(result, sourceImage);

    if (debug) {
      console.info(
        "[PooderEditor] detectDielineFromFrame diagnostics",
        diagnostics,
      );
    }

    if (options?.commit === false) {
      return {
        ...result,
        ...(includeCroppedImage ? { sourceImage } : {}),
        ...(includeDiagnostics ? { diagnostics } : {}),
      };
    }

    applyDetectedDielineConfig(result);
    const mappedSize = applyDetectSizeByLongEdge(result, debug);
    const imageUpdateTarget = await resolveDetectImageUpdateTarget(debug);
    let committedSync: Array<{ id: string; width: number; height: number }> =
      [];
    const targetSnapshots = filterSnapshotsByIds(
      snapshots,
      sourceImage.imageIds,
    );
    await compensateImagesForDetectedDieline(
      result,
      targetSnapshots,
      debug,
      imageUpdateTarget,
    );

    // One-pass closed-loop correction: detect again on the updated frame and
    // directly nudge image left/top by measured center residual.
    const verifySource = await exportUserCroppedImage({
      multiplier: options?.export?.multiplier ?? 2,
      format: options?.export?.format ?? "png",
      imageIds: sourceImage.imageIds,
    });
    const verifyUrl = verifySource?.url;
    if (verifyUrl) {
      try {
        const verifyResult = (await cmdSvc.executeCommand(
          "detectEdge",
          verifyUrl,
          {
            expand: options?.detect?.expand ?? 0,
            smoothing: options?.detect?.smoothing ?? true,
            simplifyTolerance: options?.detect?.simplifyTolerance ?? 2,
            threshold: options?.detect?.threshold,
            debug,
          },
        )) as DetectEdgeResult | null;

        if (verifyResult) {
          const verifyOffset = getDetectCenterOffset(
            verifyResult,
            verifySource.width,
            verifySource.height,
          );
          if (debug) {
            console.info("[PooderEditor] detectDieline verify pass", {
              sourceWidth: verifySource.width,
              sourceHeight: verifySource.height,
              offset: verifyOffset,
              imageIds: sourceImage.imageIds,
            });
          }
          if (
            verifyOffset &&
            (Math.abs(verifyOffset.offsetX) > 0.01 ||
              Math.abs(verifyOffset.offsetY) > 0.01)
          ) {
            const latestSnapshots = filterSnapshotsByIds(
              snapshotImageRenderStates(canvasService),
              sourceImage.imageIds,
            );
            await compensateImagesByDetectionOffset(
              verifyOffset.offsetX,
              verifyOffset.offsetY,
              verifySource.width,
              verifySource.height,
              latestSnapshots,
              debug,
              imageUpdateTarget,
              "verify-pass",
            );
          }
        }
      } finally {
        URL.revokeObjectURL(verifyUrl);
      }
    }

    // Keep non-session rendering aligned with the latest detected dieline by
    // syncing committed image bitmap data after position compensation.
    if (imageUpdateTarget === "config" && sourceImage.imageIds.length > 0) {
      committedSync = await syncCommittedImageDataForIds(
        sourceImage.imageIds,
        {
          multiplier: options?.export?.multiplier ?? 2,
          format: options?.export?.format ?? "png",
        },
        debug,
      );
    }

    if (debug) {
      let layoutAfterCommit: any = null;
      try {
        layoutAfterCommit = await cmdSvc.executeCommand("getSceneLayout");
      } catch (error) {
        console.warn(
          "[PooderEditor] detectDielineFromFrame layout(after) failed",
          {
            error,
          },
        );
      }
      console.info("[PooderEditor] detectDielineFromFrame commit result", {
        mappedSize,
        imageUpdateTarget,
        committedSync,
        sizeAfter: {
          actualWidthMm: cfgSvc.get("size.actualWidthMm"),
          actualHeightMm: cfgSvc.get("size.actualHeightMm"),
          viewPadding: cfgSvc.get("size.viewPadding"),
        },
        layoutAfterCommit: summarizeSceneLayoutForDebug(layoutAfterCommit),
      });
    }
    return {
      ...result,
      ...(includeCroppedImage ? { sourceImage } : {}),
      ...(includeDiagnostics ? { diagnostics } : {}),
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
