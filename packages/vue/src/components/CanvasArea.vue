<template>
  <div ref="container" class="pooder-canvas-area">
    <canvas ref="canvas"></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

const emit = defineEmits<{
  (e: "canvas-ready", el: HTMLCanvasElement): void;
  (e: "resize", width: number, height: number): void;
}>();

const container = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (container.value && canvas.value) {
    const { clientWidth, clientHeight } = container.value;
    canvas.value.width = clientWidth;
    canvas.value.height = clientHeight;

    emit("canvas-ready", canvas.value);

    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        emit("resize", width, height);
      }
    });
    resizeObserver.observe(container.value);
  }
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
});
</script>

<style scoped>
.pooder-canvas-area {
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 650px;
  min-width: 650px;
  overflow: hidden;
  background: #f5f5f5;
  position: relative;
}

canvas {
  display: block;
}
</style>
