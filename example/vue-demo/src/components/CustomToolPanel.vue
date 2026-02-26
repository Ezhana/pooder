<template>
  <div class="custom-tool-panel" v-if="currentMode">
    <div class="panel-header">
      {{ currentMode }} Settings
      <button class="close-btn" @click="closePanel">×</button>
    </div>

    <!-- Size Controls -->
    <div v-if="currentMode === 'Size'" class="controls">
      <div class="control-group">
        <label>Actual Size</label>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px">
          <input
            type="number"
            min="10"
            step="0.1"
            v-model.number="sizeState.width"
            @input="updateSizeByWidth"
          />
          <input
            type="number"
            min="10"
            step="0.1"
            v-model.number="sizeState.height"
            @input="updateSizeByHeight"
          />
        </div>
      </div>
      <div class="control-group">
        <label>Unit</label>
        <select v-model="sizeState.unit" @change="updateSizeUnit">
          <option value="mm">mm</option>
          <option value="cm">cm</option>
          <option value="in">in</option>
        </select>
      </div>
      <div class="control-group">
        <label>Constraint</label>
        <select
          v-model="sizeState.constraintMode"
          @change="updateSizeConstraint"
        >
          <option value="free">Free</option>
          <option value="lockAspect">Lock Aspect</option>
          <option value="equal">Equal</option>
        </select>
      </div>
      <div class="control-group">
        <label>Cut Mode</label>
        <select v-model="sizeState.cutMode" @change="updateSizeCut">
          <option value="trim">Trim</option>
          <option value="outset">Outset</option>
          <option value="inset">Inset</option>
        </select>
      </div>
      <div class="control-group">
        <label>Cut Margin (mm)</label>
        <input
          type="number"
          min="0"
          step="0.1"
          v-model.number="sizeState.cutMarginMm"
          @input="updateSizeCut"
        />
      </div>
      <div class="control-group">
        <label>Image Size</label>
        <div class="hint" v-if="selectedImageSize">
          {{ selectedImageSize.width.toFixed(2) }} ×
          {{ selectedImageSize.height.toFixed(2) }} {{ selectedImageSize.unit }}
        </div>
        <div class="hint" v-else>No image selected</div>
      </div>
    </div>

    <!-- Image Controls -->
    <div v-if="currentMode === 'Image'" class="controls">
      <div class="control-group">
        <label>Images</label>
        <div class="image-list" v-if="imageRows.length">
          <button
            v-for="item in imageRows"
            :key="item.id"
            class="image-item"
            :class="{ active: item.id === imageState.id }"
            @click="focusImageById(item.id)"
          >
            <div class="image-item-head">
              <span>{{ item.id }}</span>
            </div>
            <div class="hint">
              scale {{ item.scale.toFixed(2) }} · angle
              {{ item.angle.toFixed(1) }}°
            </div>
            <div class="hint">
              left {{ item.left.toFixed(2) }} · top {{ item.top.toFixed(2) }}
            </div>
            <div class="hint">
              opacity {{ item.opacity.toFixed(2) }} ·
              {{ item.originalWidth || 0 }} × {{ item.originalHeight || 0 }} px
            </div>
          </button>
        </div>
        <div class="hint" v-else>No images</div>
      </div>

      <div class="control-group" v-if="imageState.id">
        <label>Original size</label>
        <div class="hint">
          {{ imageState.originalWidth }} × {{ imageState.originalHeight }} px
        </div>
        <div class="hint" v-if="imageOriginalMm">
          {{ imageOriginalMm.width }} × {{ imageOriginalMm.height }} mm
        </div>
      </div>

      <div class="control-group">
        <label>Scale</label>
        <input
          type="range"
          min="0.1"
          max="3"
          step="0.1"
          v-model.number="imageState.scale"
          @input="updateImageState"
          :disabled="!imageState.id"
        />
        <span>{{ imageState.scale.toFixed(1) }}</span>
      </div>

      <div class="control-group">
        <label>Rotate</label>
        <input
          type="range"
          min="0"
          max="360"
          v-model.number="imageState.angle"
          @input="updateImageState"
          :disabled="!imageState.id"
        />
        <span>{{ imageState.angle.toFixed(1) }}°</span>
      </div>

      <div
        class="control-group"
        style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px"
      >
        <button @click="triggerImageUpload('add')">Add Image</button>
        <button
          @click="triggerImageUpload('replace')"
          :disabled="!imageState.id"
        >
          Replace Focused
        </button>
        <button @click="clearImageFocus" :disabled="!imageState.id">
          Clear Focus
        </button>
      </div>

      <input
        type="file"
        ref="imageInput"
        style="display: none"
        @change="handleImageUpload"
        accept="image/*"
      />

      <div class="control-group">
        <button @click="completeImageWorking" :disabled="!imageRows.length">
          Complete
        </button>
        <button @click="detectDielineFromFrame" :disabled="!imageRows.length">
          Detect Dieline
        </button>
        <div v-if="imageCompleteStatus.message" class="hint">
          {{ imageCompleteStatus.message }}
        </div>
      </div>
    </div>

    <!-- White Ink Controls -->
    <div v-if="currentMode === 'White Ink'" class="controls">
      <div class="control-group">
        <button @click="triggerWhiteInkUpload">Upload</button>
        <input
          type="file"
          ref="whiteInkInput"
          style="display: none"
          @change="handleWhiteInkReplace"
          accept="image/*"
        />
      </div>
      <div class="control-group">
        <label>
          <input
            type="checkbox"
            v-model="whiteInkState.printWithWhiteInk"
            @change="toggleWhiteInkPrint"
            :disabled="!whiteInkState.id"
          />
          Preview White Ink
        </label>
      </div>
      <div class="control-group" v-if="whiteInkState.id">
        <label>White Ink Opacity</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          v-model.number="whiteInkState.opacity"
          @input="updateWhiteInkOpacity"
        />
        <span>{{ whiteInkState.opacity.toFixed(2) }}</span>
      </div>
      <div class="control-group" v-if="whiteInkState.id">
        <button @click="toggleWhiteInkPreviewImage">
          {{ whiteInkState.previewImageVisible ? "Hide Image" : "Show Image" }}
        </button>
      </div>
      <div class="control-group" v-if="whiteInkState.id">
        <button @click="completeWhiteInkWorking">Complete</button>
        <button @click="clearWhiteInk">Clear</button>
        <div v-if="whiteInkActionStatus.message" class="hint">
          {{ whiteInkActionStatus.message }}
        </div>
      </div>
    </div>

    <!-- Dieline Controls -->
    <div v-if="currentMode === 'Dieline'" class="controls">
      <div class="control-group">
        <button @click="triggerDielineUpload" disabled>
          Upload Image to Detect
        </button>
        <input
          type="file"
          ref="dielineInput"
          style="display: none"
          @change="handleDielineDetect"
          accept="image/*"
        />
      </div>
      <div class="control-group">
        <label>Shape</label>
        <select
          v-model="dielineState.shape"
          @change="updateDielineConfig"
          disabled
        >
          <option value="rect">Rectangle</option>
          <option value="circle">Circle</option>
          <option value="custom">Custom</option>
        </select>
      </div>
    </div>

    <!-- Hole Controls -->
    <div v-if="currentMode === 'Hole'" class="controls">
      <div class="control-group">
        <label>Hole Preset</label>
        <select v-model="selectedPreset" @change="loadPreset">
          <option value="">Select a preset...</option>
          <option
            v-for="preset in availablePresets"
            :key="preset.name"
            :value="preset.name"
          >
            {{ preset.name }}
          </option>
        </select>
      </div>

      <div v-if="featureState.groupId" class="feature-controls">
        <div class="control-group">
          <label>Position X (0-1)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            v-model.number="featureState.x"
            @input="updateGroupPosition"
            :disabled="isXDisabled"
          />
        </div>
        <div class="control-group">
          <label>Position Y (0-2)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            max="2"
            v-model.number="featureState.y"
            @input="updateGroupPosition"
            :disabled="isYDisabled"
          />
        </div>
      </div>

      <div class="control-group">
        <button @click="completeWorking">Complete</button>
        <div v-if="completeStatus.message" style="font-size: 12px; color: #666">
          {{ completeStatus.message }}
        </div>
        <div
          v-if="completeStatus.issues.length"
          style="font-size: 12px; color: #b00020"
        >
          <div v-for="issue in completeStatus.issues" :key="issue.featureId">
            {{ issue.featureId }}: {{ issue.reason }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, reactive, onUnmounted, computed } from "vue";
