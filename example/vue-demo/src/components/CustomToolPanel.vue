<template>
  <div class="custom-tool-panel" v-if="currentMode">
    <div class="panel-header">
      {{ currentMode }} Settings
      <button class="close-btn" @click="closePanel">×</button>
    </div>

    <!-- Image Controls -->
    <div v-if="currentMode === 'Image'" class="controls">
      <div class="control-group">
        <label>Scale</label>
        <input
          type="range"
          min="0.1"
          max="3"
          step="0.1"
          v-model.number="imageState.scale"
          @input="updateImageState"
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
        />
        <span>{{ imageState.angle }}°</span>
      </div>
      <div class="control-group">
        <button @click="triggerImageUpload">Replace Image</button>
        <input
          type="file"
          ref="imageInput"
          style="display: none"
          @change="handleImageReplace"
          accept="image/*"
        />
      </div>
    </div>

    <!-- Dieline Controls -->
    <div v-if="currentMode === 'Dieline'" class="controls">
      <div class="control-group">
        <button @click="triggerDielineUpload">Upload Image to Detect</button>
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
        <select v-model="dielineState.shape" @change="updateDielineConfig">
          <option value="rect">Rectangle</option>
          <option value="circle">Circle</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div
        class="control-group"
        :style="{ opacity: dielineState.shape === 'custom' ? 0.5 : 1 }"
      >
        <div
          style="
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
          "
        >
          <label>Border length</label>
          <span style="font-size: 12px; font-weight: bold">{{
            dielineState.offset === 0 ? "full" : dielineState.offset + "mm"
          }}</span>
        </div>
        <input
          type="range"
          min="0"
          max="5"
          step="1"
          v-model.number="dielineState.offset"
          @input="updateDielineConfig"
          :disabled="dielineState.shape === 'custom'"
        />
        <div
          style="
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: #999;
            margin-top: 2px;
          "
        >
          <span>full</span>
          <span>1mm</span>
          <span>2mm</span>
          <span>3mm</span>
          <span>4mm</span>
          <span>5mm</span>
        </div>
      </div>
    </div>

    <!-- Hole Controls -->
    <div v-if="currentMode === 'Hole'" class="controls">
      <div class="control-group">
        <label>Hole Preset</label>
        <select v-model="selectedPreset" @change="loadPreset">
          <option value="">Select a preset...</option>
          <option
            v-for="preset in HOLE_PRESETS"
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

const props = defineProps({
  editor: Object,
});

const editor = computed(() => {
  const e = props.editor;
  if (e && typeof e === "object" && "value" in e) return e.value;
  return e;
});

const currentMode = ref("");
const imageInput = ref(null);
const dielineInput = ref(null);

const imageState = reactive({
  id: null,
  scale: 1,
  angle: 0,
});

const dielineState = reactive({
  shape: "rect",
  offset: 0,
});

const featuresList = ref([]);
const selectedPreset = ref("");

const HOLE_PRESETS = [
  {
    name: "2.5mm",
    groupId: "2.5mm-hole",
    features: [
      {
        id: "2.5mm-hole-lug",
        groupId: "2.5mm-hole",
        operation: "add",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 2.5,
        rotation: 0,
        renderBehavior: "edge",
        constraints: [
          {
            type: "path",
            params: {
              minOffset: -2.5,
              maxOffset: 2,
            },
          },
        ],
      },
      {
        id: "2.5mm-hole-hole",
        groupId: "2.5mm-hole",
        operation: "subtract",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 2,
        rotation: 0,
        renderBehavior: "edge",
        constraints: [
          {
            type: "path",
            params: {
              minOffset: -2.5,
              maxOffset: 2,
            },
          },
        ],
      },
    ],
  },
  {
    name: "3mm",
    groupId: "3mm-hole",
    features: [
      {
        id: "3mm-hole-lug",
        groupId: "3mm-hole",
        operation: "add",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 3,
        rotation: 0,
        renderBehavior: "edge",
        constraints: [{ type: "path" }],
      },
      {
        id: "3mm-hole-hole",
        groupId: "3mm-hole",
        operation: "subtract",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 2,
        rotation: 0,
        renderBehavior: "edge",
        constraints: [{ type: "path" }],
      },
    ],
  },
  {
    name: "10mm",
    groupId: "10mm-hole",
    features: [
      {
        id: "10mm-hole-lug",
        groupId: "10mm-hole",
        operation: "add",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 10,
        rotation: 0,
        renderBehavior: "edge",
        constraints: [{ type: "path" }],
      },
      {
        id: "10mm-hole-hole",
        groupId: "10mm-hole",
        operation: "subtract",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 5,
        rotation: 0,
        renderBehavior: "edge",
        constraints: [{ type: "path" }],
      },
    ],
  },
  {
    name: "Standee Tab",
    groupId: "standee-tab",
    features: [
      {
        id: "standee-tab-lug",
        groupId: "standee-tab",
        operation: "add",
        skipCut: true,
        shape: "rect",
        x: 0.5,
        y: 1.02,
        width: 15,
        height: 6,
        rotation: 0,
        renderBehavior: "edge",
        bridge: {
          type: "vertical",
        },
        constraints: [
          {
            type: "lowest-tangent",
            params: {
              gap: 0,
              confineX: true,
            },
          },
        ],
      },
    ],
  },
];

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

