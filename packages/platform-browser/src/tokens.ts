import { createServiceToken } from "@pooder/core";
import type { FabricSceneAdapter } from "./scene/fabric-scene-adapter";

export {
  CANVAS_SERVICE,
  SCENE_EXPORT_SERVICE,
  SCENE_LAYOUT_SERVICE,
} from "@pooder/core";

export const FABRIC_SCENE_ADAPTER =
  createServiceToken<FabricSceneAdapter>("FabricSceneAdapter");
