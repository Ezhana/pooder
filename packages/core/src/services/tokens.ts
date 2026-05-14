import { createServiceToken } from "../service";
import type CapabilityRegistryService from "./CapabilityRegistryService";
import type CommandService from "./CommandService";
import type ConfigurationService from "./ConfigurationService";
import type EffectApplicatorRegistryService from "./EffectApplicatorRegistryService";
import type {
  RenderIntentCompilerRegistryService,
  RenderIntentService,
} from "../render-intent";
import type SceneService from "./SceneService";
import type ToolRegistryService from "./ToolRegistryService";
import type ToolSessionService from "./ToolSessionService";
import type WorkbenchService from "./WorkbenchService";
import type WorkflowSessionService from "./WorkflowSessionService";
import type {
  CanvasService,
  SceneExportService,
  SceneLayoutService,
} from "../render";

export const CAPABILITY_REGISTRY_SERVICE =
  createServiceToken<CapabilityRegistryService>("CapabilityRegistryService");
export const COMMAND_SERVICE = createServiceToken<CommandService>(
  "CommandService",
);
export const CONFIGURATION_SERVICE = createServiceToken<ConfigurationService>(
  "ConfigurationService",
);
export const EFFECT_APPLICATOR_REGISTRY_SERVICE =
  createServiceToken<EffectApplicatorRegistryService>(
    "EffectApplicatorRegistryService",
  );
export const RENDER_INTENT_SERVICE =
  createServiceToken<RenderIntentService>("RenderIntentService");
export const RENDER_INTENT_COMPILER_REGISTRY_SERVICE =
  createServiceToken<RenderIntentCompilerRegistryService>(
    "RenderIntentCompilerRegistryService",
  );
export const SCENE_SERVICE = createServiceToken<SceneService>("SceneService");
export const CANVAS_SERVICE = createServiceToken<CanvasService>("CanvasService");
export const SCENE_LAYOUT_SERVICE =
  createServiceToken<SceneLayoutService>("SceneLayoutService");
export const SCENE_EXPORT_SERVICE =
  createServiceToken<SceneExportService>("SceneExportService");
export const TOOL_REGISTRY_SERVICE =
  createServiceToken<ToolRegistryService>("ToolRegistryService");
export const TOOL_SESSION_SERVICE =
  createServiceToken<ToolSessionService>("ToolSessionService");
export const WORKBENCH_SERVICE =
  createServiceToken<WorkbenchService>("WorkbenchService");
export const WORKFLOW_SESSION_SERVICE =
  createServiceToken<WorkflowSessionService>("WorkflowSessionService");

export const CORE_SERVICE_TOKENS = {
  CAPABILITY_REGISTRY: CAPABILITY_REGISTRY_SERVICE,
  COMMAND: COMMAND_SERVICE,
  CONFIGURATION: CONFIGURATION_SERVICE,
  EFFECT_APPLICATOR_REGISTRY: EFFECT_APPLICATOR_REGISTRY_SERVICE,
  RENDER_INTENT: RENDER_INTENT_SERVICE,
  RENDER_INTENT_COMPILER_REGISTRY: RENDER_INTENT_COMPILER_REGISTRY_SERVICE,
  CANVAS: CANVAS_SERVICE,
  SCENE: SCENE_SERVICE,
  SCENE_LAYOUT: SCENE_LAYOUT_SERVICE,
  SCENE_EXPORT: SCENE_EXPORT_SERVICE,
  TOOL_REGISTRY: TOOL_REGISTRY_SERVICE,
  TOOL_SESSION: TOOL_SESSION_SERVICE,
  WORKBENCH: WORKBENCH_SERVICE,
  WORKFLOW_SESSION: WORKFLOW_SESSION_SERVICE,
} as const;
