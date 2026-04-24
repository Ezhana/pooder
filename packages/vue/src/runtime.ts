import type { InjectionKey } from "vue";
import { inject } from "vue";
import { Pooder } from "@pooder/core";
import type {
  ExtensionDefinition,
  ExtensionStateSnapshot,
  RegisterServiceOptions,
  Service,
  ServiceIdentifier,
} from "@pooder/core";

export interface PooderRuntimeLike {
  readonly eventBus: {
    clear(): void;
    count(event: string): number;
    emit(event: string, ...args: any[]): void;
    off(event: string, handler: (...args: any[]) => void | boolean): void;
    on(
      event: string,
      handler: (...args: any[]) => void | boolean,
      priority?: number,
    ): void;
  };
  readonly services: {
    register<T extends Service>(
      service: T,
      identifier?: ServiceIdentifier<T>,
      options?: RegisterServiceOptions,
    ): boolean;
    registerAsync<T extends Service>(
      service: T,
      identifier?: ServiceIdentifier<T>,
      options?: RegisterServiceOptions,
    ): Promise<boolean>;
    unregister(
      serviceOrIdentifier: Service | ServiceIdentifier<Service>,
      identifier?: ServiceIdentifier<Service>,
    ): boolean;
    unregisterAsync(
      serviceOrIdentifier: Service | ServiceIdentifier<Service>,
      identifier?: ServiceIdentifier<Service>,
    ): Promise<boolean>;
    get<T extends Service>(identifier: ServiceIdentifier<T>): T | undefined;
    getOrThrow<T extends Service>(
      identifier: ServiceIdentifier<T>,
      errorMessage?: string,
    ): T;
    has(identifier: ServiceIdentifier<Service>): boolean;
  };
  readonly extensions: {
    register(extension: ExtensionDefinition): ExtensionStateSnapshot;
    registerMany(
      extensions: Iterable<ExtensionDefinition>,
    ): ExtensionStateSnapshot[];
    flushActivation(): Promise<ExtensionStateSnapshot[]>;
    getState(id: string): ExtensionStateSnapshot | undefined;
    listStates(): ExtensionStateSnapshot[];
    unregister(id: string): Promise<boolean>;
  };
  readonly commands: {
    execute<T = unknown>(id: string, ...args: any[]): Promise<T>;
  };
  readonly config: {
    export(): Record<string, any>;
    get<T = unknown>(key: string, defaultValue?: T): T;
    getDefinition(id: string): any;
    import(data: Record<string, any>): void;
    listDefinitions(): any;
    update(key: string, value: any): void;
  };
  readonly workbench: {
    activate(id: string | null): Promise<any>;
    deactivate(): Promise<any>;
    readonly activeToolId: string | null;
  };
}

export const POODER_RUNTIME_KEY: InjectionKey<PooderRuntimeLike> = Symbol(
  "PooderRuntime",
);

export function createPooderRuntime(): PooderRuntimeLike {
  return new Pooder();
}

export function usePooderRuntime(): PooderRuntimeLike {
  const runtime = inject(POODER_RUNTIME_KEY, null);
  if (!runtime) {
    throw new Error(
      "[@pooder/vue] Pooder runtime was not provided. Wrap consumers with PooderRuntimeProvider.",
    );
  }
  return runtime;
}