import {
  CATEGORY_TEMPLATE_MAP,
  HOLE_PRESETS,
  TEMPLATE_HOLE_PRESETS,
} from "../constants/productTemplates";

const props = defineProps({
  editor: Object,
  category: String,
});

const editor = computed(() => {
  const e = props.editor;
  if (e && typeof e === "object" && "value" in e) return e.value;
  return e;
});

const currentMode = ref("");
const imageInput = ref(null);
const whiteInkInput = ref(null);
const dielineInput = ref(null);
const pendingImageUploadMode = ref("add");
const imageItems = ref([]);
const imageNaturalSizeById = reactive({});
const imageSizeCacheByUrl = new Map();

const imageState = reactive({
  id: null,
  scale: 1,
  angle: 0,
  originalWidth: 0,
  originalHeight: 0,
});

const imageCompleteStatus = reactive({
  message: "",
  issues: [],
});

const whiteInkState = reactive({
  id: null,
  printWithWhiteInk: true,
  opacity: 0.45,
  previewImageVisible: true,
});

const whiteInkActionStatus = reactive({
  message: "",
});

const sizeState = reactive({
  width: 50,
  height: 50,
  unit: "mm",
  constraintMode: "free",
  cutMode: "trim",
  cutMarginMm: 0,
});

const selectedImageSize = ref(null);

