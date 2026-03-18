<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import {
  hasAnyImageInViewState,
  PooderEditor,
  type ImageViewState,
  type PooderEditorExposed,
} from "@pooder/vue";
import CustomActivityBar from "./components/CustomActivityBar.vue";
import CustomToolPanel from "./components/CustomToolPanel.vue";
import { getTemplateConfig } from "./constants/productTemplates";

const editorRef = ref<PooderEditorExposed | null>(null);
const currentCategory = ref("Thick Acrylic Keychains");
let stopImageStateSubscription: (() => void) | null = null;

const cloneConfigValue = (value: any) => {
  if (value && typeof value === "object") {
    return JSON.parse(JSON.stringify(value));
  }
  return value;
};

const applyCategoryTemplate = () => {
  if (!editorRef.value) return;
  const config = getTemplateConfig(currentCategory.value);
  Object.entries(config || {}).forEach(([key, value]) => {
    editorRef.value.updateConfig(key, cloneConfigValue(value));
  });
};

onMounted(() => {
  if (editorRef.value) {
    applyCategoryTemplate();
    editorRef.value.updateConfig("dieline.showBleedLines", false);
    editorRef.value.updateConfig("dieline.offsetStyle", "hidden");
    editorRef.value.updateConfig("size.actualWidthMm", 50);
    editorRef.value.updateConfig("size.actualHeightMm", 50);
  }
});

watch(currentCategory, () => {
  applyCategoryTemplate();
});

watch(
  editorRef,
  async (editor) => {
    stopImageStateSubscription?.();
    stopImageStateSubscription = null;

    if (!editor) return;

    applyCategoryTemplate();

    const state = await editor.getImageState();
    handleImageStateChange(state);
    stopImageStateSubscription = editor.onImageStateChange(
      handleImageStateChange,
    );
  },
  { immediate: true },
);

onUnmounted(() => {
  stopImageStateSubscription?.();
  stopImageStateSubscription = null;
});

const handleImageStateChange = (state: ImageViewState) => {
  console.log("Image State Changed (App.vue):", state);
  console.log("Has Any Image:", hasAnyImageInViewState(state));
};
</script>

<template>
  <div class="app-container">
    <main class="editor-wrapper">
      <PooderEditor ref="editorRef" />
      <CustomActivityBar :editor="editorRef" />
      <CustomToolPanel :editor="editorRef" :category="currentCategory" />
    </main>
  </div>
</template>

<style>
/* Global reset for full height */
html,
body,
#app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
}

.editor-wrapper {
  flex: 1 1 auto;
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
}
</style>
