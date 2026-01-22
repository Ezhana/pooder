<template>
  <div class="configuration-panel">
    <div v-for="group in configurations" :key="group.extensionId" class="config-group">
      <h3 class="group-title">{{ group.extensionId }}</h3>
      <div v-for="config in group.items" :key="config.id" class="config-item">
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

type ConfigGroup = {
  extensionId: string;
  items: ConfigurationContribution[];
};

const pooder = inject<Pooder>("pooder");
const configurations = ref<ConfigGroup[]>([]);
const values = ref<Record<string, any>>({});
let configService: ConfigurationService | undefined;
let disposable: any;

const refreshConfigs = () => {
  if (!pooder) return;

  // Get all configuration definitions
  const contribs = pooder.getContributions<ConfigurationContribution>(
    ContributionPointIds.CONFIGURATIONS,
  );

  // Group by extension
  const groups: Record<string, ConfigurationContribution[]> = {};
  contribs.forEach((c) => {
    const extId = c.metadata?.extensionId || "General";
    if (!groups[extId]) {
      groups[extId] = [];
    }
    groups[extId].push(c.data);
  });

  // Convert to array and sort
  configurations.value = Object.keys(groups)
    .sort((a, b) => {
      if (a === "General") return -1;
      if (b === "General") return 1;
      return a.localeCompare(b);
    })
    .map((id) => ({
      extensionId: id,
      items: groups[id],
    }));

  // Get current values
  configService = pooder.getService<ConfigurationService>(
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
  padding-left: 10px; /* Indent items */
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
