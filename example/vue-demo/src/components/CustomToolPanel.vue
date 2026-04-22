<template>
  <aside class="tool-panel">
    <section class="panel-section">
      <h3>Runtime</h3>
      <p>{{ ready ? "Ready" : "Waiting for canvas host..." }}</p>
      <p>Active tool: {{ activeToolId || "none" }}</p>
      <p>Images: {{ imageViewState.items.length }}</p>
    </section>

    <section class="panel-section">
      <h3>Image</h3>
      <input
        ref="imageInput"
        accept="image/*"
        class="sr-only"
        type="file"
        @change="handleImageUpload"
      />
      <div class="panel-actions">
        <button type="button" @click="openImageUpload">Upload image</button>
        <button type="button" @click="applyImageOperation('cover')">Cover</button>
        <button type="button" @click="applyImageOperation('contain')">Contain</button>
        <button type="button" @click="completeImages">Complete</button>
        <button type="button" @click="clearImages">Clear</button>
      </div>
      <label>
        <span>Scale</span>
        <input v-model.number="imageState.scale" min="0.1" step="0.1" type="number" />
      </label>
      <label>
        <span>Angle</span>
        <input v-model.number="imageState.angle" step="1" type="number" />
      </label>
      <button type="button" @click="applyImageTransform">Apply transform</button>
    </section>

    <section class="panel-section">
      <h3>White Ink</h3>
      <input
        ref="whiteInkInput"
        accept="image/*"
        class="sr-only"
        type="file"
        @change="handleWhiteInkUpload"
      />
      <div class="panel-actions">
        <button type="button" @click="whiteInkInput?.click()">Upload white ink</button>
        <button type="button" @click="completeWhiteInk">Complete</button>
        <button type="button" @click="clearWhiteInk">Clear</button>
      </div>
      <label class="checkbox-row">
        <input
          v-model="whiteInkState.printWithWhiteInk"
          type="checkbox"
          @change="toggleWhiteInkPrint"
        />
        <span>Print with white ink</span>
      </label>
      <label class="checkbox-row">
        <input
          :checked="whiteInkState.previewImageVisible"
          type="checkbox"
          @change="toggleWhiteInkPreview"
        />
        <span>Show preview image</span>
      </label>
    </section>

    <section class="panel-section">
      <h3>Dieline</h3>
      <div class="panel-actions">
        <button type="button" @click="detectFromFrame">Detect from frame</button>
      </div>
      <label>
        <span>Shape</span>
        <select v-model="dielineShape" @change="updateDielineShape">
          <option value="rect">Rect</option>
          <option value="circle">Circle</option>
          <option value="ellipse">Ellipse</option>
          <option value="custom">Custom</option>
        </select>
      </label>
    </section>

    <section class="panel-section">
      <h3>Size</h3>
      <label>
        <span>Width (mm)</span>
        <input v-model.number="sizeState.width" min="1" step="0.1" type="number" />
      </label>
      <label>
        <span>Height (mm)</span>
        <input v-model.number="sizeState.height" min="1" step="0.1" type="number" />
      </label>
      <label>
        <span>Unit</span>
        <select v-model="sizeState.unit" @change="applySizeUnit">
          <option value="mm">mm</option>
          <option value="px">px</option>
          <option value="inch">inch</option>
        </select>
      </label>
      <div class="panel-actions">
        <button type="button" @click="applySizeDimensions">Apply size</button>
      </div>
    </section>

    <section class="panel-section">
      <h3>Features</h3>
      <label>
        <span>Preset</span>
        <select v-model="selectedPreset">
          <option v-for="preset in availablePresets" :key="preset.name" :value="preset.name">
            {{ preset.name }}
          </option>
        </select>
      </label>
      <div class="panel-actions">
        <button type="button" @click="applyFeaturePreset">Apply preset</button>
        <button type="button" @click="completeFeatures">Complete</button>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { type ImageViewState, hasAnyImageInViewState } from "@pooder/kit";
import { usePooderRuntime } from "@pooder/vue";
import {
  CATEGORY_TEMPLATE_MAP,
  HOLE_PRESETS,
  TEMPLATE_HOLE_PRESETS,
} from "../constants/productTemplates";

const props = defineProps<{
  category?: string;
  ready?: boolean;
}>();

type HolePreset = (typeof HOLE_PRESETS)[keyof typeof HOLE_PRESETS];

