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
          <label>Position Y (0-1)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            v-model.number="featureState.y"
            @input="updateGroupPosition"
            :disabled="isYDisabled"
          />
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
        placement: "edge",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 2.5,
        rotation: 0,
      },
      {
        id: "2.5mm-hole-hole",
        groupId: "2.5mm-hole",
        operation: "subtract",
        placement: "edge",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 2,
        rotation: 0,
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
        placement: "edge",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 3,
        rotation: 0,
      },
      {
        id: "3mm-hole-hole",
        groupId: "3mm-hole",
        operation: "subtract",
        placement: "edge",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 2,
        rotation: 0,
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
        placement: "edge",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 10,
        rotation: 0,
      },
      {
        id: "10mm-hole-hole",
        groupId: "10mm-hole",
        operation: "subtract",
        placement: "edge",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 5,
        rotation: 0,
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
        placement: "edge",
        skipCut: true,
        shape: "rect",
        x: 0.5,
        y: 1,
        width: 15,
        height: 6,
        rotation: 0,
        constraints: {
          type: "edge",
          params: {
            allowedEdges: ["bottom"],
            confine: true,
          },
        },
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

const closePanel = () => {
  // Deactivate tool? Or just hide panel?
  // If we just hide panel, currentMode = ''.
  // But ActivityBar might still show active tool.
  // Ideally we should deactivate tool.
  // Editor doesn't expose deactivateTool directly but we can activate empty tool or 'default'.
  // Or just clear local state.
  currentMode.value = "";
  // If we want to clear selection too:
  if (props.editor && props.editor.canvasService) {
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
    await props.editor.updateImage(imageState.id, { url });
  } else {
    const id = await props.editor.addImage(url);
    imageState.id = id;

    // Sync state from new image default props
    const items = props.editor.getConfig("image.items") || [];
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
  await props.editor.detectDieline(url);
  // Refresh config
  syncDielineState();
};

const updateImageState = () => {
  if (!imageState.id) return;
  props.editor.executeCommand("updateImage", imageState.id, {
    scale: imageState.scale,
    angle: imageState.angle,
  });
};

const updateDielineConfig = () => {
  props.editor.updateConfig("dieline.shape", dielineState.shape);
  props.editor.updateConfig("dieline.offset", -dielineState.offset);
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

  // Check if already exists?
  // User requirement: "Select name... then load Hole".
  // I will replace current features with this preset for simplicity, or add it?
  // "Same group... regarded as whole".
  // I'll overwrite features for now as this seems to be a single-group demo.
  // Or I should check if groupId exists.

  // For this specific requirement, let's just set the features.
  props.editor.updateConfig("dieline.features", [...preset.features]);

  // Select it for editing
  featureState.groupId = preset.groupId;

  // Initialize state from first feature (assuming shared position)
  if (preset.features.length > 0) {
    featureState.x = preset.features[0].x;
    featureState.y = preset.features[0].y;
    // Radius is tricky if they differ. I'll use the first one's radius as "base" size.
    featureState.radius = preset.features[0].radius;
    featureState.constraints = preset.features[0].constraints;
  }
};

const isXDisabled = computed(() => {
  if (!featureState.constraints) return false;
  if (featureState.constraints.type === "edge") {
    const edges = featureState.constraints.params?.allowedEdges || [
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
  if (!featureState.constraints) return false;
  if (featureState.constraints.type === "edge") {
    const edges = featureState.constraints.params?.allowedEdges || [
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
  props.editor.executeCommand(
    "updateFeaturePosition",
    featureState.groupId,
    featureState.x,
    featureState.y,
  );
};

const updateGroupRadius = () => {
  if (!featureState.groupId) return;
  const features = props.editor.getConfig("dieline.features") || [];

  // Logic: If I change radius, how do I apply it to multiple items with different radii?
  // Option A: Set all to same radius (Bad for lug+hole)
  // Option B: Scale them.
  // Option C: Difference.
  // User said "Size... is enough".
  // Given "2.5mm" preset name, maybe they are fixed relative size?
  // Let's implement scaling based on the ratio of change of the "primary" feature (the one we initialized state from).

  // Find original radius of first feature in group to calculate scale factor
  // This is hard because we don't store original state.
  // Let's just update the radius of ALL items by delta?
  // Or just update the first one and let others be? No, they need to resize together.

  // Simplest approach for "lug + hole":
  // Lug is 40, Hole is 20. Ratio is 2:1.
  // If user inputs 40, Lug=40, Hole=20.
  // If user inputs 20, Lug=20, Hole=10.
  // So I need to know the "base" radius.

  // Let's look at current features in config
  const groupFeatures = features.filter(
    (f) => f.groupId === featureState.groupId,
  );
  if (groupFeatures.length === 0) return;

  const baseFeature = groupFeatures[0]; // Lug
  const oldRadius = baseFeature.radius;
  if (oldRadius === 0) return; // Avoid divide by zero

  const scale = featureState.radius / oldRadius;

  const newFeatures = features.map((f) => {
    if (f.groupId === featureState.groupId) {
      return { ...f, radius: f.radius * scale };
    }
    return f;
  });

  props.editor.updateConfig("dieline.features", newFeatures);
};

const syncFeaturesList = () => {
  if (!props.editor) return;
  featuresList.value = props.editor.getConfig("dieline.features") || [];
};

const syncDielineState = () => {
  if (!props.editor) return;
  dielineState.shape = props.editor.getConfig("dieline.shape") || "rect";
  dielineState.offset = Math.abs(props.editor.getConfig("dieline.offset")) || 0;
};

const onConfigChange = (e) => {
  if (e.key === "dieline.features" && featureState.groupId) {
    const features = e.value || [];
    const feature = features.find((f) => f.groupId === featureState.groupId);
    if (feature) {
      featureState.x = parseFloat((feature.x || 0).toFixed(2));
      featureState.y = parseFloat((feature.y || 0).toFixed(2));
      featureState.radius = feature.radius;
      featureState.constraints = feature.constraints;
    }
  }
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

    // Sync state from config
    const features = props.editor.getConfig("dieline.features") || [];
    const feature = features.find((f) => f.groupId === featureState.groupId);
    if (feature) {
      featureState.x = parseFloat((feature.x || 0).toFixed(2));
      featureState.y = parseFloat((feature.y || 0).toFixed(2));
      featureState.radius = feature.radius;
      featureState.constraints = feature.constraints;
    }
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
    const items = props.editor.getConfig("image.items") || [];
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

watch(
  () => props.editor,
  (editor) => {
    if (editor) {
      editor.on("selection:created", onSelectionCreated);
      editor.on("selection:updated", onSelectionCreated);
      editor.on("selection:cleared", onSelectionCleared);
      editor.on("tool:activated", onToolActivated);
      editor.on("change", onConfigChange);

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
    props.editor.off("change", onConfigChange);
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
