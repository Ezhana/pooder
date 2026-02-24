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

<script setup>
import { ref, onUnmounted, watch } from 'vue';

const props = defineProps({
  editor: Object
});

const activeTool = ref('');

const tools = [
  { id: 'pooder.kit.image', label: 'Image' },
  { id: 'pooder.kit.white-ink', label: 'White Ink' },
  { id: 'pooder.kit.dieline', label: 'Dieline' },
  { id: 'pooder.kit.feature', label: 'Hole' }
];

const activate = (id) => {
  if (props.editor) {
    props.editor.activateTool(id);
  }
};

const updateActiveTool = (event) => {
    activeTool.value = event.id;
}

watch(() => props.editor, (editor) => {
    if (editor) {
        editor.on('tool:activated', updateActiveTool);
        if (editor.services && editor.services.workbench) {
             activeTool.value = editor.services.workbench.activeToolId;
        }
    }
}, { immediate: true });

onUnmounted(() => {
    if (props.editor) {
        props.editor.off('tool:activated', updateActiveTool);
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
