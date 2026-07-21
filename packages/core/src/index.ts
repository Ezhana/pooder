import {
  isServiceToken,
  RegisterServiceOptions,
  Service,
  ServiceContext,
  ServiceIdentifier,
  ServiceRegistry,
} from "./service";
import EventBus from "./event";
import type Disposable from "./disposable";
import {
  ExtensionManager,
  type ExtensionDefinition,
  type ExtensionStateSnapshot,
} from "./extension";
import type { RegisteredCapabilityDefinition } from "./capability";
import {
  CORE_SERVICE_TOKENS,
  CapabilityRegistryService,
  CommandService,
  ConfigurationService,
  ConstraintResolverService,
  GeometrySourceService,
  InteractionService,
  DefaultSurfaceFrameService,
  RenderEffectRegistryService,
  RenderIntentCompilerRegistryService,
  RenderIntentService,
  SceneService,
  SessionService,
} from "./services";
import { ExtensionContext } from "./context";
import { TypedEventEmitter } from "./typed-event";
import { createRenderIntentGeometrySource } from "./render-intent";

export interface RuntimeServiceChangeEvent {
  readonly type: "registered" | "unregistered";
  readonly id: string;
  readonly service: Service;
}

export * from "./extension";
export * from "./context";
export * from "./capability";
export * from "./contribution";
export * from "./scene";
export * from "./render";
export * from "./render-intent";
export * from "./coordinate";
export * from "./image-geometry";
export * from "./image-resource";
export * from "./units";
export * from "./dieline-shape";
export * from "./scene-layout-model";
export * from "./service";
export * from "./workflow-session";
export * from "./interaction";
export * from "./geometry-source";
export * from "./constraint-resolver";
export * from "./interaction-service";
export * from "./surface-frames";
export * from "./typed-event";
export * from "./services";
export type { default as Disposable } from "./disposable";
/** @internal Temporary legacy test/extension bridge. */
export { default as EventBus } from "./event";

type RuntimeServicesApi = {
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
    id?: ServiceIdentifier<Service>,
  ): boolean;
  unregisterAsync(
    serviceOrIdentifier: Service | ServiceIdentifier<Service>,
    id?: ServiceIdentifier<Service>,
  ): Promise<boolean>;
  get<T extends Service>(identifier: ServiceIdentifier<T>): T | undefined;
  getOrThrow<T extends Service>(
    identifier: ServiceIdentifier<T>,
    errorMessage?: string,
  ): T;
  has(identifier: ServiceIdentifier<Service>): boolean;
  onDidChange(listener: (event: RuntimeServiceChangeEvent) => void): Disposable;
};

type RuntimeExtensionsApi = {
  register(extension: ExtensionDefinition): ExtensionStateSnapshot;
  registerMany(
    extensions: Iterable<ExtensionDefinition>,
  ): ExtensionStateSnapshot[];
  flushActivation(): Promise<ExtensionStateSnapshot[]>;
  getState(id: string): ExtensionStateSnapshot | undefined;
  listStates(): ExtensionStateSnapshot[];
  unregister(id: string): Promise<boolean>;
  onDidChange: ExtensionManager["onDidChange"];
};

type RuntimeCommandsApi = {
  execute<T = unknown>(id: string, ...args: any[]): Promise<T>;
};

type RuntimeCapabilitiesApi = {
  get<TFacade = unknown>(id: string): TFacade | undefined;
  getOrThrow<TFacade = unknown>(id: string, errorMessage?: string): TFacade;
  getDefinition<TFacade = unknown>(
    id: string,
  ): RegisteredCapabilityDefinition<TFacade> | undefined;
  list(): RegisteredCapabilityDefinition[];
  has(id: string): boolean;
  onDidChange(
    callback: Parameters<CapabilityRegistryService["onDidChange"]>[0],
  ): Disposable;
};

