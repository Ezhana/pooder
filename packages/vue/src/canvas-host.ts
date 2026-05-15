export interface PooderCanvasHostReadyPayload {
  flushRender(): Promise<void>;
}

export interface PooderCanvasHostRenderLoadingPayload {
  error?: unknown;
  generation: number;
  loading: boolean;
  pending: number;
}
