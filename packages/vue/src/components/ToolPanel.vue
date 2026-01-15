<template>
  <div class="tool-panel" v-if="editor">
    <div class="plugin-section" v-for="ext in extensionList" :key="ext.name">
      <h3>{{ ext.name }}</h3>
      <div v-if="ext.options">
        <div v-for="(val, key) in ext.options" :key="key" class="config-item">
          <label>{{ getLabel(ext, String(key)) }}</label>

          <!-- Select -->
          <div v-if="getInputType(ext, String(key), val) === 'select'">
            <select
              :value="val"
              @change="
                (e) =>
                  updateOption(ext, key, (e.target as HTMLSelectElement).value)
              "
            >
              <option
                v-for="opt in getSelectOptions(ext, String(key))"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </option>
            </select>
          </div>

          <!-- Color -->
          <div v-else-if="getInputType(ext, String(key), val) === 'color'">
            <ColorPicker
              :modelValue="String(val)"
              @update:modelValue="(v) => updateOption(ext, key, v)"
            />
          </div>

          <!-- Number -->
          <div v-else-if="getInputType(ext, String(key), val) === 'number'">
            <input
              type="number"
              :value="val"
              @input="
                (e) =>
                  updateOption(
                    ext,
                    key,
                    Number((e.target as HTMLInputElement).value),
                  )
              "
            />
            <div class="slider-container">
              <input
                type="range"
                :min="getMinMax(ext, String(key), val).min"
                :max="getMinMax(ext, String(key), val).max"
                :step="getMinMax(ext, String(key), val).step"
                :value="val"
                @input="
                  (e) =>
                    updateOption(
                      ext,
                      key,
                      Number((e.target as HTMLInputElement).value),
                    )
                "
              />
              <span class="slider-value">{{ formatNumber(val) }}</span>
            </div>
          </div>

          <!-- Switch (Boolean) -->
          <div v-else-if="getInputType(ext, String(key), val) === 'boolean'">
            <div class="switch-wrapper">
              <label class="switch">
                <input
                  type="checkbox"
                  :checked="Boolean(val)"
                  @change="
                    (e) =>
                      updateOption(
                        ext,
                        key,
                        (e.target as HTMLInputElement).checked,
                      )
                  "
                />
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <!-- Checkbox -->
          <div v-else-if="getInputType(ext, String(key), val) === 'checkbox'">
            <div class="checkbox-wrapper">
              <input
                type="checkbox"
                :checked="Boolean(val)"
                @change="
                  (e) =>
                    updateOption(
                      ext,
                      key,
                      (e.target as HTMLInputElement).checked,
                    )
                "
              />
            </div>
          </div>

          <!-- Text (Fallback) -->
          <div v-else>
            <input
              type="text"
              :value="val"
              @input="
                (e) =>
                  updateOption(ext, key, (e.target as HTMLInputElement).value)
              "
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  watch,
  PropType,
  reactive,
  isReactive,
} from "vue";
import { Editor, Extension, OptionSchema } from "@pooder/core";
import ColorPicker from "./ColorPicker.vue";