const imageOriginalMm = computed(() => {
  const w = imageState.originalWidth;
  const h = imageState.originalHeight;
  if (!w || !h) return null;
  const pxToMm = 0.264583;
  return {
    width: parseFloat((w * pxToMm).toFixed(1)),
    height: parseFloat((h * pxToMm).toFixed(1)),
  };
});

const imageRows = computed(() => {
  return (imageItems.value || []).map((item) => {
    const sourceSize = imageNaturalSizeById[item.id];
    return {
      ...item,
      originalWidth: Number(sourceSize?.width ?? 0),
      originalHeight: Number(sourceSize?.height ?? 0),
    };
  });
});

const dielineState = reactive({
  shape: "rect",
});

const selectedPreset = ref("");

const availablePresets = computed(() => {
  if (!props.category) return [];

  let templateType = CATEGORY_TEMPLATE_MAP[props.category];
  if (!templateType) {
    templateType = CATEGORY_TEMPLATE_MAP[props.category.trim()];
  }
  if (!templateType) return [];

  const allowedKeys = TEMPLATE_HOLE_PRESETS[templateType] || [];
  return allowedKeys.map((key) => HOLE_PRESETS[key]).filter(Boolean);
});

const featureState = reactive({
  groupId: null,
  x: 0,
  y: 0,
  radius: 0,
  constraints: null,
});

const completeStatus = reactive({
  message: "",
  issues: [],
});

watch(
  availablePresets,
  (newPresets) => {
    if (newPresets.length === 0) {
      selectedPreset.value = "";
      return;
    }

    const hasSelected = newPresets.some(
      (preset) => preset.name === selectedPreset.value,
    );
    if (!hasSelected) {
      selectedPreset.value = newPresets[0].name;
    }
  },
  { immediate: true },
);

const normalizeImageItem = (item) => ({
  id: String(item?.id || ""),
  url: typeof item?.url === "string" ? item.url : "",
  sourceUrl: typeof item?.sourceUrl === "string" ? item.sourceUrl : "",
  opacity: Number.isFinite(Number(item?.opacity)) ? Number(item.opacity) : 1,
  scale: Number.isFinite(Number(item?.scale)) ? Number(item.scale) : 1,
  angle: Number.isFinite(Number(item?.angle)) ? Number(item.angle) : 0,
  left: Number.isFinite(Number(item?.left)) ? Number(item.left) : 0.5,
  top: Number.isFinite(Number(item?.top)) ? Number(item.top) : 0.5,
});

const syncFocusedImageState = () => {
  const focused = imageItems.value.find((item) => item.id === imageState.id);
  if (!focused) {
    imageState.id = null;
    imageState.scale = 1;
    imageState.angle = 0;
    imageState.originalWidth = 0;
    imageState.originalHeight = 0;
    return;
  }

  imageState.scale = Number(focused.scale ?? 1);
  imageState.angle = Number(focused.angle ?? 0);
  const sourceSize = imageNaturalSizeById[focused.id];
  imageState.originalWidth = Number(sourceSize?.width ?? 0);
  imageState.originalHeight = Number(sourceSize?.height ?? 0);
};

const readImageNaturalSize = (url) => {
  if (!url) return Promise.resolve(null);
  if (imageSizeCacheByUrl.has(url)) {
    return Promise.resolve(imageSizeCacheByUrl.get(url));
  }

  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const width = Number(img.naturalWidth || 0);
      const height = Number(img.naturalHeight || 0);
      const size =
        width > 0 && height > 0
          ? {
              width,
              height,
            }
          : null;
      imageSizeCacheByUrl.set(url, size);
      resolve(size);
    };
    img.onerror = () => {
      imageSizeCacheByUrl.set(url, null);
      resolve(null);
    };
    img.src = url;
  });
};

