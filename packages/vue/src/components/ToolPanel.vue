<template>
  <div class="pooder-tool-panel">
    <div class="panel-section">
      <h3>Tools</h3>
      <div class="tool-list">
        <div v-for="cmd in commands" :key="cmd.command" class="tool-item">
          <button @click="executeCommand(cmd)">{{ cmd.title }}</button>
        </div>
      </div>
    </div>

    <div class="panel-section">
      <h3>Configuration</h3>
      <ConfigurationPanel />
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject, ref, onMounted, onUnmounted } from "vue";
import {
  Pooder,
  ContributionPointIds,
  CommandContribution,
} from "@pooder/core";
import CommandService from "@pooder/core/src/services/CommandService";
import ConfigurationPanel from "./ConfigurationPanel.vue";

const pooder = inject<Pooder>("pooder");
const commands = ref<CommandContribution[]>([]);

const updateCommands = () => {
  if (pooder) {
    const contribs = pooder.getContributions<CommandContribution>(
      ContributionPointIds.COMMANDS,
    );
    commands.value = contribs.map((c) => c.data);
  }
};

const executeCommand = async (cmd: CommandContribution) => {
  if (!pooder) return;
  const commandService = pooder.getService<CommandService>("CommandService");
  if (commandService) {
    try {
      await commandService.executeCommand(cmd.command);
    } catch (e) {
      console.error("Command execution failed", e);
    }
  }
};

onMounted(() => {
  updateCommands();
  if (pooder) {
    pooder.eventBus.on("contribution:register", updateCommands);
  }
});

onUnmounted(() => {
  if (pooder) {
    pooder.eventBus.off("contribution:register", updateCommands);
  }
});
</script>

<style scoped>
.pooder-tool-panel {
  width: 250px;
  background: #fff;
  border-right: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}

.panel-section {
  padding: 10px;
  border-bottom: 1px solid #eee;
}

h3 {
  margin-top: 0;
  margin-bottom: 10px;
  font-size: 1.1em;
  color: #333;
}

.tool-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

button {
  padding: 8px 12px;
  background: #eee;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  transition: background 0.2s;
}

button:hover {
  background: #e0e0e0;
}
</style>
