import { inject, type InjectionKey } from "vue";
import { Pooder } from "@pooder/core";
import {
  registerEditorDocumentService,
  type ActivateEditorSurfaceResult,
  type ApplyEditorDocumentOptions,
  type EditorDocumentPublication,
  type EditorDocumentSession,
  type EditorDocumentService,
  type OpenEditorDocumentSessionInput,
} from "@pooder/document-core";
import type { EditorDocument } from "@pooder/document";

export interface PooderConfigurationChangeEvent {
  key: string;
  value: unknown;
  oldValue: unknown;
}

export interface PooderDisposable {
  dispose(): void;
}

export interface PooderConfigurationApi {
  export(): Record<string, unknown>;
  get<T = unknown>(key: string, defaultValue?: T): T;
  import(data: Record<string, unknown>): void;
  onAnyChange(
    callback: (event: PooderConfigurationChangeEvent) => void,
  ): PooderDisposable;
  onDidChange(
    key: string,
    callback: (event: PooderConfigurationChangeEvent) => void,
  ): PooderDisposable;
  update(key: string, value: unknown): void;
}

export interface PooderSessionApi {
  open<TDraft>(
    input: OpenEditorDocumentSessionInput<TDraft>,
  ): Promise<EditorDocumentSession<TDraft>>;
  get<TDraft = unknown>(
    sessionId: string,
  ): EditorDocumentSession<TDraft> | undefined;
  onDidChange(
    listener: (event: PooderSessionChangeEvent) => void,
  ): PooderDisposable;
}

export interface PooderSessionChangeEvent {
  sessionId: string;
  reason: string;
  state: {
    dirty: boolean;
    focused: boolean;
    phase: string;
  };
  detail?: unknown;
}

export interface PooderRuntime {
  readonly config: PooderConfigurationApi;
  readonly document: EditorDocumentService | null;
  readonly sessions: PooderSessionApi;
  activateSurface(surfaceId: string): Promise<ActivateEditorSurfaceResult>;
  dispose(): Promise<void>;
}

export interface InstallPooderDocumentOptions extends Omit<
  ApplyEditorDocumentOptions,
  "afterPublish" | "publicationParticipants"
> {
  publicationParticipants?: readonly {
    prepare(
      runtime: PooderRuntime,
      document: EditorDocument,
      service: EditorDocumentService,
    ):
      | EditorDocumentPublication
      | void
      | Promise<EditorDocumentPublication | void>;
  }[];
  afterPublish?: (
    runtime: PooderRuntime,
    document: EditorDocument,
    service: EditorDocumentService,
  ) => Promise<void> | void;
}

const runtimeCores = new WeakMap<PooderRuntime, Pooder>();
const runtimeDocuments = new WeakMap<PooderRuntime, EditorDocumentService>();

export const POODER_RUNTIME_KEY: InjectionKey<PooderRuntime> =
  Symbol("PooderRuntime");

export function createPooderRuntime(): PooderRuntime {
  const core = new Pooder();
  const runtime: PooderRuntime = {
    config: {
      export: () => core.config.export(),
      get: <T = unknown>(key: string, defaultValue?: T) =>
        core.config.get(key, defaultValue),
      import: (data) => core.config.import(data),
      onAnyChange: (callback) => core.config.onAnyChange(callback),
      onDidChange: (key, callback) => core.config.onDidChange(key, callback),
      update: (key, value) => core.config.update(key, value),
    },
    get document() {
      return runtimeDocuments.get(runtime) ?? null;
    },
    sessions: {
      open: <TDraft>(input: OpenEditorDocumentSessionInput<TDraft>) =>
        getPooderDocument(runtime).openSession(input),
      get: <TDraft = unknown>(sessionId: string) =>
        getPooderDocument(runtime).getSession<TDraft>(sessionId),
      onDidChange: (listener) =>
        core.sessions.onDidChange((event) =>
          listener({
            sessionId: event.snapshot.descriptor.sessionId,
            reason: event.reason,
            state: {
              dirty: event.snapshot.dirty,
              focused: event.snapshot.focused,
              phase: event.snapshot.phase,
            },
            detail: event.snapshot.draft,
          }),
        ),
    },
    activateSurface: (surfaceId) =>
      getPooderDocument(runtime).activateSurface(surfaceId),
    dispose: () => core.dispose(),
  };
  runtimeCores.set(runtime, core);
  return runtime;
}

export function installPooderDocument(
  runtime: PooderRuntime,
  options: InstallPooderDocumentOptions = {},
): EditorDocumentService {
  const existing = runtimeDocuments.get(runtime);
  if (existing) return existing;
  const core = resolvePooderRuntimeCore(runtime);
  let service: EditorDocumentService;
  service = registerEditorDocumentService(core, {
    effectSchemaRegistry: options.effectSchemaRegistry,
    resolveEffectCapabilityId: options.resolveEffectCapabilityId,
    validators: options.validators,
    publicationParticipants: options.publicationParticipants?.map(
      (participant) => ({
        prepare: ({ document }) =>
          participant.prepare(runtime, document, service),
      }),
    ),
    afterPublish: async (_runtime, document) => {
      await options.afterPublish?.(runtime, document, service);
    },
  });
  runtimeDocuments.set(runtime, service);
  return service;
}

export function getPooderDocument(
  runtime: PooderRuntime,
): EditorDocumentService {
  const service = runtimeDocuments.get(runtime);
  if (!service) {
    throw new Error(
      "[@pooder/vue] EditorDocumentService is not installed for this runtime.",
    );
  }
  return service;
}

export function usePooderRuntime(): PooderRuntime {
  const runtime = inject(POODER_RUNTIME_KEY, null);
  if (!runtime) {
    throw new Error(
      "[@pooder/vue] Pooder runtime was not provided. Wrap consumers with PooderRuntimeProvider.",
    );
  }
  return runtime;
}

export function usePooderDocument(): EditorDocumentService {
  return getPooderDocument(usePooderRuntime());
}

export function usePooderSessions(): PooderSessionApi {
  return usePooderRuntime().sessions;
}

/** @internal Browser/editor adapters only. */
function resolvePooderRuntimeCore(runtime: PooderRuntime): Pooder {
  const core = runtimeCores.get(runtime);
  if (!core) throw new Error("[@pooder/vue] Unknown Pooder runtime facade.");
  return core;
}

/** @internal Browser/editor adapters only. */
export function getPooderRuntimeCore(runtime: PooderRuntime): unknown {
  return resolvePooderRuntimeCore(runtime);
}
