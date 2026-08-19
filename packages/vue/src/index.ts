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
export type { ActivateSurfaceResult } from "@pooder/document-core";
export type {
  ApplyDocumentResult,
  DocumentDraft,
  DocumentSession,
  DocumentSessionDerive,
  DocumentChangeEvent,
  DocumentMutationResult,
  PooderDocumentService,
  OpenDocumentSessionInput,
} from "@pooder/document-core";