export default defineComponent({
  name: "ToolPanel",
  components: { ColorPicker },
  props: {
    editor: {
      type: Object as PropType<Editor | null>,
      default: null,
    },
  },
  setup(props) {
    const extensionList = ref<Extension[]>([]);

    const updateExtensions = () => {
      if (props.editor) {
        // Map extensions to array and ensure options are reactive for UI binding
        extensionList.value = Array.from(
          props.editor.getExtensions().map((ext) => {
            if (ext.options && !isReactive(ext.options)) {
              // We wrap options in reactive so changes reflect in UI (e.g. slider updating number input)
              ext.options = reactive(ext.options);
            }
            return ext;
          }),
        );
      } else {
        extensionList.value = [];
      }
    };

    watch(
      () => props.editor,
      (newEditor) => {
        updateExtensions();
      },
      { immediate: true },
    );

    const getSchema = (
      ext: Extension,
      key: string,
    ): OptionSchema | undefined => {
      return ext.schema?.[key];
    };

    const getLabel = (ext: Extension, key: string): string => {
      const schema = getSchema(ext, key);
      if (schema && schema.label) return schema.label;
      // Capitalize first letter
      return key.charAt(0).toUpperCase() + key.slice(1);
    };

    const getInputType = (ext: Extension, key: string, value: any): string => {
      const schema = getSchema(ext, key);
      if (schema && schema.type) return schema.type;

      // Fallback heuristics
      if (typeof value === "boolean") return "checkbox";
      if (typeof value === "number") return "number";
      if (typeof value === "string") {
        const k = key.toLowerCase();
        if (k.includes("color") || k.includes("fill") || k.includes("stroke"))
          return "color";
        if (value.startsWith("#") || value.startsWith("rgb")) return "color";
        return "text";
      }
      return "text";
    };

    const getSelectOptions = (
      ext: Extension,
      key: string,
    ): { label: string; value: any }[] => {
      const schema = getSchema(ext, key);
      if (!schema || !schema.options) return [];

      return schema.options.map((opt: any) => {
        if (typeof opt === "string") {
          return { label: opt, value: opt };
        }
        return opt;
      });
    };

    const getMinMax = (ext: Extension, key: string, val: number) => {
      const schema = getSchema(ext, key);
      if (schema) {
        return {
          min: schema.min ?? 0,
          max: schema.max ?? 100,
          step: schema.step ?? 1,
        };
      }

      // Heuristic for slider range
      if (val <= 1 && val >= 0) {
        return { min: 0, max: 1, step: 0.01 };
      }
      // Default large range
      const max = Math.max(1000, val * 2);
      return { min: 0, max: max, step: 1 };
    };

    const formatNumber = (val: any) => {
      if (typeof val === "number") {
        return Number.isInteger(val) ? val : val.toFixed(2);
      }
      return val;
    };

    const updateOption = (ext: Extension, key: string | number, value: any) => {
      if (!ext.options) return;
      ext.options[String(key)] = value;

      // Trigger editor update
      if (props.editor) {
        // We trigger a state update to notify the system that something changed.
        // The exact mechanism depends on how the editor listens to changes,
        // but updateState triggers extensionManager.update()
        props.editor.updateState((s) => ({ ...s }));
      }
    };

    return {
      extensionList,
      getInputType,
      updateOption,
      getMinMax,
      formatNumber,
      getLabel,
      getSelectOptions,
    };
  },
});
</script>

<style scoped>
.tool-panel {
  padding: 15px;
  overflow-x: auto;
  overflow-y: hidden;
  height: 100%;
  display: flex;
  flex-direction: row;
  background: #f9f9f9;
}
.plugin-section {
  width: 300px;
  flex-shrink: 0;
  margin-right: 20px;
  border-right: 1px solid #eee;
  padding-right: 20px;
  height: 100%;
  overflow-y: auto;
}
.plugin-section h3 {
  margin-top: 0;
  margin-bottom: 15px;
  font-size: 16px;
  color: #333;
  border-bottom: 2px solid #ddd;
  padding-bottom: 5px;
}
.config-item {
  margin-bottom: 15px;
}
.config-item label {
  display: block;
  margin-bottom: 5px;
  font-size: 14px;
  font-weight: 500;
  color: #555;
}
.config-item input[type="text"],
.config-item input[type="number"],
.config-item select {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  box-sizing: border-box;
  font-size: 14px;
}
.config-item input[type="checkbox"] {
  transform: scale(1.2);
}
.checkbox-wrapper {
  padding: 5px 0;
}
.slider-container {
  display: flex;
  align-items: center;
  margin-top: 5px;
}
.slider-container input[type="range"] {
  flex: 1;
  margin-right: 10px;
}
.slider-value {
  font-size: 12px;
  color: #666;
  width: 35px;
  text-align: right;
}

/* Switch Styles */
.switch-wrapper {
  padding: 5px 0;
}
.switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 20px;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: 0.4s;
  border-radius: 20px;
}
.slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  transition: 0.4s;
  border-radius: 50%;
}
input:checked + .slider {
  background-color: #2196f3;
}
input:checked + .slider:before {
  transform: translateX(20px);
}
</style>