type RuntimeConfigApi = {
  get<T = unknown>(key: string, defaultValue?: T): T;
  update(key: string, value: any): void;
  import(data: Record<string, any>): void;
  export(): Record<string, any>;
  listDefinitions(): ReturnType<ConfigurationService["listDefinitions"]>;
  getDefinition(id: string): ReturnType<ConfigurationService["getDefinition"]>;
  onDidChange(
    key: string,
    callback: Parameters<ConfigurationService["onDidChange"]>[1],
  ): Disposable;
  onAnyChange(
    callback: Parameters<ConfigurationService["onAnyChange"]>[0],
  ): Disposable;
  onDefinitionsChange(
    callback: Parameters<ConfigurationService["onDefinitionsChange"]>[0],
  ): Disposable;
};

type RuntimeSessionsApi = {
  open: SessionService["open"];
  getHandle: SessionService["getHandle"];
  listSnapshots: SessionService["listSnapshots"];
  onDidChange: SessionService["onDidChange"];
  onDidTerminate: SessionService["onDidTerminate"];
};

export class Pooder {
  /** @internal Temporary bridge for extensions wrapped by defineLegacyExtension(). */
  readonly eventBus: EventBus = new EventBus();
  private readonly serviceRegistry: ServiceRegistry = new ServiceRegistry();
  private readonly serviceEvents = new TypedEventEmitter<{
    change: RuntimeServiceChangeEvent;
  }>();
  private readonly serviceContext: ServiceContext = {
    eventBus: this.eventBus,
    get: <T extends Service>(identifier: ServiceIdentifier<T>) =>
      this.serviceRegistry.get(identifier),
    getOrThrow: <T extends Service>(
      identifier: ServiceIdentifier<T>,
      errorMessage?: string,
    ) => this.serviceRegistry.getOrThrow(identifier, errorMessage),
    has: (identifier: ServiceIdentifier<Service>) =>
      this.serviceRegistry.has(identifier),
  };
  private readonly commandService = new CommandService();
  private readonly capabilityRegistryService = new CapabilityRegistryService();
  private readonly configurationService = new ConfigurationService();
  private readonly renderIntentService = new RenderIntentService();
  private readonly renderEffectRegistryService =
    new RenderEffectRegistryService();
  private readonly renderIntentCompilerRegistryService =
    new RenderIntentCompilerRegistryService();
  private readonly sceneService = new SceneService();
  private readonly sessionService = new SessionService();
  private readonly surfaceFrameService = new DefaultSurfaceFrameService();
  private readonly geometrySourceService = new GeometrySourceService();
  private readonly constraintResolverService = new ConstraintResolverService(
    this.geometrySourceService,
  );
  private readonly interactionService = new InteractionService({
    commandService: this.commandService,
    constraintResolver: this.constraintResolverService,
    sessionService: this.sessionService,
  });
  private readonly extensionManager: ExtensionManager;

  readonly services: RuntimeServicesApi;
  readonly extensions: RuntimeExtensionsApi;
  readonly commands: RuntimeCommandsApi;
  readonly capabilities: RuntimeCapabilitiesApi;
  readonly config: RuntimeConfigApi;
  readonly sessions: RuntimeSessionsApi;

