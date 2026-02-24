<script setup lang="ts">
import { ref, onMounted } from "vue";
import { PooderEditor } from "@pooder/vue";
import CustomActivityBar from "./components/CustomActivityBar.vue";
import CustomToolPanel from "./components/CustomToolPanel.vue";

const editorRef = ref<any>(null);
const currentCategory = ref("Acrylic Keychain");

onMounted(() => {
  if (editorRef.value) {
    editorRef.value.updateConfig("dieline.showBleedLines", false);
    editorRef.value.updateConfig("dieline.offsetStyle", "hidden");
    editorRef.value.updateConfig("size.actualWidthMm", 50);
    editorRef.value.updateConfig("size.actualHeightMm", 50);
  }
});

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
