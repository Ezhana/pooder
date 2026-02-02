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
import { CommandService, ConfigurationService, Pooder } from "@pooder/core";
import {
  CanvasService,
  BackgroundTool,
  RulerTool,
  DielineTool,
  FilmTool,
  HoleTool,
  ImageTool,
  WhiteInkTool,
  MirrorTool,
} from "@pooder/kit";
import ToolPanel from "./components/ToolPanel.vue";
import CanvasArea from "./components/CanvasArea.vue";

const pooder = new Pooder();
provide("pooder", pooder);
const cmdSvc = pooder.getService<CommandService>("CommandService")!;
const cfgSvc = pooder.getService<ConfigurationService>("ConfigurationService")!;

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

const addImage = async (url: string, options?: any) => {
  const id = await cmdSvc.executeCommand("addImage", url, options);

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

  return id;
};

const updateImage = async (id: string, options?: any) => {
  return await cmdSvc.executeCommand("updateImage", id, options);
};

const clearImages = async () => {
  return await cmdSvc.executeCommand("clearImages");
};

const detectDieline = async (url: string) => {
  const pathData = await cmdSvc.executeCommand("detectEdge", url, {
    expand: 10, // 安全距离（像素）
    smoothing: true, // 是否平滑
    simplifyTolerance: 2, // 平滑度容差，值越大越圆润
  });
  if (pathData) {
    cfgSvc.update("dieline.shape", "custom");
    cfgSvc.update("dieline.pathData", pathData);
  }
  return pathData;
};

defineExpose({
  importConfig,
  exportConfig,
  getImages,
  generateCutImage,
  addImage,
  updateImage,
  clearImages,
  detectDieline,
});

const onCanvasReady = (canvasEl: HTMLCanvasElement) => {
  const canvasService = new CanvasService(canvasEl);

  pooder.registerService(canvasService, "CanvasService");

  const tools = [
    new BackgroundTool(),
    new ImageTool(),
    // new FilmTool(),
    // new WhiteInkTool(),
    new MirrorTool(),
    new DielineTool(),
    new RulerTool(),
    new HoleTool(),
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
