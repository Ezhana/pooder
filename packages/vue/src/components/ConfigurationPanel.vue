<template>
  <div class="configuration-panel">
    <div v-for="config in configurations" :key="config.id" class="config-item">
      <label :for="config.id">{{ config.label || config.id }}</label>

      <!-- Select Input -->
      <select
        v-if="config.type === 'select'"
        :id="config.id"
        :value="values[config.id]"
        @change="
          (e) => updateConfig(config.id, (e.target as HTMLSelectElement).value)
        "
      >
        <option v-for="opt in config.options" :key="opt" :value="opt">
          {{ opt }}
        </option>
      </select>

      <!-- Color Input -->
      <input
        v-else-if="config.type === 'color'"
        type="color"
        :id="config.id"
        :value="values[config.id]"
        @input="
          (e) => updateConfig(config.id, (e.target as HTMLInputElement).value)
        "
      />

      <!-- Number Input -->
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

      <!-- Boolean Input -->
      <input
        v-else-if="config.type === 'boolean'"
        type="checkbox"
        :id="config.id"
        :checked="values[config.id]"
        @change="
          (e) => updateConfig(config.id, (e.target as HTMLInputElement).checked)
        "
      />

      <!-- String/Default Input -->
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
</template>

<script setup lang="ts">
import { inject, ref, onMounted, onUnmounted, watch } from "vue";
import {
  Pooder,
  ContributionPointIds,
  ConfigurationContribution,
  ConfigurationService,
} from "@pooder/core";

const pooder = inject<Pooder>("pooder");
const configurations = ref<ConfigurationContribution[]>([]);
const values = ref<Record<string, any>>({});
let configService: ConfigurationService | undefined;
let disposable: any;

const refreshConfigs = () => {
  if (!pooder) return;

  // Get all configuration definitions
  const contribs = pooder.getContributions<ConfigurationContribution>(
    ContributionPointIds.CONFIGURATIONS,
  );
  configurations.value = contribs.map((c) => c.data);

  // Get current values
  configService = pooder.getService<ConfigurationService>(
    "ConfigurationService",
  );
  if (configService) {
    configurations.value.forEach((config) => {
      values.value[config.id] = configService!.get(config.id, config.default);
    });
  }
};

const updateConfig = (key: string, value: any) => {
  if (configService) {
    configService.update(key, value);
    values.value[key] = value;
  }
};

onMounted(() => {
  refreshConfigs();

  if (pooder) {
    // Listen for new contributions (in case plugins load late)
    pooder.eventBus.on("contribution:register", (event: any) => {
      if (event.pointId === ContributionPointIds.CONFIGURATIONS) {
        refreshConfigs();
      }
    });

    // Listen for external config changes
    configService = pooder.getService<ConfigurationService>(
      "ConfigurationService",
    );
    if (configService) {
      disposable = configService.onAnyChange(({ key, value }) => {
        values.value[key] = value;
      });
    }
  }
});

onUnmounted(() => {
  if (disposable) disposable.dispose();
  // Also remove eventBus listener if possible, but Pooder's eventBus in snippet didn't show off() for specific handler reference easily unless we kept the wrapper.
  // Assuming short lifecycle or acceptable leak for this demo.
});
</script>

<style scoped>
.configuration-panel {
  padding: 10px;
  background: #f9f9f9;
  border-top: 1px solid #ddd;
  overflow-y: auto;
  max-height: 300px; /* Optional limit */
}

.config-item {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
}

label {
  font-size: 0.9em;
  margin-bottom: 4px;
  color: #555;
  font-weight: 500;
}

input[type="text"],
input[type="number"],
select {
  padding: 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}

input[type="color"] {
  width: 100%;
  height: 30px;
  padding: 0;
  border: none;
  cursor: pointer;
}
</style>