const syncImageNaturalSizes = (items) => {
  const idSet = new Set((items || []).map((item) => item.id));
  Object.keys(imageNaturalSizeById).forEach((id) => {
    if (!idSet.has(id)) {
      delete imageNaturalSizeById[id];
    }
  });

  for (const item of items || []) {
    const source = item.sourceUrl || item.url || "";
    if (!source) continue;
    void readImageNaturalSize(source).then((size) => {
      if (!size) return;
      const current = imageItems.value.find((currentItem) => {
        return currentItem.id === item.id;
      });
      const currentSource = current?.sourceUrl || current?.url || "";
      if (!current || currentSource !== source) return;
      imageNaturalSizeById[item.id] = size;
      if (item.id === imageState.id) {
        imageState.originalWidth = size.width;
        imageState.originalHeight = size.height;
      }
    });
  }
};

const applyImageItems = (items) => {
  imageItems.value = (items || [])
    .map(normalizeImageItem)
    .filter((item) => !!item.id);
  syncImageNaturalSizes(imageItems.value);
  syncFocusedImageState();
};

const syncImageItems = async () => {
  if (!editor.value) {
    applyImageItems([]);
    return;
  }

  try {
    const items = await editor.value.executeCommand("getWorkingImages");
    applyImageItems(items || []);
    return;
  } catch (e) {}

  try {
    const items =
      typeof editor.value.getImages === "function"
        ? editor.value.getImages()
        : [];
    applyImageItems(items || []);
  } catch (e) {
    applyImageItems([]);
  }
};

const focusImageById = async (
  id,
  options = {
    syncCanvasSelection: true,
  },
) => {
  if (!editor.value) return;
  if (id && !imageItems.value.some((item) => item.id === id)) return;

  await editor.value.focusImage(id, options);
  imageState.id = id;
  syncFocusedImageState();
  await refreshSelectedImageSize();
};

const clearImageFocus = async () => {
  await focusImageById(null, {
    syncCanvasSelection: true,
  });
};

const resetPanelState = () => {
  currentMode.value = "";
  pendingImageUploadMode.value = "add";
  imageItems.value = [];
  Object.keys(imageNaturalSizeById).forEach((id) => {
    delete imageNaturalSizeById[id];
  });
  imageState.id = null;
  imageState.scale = 1;
  imageState.angle = 0;
  imageState.originalWidth = 0;
  imageState.originalHeight = 0;
  imageCompleteStatus.message = "";
  imageCompleteStatus.issues = [];

  whiteInkState.id = null;
  whiteInkState.printWithWhiteInk = true;
  whiteInkState.opacity = 0.45;
  whiteInkState.previewImageVisible = true;
  whiteInkActionStatus.message = "";

  sizeState.width = 50;
  sizeState.height = 50;
  sizeState.unit = "mm";
  sizeState.constraintMode = "free";
  sizeState.cutMode = "trim";
  sizeState.cutMarginMm = 0;
  selectedImageSize.value = null;

  featureState.groupId = null;
  featureState.x = 0;
  featureState.y = 0;
  featureState.radius = 0;
  featureState.constraints = null;
  completeStatus.message = "";
  completeStatus.issues = [];
};

const rollbackWorkingByTool = async (toolId) => {
  if (!editor.value || !toolId) return;

  if (toolId === "pooder.kit.image") {
    await editor.value.executeCommand("resetWorkingImages");
    return;
  }
  if (toolId === "pooder.kit.white-ink") {
    await editor.value.executeCommand("resetWorkingWhiteInks");
    return;
  }
  if (toolId === "pooder.kit.feature") {
    await editor.value.executeCommand("rollbackFeatureSession");
  }
};

const closePanel = async () => {
  if (!editor.value) {
    resetPanelState();
    return;
  }

  const activeToolId = editor.value?.services?.workbench?.activeToolId || null;

  try {
    await rollbackWorkingByTool(activeToolId);
    await editor.value.deactivateTool();
  } catch (e) {}

  resetPanelState();
};

const triggerImageUpload = (mode = "add") => {
  pendingImageUploadMode.value = mode;
  if (!imageInput.value) return;
  imageInput.value.click();
};
const triggerWhiteInkUpload = () => whiteInkInput.value.click();
const triggerDielineUpload = () => dielineInput.value.click();

