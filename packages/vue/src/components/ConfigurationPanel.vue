<template>
  <div class="configuration-panel">
    <div
      v-for="group in configurations"
      :key="group.extensionId"
      class="config-group"
    >
      <h3 class="group-title">{{ group.extensionId }}</h3>
      <div v-for="config in group.items" :key="config.id" class="config-item">
        <label :for="config.id">{{ config.label || config.id }}</label>

        <select
          v-if="config.type === 'select'"
          :id="config.id"
          :value="values[config.id]"
          @change="
            (e) =>
              updateConfig(config.id, (e.target as HTMLSelectElement).value)
          "
        >
          <option v-for="opt in config.options" :key="String(opt)" :value="opt">
            {{ opt }}
          </option>
        </select>

        <input
          v-else-if="config.type === 'color'"
          type="color"
          :id="config.id"
          :value="values[config.id]"
          @input="
            (e) => updateConfig(config.id, (e.target as HTMLInputElement).value)
          "
        />

        <input
          v-else-if="config.type === 'number'"
          type="number"
          :id="config.id"
          :value="values[config.id]"
          :min="config.min"
          :max="config.max"
          :step="config.step"
          @input="
            (e) =>
              updateConfig(
                config.id,
                Number((e.target as HTMLInputElement).value),
              )
          "
        />

        <input
          v-else-if="config.type === 'boolean'"
          type="checkbox"
          :id="config.id"
          :checked="values[config.id]"
          @change="
            (e) =>
              updateConfig(config.id, (e.target as HTMLInputElement).checked)
          "
        />

        <textarea
          v-else-if="config.type === 'array' || config.type === 'json'"
          :id="config.id"
          :value="JSON.stringify(values[config.id], null, 2)"
          @change="
            (e) => {
              try {
                const val = JSON.parse((e.target as HTMLTextAreaElement).value);
                updateConfig(config.id, val);
              } catch (err) {
                console.error('Invalid JSON', err);
              }
            }
          "
          rows="5"
        ></textarea>

        <input
          v-else
          type="text"
          :id="config.id"
          :value="values[config.id]"
          @input="
            (e) => updateConfig(config.id, (e.target as HTMLInputElement).value)
          "
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import {
  ConfigurationService,
  RegisteredConfigurationDefinition,
} from "@pooder/core";
import { usePooderRuntime } from "../runtime";

type ConfigGroup = {
  extensionId: string;
  items: RegisteredConfigurationDefinition[];
};

const pooder = usePooderRuntime();
const configurations = ref<ConfigGroup[]>([]);
const values = ref<Record<string, any>>({});
let configService: ConfigurationService | undefined;
let definitionsDisposable: { dispose(): void } | undefined;
let valuesDisposable: { dispose(): void } | undefined;

const refreshConfigs = () => {
  if (!pooder) return;

  const definitions = pooder.config.listDefinitions();
  const groups: Record<string, RegisteredConfigurationDefinition[]> = {};

  definitions.forEach((definition) => {
    const extensionId = definition.extensionId || "General";
    if (!groups[extensionId]) {
      groups[extensionId] = [];
    }
    groups[extensionId].push(definition);
  });

  configurations.value = Object.keys(groups)
    .sort((a, b) => {
      if (a === "General") return -1;
      if (b === "General") return 1;
      return a.localeCompare(b);
    })
    .map((extensionId) => ({
      extensionId,
      items: groups[extensionId],
    }));

  configService = pooder.services.get<ConfigurationService>(
    "ConfigurationService",
  );
  if (configService) {
    configurations.value.forEach((group) => {
      group.items.forEach((config) => {
        values.value[config.id] = configService!.get(config.id, config.default);
      });
    });
  }
};

const updateConfig = (key: string, value: any) => {
  if (!configService) {
    return;
  }
  configService.update(key, value);
  values.value[key] = value;
};

onMounted(() => {
  refreshConfigs();

  configService = pooder.services.get<ConfigurationService>(
    "ConfigurationService",
  );

  if (configService) {
    definitionsDisposable = configService.onDefinitionsChange(() => {
      refreshConfigs();
    });
    valuesDisposable = configService.onAnyChange(({ key, value }) => {
      values.value[key] = value;
    });
  }
});

onUnmounted(() => {
  definitionsDisposable?.dispose();
  valuesDisposable?.dispose();
});
</script>

<style scoped>
.configuration-panel {
  padding: 10px;
  background: #f9f9f9;
  border-top: 1px solid #ddd;
  overflow-y: auto;
  max-height: 300px;
}

.config-group {
  margin-bottom: 20px;
}

.group-title {
  font-size: 1.1em;
  font-weight: bold;
  margin-bottom: 10px;
  padding-bottom: 5px;
  border-bottom: 2px solid #eee;
  color: #333;
}

.config-item {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  padding-left: 10px;
}

label {
  font-size: 0.9em;
  margin-bottom: 4px;
  color: #555;
  font-weight: 500;
}

input[type="text"],
input[type="number"],
select,
textarea {
  padding: 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 0.95em;
}

input[type="checkbox"] {
  width: 18px;
  height: 18px;
}

textarea {
  font-family: monospace;
  resize: vertical;
}
</style>
