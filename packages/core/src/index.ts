import {
  isServiceToken,
  RegisterServiceOptions,
  Service,
  ServiceContext,
  ServiceIdentifier,
  ServiceRegistry,
} from "./service";
import EventBus from "./event";
import { ExtensionManager } from "./extension";
import Disposable from "./disposable";
import {
  Contribution,
  ContributionPoint,
  ContributionPointIds,
  ContributionRegistry,
} from "./contribution";
import {
  CORE_SERVICE_TOKENS,
  CommandService,
  ConfigurationService,
  ToolRegistryService,
  ToolSessionService,
  WorkbenchService,
} from "./services";
import { ExtensionContext } from "./context";

export * from "./extension";
export * from "./context";
export * from "./contribution";
export * from "./service";
export * from "./services";
export { default as EventBus } from "./event";

export class Pooder {
  readonly eventBus: EventBus = new EventBus();
  private readonly services: ServiceRegistry = new ServiceRegistry();
  private readonly serviceContext: ServiceContext = {
    eventBus: this.eventBus,
    get: <T extends Service>(identifier: ServiceIdentifier<T>) =>
      this.services.get(identifier),
    getOrThrow: <T extends Service>(
      identifier: ServiceIdentifier<T>,
      errorMessage?: string,
    ) => this.services.getOrThrow(identifier, errorMessage),
    has: (identifier: ServiceIdentifier<Service>) => this.services.has(identifier),
  };
  private readonly contributions: ContributionRegistry =
    new ContributionRegistry();
  readonly extensionManager: ExtensionManager;

  constructor() {
    // Initialize default contribution points
    this.initDefaultContributionPoints();

    const commandService = new CommandService();
    this.registerService(commandService, CORE_SERVICE_TOKENS.COMMAND);

    const configurationService = new ConfigurationService();
    this.registerService(configurationService, CORE_SERVICE_TOKENS.CONFIGURATION);

    const toolRegistryService = new ToolRegistryService();
    this.registerService(toolRegistryService, CORE_SERVICE_TOKENS.TOOL_REGISTRY);

    const toolSessionService = new ToolSessionService({
      commandService,
      toolRegistry: toolRegistryService,
    });
    this.registerService(toolSessionService, CORE_SERVICE_TOKENS.TOOL_SESSION);

    const workbenchService = new WorkbenchService({
      eventBus: this.eventBus,
      toolRegistry: toolRegistryService,
      sessionService: toolSessionService,
    });
    this.registerService(workbenchService, CORE_SERVICE_TOKENS.WORKBENCH);

    // Create a restricted context for extensions
    const context: ExtensionContext = {
      eventBus: this.eventBus,
      services: {
        get: <T extends Service>(identifier: ServiceIdentifier<T>) =>
          this.services.get(identifier),
        getOrThrow: <T extends Service>(
          identifier: ServiceIdentifier<T>,
          errorMessage?: string,
        ) => this.services.getOrThrow(identifier, errorMessage),
        has: (identifier: ServiceIdentifier<Service>) =>
          this.services.has(identifier),
      },
      contributions: {
        get: <T>(pointId: string) => this.getContributions<T>(pointId),
        register: <T>(pointId: string, contribution: Contribution<T>) =>
          this.registerContribution(pointId, contribution),
      },
    };

    this.extensionManager = new ExtensionManager(context);
  }

  private initDefaultContributionPoints() {
    this.registerContributionPoint({
      id: ContributionPointIds.CONTRIBUTIONS,
      description: "Contribution point for contribution points",
    });

    this.registerContributionPoint({
      id: ContributionPointIds.COMMANDS,
      description: "Contribution point for commands",
    });

    this.registerContributionPoint({
      id: ContributionPointIds.TOOLS,
      description: "Contribution point for tools",
    });

    this.registerContributionPoint({
      id: ContributionPointIds.VIEWS,
      description: "Contribution point for UI views",
    });

    this.registerContributionPoint({
      id: ContributionPointIds.CONFIGURATIONS,
      description: "Contribution point for configurations",
    });
  }

  // --- Service Management ---

  registerService<T extends Service>(
    service: T,
    identifier?: ServiceIdentifier<T>,
    options: RegisterServiceOptions = {},
  ): boolean {
    const serviceIdentifier = this.resolveServiceIdentifier(service, identifier);
    const serviceId = this.getServiceLabel(serviceIdentifier);

    try {
      const initResult = this.invokeServiceHook(service, "init");
      if (this.isPromiseLike(initResult)) {
        throw new Error(
          `Service "${serviceId}" init() is async. Use registerServiceAsync() instead.`,
        );
      }

      this.services.register(serviceIdentifier, service, options);
      this.eventBus.emit("service:register", service, { id: serviceId });
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
    const serviceIdentifier = this.resolveServiceIdentifier(service, identifier);
    const serviceId = this.getServiceLabel(serviceIdentifier);

    try {
      await this.invokeServiceHookAsync(service, "init");
      this.services.register(serviceIdentifier, service, options);
      this.eventBus.emit("service:register", service, { id: serviceId });
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
    const registeredService = this.services.get(resolvedIdentifier);

    if (!registeredService) {
      console.warn(`Service ${serviceId} is not registered.`);
      return true;
    }

    try {
      const disposeResult = this.invokeServiceHook(registeredService, "dispose");
      if (this.isPromiseLike(disposeResult)) {
        throw new Error(
          `Service "${serviceId}" dispose() is async. Use unregisterServiceAsync() instead.`,
        );
      }
    } catch (error) {
      console.error(`Error disposing service ${serviceId}:`, error);
      return false;
    }

    this.services.delete(resolvedIdentifier);
    this.eventBus.emit("service:unregister", registeredService, { id: serviceId });
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
    const registeredService = this.services.get(resolvedIdentifier);

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

    this.services.delete(resolvedIdentifier);
    this.eventBus.emit("service:unregister", registeredService, { id: serviceId });
    return true;
  }

  getService<T extends Service>(identifier: ServiceIdentifier<T>): T | undefined {
    return this.services.get<T>(identifier);
  }

  getServiceOrThrow<T extends Service>(
    identifier: ServiceIdentifier<T>,
    errorMessage?: string,
  ): T {
    return this.services.getOrThrow(identifier, errorMessage);
  }

  hasService(identifier: ServiceIdentifier<Service>): boolean {
    return this.services.has(identifier);
  }

  async dispose(): Promise<void> {
    this.extensionManager.destroy();

    const registrations = this.services.list().slice().reverse();
    for (const item of registrations) {
      const identifier = item.token ?? item.id;
      await this.unregisterServiceAsync(identifier);
    }

    this.services.clear();
  }

  // --- Contribution Management ---

  registerContributionPoint<T>(point: ContributionPoint<T>): void {
    this.contributions.registerPoint(point);
    this.eventBus.emit("contribution:point:register", point);
  }

  registerContribution<T>(
    pointId: string,
    contribution: Contribution<T>,
  ): Disposable {
    const disposable = this.contributions.register(pointId, contribution);
    this.eventBus.emit("contribution:register", { ...contribution, pointId });
    return disposable;
  }

  getContributions<T>(pointId: string): Contribution<T>[] {
    return this.contributions.get<T>(pointId);
  }

  private resolveServiceIdentifier<T extends Service>(
    service: T,
    identifier?: ServiceIdentifier<T>,
  ): ServiceIdentifier<T> {
    return identifier ?? service.constructor.name;
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
