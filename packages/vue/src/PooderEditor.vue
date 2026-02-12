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

const fitImageToDefaultArea = async (id: string) => {
  // Auto-fit to dieline if exists
  const geo = await cmdSvc.executeCommand("getGeometry");
  const canvasService = pooder.getService<CanvasService>("CanvasService");

  if (geo && canvasService) {
    const canvasW = canvasService.canvas.width;
    const canvasH = canvasService.canvas.height;

    // Get physical bleed offset (mm)
    const dielineOffset = cfgSvc.get("dieline.offset") || 0;

    // Convert physical bleed to visual pixels using dieline's scale
    const visualOffset = dielineOffset * geo.scale;

    // Target dimensions in pixels
    const targetWidth = geo.width + 2 * visualOffset;
    const targetHeight = geo.height + 2 * visualOffset;

    // Normalized center coordinates (0-1)
    const left = geo.x / canvasW;
    const top = geo.y / canvasH;

    await cmdSvc.executeCommand("fitImageToArea", id, {
      width: targetWidth,
      height: targetHeight,
      left,
      top,
    });
  } else if (canvasService) {
    // Default: Fit to canvas center if no dieline
    await cmdSvc.executeCommand("fitImageToArea", id, {
      width: canvasService.canvas.width,
      height: canvasService.canvas.height,
      left: 0.5,
      top: 0.5,
    });
  }
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
  });

  if (result?.mode === "add" && options?.fitOnAdd !== false) {
    await fitImageToDefaultArea(result.id);
  }

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

const detectDieline = async (url: string) => {
  const result = await cmdSvc.executeCommand("detectEdge", url, {
    expand: 10, // 安全距离（像素）
    smoothing: true, // 是否平滑
    simplifyTolerance: 2, // 平滑度容差，值越大越圆润
  });
  if (result) {
    const {
      pathData,
      width,
      height,
      rawBounds,
      baseBounds,
      imageWidth,
      imageHeight,
    } = result;
    cfgSvc.update("dieline.shape", "custom");
    cfgSvc.update("dieline.pathData", pathData);
    cfgSvc.update("dieline.width", width);
    cfgSvc.update("dieline.height", height);
    cfgSvc.update("dieline.offset", 0);

    // Auto-align image to the detected dieline
    const alignBounds = baseBounds || rawBounds;
    if (alignBounds && imageWidth && imageHeight) {
      const canvasService = pooder.getService<CanvasService>("CanvasService");
      const images = cfgSvc.get("image.items") || [];
      const targetImage = images.find((img: any) => img.url === url);

      if (canvasService && targetImage) {
        // Get updated geometry (which includes the new viewport scale)
        const geo = await cmdSvc.executeCommand("getGeometry");

        if (geo) {
          // Calculate scale to match the dieline's visual width
          const ratio = geo.width / alignBounds.width;

          // Calculate offset of the object center from the image center (original pixels)
          const imgCenterX = imageWidth / 2;
          const imgCenterY = imageHeight / 2;
          const objCenterX = alignBounds.x + alignBounds.width / 2;
          const objCenterY = alignBounds.y + alignBounds.height / 2;

          const deltaX = objCenterX - imgCenterX;
          const deltaY = objCenterY - imgCenterY;

          // Convert offset to screen pixels
          const screenDeltaX = deltaX * ratio;
          const screenDeltaY = deltaY * ratio;

          // Calculate new normalized position
          // We want the object center to be at the canvas center (0.5, 0.5)
          const canvasW = canvasService.canvas.width;
          const canvasH = canvasService.canvas.height;

          const newLeft = 0.5 - screenDeltaX / canvasW;
          const newTop = 0.5 - screenDeltaY / canvasH;

          await cmdSvc.executeCommand("updateImage", targetImage.id, {
            scale: ratio,
            left: newLeft,
            top: newTop,
          });
        }
      }
    }

    return pathData;
  }
  return null;
};

const detectDielineFromFrame = async (options?: {
  detect?: {
    expand?: number;
    smoothing?: boolean;
    simplifyTolerance?: number;
  };
  commit?: boolean;
}) => {
  const { url } = await cmdSvc.executeCommand("exportImageFrameUrl", {
    multiplier: 2,
    format: "png",
  });

  try {
    const result = await cmdSvc.executeCommand("detectEdge", url, {
      expand: options?.detect?.expand ?? 10,
      smoothing: options?.detect?.smoothing ?? true,
      simplifyTolerance: options?.detect?.simplifyTolerance ?? 2,
    });

    if (!result) return null;

    if (options?.commit === false) {
      return result;
    }

    const { pathData, width, height } = result;
    cfgSvc.update("dieline.shape", "custom");
    cfgSvc.update("dieline.pathData", pathData);
    cfgSvc.update("dieline.width", width);
    cfgSvc.update("dieline.height", height);
    cfgSvc.update("dieline.offset", 0);

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
  const imageId = await addImage(url);
  const result = await cmdSvc.executeCommand("detectEdge", url, {
    expand: options?.expand ?? 10,
    smoothing: options?.smoothing ?? true,
    simplifyTolerance: options?.simplifyTolerance ?? 2,
  });
  if (!result) return null;

  const {
    pathData,
    width,
    height,
    rawBounds,
    baseBounds,
    imageWidth,
    imageHeight,
  } = result;

  cfgSvc.update("dieline.shape", "custom");
  cfgSvc.update("dieline.pathData", pathData);
  cfgSvc.update("dieline.width", width);
  cfgSvc.update("dieline.height", height);
  cfgSvc.update("dieline.offset", 0);

  const alignBounds = baseBounds || rawBounds;
  if (alignBounds && imageWidth && imageHeight) {
    const canvasService = pooder.getService<CanvasService>("CanvasService");
    if (canvasService) {
      const geo = await cmdSvc.executeCommand("getGeometry");
      if (geo) {
        const ratio = geo.width / alignBounds.width;

        const imgCenterX = imageWidth / 2;
        const imgCenterY = imageHeight / 2;
        const objCenterX = alignBounds.x + alignBounds.width / 2;
        const objCenterY = alignBounds.y + alignBounds.height / 2;

        const deltaX = objCenterX - imgCenterX;
        const deltaY = objCenterY - imgCenterY;

        const screenDeltaX = deltaX * ratio;
        const screenDeltaY = deltaY * ratio;

        const canvasW = canvasService.canvas.width;
        const canvasH = canvasService.canvas.height;

        const newLeft = 0.5 - screenDeltaX / canvasW;
        const newTop = 0.5 - screenDeltaY / canvasH;

        await cmdSvc.executeCommand("updateImage", imageId, {
          scale: ratio,
          left: newLeft,
          top: newTop,
        });
      }
    }
  }

  return { imageId, url, pathData };
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
