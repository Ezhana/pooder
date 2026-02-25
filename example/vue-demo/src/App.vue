<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { PooderEditor } from "@pooder/vue";
import CustomActivityBar from "./components/CustomActivityBar.vue";
import CustomToolPanel from "./components/CustomToolPanel.vue";
import { getTemplateConfig } from "./constants/productTemplates";

const editorRef = ref<any>(null);
const currentCategory = ref("Thick Acrylic Keychains");

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
  (editor) => {
    if (editor) applyCategoryTemplate();
  },
  { immediate: true },
);

const handleImageChange = (images: any[]) => {
  console.log("Images Changed (App.vue):", images);
};
</script>

<template>
  <div class="app-container">
    <main class="editor-wrapper">
      <PooderEditor ref="editorRef" @image-change="handleImageChange" />
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
