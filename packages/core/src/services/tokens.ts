import { createServiceToken } from "../service";
import type CommandService from "./CommandService";
import type ConfigurationService from "./ConfigurationService";
import type ToolRegistryService from "./ToolRegistryService";
import type ToolSessionService from "./ToolSessionService";
import type WorkbenchService from "./WorkbenchService";

export const COMMAND_SERVICE = createServiceToken<CommandService>(
  "CommandService",
);
export const CONFIGURATION_SERVICE = createServiceToken<ConfigurationService>(
  "ConfigurationService",
);
export const TOOL_REGISTRY_SERVICE =
  createServiceToken<ToolRegistryService>("ToolRegistryService");
export const TOOL_SESSION_SERVICE =
  createServiceToken<ToolSessionService>("ToolSessionService");
export const WORKBENCH_SERVICE =
  createServiceToken<WorkbenchService>("WorkbenchService");

export const CORE_SERVICE_TOKENS = {
  COMMAND: COMMAND_SERVICE,
  CONFIGURATION: CONFIGURATION_SERVICE,
  TOOL_REGISTRY: TOOL_REGISTRY_SERVICE,
  TOOL_SESSION: TOOL_SESSION_SERVICE,
  WORKBENCH: WORKBENCH_SERVICE,
} as const;
