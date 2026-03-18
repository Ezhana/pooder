<template>
  <div class="custom-activity-bar">
    <div 
      v-for="tool in tools" 
      :key="tool.id"
      class="tool-btn"
      :class="{ active: activeTool === tool.id }"
      @click="activate(tool.id)"
    >
      {{ tool.label }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onUnmounted, watch } from "vue";
import type { PooderEditorExposed } from "@pooder/vue";

const props = defineProps<{
  editor: PooderEditorExposed | null;
}>();

const editor = computed(() => {
  const e = props.editor;
  if (e && typeof e === "object" && "value" in e) return e.value;
  return e;
});

const activeTool = ref("");

const tools = [
  { id: "pooder.kit.size", label: "Size" },
  { id: "pooder.kit.image", label: "Image" },
  { id: "pooder.kit.white-ink", label: "White Ink" },
  { id: "pooder.kit.dieline", label: "Dieline" },
  { id: "pooder.kit.feature", label: "Hole" },
];

const activate = (id: string) => {
  if (editor.value) {
    void editor.value.activateTool(id);
  }
};

const updateActiveTool = (event: { id: string | null }) => {
  activeTool.value = event.id || "";
};

watch(
  editor,
  (nextEditor, previousEditor) => {
    if (previousEditor) {
      previousEditor.off("tool:activated", updateActiveTool);
    }
    if (nextEditor) {
      nextEditor.on("tool:activated", updateActiveTool);
      if (nextEditor.services && nextEditor.services.workbench) {
        activeTool.value = nextEditor.services.workbench.activeToolId || "";
      }
    } else {
      activeTool.value = "";
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (editor.value) {
    editor.value.off("tool:activated", updateActiveTool);
  }
});
</script>

<style scoped>
.custom-activity-bar {
  position: absolute;
  right: 20px;
  top: 50%;
  transform: translateY(-50%);
  background: white;
  padding: 10px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 100;
}

.tool-btn {
  padding: 10px 20px;
  cursor: pointer;
  border-radius: 4px;
  background: #f0f0f0;
  text-align: center;
  user-select: none;
}

.tool-btn:hover {
  background: #e0e0e0;
}

.tool-btn.active {
  background: #007bff;
  color: white;
}
</style>
