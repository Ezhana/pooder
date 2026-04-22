<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Pooder } from "@pooder/core";
import {
  BackgroundTool,
  DielineTool,
  DielineWorkflowExtension,
  FeatureTool,
  ImageTool,
  RulerTool,
  SizeTool,
  WhiteInkTool,
  hasAnyImageInViewState,
  type ImageViewState,
} from "@pooder/kit";
import {
  PooderCanvasHost,
  PooderRuntimeProvider,
} from "@pooder/vue";
import CustomActivityBar from "./components/CustomActivityBar.vue";
import CustomToolPanel from "./components/CustomToolPanel.vue";
import {
  CATEGORY_TEMPLATE_MAP,
  getTemplateConfig,
} from "./constants/productTemplates";

const runtime = new Pooder();
runtime.extensions.registerMany([
  new BackgroundTool(),
  new SizeTool(),
  new ImageTool(),
  new WhiteInkTool(),
  new DielineTool(),
  new RulerTool(),
  new FeatureTool(),
  new DielineWorkflowExtension(),
]);

const currentCategory = ref("Thick Acrylic Keychains");
const runtimeReady = ref(false);
const imageSummary = ref("No image loaded");

const categories = computed(() => Object.keys(CATEGORY_TEMPLATE_MAP).sort());

const cloneConfigValue = (value: any) => {
  if (value && typeof value === "object") {
    return JSON.parse(JSON.stringify(value));
  }
  return value;
};

const applyCategoryTemplate = () => {
  const config = getTemplateConfig(currentCategory.value);
  Object.entries(config || {}).forEach(([key, value]) => {
    runtime.config.update(key, cloneConfigValue(value));
  });
  runtime.config.update("dieline.showBleedLines", false);
  runtime.config.update("dieline.offsetStyle", "hidden");
  runtime.config.update("size.actualWidthMm", 50);
  runtime.config.update("size.actualHeightMm", 50);
};

const handleImageStateChange = (state: ImageViewState) => {
  imageSummary.value = hasAnyImageInViewState(state)
    ? `${state.items.length} image(s) loaded`
    : "No image loaded";
};

const handleCanvasHostReady = async () => {
  await runtime.extensions.flushActivation();
  runtimeReady.value = true;
  applyCategoryTemplate();
  const state = await runtime.commands.execute<ImageViewState>("getImageViewState");
  handleImageStateChange(state);
};

watch(currentCategory, () => {
  applyCategoryTemplate();
});

onMounted(() => {
  runtime.eventBus.on("image:state:change", handleImageStateChange);
});

onUnmounted(() => {
  runtime.eventBus.off("image:state:change", handleImageStateChange);
  void runtime.dispose();
});
</script>

<template>
  <div class="app-container">
    <header class="demo-header">
      <label class="demo-header__field">
        <span>Template</span>
        <select v-model="currentCategory">
          <option v-for="category in categories" :key="category" :value="category">
            {{ category }}
          </option>
        </select>
      </label>
      <p class="demo-header__summary">{{ imageSummary }}</p>
      <p class="demo-header__status">
        {{ runtimeReady ? "Runtime ready" : "Mounting runtime..." }}
      </p>
    </header>

    <PooderRuntimeProvider :runtime="runtime">
      <main class="editor-wrapper">
        <PooderCanvasHost class="editor-wrapper__canvas" @ready="handleCanvasHostReady" />
        <CustomActivityBar />
        <CustomToolPanel :category="currentCategory" :ready="runtimeReady" />
      </main>
    </PooderRuntimeProvider>
  </div>
</template>

<style>
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
  background: #f4f3ef;
}

.demo-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.12);
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(12px);
}

.demo-header__field {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
}

.demo-header__field select {
  min-width: 220px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.16);
  background: white;
}

.demo-header__summary,
.demo-header__status {
  margin: 0;
  font-size: 13px;
  color: #475569;
}

.editor-wrapper {
  flex: 1 1 auto;
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
}

.editor-wrapper__canvas {
  height: 100%;
}
</style>