const runtime = usePooderRuntime();
const imageInput = ref<HTMLInputElement | null>(null);
const whiteInkInput = ref<HTMLInputElement | null>(null);
const activeToolId = ref("");
const imageViewState = ref<ImageViewState>({
  focusedItem: null,
  hasAnyImage: false,
  items: [],
});
const imageState = reactive({
  id: "",
  scale: 1,
  angle: 0,
});
const whiteInkState = reactive({
  id: "",
  printWithWhiteInk: true,
  previewImageVisible: true,
});
const sizeState = reactive({
  width: 50,
  height: 50,
  unit: "mm",
});
const dielineShape = ref("rect");
const selectedPreset = ref("");

const availablePresets = computed<HolePreset[]>(() => {
  const categoryName = props.category || "";
  let templateType = CATEGORY_TEMPLATE_MAP[categoryName];
  if (!templateType && categoryName) {
    templateType = CATEGORY_TEMPLATE_MAP[categoryName.trim()];
  }
  if (!templateType) {
    return [];
  }

  const allowedKeys = TEMPLATE_HOLE_PRESETS[templateType] || [];
  return allowedKeys
    .map((key) => HOLE_PRESETS[key as keyof typeof HOLE_PRESETS])
    .filter(Boolean);
});

const executeCommand = async <T = unknown,>(id: string, ...args: any[]) => {
  return await runtime.commands.execute<T>(id, ...args);
};

const syncImageState = async () => {
  try {
    const state = await executeCommand<ImageViewState>("getImageViewState");
    imageViewState.value = state;
    const focusedItem =
      state.focusedItem || (hasAnyImageInViewState(state) ? state.items[0] : null);
    imageState.id = focusedItem?.id || "";
    imageState.scale = Number(focusedItem?.scale ?? 1);
    imageState.angle = Number(focusedItem?.angle ?? 0);
  } catch (error) {
    console.error("Failed to sync image state", error);
  }
};

const syncWhiteInkState = async () => {
  try {
    const settings = await executeCommand<{
      id?: string | null;
      printWithWhiteInk?: boolean;
      previewImageVisible?: boolean;
    }>("getWhiteInkSettings");
    whiteInkState.id = String(settings?.id || "");
    whiteInkState.printWithWhiteInk = settings?.printWithWhiteInk !== false;
    whiteInkState.previewImageVisible = settings?.previewImageVisible !== false;
  } catch (error) {
    console.error("Failed to sync white ink state", error);
  }
};

const syncSizeState = async () => {
  try {
    const state = await executeCommand<{
      actualWidthMm?: number;
      actualHeightMm?: number;
      unit?: string;
    }>("getSizeState");
    sizeState.width = Number(state?.actualWidthMm ?? sizeState.width);
    sizeState.height = Number(state?.actualHeightMm ?? sizeState.height);
    sizeState.unit = String(state?.unit || sizeState.unit);
  } catch (error) {
    console.error("Failed to sync size state", error);
  }
};

const syncDielineShape = () => {
  dielineShape.value = String(runtime.config.get("dieline.shape", "rect"));
};

const openImageUpload = async () => {
  await runtime.workbench.activate("pooder.kit.image");
  imageInput.value?.click();
};

const handleImageUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) {
    return;
  }

  const url = URL.createObjectURL(file);
  try {
    await executeCommand("upsertImage", url, {
      id: imageState.id || undefined,
      mode: imageState.id ? "replace" : "add",
      operation: { type: "cover" },
    });
    await syncImageState();
    if (imageState.id) {
      await executeCommand("focusImage", imageState.id, {
        syncCanvasSelection: true,
      });
    }
  } finally {
    URL.revokeObjectURL(url);
    if (input) {
      input.value = "";
    }
  }
};

const applyImageOperation = async (type: string) => {
  if (!imageState.id) {
    return;
  }
  await executeCommand("applyImageOperation", imageState.id, { type });
  await syncImageState();
};

const applyImageTransform = async () => {
  if (!imageState.id) {
    return;
  }
  await executeCommand("setImageTransform", imageState.id, {
    scale: imageState.scale,
    angle: imageState.angle,
  });
};

const completeImages = async () => {
  const result = await executeCommand<{ ok?: boolean }>("completeImages");
  if (result?.ok !== false) {
    await runtime.workbench.deactivate();
  }
};

const clearImages = async () => {
  await executeCommand("clearImages");
  await syncImageState();
};

const handleWhiteInkUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) {
    return;
  }

  const url = URL.createObjectURL(file);
  try {
    await executeCommand("setWhiteInkImage", url);
    await syncWhiteInkState();
  } finally {
    URL.revokeObjectURL(url);
    if (input) {
      input.value = "";
    }
  }
};

const toggleWhiteInkPrint = async () => {
  await executeCommand("setWhiteInkPrintEnabled", whiteInkState.printWithWhiteInk);
};

const toggleWhiteInkPreview = async () => {
  const nextVisible = !whiteInkState.previewImageVisible;
  await executeCommand("setWhiteInkPreviewImageVisible", nextVisible);
  whiteInkState.previewImageVisible = nextVisible;
};

const completeWhiteInk = async () => {
  const result = await executeCommand<{ ok?: boolean }>("completeWhiteInks");
  if (result?.ok) {
    await runtime.workbench.deactivate();
  }
};

const clearWhiteInk = async () => {
  await executeCommand("clearWhiteInks");
  await syncWhiteInkState();
};

const detectFromFrame = async () => {
  await executeCommand("detectDielineFromFrame", {
    inspect: { includeDiagnostics: true },
  });
  syncDielineShape();
};

const updateDielineShape = () => {
  runtime.config.update("dieline.shape", dielineShape.value);
};

const applySizeDimensions = async () => {
  await executeCommand("updateSizeDimensions", {
    actualWidthMm: sizeState.width,
    actualHeightMm: sizeState.height,
  });
};

const applySizeUnit = async () => {
  await executeCommand("setSizeDisplayUnit", sizeState.unit);
};

const applyFeaturePreset = async () => {
  if (!selectedPreset.value) {
    return;
  }
  const preset = availablePresets.value.find((item) => item.name === selectedPreset.value);
  if (!preset) {
    return;
  }

  runtime.config.update(
    "dieline.features",
    JSON.parse(JSON.stringify(preset.features)),
  );
  await executeCommand("beginFeatureSession");
  await runtime.workbench.activate("pooder.kit.feature");
};

const completeFeatures = async () => {
  const result = await executeCommand<{ ok?: boolean }>("completeFeatures");
  if (result?.ok) {
    await runtime.workbench.deactivate();
  }
};

const onToolActivated = (event: { id?: string | null }) => {
  activeToolId.value = String(event.id || "");
};

const onImageStateChange = (state: ImageViewState) => {
  imageViewState.value = state;
  const focusedItem =
    state.focusedItem || (hasAnyImageInViewState(state) ? state.items[0] : null);
  imageState.id = focusedItem?.id || "";
  imageState.scale = Number(focusedItem?.scale ?? 1);
  imageState.angle = Number(focusedItem?.angle ?? 0);
};

watch(
  availablePresets,
  (presets) => {
    if (!presets.length) {
      selectedPreset.value = "";
      return;
    }
    if (!presets.some((preset) => preset.name === selectedPreset.value)) {
      selectedPreset.value = presets[0]?.name || "";
    }
  },
  { immediate: true },
);

watch(
  () => props.category,
  () => {
    syncDielineShape();
    void syncSizeState();
  },
);

onMounted(() => {
  runtime.eventBus.on("tool:activated", onToolActivated);
  runtime.eventBus.on("image:state:change", onImageStateChange);
  activeToolId.value = runtime.workbench.activeToolId || "";
  syncDielineShape();
  void syncImageState();
  void syncWhiteInkState();
  void syncSizeState();
});

onUnmounted(() => {
  runtime.eventBus.off("tool:activated", onToolActivated);
  runtime.eventBus.off("image:state:change", onImageStateChange);
});
</script>

<style scoped>
.tool-panel {
  position: absolute;
  left: 16px;
  top: 16px;
  width: 320px;
  max-height: calc(100% - 32px);
  overflow: auto;
  padding: 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.15);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.panel-section:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.panel-section h3,
.panel-section p {
  margin: 0;
}

.panel-section label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

.panel-section input,
.panel-section select,
.panel-section button {
  font: inherit;
}

.panel-section input[type="number"],
.panel-section select {
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  background: white;
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.panel-actions button,
.panel-section > button {
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  background: #f8fafc;
  cursor: pointer;
}

.panel-actions button:hover,
.panel-section > button:hover {
  background: #eef2ff;
}

.checkbox-row {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