const syncSizeState = async () => {
  if (!editor.value) return;
  try {
    const next = await editor.value.executeCommand("getSizeState");
    if (!next) return;
    sizeState.width = Number(next.actualWidth ?? 0);
    sizeState.height = Number(next.actualHeight ?? 0);
    sizeState.unit = next.unit || "mm";
    sizeState.constraintMode = next.constraintMode || "free";
    sizeState.cutMode = next.cutMode || "trim";
    sizeState.cutMarginMm = Number(next.cutMarginMm ?? 0);
  } catch (e) {}
};

const refreshSelectedImageSize = async () => {
  if (!editor.value) return;
  try {
    selectedImageSize.value = await editor.value.executeCommand(
      "getSelectedImageSize",
    );
  } catch (e) {
    selectedImageSize.value = null;
  }
};

const updateSizeByWidth = async () => {
  if (!editor.value) return;
  await editor.value.executeCommand("updateSizeDimensions", {
    width: sizeState.width,
    unit: sizeState.unit,
    changed: "width",
  });
  await syncSizeState();
  await refreshSelectedImageSize();
};

const updateSizeByHeight = async () => {
  if (!editor.value) return;
  await editor.value.executeCommand("updateSizeDimensions", {
    height: sizeState.height,
    unit: sizeState.unit,
    changed: "height",
  });
  await syncSizeState();
  await refreshSelectedImageSize();
};

const updateSizeUnit = async () => {
  if (!editor.value) return;
  await editor.value.executeCommand("setSizeDisplayUnit", sizeState.unit);
  await syncSizeState();
  await refreshSelectedImageSize();
};

const updateSizeConstraint = async () => {
  if (!editor.value) return;
  await editor.value.executeCommand(
    "setSizeConstraintMode",
    sizeState.constraintMode,
  );
  await syncSizeState();
  await refreshSelectedImageSize();
};

const updateSizeCut = async () => {
  if (!editor.value) return;
  await editor.value.executeCommand(
    "setSizeCut",
    sizeState.cutMode,
    sizeState.cutMarginMm,
  );
  await syncSizeState();
  await refreshSelectedImageSize();
};

const handleImageUpload = async (e) => {
  const file = e.target.files[0];
  if (!file || !editor.value) return;
  const url = URL.createObjectURL(file);
  imageCompleteStatus.message = "";
  imageCompleteStatus.issues = [];

  try {
    const mode = pendingImageUploadMode.value;
    const isReplace = mode === "replace";
    if (isReplace && !imageState.id) {
      throw new Error("replace-target-id-required");
    }

    const result = await editor.value.upsertImage(
      url,
      isReplace
        ? {
            mode: "replace",
            id: imageState.id,
          }
        : {
            mode: "add",
          },
    );

    await editor.value.executeCommand("resetWorkingImages");
    await syncImageItems();
    if (result?.id) {
      await focusImageById(result.id, {
        syncCanvasSelection: true,
      });
    }
  } catch (error) {
    imageCompleteStatus.message = error?.message || "Image upload failed";
  } finally {
    URL.revokeObjectURL(url);
    pendingImageUploadMode.value = "add";
    e.target.value = "";
  }
};

const handleWhiteInkReplace = async (e) => {
  const file = e.target.files[0];
  if (!file || !editor.value) return;
  const url = URL.createObjectURL(file);
  whiteInkActionStatus.message = "";
  await editor.value.executeCommand("setWhiteInkImage", url);
  await syncWhiteInkSettings();
  e.target.value = "";
};

const handleDielineDetect = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  await editor.value.detectDieline(url);
  // Refresh config
  syncDielineState();
};

const updateImageState = () => {
  if (!editor.value || !imageState.id) return;
  imageCompleteStatus.message = "";
  imageCompleteStatus.issues = [];
  editor.value.executeCommand("setWorkingImage", imageState.id, {
    scale: imageState.scale,
    angle: imageState.angle,
  });
};

const syncWhiteInkSettings = async () => {
  if (!editor.value) return;
  try {
    const settings = await editor.value.executeCommand("getWhiteInkSettings");
    whiteInkState.id = settings?.id || null;
    whiteInkState.printWithWhiteInk = settings?.printWithWhiteInk !== false;
    whiteInkState.opacity = Number(settings?.opacity ?? 0.45);
    whiteInkState.previewImageVisible = settings?.previewImageVisible !== false;
    return;
  } catch (e) {}

  whiteInkState.id = null;
  whiteInkState.printWithWhiteInk = true;
  whiteInkState.opacity = 0.45;
  whiteInkState.previewImageVisible = true;
};

const toggleWhiteInkPrint = async () => {
  if (!editor.value || !whiteInkState.id) return;
  whiteInkActionStatus.message = "";
  await editor.value.executeCommand(
    "setWhiteInkPrintEnabled",
    !!whiteInkState.printWithWhiteInk,
  );
};

