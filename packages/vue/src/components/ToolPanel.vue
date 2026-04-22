<template>
  <div class="pooder-tool-panel">
    <div class="panel-section">
      <h3>Tools</h3>
      <div class="tool-list">
        <div v-for="tool in tools" :key="tool.id" class="tool-item">
          <button @click="activateTool(tool.id)">{{ tool.name }}</button>
        </div>
      </div>
    </div>

    <div class="panel-section">
      <h3>Commands</h3>
      <div class="tool-list">
        <div v-for="command in commands" :key="command.id" class="tool-item">
          <button @click="executeCommand(command.id)">
            {{ command.title || command.id }}
          </button>
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
import { onMounted, onUnmounted, ref } from "vue";
import {
  COMMAND_SERVICE,
  ToolContribution,
  ToolRegistryService,
  WorkbenchService,
  WORKBENCH_SERVICE,
} from "@pooder/core";
import ConfigurationPanel from "./ConfigurationPanel.vue";
import { usePooderRuntime } from "../runtime";

const pooder = usePooderRuntime();
const tools = ref<ToolContribution[]>([]);
const commands = ref<Array<{ id: string; title?: string }>>([]);

const refreshLists = () => {
  if (!pooder) return;

  const toolRegistry =
    pooder.services.get<ToolRegistryService>("ToolRegistryService");
  tools.value = toolRegistry?.listTools() || [];

  const commandService = pooder.services.get(COMMAND_SERVICE);
  commands.value = Array.from(commandService?.getCommands().values() || []).map(
    (command) => ({
      id: command.id,
      title: command.title,
    }),
  );
};

const executeCommand = async (id: string) => {
  if (!pooder) return;
  try {
    await pooder.commands.execute(id);
  } catch (error) {
    console.error("Command execution failed", error);
  }
};

const activateTool = async (id: string) => {
  if (!pooder) return;
  const workbench = pooder.services.get<WorkbenchService>(WORKBENCH_SERVICE);
  if (!workbench) {
    return;
  }
  try {
    await workbench.activate(id);
  } catch (error) {
    console.error("Tool activation failed", error);
  }
};

onMounted(() => {
  refreshLists();
  pooder.eventBus.on("extension:state-change", refreshLists);
});

onUnmounted(() => {
  pooder.eventBus.off("extension:state-change", refreshLists);
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
