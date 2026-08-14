import PooderRuntimeProvider from "./pooder-runtime-provider.vue";

export { PooderRuntimeProvider };
export {
  createPooderRuntime,
  getPooderDocument,
  installPooderDocument,
  POODER_RUNTIME_KEY,
  usePooderDocument,
  usePooderRuntime,
  usePooderSessions,
} from "./runtime";
export type {
  InstallPooderDocumentOptions,
  PooderConfigurationApi,
  PooderConfigurationChangeEvent,
  PooderDisposable,
  PooderRuntime,
  PooderSessionApi,
} from "./runtime";
export type { ActivateEditorSurfaceResult } from "@pooder/document-core";
export type {
  ApplyEditorDocumentResult,
  DocumentDraft,
  EditorDocumentSession,
  EditorDocumentSessionDerive,
  EditorDocumentChangeEvent,
  EditorDocumentMutationResult,
  EditorDocumentService,
  OpenEditorDocumentSessionInput,
} from "@pooder/document-core";
