<template>
  <div class="pooder-editor">
    <ToolPanel />
    <CanvasArea @canvas-ready="onCanvasReady" />
  </div>
</template>

<script setup lang="ts">
import { provide, onUnmounted } from "vue";
import { Pooder } from "@pooder/core";
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

const onCanvasReady = (canvasEl: HTMLCanvasElement) => {
  const canvasService = new CanvasService(canvasEl);

  pooder.registerService(canvasService);

  const tools = [
    new BackgroundTool(),
    new RulerTool(),
    new DielineTool(),
    new FilmTool(),
    new ImageTool(),
    new WhiteInkTool(),
    new MirrorTool(),
    new HoleTool(),
  ];

  tools.forEach((tool) => {
    pooder.extensionManager.register(tool);
  });

  const svc=pooder.getService<CanvasService>("CanvasService")

  console.log(svc!.canvas.getObjects())
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
