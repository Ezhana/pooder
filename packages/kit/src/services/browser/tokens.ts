import { createServiceToken } from "@pooder/core";
import type CanvasService from "./CanvasService";
import type { SceneLayoutService } from "./SceneLayoutService";

export const CANVAS_SERVICE = createServiceToken<CanvasService>(
  "CanvasService",
);

export const SCENE_LAYOUT_SERVICE = createServiceToken<SceneLayoutService>(
  "SceneLayoutService",
);
