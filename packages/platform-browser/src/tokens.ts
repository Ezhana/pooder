import { createServiceToken } from "@pooder/core";
import type CanvasService from "./canvas-service";
import type { SceneLayoutService } from "./scene-layout-service";

export const CANVAS_SERVICE =
  createServiceToken<CanvasService>("CanvasService");

export const SCENE_LAYOUT_SERVICE =
  createServiceToken<SceneLayoutService>("SceneLayoutService");