const closePanel = () => {
  // Deactivate tool? Or just hide panel?
  // If we just hide panel, currentMode = ''.
  // But ActivityBar might still show active tool.
  // Ideally we should deactivate tool.
  // Editor doesn't expose deactivateTool directly but we can activate empty tool or 'default'.
  // Or just clear local state.
  currentMode.value = "";
  // If we want to clear selection too:
  if (editor.value && editor.value.canvasService) {
    // canvasService not exposed directly unless via services
    // props.editor.services.workbench.activate(null); // If workbench service supported null
    // For now just clear UI
  }
};

const triggerImageUpload = () => imageInput.value.click();
const triggerDielineUpload = () => dielineInput.value.click();

const handleImageReplace = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);

  if (imageState.id) {
    await editor.value.updateImage(imageState.id, { url });
  } else {
    const id = await editor.value.addImage(url);
    imageState.id = id;

    // Sync state from new image default props
    const items = editor.value.getConfig("image.items") || [];
    const item = items.find((i) => i.id === id);
    if (item) {
      imageState.scale = item.scale || 1;
      imageState.angle = item.angle || 0;
    }
  }
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
  if (!imageState.id) return;
  editor.value.executeCommand("updateImage", imageState.id, {
    scale: imageState.scale,
    angle: imageState.angle,
  });
};

const updateDielineConfig = () => {
  editor.value.updateConfig("dieline.shape", dielineState.shape);
  editor.value.updateConfig("dieline.offset", -dielineState.offset);
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

const loadPreset = () => {
  if (!selectedPreset.value) {
    // Clear features if no preset selected?
    // props.editor.updateConfig('dieline.features', []);
    // featureState.groupId = null;
    return;
  }

  const preset = HOLE_PRESETS.find((p) => p.name === selectedPreset.value);
  if (!preset) return;

  const features = JSON.parse(JSON.stringify(preset.features || []));
  if (preset.name === "Standee Tab") {
    const dielineHeight = editor.value.getConfig("dieline.height") || 50;
    const tab = features[0];
    const tabHeight = tab.height || 0;
    tab.y = 1 + tabHeight / 2 / dielineHeight;
  }

  editor.value.executeCommand("setWorkingFeatures", features);

  // Select it for editing
  featureState.groupId = preset.groupId;

  syncFeatureStateFromWorking(preset.groupId);
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
  dielineState.offset = Math.abs(editor.value.getConfig("dieline.offset")) || 0;
};

const onSelectionCreated = (e) => {
  const selection = e.selected ? e.selected[0] : null;
  if (!selection) {
    // Fallback to active tool
    return;
  }

  // Check if feature selection
  if (selection.data && selection.data.groupId) {
    currentMode.value = "Hole";
    featureState.groupId = selection.data.groupId;
    syncFeatureStateFromWorking(featureState.groupId);
    return;
  }

  // Check if image
  if (selection.data && selection.data.id && !selection.featureIndex) {
    // Assume it's an image if it has ID and not a feature
    // Actually we should check type or something, but data.id is used by ImageTool
    currentMode.value = "Image";
    imageState.id = selection.data.id;

    // Need to reverse calculate scale relative to original...
    // But for simplicity, let's just use object scale
    // Wait, ImageTool stores config scale.
    // We can get config item.
    const items = editor.value.getConfig("image.items") || [];
    const item = items.find((i) => i.id === imageState.id);
    if (item) {
      imageState.scale = item.scale || 1;
      imageState.angle = item.angle || 0;
    }
  }

  // Check if feature
  // FeatureTool markers usually have data identifying them
  // Assuming feature marker has some identification
  // If not, we can't edit it easily.
  // But let's assume active tool 'Hole' handles it if we can't select.
};

const onSelectionCleared = () => {
  // Only clear if we are not in a specific tool mode that persists (like Hole/Dieline)
  // Actually, usually panels close on deselect.
  // But if we are in "Dieline" mode (tool active), we shouldn't close just because no object selected.
  // However, Image mode depends on selection.
  if (currentMode.value === "Image") {
    currentMode.value = "";
    imageState.id = null;
  }
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
  if (id === "pooder.kit.image") {
    // Wait for selection to show panel? Or show generic image settings?
    // Usually Image tool requires selection to edit.
    // If we just activate tool "Image", maybe we show nothing or "Select an image".
    // Current logic sets 'Image'.
    currentMode.value = "Image";
  } else if (id === "pooder.kit.dieline") {
    currentMode.value = "Dieline";
    syncDielineState();
  } else if (id === "pooder.kit.feature") {
    currentMode.value = "Hole";
    // syncFeaturesList(); // Not needed as we use presets now
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
