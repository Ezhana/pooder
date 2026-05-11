import { createServiceToken } from "@pooder/core";
import type { BrowserSceneExportService } from "./browser-scene-export-service";
import type CanvasService from "./canvas-service";
import type { FabricSceneAdapter } from "./scene/fabric-scene-adapter";
import type { SceneLayoutService } from "./scene-layout-service";

export const CANVAS_SERVICE =
  createServiceToken<CanvasService>("CanvasService");

export const SCENE_LAYOUT_SERVICE =
  createServiceToken<SceneLayoutService>("SceneLayoutService");

export const BROWSER_SCENE_EXPORT_SERVICE =
  createServiceToken<BrowserSceneExportService>("BrowserSceneExportService");

export const FABRIC_SCENE_ADAPTER =
  createServiceToken<FabricSceneAdapter>("FabricSceneAdapter");