const updateWhiteInkOpacity = async () => {
  if (!editor.value || !whiteInkState.id) return;
  whiteInkActionStatus.message = "";
  await editor.value.executeCommand(
    "setWhiteInkOpacity",
    Number(whiteInkState.opacity || 0),
  );
};

const toggleWhiteInkPreviewImage = async () => {
  if (!editor.value || !whiteInkState.id) return;
  whiteInkActionStatus.message = "";
  const nextVisible = !whiteInkState.previewImageVisible;
  await editor.value.executeCommand(
    "setWhiteInkPreviewImageVisible",
    nextVisible,
  );
  whiteInkState.previewImageVisible = nextVisible;
};

const completeWhiteInkWorking = async () => {
  if (!editor.value || !whiteInkState.id) return;
  whiteInkActionStatus.message = "";
  const res = await editor.value.executeCommand("completeWhiteInks");
  whiteInkActionStatus.message =
    res && res.ok ? "Completed" : "Complete failed";
  await syncWhiteInkSettings();
};

const clearWhiteInk = async () => {
  if (!editor.value || !whiteInkState.id) return;
  whiteInkActionStatus.message = "";
  await editor.value.executeCommand("clearWhiteInks");
  await syncWhiteInkSettings();
  whiteInkActionStatus.message = "Cleared";
};

const completeImageWorking = async () => {
  if (!editor.value) return;
  imageCompleteStatus.message = "";
  imageCompleteStatus.issues = [];
  if (!imageRows.value.length) return;
  const res = await editor.value.executeCommand("completeImages");
  if (res && res.ok) {
    imageCompleteStatus.message = "Completed";
    await syncImageItems();
    return;
  }
  imageCompleteStatus.message = "Complete failed";
  imageCompleteStatus.issues = (res && res.issues) || [];
};

const detectDielineFromFrame = async () => {
  if (!editor.value) return;
  imageCompleteStatus.message = "";
  imageCompleteStatus.issues = [];
  if (!imageRows.value.length) return;
  await completeImageWorking();
  const res = await editor.value.detectDielineFromFrame();
  if (res && res.pathData) {
    imageCompleteStatus.message = "Dieline detected";
    return;
  }
  imageCompleteStatus.message = "Detect failed";
};

const updateDielineConfig = () => {
  editor.value.updateConfig("dieline.shape", dielineState.shape);
};

const syncFeatureStateFromWorking = async (groupId) => {
  if (!editor.value || !groupId) return;
  try {
    const features = await editor.value.executeCommand("getWorkingFeatures");
    const feature = (features || []).find((f) => f.groupId === groupId);
    if (feature) {
      featureState.x = parseFloat((feature.x || 0).toFixed(2));
      featureState.y = parseFloat((feature.y || 0).toFixed(2));
      featureState.radius = feature.radius;
      featureState.constraints = feature.constraints;
    }
  } catch (e) {}
};

const loadPreset = async (presetName = selectedPreset.value) => {
  if (!editor.value || !presetName) {
    return;
  }

  const preset = availablePresets.value.find((p) => p.name === presetName);
  if (!preset) return;

  const features = JSON.parse(JSON.stringify(preset.features || []));
  const groupId = features[0]?.groupId || null;
  if (!groupId) return;

  await editor.value.executeCommand("setWorkingFeatures", features);

  // Select it for editing
  featureState.groupId = groupId;

  await syncFeatureStateFromWorking(groupId);
};

const isXDisabled = computed(() => {
  if (!featureState.constraints || !Array.isArray(featureState.constraints))
    return false;
  const edgeConstraint = featureState.constraints.find(
    (c) => c.type === "edge",
  );

  if (edgeConstraint) {
    const edges = edgeConstraint.params?.allowedEdges || [
      "top",
      "bottom",
      "left",
      "right",
    ];
    // If only vertical edges allowed (left/right), X is fixed (0 or 1)
    // Wait, if left/right, X is fixed to 0 or 1. So disable X.
    // If top/bottom, X is variable.
    // So if NO top/bottom in allowedEdges, disable X.
    const hasHorizontalMovement =
      edges.includes("top") || edges.includes("bottom");
    return !hasHorizontalMovement;
  }
  return false;
});

const isYDisabled = computed(() => {
  if (!featureState.constraints || !Array.isArray(featureState.constraints))
    return false;
  const edgeConstraint = featureState.constraints.find(
    (c) => c.type === "edge",
  );

  if (edgeConstraint) {
    const edges = edgeConstraint.params?.allowedEdges || [
      "top",
      "bottom",
      "left",
      "right",
    ];
    // If NO left/right, disable Y.
    const hasVerticalMovement =
      edges.includes("left") || edges.includes("right");
    return !hasVerticalMovement;
  }
  return false;
});

