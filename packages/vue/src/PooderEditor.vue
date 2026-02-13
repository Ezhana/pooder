<template>
  <div class="pooder-editor">
    <!--    <ToolPanel />-->
    <CanvasArea @canvas-ready="onCanvasReady" @resize="onResize" />
    <!--    <div>-->
    <!--      <button-->
    <!--        @click="-->
    <!--          console.log(cfgSvc.export());-->
    <!--          console.log(JSON.stringify(cfgSvc.export()));-->
    <!--        "-->
    <!--      >-->
    <!--        export-->
    <!--      </button>-->
    <!--      &lt;!&ndash;          <button @click="handleImport">import</button>&ndash;&gt;-->
    <!--    </div>-->
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
  SceneViewService,
} from "@pooder/kit";
import ToolPanel from "./components/ToolPanel.vue";
import CanvasArea from "./components/CanvasArea.vue";

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

const generateCutImage = async () => {
  return await cmdSvc.executeCommand("exportCutImage");
};

const upsertImage = async (
  url: string,
  options?: {
    id?: string;
    mode?: "auto" | "replace" | "add";
    createIfMissing?: boolean;
    addOptions?: any;
    fitOnAdd?: boolean;
  },
) => {
  const result = await cmdSvc.executeCommand("upsertImage", url, {
    id: options?.id,
    mode: options?.mode,
    createIfMissing: options?.createIfMissing,
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

const IMAGE_OBJECT_LAYER_ID = "image.user";

const clampNormalized = (value: number): number => {
  return Math.max(-1, Math.min(2, value));
};

const toFrameRect = (geo: any): FrameRect | null => {
  const width = Number(geo?.width);
  const height = Number(geo?.height);
  const centerX = Number(geo?.x);
  const centerY = Number(geo?.y);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(centerX) ||
    !Number.isFinite(centerY) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
  };
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

const applyDetectedDielineConfig = (result: DetectEdgeResult) => {
  cfgSvc.update("dieline.shape", "custom");
  cfgSvc.update("dieline.pathData", result.pathData);
  cfgSvc.update("dieline.offset", 0);
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
) => {
  if (!snapshots.length) return;

  const geo = await cmdSvc.executeCommand("getGeometry");
  const frame = toFrameRect(geo);
  if (!frame) return;

  const { shiftX, shiftY } = computeDetectAlignmentShift(result, frame);

  if (debug) {
    console.info("[PooderEditor] detectDieline alignment", {
      frame,
      shiftX,
      shiftY,
      snapshotCount: snapshots.length,
      baseBounds: result.baseBounds,
      rawBounds: result.rawBounds,
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
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

    await cmdSvc.executeCommand("updateImage", snapshot.id, {
      scale: targetScale,
      left,
      top,
    });
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
    debug?: boolean;
  };
  commit?: boolean;
}) => {
  const debug = options?.detect?.debug === true;
  const canvasService = pooder.getService<CanvasService>("CanvasService");
  const snapshots = snapshotImageRenderStates(canvasService);

  const { url } = await cmdSvc.executeCommand("exportImageFrameUrl", {
    multiplier: 2,
    format: "png",
  });

  try {
    const result = (await cmdSvc.executeCommand("detectEdge", url, {
      expand: options?.detect?.expand ?? 30,
      smoothing: options?.detect?.smoothing ?? true,
      simplifyTolerance: options?.detect?.simplifyTolerance ?? 2,
      debug,
    })) as DetectEdgeResult | null;

    if (!result) return null;

    if (options?.commit === false) {
      return result;
    }

    applyDetectedDielineConfig(result);
    await compensateImagesForDetectedDieline(result, snapshots, debug);

    return result;
  } finally {
    if (url) URL.revokeObjectURL(url);
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

  const tools = [
    new BackgroundTool(),
    new SceneViewService(),
    new ImageTool(),
    // new FilmTool(),
    // new WhiteInkTool(),
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
    canvasService.canvas.setDimensions({ width, height });
  }
};

onUnmounted(() => {
  const canvasService = pooder.getService<CanvasService>("CanvasService");
  if (canvasService) {
    canvasService.dispose();
  }

  configDisposable.dispose();
  pooder.extensionManager.destroy();
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
