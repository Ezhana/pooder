import PooderRuntimeProvider from "./pooder-runtime-provider.vue";

export { PooderRuntimeProvider };
export {
  createPooderRuntime,
  getPooderDocument,
  installPooderDocument,
  POODER_RUNTIME_KEY,
  usePooderDocument,
  usePooderRuntime,
} from "./runtime";
export type {
  InstallPooderDocumentOptions,
  PooderConfigurationApi,
  PooderConfigurationChangeEvent,
  PooderDisposable,
  PooderRuntime,
} from "./runtime";
export type {
  ApplyEditorDocumentResult,
  DocumentDraft,
  EditorDocumentChangeEvent,
  EditorDocumentMutationResult,
  EditorDocumentService,
} from "@pooder/document-core";