const updateGroupPosition = () => {
  if (!featureState.groupId) return;
  editor.value.executeCommand(
    "updateWorkingGroupPosition",
    featureState.groupId,
    featureState.x,
    featureState.y,
  );
};

const syncDielineState = () => {
  if (!editor.value) return;
  dielineState.shape = editor.value.getConfig("dieline.shape") || "rect";
};

const onSelectionCreated = async (e) => {
  const selection = e.selected ? e.selected[0] : e.target || null;
  const activeId = editor.value?.services?.workbench?.activeToolId;
  if (!selection) {
    if (activeId === "pooder.kit.image") {
      await syncImageItems();
    }
    await refreshSelectedImageSize();
    return;
  }

  // Check if feature selection
  if (selection.data && selection.data.groupId) {
    currentMode.value = "Hole";
    featureState.groupId = selection.data.groupId;
    syncFeatureStateFromWorking(featureState.groupId);
    return;
  }

  if (selection.data?.layerId === "white-ink.user" && selection.data?.id) {
    currentMode.value = "White Ink";
    await syncWhiteInkSettings();
    return;
  }

  // Check if image
  if (selection.data?.layerId === "image.user" && selection.data?.id) {
    if (activeId === "pooder.kit.image") {
      currentMode.value = "Image";
      await syncImageItems();
      await focusImageById(selection.data.id, {
        syncCanvasSelection: false,
      });
    }
    await refreshSelectedImageSize();
    return;
  }

  // Check if feature
  // FeatureTool markers usually have data identifying them
  // Assuming feature marker has some identification
  // If not, we can't edit it easily.
  // But let's assume active tool 'Hole' handles it if we can't select.
  await refreshSelectedImageSize();
};

const onSelectionCleared = async () => {
  // Only clear if we are not in a specific tool mode that persists (like Hole/Dieline)
  // Actually, usually panels close on deselect.
  // But if we are in "Dieline" mode (tool active), we shouldn't close just because no object selected.
  // However, Image mode depends on selection.
  if (currentMode.value === "Image") {
    const activeId = editor.value?.services?.workbench?.activeToolId;
    if (activeId !== "pooder.kit.image") {
      imageState.id = null;
      syncFocusedImageState();
      currentMode.value = "";
    } else {
      await focusImageById(null, {
        syncCanvasSelection: false,
      });
      await syncImageItems();
    }
  }
  if (currentMode.value === "White Ink") {
    const activeId = editor.value?.services?.workbench?.activeToolId;
    if (activeId !== "pooder.kit.white-ink") {
      whiteInkState.id = null;
      currentMode.value = "";
    } else {
      void syncWhiteInkSettings();
    }
  }
  await refreshSelectedImageSize();
  // For Hole/Dieline, they are activated by ActivityBar, so we keep them open until tool changes?
  // User said: "panel opened but cannot close".
  // If I click empty space, active tool might remain Dieline, but no selection.
  // If active tool is None (default), then panel should be closed.
  // But ActivityBar sets active tool.
  // If we want to close panel, we might need to deactivate tool?
  // Or maybe "cannot close" refers to Image mode sticking around?
  // Let's assume Image mode is selection-based, others are Tool-based.
};

const onToolActivated = ({ id }) => {
  if (id === "pooder.kit.size") {
    currentMode.value = "Size";
    void syncSizeState();
    void refreshSelectedImageSize();
  } else if (id === "pooder.kit.image") {
    currentMode.value = "Image";
    imageCompleteStatus.message = "";
    imageCompleteStatus.issues = [];
    void syncImageItems();
  } else if (id === "pooder.kit.white-ink") {
    currentMode.value = "White Ink";
    syncWhiteInkSettings();
  } else if (id === "pooder.kit.dieline") {
    currentMode.value = "Dieline";
    syncDielineState();
  } else if (id === "pooder.kit.feature") {
    currentMode.value = "Hole";
    completeStatus.message = "";
    completeStatus.issues = [];
    void (async () => {
      try {
        await editor.value.executeCommand("beginFeatureSession");
      } catch (e) {}
      if (!featureState.groupId) {
        if (!selectedPreset.value && availablePresets.value.length > 0) {
          selectedPreset.value = availablePresets.value[0].name;
        }
        if (selectedPreset.value) {
          await loadPreset(selectedPreset.value);
        }
      } else {
        await syncFeatureStateFromWorking(featureState.groupId);
      }
    })();
  } else {
    currentMode.value = "";
  }
};

