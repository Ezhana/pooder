<template>
  <div class="canvas-area">
    <div class="canvas-wrapper">
      <canvas ref="canvasRef"></canvas>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  onMounted,
  onBeforeUnmount,
  ref,
  PropType,
} from "vue";
import { PooderEditor } from "@pooder/core";

export default defineComponent({
  name: "CanvasArea",
  props: {
    width: {
      type: Number,
      required: true,
    },
    height: {
      type: Number,
      required: true,
    },
  },
  emits: ["init"],
  setup(props, { emit }) {
    const canvasRef = ref<HTMLCanvasElement | null>(null);
    let editor: PooderEditor | null = null;

    onMounted(() => {
      if (canvasRef.value) {
        // Explicitly set canvas dimensions
        canvasRef.value.width = props.width;
        canvasRef.value.height = props.height;

        editor = new PooderEditor(canvasRef.value, {
          width: props.width,
          height: props.height,
        });

        emit("init", editor);
      }
    });

    onBeforeUnmount(() => {
      if (editor) {
        editor.destroy();
      }
    });

    return {
      canvasRef,
    };
  },
});
</script>

<style scoped>
.canvas-area {
  flex: 1;
  background: #e0e0e0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 20px;
}

.canvas-wrapper {
  background: white;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
}
</style>
