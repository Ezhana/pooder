<template>
  <div ref="container" class="pooder-canvas-host">
    <canvas ref="canvas"></canvas>
  </div>
</template>

<script setup lang="ts">
import type { Pooder } from "@pooder/core";
import { onMounted, onUnmounted, ref } from "vue";
import { CanvasService, SceneLayoutService } from "@pooder/kit";
import { usePooderRuntime } from "./runtime";

const CANVAS_SERVICE_ID = "CanvasService";
const SCENE_LAYOUT_SERVICE_ID = "SceneLayoutService";

const props = defineProps<{
  runtime?: Pooder;
}>();

const emit = defineEmits<{
  (e: "ready"): void;
}>();

const injectedRuntime = props.runtime ? null : usePooderRuntime();
const container = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);

let resizeObserver: ResizeObserver | null = null;
let registeredRuntime: Pooder | null = null;
let canvasService: CanvasService | null = null;
let sceneLayoutService: SceneLayoutService | null = null;

function getRuntime(): Pooder {
  return props.runtime ?? injectedRuntime!;
}

onMounted(() => {
  if (!container.value || !canvas.value) {
    return;
  }

  const runtime = getRuntime();
  const width = container.value.clientWidth;
  const height = container.value.clientHeight;

  canvas.value.width = width;
  canvas.value.height = height;

  canvasService = new CanvasService(canvas.value, {
    eventBus: runtime.eventBus,
  });
  sceneLayoutService = new SceneLayoutService();
  runtime.services.register(canvasService, CANVAS_SERVICE_ID);
  runtime.services.register(sceneLayoutService, SCENE_LAYOUT_SERVICE_ID);
  registeredRuntime = runtime;

  emit("ready");

  resizeObserver = new ResizeObserver((entries) => {
    const currentCanvasService = canvasService;
    if (!currentCanvasService) {
      return;
    }

    for (const entry of entries) {
      const nextWidth = entry.contentRect.width;
      const nextHeight = entry.contentRect.height;
      currentCanvasService.resize(nextWidth, nextHeight);
    }
  });
  resizeObserver.observe(container.value);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;

  if (registeredRuntime && sceneLayoutService) {
    registeredRuntime.services.unregister(
      sceneLayoutService,
      SCENE_LAYOUT_SERVICE_ID,
    );
  }
  if (registeredRuntime && canvasService) {
    registeredRuntime.services.unregister(canvasService, CANVAS_SERVICE_ID);
  }

  sceneLayoutService = null;
  canvasService = null;
  registeredRuntime = null;
});
</script>

<style scoped>
.pooder-canvas-host {
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 650px;
  min-width: 650px;
  overflow: hidden;
  background: #ececec;
  position: relative;
}

canvas {
  display: block;
}
</style>