  constructor() {
    this.geometrySourceService.registerSource(
      createRenderIntentGeometrySource(this.renderIntentService),
    );
    this.registerService(
      this.capabilityRegistryService,
      CORE_SERVICE_TOKENS.CAPABILITY_REGISTRY,
    );
    this.registerService(this.commandService, CORE_SERVICE_TOKENS.COMMAND);
    this.registerService(
      this.configurationService,
      CORE_SERVICE_TOKENS.CONFIGURATION,
    );
    this.registerService(
      this.renderIntentService,
      CORE_SERVICE_TOKENS.RENDER_INTENT,
    );
    this.registerService(
      this.renderEffectRegistryService,
      CORE_SERVICE_TOKENS.RENDER_EFFECT_REGISTRY,
    );
    this.registerService(
      this.renderIntentCompilerRegistryService,
      CORE_SERVICE_TOKENS.RENDER_INTENT_COMPILER_REGISTRY,
    );
    this.registerService(this.sessionService, CORE_SERVICE_TOKENS.SESSION);
    this.registerService(this.sceneService, CORE_SERVICE_TOKENS.SCENE);
    this.registerService(
      this.surfaceFrameService,
      CORE_SERVICE_TOKENS.SURFACE_FRAME,
    );
    this.registerService(
      this.geometrySourceService,
      CORE_SERVICE_TOKENS.GEOMETRY_SOURCE,
    );
    this.registerService(
      this.constraintResolverService,
      CORE_SERVICE_TOKENS.CONSTRAINT_RESOLVER,
    );
    this.registerService(
      this.interactionService,
      CORE_SERVICE_TOKENS.INTERACTION,
    );
    const context: ExtensionContext = {
      eventBus: this.eventBus,
      services: {
        get: <T extends Service>(identifier: ServiceIdentifier<T>) =>
          this.serviceRegistry.get(identifier),
        getOrThrow: <T extends Service>(
          identifier: ServiceIdentifier<T>,
          errorMessage?: string,
        ) => this.serviceRegistry.getOrThrow(identifier, errorMessage),
        has: (identifier: ServiceIdentifier<Service>) =>
          this.serviceRegistry.has(identifier),
      },
    };

    this.extensionManager = new ExtensionManager(context, {
      capabilityRegistry: this.capabilityRegistryService,
      configurationService: this.configurationService,
      commandService: this.commandService,
      renderEffectRegistry: this.renderEffectRegistryService,
      renderIntentCompilerRegistry: this.renderIntentCompilerRegistryService,
    });

    this.services = {
      register: (service, identifier, options) =>
        this.registerService(service, identifier, options),
      registerAsync: (service, identifier, options) =>
        this.registerServiceAsync(service, identifier, options),
      unregister: (serviceOrIdentifier, id) =>
        this.unregisterServiceEntry(serviceOrIdentifier, id),
      unregisterAsync: (serviceOrIdentifier, id) =>
        this.unregisterServiceEntryAsync(serviceOrIdentifier, id),
      get: (identifier) => this.getService(identifier),
      getOrThrow: (identifier, errorMessage) =>
        this.getServiceOrThrow(identifier, errorMessage),
      has: (identifier) => this.hasService(identifier),
      onDidChange: (listener) => this.serviceEvents.on("change", listener),
    };

    this.extensions = {
      register: (extension) => this.extensionManager.register(extension),
      registerMany: (extensions) =>
        this.extensionManager.registerMany(extensions),
      flushActivation: () => this.extensionManager.flushActivation(),
      getState: (id) => this.extensionManager.getState(id),
      listStates: () => this.extensionManager.listStates(),
      unregister: (id) => this.extensionManager.unregister(id),
      onDidChange: (listener) => this.extensionManager.onDidChange(listener),
    };

    this.commands = {
      execute: (id, ...args) => this.commandService.executeCommand(id, ...args),
    };

    this.capabilities = {
      get: (id) => this.capabilityRegistryService.getFacade(id),
      getOrThrow: (id, errorMessage) =>
        this.getCapabilityFacadeOrThrow(id, errorMessage),
      getDefinition: (id) => this.capabilityRegistryService.getCapability(id),
      list: () => this.capabilityRegistryService.listCapabilities(),
      has: (id) => this.capabilityRegistryService.hasCapability(id),
      onDidChange: (callback) =>
        this.capabilityRegistryService.onDidChange(callback),
    };

    this.config = {
      get: (key, defaultValue) =>
        this.configurationService.get(key, defaultValue),
      update: (key, value) => this.configurationService.update(key, value),
      import: (data) => this.configurationService.import(data),
      export: () => this.configurationService.export(),
      listDefinitions: () => this.configurationService.listDefinitions(),
      getDefinition: (id) => this.configurationService.getDefinition(id),
      onDidChange: (key, callback) =>
        this.configurationService.onDidChange(key, callback),
      onAnyChange: (callback) =>
        this.configurationService.onAnyChange(callback),
      onDefinitionsChange: (callback) =>
        this.configurationService.onDefinitionsChange(callback),
    };

    this.sessions = {
      open: (...args) => this.sessionService.open(...args),
      getHandle: (...args) => this.sessionService.getHandle(...args),
      listSnapshots: () => this.sessionService.listSnapshots(),
      onDidChange: (...args) => this.sessionService.onDidChange(...args),
      onDidTerminate: (...args) => this.sessionService.onDidTerminate(...args),
    };
  }

