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
  SizeTool,
  SceneLayoutService,
  type ImageOperation,
  type ImageSessionNotice,
  type ImageTransformUpdates,
  type ImageViewState,
} from "@pooder/kit";
import type {
  PooderDetectBounds as DetectBounds,
  PooderDetectDielineFromFrameOptions,
  PooderDetectDielineFromFrameResult,
  PooderDetectEdgeResult as DetectEdgeResult,
  PooderDetectFrameDiagnostics as DetectFrameDiagnostics,
  PooderDetectPostCommitDiagnostics as DetectPostCommitDiagnostics,
  PooderDetectMarginDiagnostics as DetectMarginDiagnostics,
  PooderEditorExposed,
  PooderEditorImageStateChangeHandler,
  PooderEditorImageSessionNoticeHandler,
  PooderExportUserCroppedImageOptions,
  PooderExportUserCroppedImageResult as ExportUserCroppedImageResult,
  PooderFocusImageOptions,
  PooderGenerateCutImageOptions,
  PooderImageTarget,
  PooderUpsertImageOptions,
  PooderUploadAndDetectEdgeOptions,
  PooderUploadAndDetectEdgeResult,
} from "./model";
import CanvasArea from "./components/CanvasArea.vue";

const SCENE_LAYOUT_SERVICE_ID = "SceneLayoutService";

const pooder = new Pooder();
provide("pooder", pooder);
const cmdSvc = pooder.getService<CommandService>("CommandService")!;
const cfgSvc = pooder.getService<ConfigurationService>("ConfigurationService")!;
const wbSvc = pooder.getService<WorkbenchService>("WorkbenchService")!;

const emit = defineEmits<{
  (e: "image-state-change", state: ImageViewState): void;
  (e: "image-session-notice", notice: ImageSessionNotice | null): void;
}>();

const onImageStateChangeEvent = (state: ImageViewState) => {
  emit("image-state-change", state);
};

const onImageSessionNoticeEvent = (notice: ImageSessionNotice | null) => {
  emit("image-session-notice", notice);
};

pooder.eventBus.on("image:state:change", onImageStateChangeEvent);
pooder.eventBus.on("image:session:notice", onImageSessionNoticeEvent);

const importConfig = (config: Record<string, any>) => {
  cfgSvc.import(config);
};

const exportConfig = () => {
  return cfgSvc.export();
};

const generateCutImage = async (options?: PooderGenerateCutImageOptions) => {
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

const upsertImage = async (url: string, options?: PooderUpsertImageOptions) => {
  const result = await cmdSvc.executeCommand("upsertImage", url, {
    id: options?.id,
    mode: options?.mode,
    addOptions: options?.addOptions,
    operation: options?.operation,
  });

  return result;
};

const addImage = async (url: string, options?: any) => {
  const result = await upsertImage(url, {
    mode: "add",
    addOptions: options,
  });

  return result.id;
};

const applyImageOperation = async (
  id: string,
  operation: ImageOperation,
  options?: { target?: PooderImageTarget },
) => {
  return await cmdSvc.executeCommand(
    "applyImageOperation",
    id,
    operation,
    options,
  );
};

const getImageState = async () => {
  return (await cmdSvc.executeCommand("getImageViewState")) as ImageViewState;
};

const setImageTransform = async (
  id: string,
  updates: ImageTransformUpdates,
  options?: { target?: PooderImageTarget },
) => {
  return await cmdSvc.executeCommand("setImageTransform", id, updates, options);
};

const onImageStateChange = (handler: PooderEditorImageStateChangeHandler) => {
  pooder.eventBus.on("image:state:change", handler);
  return () => pooder.eventBus.off("image:state:change", handler);
};

const onImageSessionNotice = (
  handler: PooderEditorImageSessionNoticeHandler,
) => {
  pooder.eventBus.on("image:session:notice", handler);
  return () => pooder.eventBus.off("image:session:notice", handler);
};

const updateImage = async (id: string, options?: any) => {
  return await cmdSvc.executeCommand("updateImage", id, options);
};

const clearImages = async () => {
  return await cmdSvc.executeCommand("clearImages");
};

const exportUserCroppedImage = async (
  options?: PooderExportUserCroppedImageOptions,
) => {
  return (await cmdSvc.executeCommand(
    "exportUserCroppedImage",
    options,
  )) as ExportUserCroppedImageResult;
};

const focusImage = async (
  id: string | null,
  options?: PooderFocusImageOptions,
) => {
  return await cmdSvc.executeCommand("focusImage", id, options);
};
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
    Number.isFinite(sourceHeight) && sourceHeight > 0
      ? sourceHeight
      : undefined,
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

const detectDielineFromFrame = async (
  options: PooderDetectDielineFromFrameOptions = {},
): Promise<PooderDetectDielineFromFrameResult | null> => {
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
  options?: PooderUploadAndDetectEdgeOptions,
): Promise<PooderUploadAndDetectEdgeResult | null> => {
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

const exposed = {
  importConfig,
  exportConfig,
  generateCutImage,
  addImage,
  upsertImage,
  getImageState,
  onImageStateChange,
  onImageSessionNotice,
  applyImageOperation,
  setImageTransform,
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
  executeCommand: <T = unknown,>(id: string, ...args: any[]) =>
    cmdSvc.executeCommand<T>(id, ...args),
  getConfig: <T = unknown,>(key: string) => cfgSvc.get(key) as T,
  updateConfig: (key: string, val: any) => cfgSvc.update(key, val),
  services: {
    workbench: wbSvc,
    command: cmdSvc,
    config: cfgSvc,
  },
} satisfies PooderEditorExposed;

defineExpose(exposed);

const onCanvasReady = (canvasEl: HTMLCanvasElement) => {
  const canvasService = new CanvasService(canvasEl, {
    eventBus: pooder.eventBus,
  });

  pooder.registerService(canvasService, "CanvasService");
  pooder.registerService(new SceneLayoutService(), SCENE_LAYOUT_SERVICE_ID);

  const tools = [
    new BackgroundTool(),
    new SizeTool(),
    new ImageTool(),
    // new FilmTool(),
    new WhiteInkTool(),
    // new MirrorTool(),
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
  pooder.eventBus.off("image:state:change", onImageStateChangeEvent);
  pooder.eventBus.off("image:session:notice", onImageSessionNoticeEvent);
  pooder.extensionManager.destroy();
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