const onWorkingChange = (e) => {
  if (featureState.groupId && e?.features) {
    const feature = (e.features || []).find(
      (f) => f.groupId === featureState.groupId,
    );
    if (feature) {
      featureState.x = parseFloat((feature.x || 0).toFixed(2));
      featureState.y = parseFloat((feature.y || 0).toFixed(2));
      featureState.radius = feature.radius;
      featureState.constraints = feature.constraints;
    }
  }
};

const onImageWorkingChange = (e) => {
  if (currentMode.value !== "Image") return;
  if (Array.isArray(e?.items)) {
    applyImageItems(e.items);
    return;
  }
  void syncImageItems();
};

const onSizeStateChanged = (state) => {
  if (!state) return;
  sizeState.width = Number(state.actualWidth ?? 0);
  sizeState.height = Number(state.actualHeight ?? 0);
  sizeState.unit = state.unit || "mm";
  sizeState.constraintMode = state.constraintMode || "free";
  sizeState.cutMode = state.cutMode || "trim";
  sizeState.cutMarginMm = Number(state.cutMarginMm ?? 0);
  void refreshSelectedImageSize();
};

const completeWorking = async () => {
  completeStatus.message = "";
  completeStatus.issues = [];
  const res = await editor.value.executeCommand("completeFeatures");
  if (res && res.ok) {
    completeStatus.message = "Completed";
    return;
  }
  completeStatus.message = "Complete failed";
  completeStatus.issues = (res && res.issues) || [];
};

watch(
  () => props.editor,
  (editor) => {
    if (editor) {
      editor.on("selection:created", onSelectionCreated);
      editor.on("selection:updated", onSelectionCreated);
      editor.on("selection:cleared", onSelectionCleared);
      editor.on("tool:activated", onToolActivated);
      editor.on("feature:working:change", onWorkingChange);
      editor.on("image:working:change", onImageWorkingChange);
      editor.on("size:state:changed", onSizeStateChanged);

      // Initial sync
      if (editor.services && editor.services.workbench) {
        const id = editor.services.workbench.activeToolId;
        if (id) onToolActivated({ id });
      }
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (props.editor) {
    props.editor.off("selection:created", onSelectionCreated);
    props.editor.off("selection:updated", onSelectionCreated);
    props.editor.off("selection:cleared", onSelectionCleared);
    props.editor.off("tool:activated", onToolActivated);
    props.editor.off("feature:working:change", onWorkingChange);
    props.editor.off("image:working:change", onImageWorkingChange);
    props.editor.off("size:state:changed", onSizeStateChanged);
  }
});
</script>

<style scoped>
.custom-tool-panel {
  position: absolute;
  left: 20px;
  top: 20px;
  background: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  width: 250px;
  z-index: 100;
}

.panel-header {
  font-weight: bold;
  margin-bottom: 10px;
  padding-bottom: 5px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.close-btn {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  padding: 0 5px;
  color: #666;
}

.close-btn:hover {
  background: #f0f0f0;
  color: #333;
}

.control-group {
  margin-bottom: 15px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.control-group label {
  font-size: 12px;
  color: #666;
}

.hint {
  font-size: 12px;
  color: #666;
}

input,
select,
button {
  padding: 5px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

button {
  background: #f8f9fa;
  cursor: pointer;
}

button:hover {
  background: #e9ecef;
}

.feature-list {
  border: 1px solid #ddd;
  border-radius: 4px;
  max-height: 150px;
  overflow-y: auto;
  margin-bottom: 10px;
}

.image-list {
  border: 1px solid #ddd;
  border-radius: 4px;
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.image-item {
  width: 100%;
  border: 0;
  border-bottom: 1px solid #eee;
  border-radius: 0;
  background: #fff;
  padding: 8px;
  text-align: left;
}

.image-item:last-child {
  border-bottom: 0;
}

.image-item:hover {
  background: #f8f9fa;
}

.image-item.active {
  background: #e7f1ff;
  box-shadow: inset 2px 0 0 #007bff;
}

.image-item-head {
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  margin-bottom: 4px;
}

.feature-item {
  padding: 8px;
  border-bottom: 1px solid #eee;
  cursor: pointer;
  font-size: 12px;
}

.feature-item:hover {
  background: #f8f9fa;
}

.feature-item.active {
  background: #e7f1ff;
  border-left: 3px solid #007bff;
}

.feature-item:last-child {
  border-bottom: none;
}
</style>
