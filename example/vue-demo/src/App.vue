<script setup lang="ts">
import { ref } from "vue";
import { PooderEditor } from "@pooder/vue";

const editorRef = ref<any>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const handleImport = () => {
  if (editorRef.value) {
    // Example: Import a circular dieline configuration
    editorRef.value.importConfig({
      "dieline.shape": "circle",
      "dieline.width": 400,
      "dieline.height": 400,
      "dieline.offset": 20,
      "dieline.holes": [],
    });
  }
};

const handleExport = () => {
  if (editorRef.value) {
    const config = editorRef.value.exportConfig();
    console.log("Exported Config:", config);
    alert("Configuration exported to console");
  }
};

const handleGenerateImage = async () => {
  if (editorRef.value) {
    const url = await editorRef.value.generateCutImage();
    if (url) {
      console.log("Generated Image:", url);
      const win = window.open();
      if (win) {
        win.document.write(`<img src="${url}" style="max-width: 100%"/>`);
      }
    }
  }
};

const handleUploadClick = () => {
  fileInput.value?.click();
};

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file && editorRef.value) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      editorRef.value.addImage(url);
    };
    reader.readAsDataURL(file);
  }
  // Reset input so same file can be selected again
  target.value = "";
};
</script>

<template>
  <div class="app-container">
    <header>
      <h1>Pooder Editor Demo</h1>
      <div class="actions">
        <button @click="handleUploadClick">Upload Image</button>
        <button @click="handleImport">Import Demo Config</button>
        <button @click="handleExport">Export Config</button>
        <button @click="handleGenerateImage">Generate Cut Image</button>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          style="display: none"
          @change="handleFileChange"
        />
      </div>
    </header>
    <main class="editor-wrapper">
      <PooderEditor ref="editorRef" />
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
  overflow: hidden; /* Prevent body scroll */
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

header {
  flex: 0 0 auto;
  padding: 0 20px;
  background-color: #2c3e50;
  color: white;
  display: flex;
  align-items: center;
  height: 50px;
}

h1 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 500;
}

.editor-wrapper {
  flex: 1 1 auto;
  position: relative;
  overflow: hidden;
}

.actions {
  margin-left: auto;
  display: flex;
  gap: 10px;
}

button {
  padding: 6px 12px;
  background-color: #34495e;
  color: white;
  border: 1px solid #4fc08d;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background-color 0.2s;
}

button:hover {
  background-color: #4fc08d;
  color: #2c3e50;
}
</style>
