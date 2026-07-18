import { createServiceToken } from "../service";
import type CapabilityRegistryService from "./CapabilityRegistryService";
import type CommandService from "./CommandService";
import type ConfigurationService from "./ConfigurationService";
import type {
  RenderIntentCompilerRegistryService,
  RenderIntentService,
} from "../render-intent";
import type SceneService from "./SceneService";
import type SessionService from "./SessionService";
import type { ConstraintResolverService } from "../constraint-resolver";
import type { GeometrySourceService } from "../geometry-source";
import type { InteractionService } from "../interaction-service";
import type {
  CanvasService,
  RenderEffectRegistryService,
  SceneExportService,
  SceneLayoutService,
} from "../render";
import type { DefaultSurfaceFrameService } from "../surface-frames";

export const CAPABILITY_REGISTRY_SERVICE =
  createServiceToken<CapabilityRegistryService>("CapabilityRegistryService");
export const COMMAND_SERVICE =
  createServiceToken<CommandService>("CommandService");
export const CONFIGURATION_SERVICE = createServiceToken<ConfigurationService>(
  "ConfigurationService",
);
export const RENDER_INTENT_SERVICE = createServiceToken<RenderIntentService>(
  "RenderIntentService",
);
export const RENDER_INTENT_COMPILER_REGISTRY_SERVICE =
  createServiceToken<RenderIntentCompilerRegistryService>(
    "RenderIntentCompilerRegistryService",
  );
export const RENDER_EFFECT_REGISTRY_SERVICE =
  createServiceToken<RenderEffectRegistryService>(
    "RenderEffectRegistryService",
  );
export const SCENE_SERVICE = createServiceToken<SceneService>("SceneService");
export const CANVAS_SERVICE =
  createServiceToken<CanvasService>("CanvasService");
export const SCENE_LAYOUT_SERVICE =
  createServiceToken<SceneLayoutService>("SceneLayoutService");
export const SURFACE_FRAME_SERVICE =
  createServiceToken<DefaultSurfaceFrameService>("SurfaceFrameService");
export const SCENE_EXPORT_SERVICE =
  createServiceToken<SceneExportService>("SceneExportService");
export const SESSION_SERVICE =
  createServiceToken<SessionService>("SessionService");
export const GEOMETRY_SOURCE_SERVICE =
  createServiceToken<GeometrySourceService>("GeometrySourceService");
export const CONSTRAINT_RESOLVER_SERVICE =
  createServiceToken<ConstraintResolverService>("ConstraintResolverService");
export const INTERACTION_SERVICE =
  createServiceToken<InteractionService>("InteractionService");

export const CORE_SERVICE_TOKENS = {
  CAPABILITY_REGISTRY: CAPABILITY_REGISTRY_SERVICE,
  COMMAND: COMMAND_SERVICE,
  CONFIGURATION: CONFIGURATION_SERVICE,
  RENDER_INTENT: RENDER_INTENT_SERVICE,
  RENDER_INTENT_COMPILER_REGISTRY: RENDER_INTENT_COMPILER_REGISTRY_SERVICE,
  RENDER_EFFECT_REGISTRY: RENDER_EFFECT_REGISTRY_SERVICE,
  CANVAS: CANVAS_SERVICE,
  SCENE: SCENE_SERVICE,
  SCENE_LAYOUT: SCENE_LAYOUT_SERVICE,
  SURFACE_FRAME: SURFACE_FRAME_SERVICE,
  SCENE_EXPORT: SCENE_EXPORT_SERVICE,
  SESSION: SESSION_SERVICE,
  GEOMETRY_SOURCE: GEOMETRY_SOURCE_SERVICE,
  CONSTRAINT_RESOLVER: CONSTRAINT_RESOLVER_SERVICE,
  INTERACTION: INTERACTION_SERVICE,
} as const;
