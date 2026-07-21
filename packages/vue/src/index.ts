import PooderCanvasHost from "./pooder-canvas-host.vue";
import PooderRuntimeProvider from "./pooder-runtime-provider.vue";

export { PooderRuntimeProvider, PooderCanvasHost };
export {
  createPooderRuntime,
  POODER_RUNTIME_KEY,
  usePooderRuntime,
} from "./runtime";
export type {
  PooderCanvasHostReadyPayload,
  PooderCanvasHostRenderSyncPayload,
} from "./canvas-host";
export type { PooderRuntimeLike } from "./runtime";
export {
  applyEditorDocument,
  createEditorDocumentController,
  EDITOR_DOCUMENT_SERVICE,
  registerEditorDocumentService,
} from "@pooder/document-core";
export type {
  ApplyEditorDocumentOptions,
  ApplyEditorDocumentResult,
  EditorDocumentController,
  EditorDocumentRuntime,
  EditorDocumentService,
  EditorDocumentChangeEvent,
  EditorDocumentMutationResult,
  DocumentDraft,
} from "@pooder/document-core";
export { getLegacyRuntimeEventBridge } from "@pooder/core/internal/legacy-extension";
