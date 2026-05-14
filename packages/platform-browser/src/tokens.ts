import { createServiceToken } from "@pooder/core";
import type { FabricRenderGraphAdapter } from "./scene/fabric-render-graph-adapter";

export {
  CANVAS_SERVICE,
  SCENE_EXPORT_SERVICE,
  SCENE_LAYOUT_SERVICE,
} from "@pooder/core";

export const FABRIC_RENDER_GRAPH_ADAPTER =
  createServiceToken<FabricRenderGraphAdapter>("FabricRenderGraphAdapter");
export const FABRIC_SCENE_ADAPTER = FABRIC_RENDER_GRAPH_ADAPTER;
