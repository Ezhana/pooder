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
  type BrowserHostRuntime,
} from "@pooder/platform-browser";
import {
  getPooderRuntimeCore,
  usePooderRuntime,
  type PooderRuntime,
} from "./runtime";
import type {
  PooderCanvasHostReadyPayload,
  PooderCanvasHostRenderSyncPayload,
} from "./canvas-host";

const props = defineProps<{
  runtime?: PooderRuntime;
}>();

const emit = defineEmits<{
  (e: "ready", payload: PooderCanvasHostReadyPayload): void;
  (e: "render-sync-change", payload: PooderCanvasHostRenderSyncPayload): void;
}>();

const injectedRuntime = props.runtime ? null : usePooderRuntime();
const container = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);

let browserHost: BrowserHostAttachment | null = null;
let renderSyncFrame = 0;
let stopRenderSyncStateChange: null | (() => void) = null;

function getRuntime(): PooderRuntime {
  return props.runtime ?? injectedRuntime!;
}

function waitForNextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function emitRenderSyncChange(payload: PooderCanvasHostRenderSyncPayload) {
  if (renderSyncFrame) {
    window.cancelAnimationFrame(renderSyncFrame);
    renderSyncFrame = 0;
  }

  if (payload.syncing) {
    emit("render-sync-change", payload);
    return;
  }

  renderSyncFrame = window.requestAnimationFrame(() => {
    renderSyncFrame = 0;
    emit("render-sync-change", payload);
  });
}

onMounted(() => {
  if (!container.value || !canvas.value) {
    return;
  }

  const runtime = getRuntime();
  browserHost = attachBrowserHost(
    getPooderRuntimeCore(runtime) as BrowserHostRuntime,
    {
      canvas: canvas.value,
      container: container.value,
    },
  );

  const host = browserHost;
  stopRenderSyncStateChange = host.fabricRenderGraphAdapter.onSyncStateChange(
    (state) => {
      emitRenderSyncChange({
        causes: state.causes,
        ...(state.error === undefined ? {} : { error: state.error }),
        generation: state.generation,
        invalidations: state.invalidations,
        pending: state.pending,
        syncing: state.syncing,
      });
    },
    { immediate: true },
  );

  emit("ready", {
    flushRender: async () => {
      await host.fabricRenderGraphAdapter.flush();
      await waitForNextAnimationFrame();
    },
  });
});

onUnmounted(() => {
  stopRenderSyncStateChange?.();
  stopRenderSyncStateChange = null;
  if (renderSyncFrame) {
    window.cancelAnimationFrame(renderSyncFrame);
    renderSyncFrame = 0;
  }
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