  registerService<T extends Service>(
    service: T,
    identifier?: ServiceIdentifier<T>,
    options: RegisterServiceOptions = {},
  ): boolean {
    const serviceIdentifier = this.resolveServiceIdentifier(
      service,
      identifier,
    );
    const serviceId = this.getServiceLabel(serviceIdentifier);

    try {
      const initResult = this.invokeServiceHook(service, "init");
      if (this.isPromiseLike(initResult)) {
        throw new Error(
          `Service "${serviceId}" init() is async. Use registerServiceAsync() instead.`,
        );
      }

      this.serviceRegistry.register(serviceIdentifier, service, options);
      this.serviceEvents.emit("change", {
        type: "registered",
        id: serviceId,
        service,
      });
      return true;
    } catch (error) {
      console.error(`Error initializing service ${serviceId}:`, error);
      return false;
    }
  }

  async registerServiceAsync<T extends Service>(
    service: T,
    identifier?: ServiceIdentifier<T>,
    options: RegisterServiceOptions = {},
  ): Promise<boolean> {
    const serviceIdentifier = this.resolveServiceIdentifier(
      service,
      identifier,
    );
    const serviceId = this.getServiceLabel(serviceIdentifier);

    try {
      await this.invokeServiceHookAsync(service, "init");
      this.serviceRegistry.register(serviceIdentifier, service, options);
      this.serviceEvents.emit("change", {
        type: "registered",
        id: serviceId,
        service,
      });
      return true;
    } catch (error) {
      console.error(`Error initializing service ${serviceId}:`, error);
      return false;
    }
  }

  unregisterService(service: Service, id?: ServiceIdentifier<Service>): boolean;
  unregisterService(identifier: ServiceIdentifier<Service>): boolean;
  unregisterService(
    serviceOrIdentifier: Service | ServiceIdentifier<Service>,
    id?: ServiceIdentifier<Service>,
  ): boolean {
    const resolvedIdentifier = this.resolveUnregisterIdentifier(
      serviceOrIdentifier,
      id,
    );
    const serviceId = this.getServiceLabel(resolvedIdentifier);
    const registeredService = this.serviceRegistry.get(resolvedIdentifier);

    if (!registeredService) {
      console.warn(`Service ${serviceId} is not registered.`);
      return true;
    }

    try {
      const disposeResult = this.invokeServiceHook(
        registeredService,
        "dispose",
      );
      if (this.isPromiseLike(disposeResult)) {
        throw new Error(
          `Service "${serviceId}" dispose() is async. Use unregisterServiceAsync() instead.`,
        );
      }
    } catch (error) {
      console.error(`Error disposing service ${serviceId}:`, error);
      return false;
    }

    this.serviceRegistry.delete(resolvedIdentifier);
    this.serviceEvents.emit("change", {
      type: "unregistered",
      id: serviceId,
      service: registeredService,
    });
    return true;
  }

