import type { FabricRenderGraphSyncState } from "@pooder/platform-browser";

export interface PooderCanvasHostReadyPayload {
  flushRender(): Promise<void>;
}

export type PooderCanvasHostRenderSyncPayload = FabricRenderGraphSyncState;
