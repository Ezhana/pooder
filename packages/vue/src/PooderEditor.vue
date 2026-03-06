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
  FeatureTool,
  ImageTool,
  WhiteInkTool,
  MirrorTool,
  SceneVisibilityService,
  SizeTool,
  SceneLayoutService,
} from "@pooder/kit";
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

type DetectSizeAdjustBoundsSource =
  | "auto"
  | "raw"
  | "base"
  | "expected-expand";

type DetectSizeAdjustStrategy = "long-edge";

interface DetectSizeAdjustOptions {
  enabled?: boolean;
  boundsSource?: DetectSizeAdjustBoundsSource;
  strategy?: DetectSizeAdjustStrategy;
}

interface DetectSizeAdjustResult {
  widthMm: number;
  heightMm: number;
  aspectRatio: number;
  longEdgeMm: number;
  bounds: DetectBounds;
  boundsSource: DetectSizeAdjustBoundsSource;
  strategy: DetectSizeAdjustStrategy;
}
const applyDetectedDielineConfig = (
  result: DetectEdgeResult,
  sourceImage?: { width?: number; height?: number },
) => {
  cfgSvc.update("dieline.shape", "custom");
  cfgSvc.update("dieline.pathData", result.pathData);
  const sourceWidth = Number(result.imageWidth ?? sourceImage?.width ?? 0);
  const sourceHeight = Number(result.imageHeight ?? sourceImage?.height ?? 0);
  cfgSvc.update(
    "dieline.customSourceWidthPx",
    Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : undefined,
  );
  cfgSvc.update(
    "dieline.customSourceHeightPx",
    Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : undefined,
  );
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
  boundsSource: DetectSizeAdjustBoundsSource,
  expectedExpand = 0,
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

const detectDieline = async (url: string) => {
  const result = (await cmdSvc.executeCommand("detectEdge", url, {
    expand: 10, // 安全距离（像素）
    smoothing: true, // 是否平滑
    simplifyTolerance: 2, // 平滑度容差，值越大越圆润
  })) as DetectEdgeResult | null;
  if (result) {
    applyDetectedDielineConfig(result);
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
    sizeAdjust?: DetectSizeAdjustOptions;
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

    applyDetectedDielineConfig(result, sourceImage);
    const sizeAdjusted = applyDetectSizeAdjust(
      result,
      options?.detect?.sizeAdjust,
      debug,
      expectedExpand,
    );
    if (sizeAdjusted) {
      await settleDetectImageRender(sourceImage.imageIds);
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

    // Keep diagnostics read-only: center offset reflects content pose in frame,
    // not a guaranteed alignment error, so avoid second-pass center nudge.
    let postCommitDiagnostics = await detectPostCommitDiagnostics(
      sourceImage.imageIds,
      expectedExpand,
      diagnosticsOptions,
    );

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
  const imageId = await addImage(url);
  const result = (await cmdSvc.executeCommand("detectEdge", url, {
    expand: options?.expand ?? 10,
    smoothing: options?.smoothing ?? true,
    simplifyTolerance: options?.simplifyTolerance ?? 2,
  })) as DetectEdgeResult | null;
  if (!result) return null;

  applyDetectedDielineConfig(result);

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
