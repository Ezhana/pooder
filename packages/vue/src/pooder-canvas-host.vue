<template>
  <div ref="container" class="pooder-canvas-host">
    <canvas ref="canvas"></canvas>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import {
  attachBrowserHost,
  type BrowserHostAttachment,
} from "@pooder/platform-browser";
import { usePooderRuntime, type PooderRuntimeLike } from "./runtime";

const props = defineProps<{
  runtime?: PooderRuntimeLike;
}>();

const emit = defineEmits<{
  (e: "ready"): void;
}>();

const injectedRuntime = props.runtime ? null : usePooderRuntime();
const container = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);

let browserHost: BrowserHostAttachment | null = null;

function getRuntime(): PooderRuntimeLike {
  return props.runtime ?? injectedRuntime!;
}

onMounted(() => {
  if (!container.value || !canvas.value) {
    return;
  }

  const runtime = getRuntime();
  browserHost = attachBrowserHost(runtime as any, {
    canvas: canvas.value,
    container: container.value,
  });

  emit("ready");
});

onUnmounted(() => {
  browserHost?.dispose();
  browserHost = null;
});
</script>

<style scoped>
.pooder-canvas-host {
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: #ececec;
  position: relative;
}

canvas {
  display: block;
}
</style>
