<template>
  <div class="pooder-editor">
    <ToolPanel />
    <CanvasArea @canvas-ready="onCanvasReady" @resize="onResize" />
    <div>
      <button
        @click="
          console.log(cfgSvc.export());
          console.log(JSON.stringify(cfgSvc.export()));
        "
      >
        export
      </button>
      <!--          <button @click="handleImport">import</button>-->
    </div>
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
const cvsSvc = pooder.getService<CanvasService>("CanvasService")!;
const cmdSvc = pooder.getService<CommandService>("CommandService")!;
const cfgSvc = pooder.getService<ConfigurationService>("ConfigurationService")!;

const importConfig = (config: Record<string, any>) => {
  cfgSvc.import(config);
};

const exportConfig = () => {
  return cfgSvc.export();
};

const generateCutImage = async () => {
  return await cmdSvc.executeCommand("exportCutImage");
};

const setUserImage = async (url: string) => {
  return await cmdSvc.executeCommand("setUserImage", url, 1);
};

defineExpose({
  importConfig,
  exportConfig,
  generateCutImage,
  setUserImage,
});

const onCanvasReady = (canvasEl: HTMLCanvasElement) => {
  const canvasService = new CanvasService(canvasEl);

  pooder.registerService(canvasService, "CanvasService");

  const tools = [
    new BackgroundTool(),
    new MirrorTool(),
    // new FilmTool(),
    // new WhiteInkTool(),
    new DielineTool(),
    new RulerTool(),
    new ImageTool(),
    new HoleTool(),
  ];

  tools.forEach((tool) => {
    pooder.extensionManager.register(tool);
  });

  // cmdSvc?.executeCommand("image-tool.load-from-json", {})
  // console.log(cmdSvc.getCommands());
  // const res=cmdSvc.executeCommand("detectEdge","https://krakra.fan/api/minio/creation/1788f6aeb4444afe83cffd7703edc22a?f=png&w=2048&h=1190")
  // const res=cmdSvc.executeCommand("detectEdge","https://www.krakra.fan/api/minio/creation-cover/c8e2167d6e27411c8caf3ab0fb2a7ffc?f=webp&w=2480&h=3508")
  // const res=cmdSvc.executeCommand("detectEdge","https://www.krakra.fan/api/minio/creation-cover/3481c73176e1429f9ece1fcdb46a103b?f=webp&w=1080&h=1620")
  // res.then(r=>{
  //   cfgSvc.update("dieline.shape", "custom");
  //   cfgSvc.update("dieline.pathData", r);
  // })
  // console.log(cvsSvc!.canvas.getObjects());
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
