<template>
  <div class="custom-activity-bar">
    <button
      v-for="tool in tools"
      :key="tool.id"
      type="button"
      class="tool-btn"
      :class="{ active: activeTool === tool.id }"
      @click="activate(tool.id)"
    >
      {{ tool.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { usePooderRuntime } from "@pooder/vue";

const runtime = usePooderRuntime();
const activeTool = ref("");

const tools = [
  { id: "pooder.kit.size", label: "Size" },
  { id: "pooder.kit.image", label: "Image" },
  { id: "pooder.kit.white-ink", label: "White Ink" },
  { id: "pooder.kit.dieline", label: "Dieline" },
  { id: "pooder.kit.feature", label: "Hole" },
];

const activate = (id: string) => {
  if (activeTool.value === id) {
    runtime.eventBus.emit("tool:clicked", { id });
  }
  void runtime.workbench.activate(id);
};

const updateActiveTool = (event: { id: string | null }) => {
  activeTool.value = event.id || "";
};

onMounted(() => {
  runtime.eventBus.on("tool:activated", updateActiveTool);
  activeTool.value = runtime.workbench.activeToolId || "";
});

onUnmounted(() => {
  runtime.eventBus.off("tool:activated", updateActiveTool);
});
</script>

<style scoped>
.custom-activity-bar {
  position: absolute;
  right: 20px;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.92);
  padding: 10px;
  border-radius: 12px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.14);
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 100;
}

.tool-btn {
  padding: 10px 20px;
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #f8fafc;
  text-align: center;
  user-select: none;
  font-weight: 600;
}

.tool-btn:hover {
  background: #eef2ff;
}

.tool-btn.active {
  background: #0f172a;
  color: white;
}
</style>