  async unregisterServiceAsync(
    serviceOrIdentifier: Service | ServiceIdentifier<Service>,
    id?: ServiceIdentifier<Service>,
  ): Promise<boolean> {
    const resolvedIdentifier = this.resolveUnregisterIdentifier(
      serviceOrIdentifier,
      id,
    );
    const serviceId = this.getServiceLabel(resolvedIdentifier);
    const registeredService = this.serviceRegistry.get(resolvedIdentifier);

    if (!registeredService) {
      console.warn(`Service ${serviceId} is not registered.`);
      return true;
    }

    try {
      await this.invokeServiceHookAsync(registeredService, "dispose");
    } catch (error) {
      console.error(`Error disposing service ${serviceId}:`, error);
      return false;
    }

    this.serviceRegistry.delete(resolvedIdentifier);
    this.serviceEvents.emit("change", {
      type: "unregistered",
      id: serviceId,
      service: registeredService,
    });
    return true;
  }

  getService<T extends Service>(
    identifier: ServiceIdentifier<T>,
  ): T | undefined {
    return this.serviceRegistry.get<T>(identifier);
  }

  getServiceOrThrow<T extends Service>(
    identifier: ServiceIdentifier<T>,
    errorMessage?: string,
  ): T {
    return this.serviceRegistry.getOrThrow(identifier, errorMessage);
  }

  hasService(identifier: ServiceIdentifier<Service>): boolean {
    return this.serviceRegistry.has(identifier);
  }

  getCapabilityFacadeOrThrow<TFacade = unknown>(
    id: string,
    errorMessage?: string,
  ): TFacade {
    const facade = this.capabilityRegistryService.getFacade<TFacade>(id);
    if (facade !== undefined) {
      return facade;
    }
    throw new Error(errorMessage ?? `Capability "${id}" facade not found.`);
  }

  async dispose(): Promise<void> {
    await this.extensionManager.destroy();

    const registrations = this.serviceRegistry.list().slice().reverse();
    for (const item of registrations) {
      const identifier = item.token ?? item.id;
      await this.unregisterServiceAsync(identifier);
    }

    this.serviceRegistry.clear();
    this.serviceEvents.clear();
    this.eventBus.clear();
  }

  private resolveServiceIdentifier<T extends Service>(
    service: T,
    identifier?: ServiceIdentifier<T>,
  ): ServiceIdentifier<T> {
    return identifier ?? service.constructor.name;
  }

  private unregisterServiceEntry(
    serviceOrIdentifier: Service | ServiceIdentifier<Service>,
    id?: ServiceIdentifier<Service>,
  ): boolean {
    return this.unregisterService(serviceOrIdentifier as Service, id);
  }

  private async unregisterServiceEntryAsync(
    serviceOrIdentifier: Service | ServiceIdentifier<Service>,
    id?: ServiceIdentifier<Service>,
  ): Promise<boolean> {
    return await this.unregisterServiceAsync(
      serviceOrIdentifier as Service,
      id,
    );
  }

  private resolveUnregisterIdentifier(
    serviceOrIdentifier: Service | ServiceIdentifier<Service>,
    id?: ServiceIdentifier<Service>,
  ): ServiceIdentifier<Service> {
    if (
      typeof serviceOrIdentifier === "string" ||
      isServiceToken(serviceOrIdentifier)
    ) {
      return serviceOrIdentifier;
    }

    return id ?? serviceOrIdentifier.constructor.name;
  }

  private getServiceLabel(identifier: ServiceIdentifier<Service>): string {
    if (typeof identifier === "string") {
      return identifier;
    }
    return identifier.name;
  }

  private invokeServiceHook(
    service: Service,
    hook: "init" | "dispose",
  ): void | Promise<void> {
    const handler = service[hook];
    if (!handler) {
      return;
    }
    return handler.call(service, this.serviceContext);
  }

  private async invokeServiceHookAsync(
    service: Service,
    hook: "init" | "dispose",
  ): Promise<void> {
    await this.invokeServiceHook(service, hook);
  }

  private isPromiseLike(value: unknown): value is Promise<unknown> {
    return (
      typeof value === "object" &&
      value !== null &&
      "then" in value &&
      typeof (value as { then?: unknown }).then === "function"
    );
  }
}
