import { Service, ServiceRegistry } from "./service";
import EventBus from "./event";
import { ExtensionManager } from "./extension";
import { Disposable } from "./command";
import {
  Contribution,
  ContributionPoint,
  ContributionPointIds,
  ContributionRegistry,
} from "./contribution";
import CommandService from "./services/CommandService";
import { ExtensionContext } from "./context";

export {
  FabricImage as Image,
  Ellipse,
  Rect,
  Circle,
  Line,
  Text,
  Group,
  Path,
  Point,
  Pattern,
  filters,
  util,
} from "fabric";

export class Pooder {
  readonly eventBus: EventBus = new EventBus();
  private readonly services: ServiceRegistry = new ServiceRegistry();
  private readonly contributions: ContributionRegistry =
    new ContributionRegistry();
  readonly extensionManager: ExtensionManager;

  constructor() {
    // Initialize default contribution points
    this.initDefaultContributionPoints();

    const commandService = new CommandService();
    this.registerService(commandService);

    // Create a restricted context for extensions
    const context: ExtensionContext = {
      eventBus: this.eventBus,
      services: {
        get: <T extends Service>(serviceName: string) =>
          this.services.get<T>(serviceName),
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
  }

  // --- Service Management ---

  registerService(service: Service) {
    const serviceId = service.constructor.name;

    try {
      service?.init?.();
    } catch (e) {
      console.error(`Error initializing service ${serviceId}:`, e);
      return false;
    }

    this.services.register(serviceId, service);
    this.eventBus.emit("service:register", service);
    return true;
  }

  unregisterService(service: Service) {
    const serviceId = service.constructor.name;
    if (!this.services.has(serviceId)) {
      console.warn(`Service ${serviceId} is not registered.`);
      return true;
    }

    try {
      service?.dispose?.();
    } catch (e) {
      console.error(`Error disposing service ${serviceId}:`, e);
      return false;
    }

    this.services.delete(serviceId);
    this.eventBus.emit("service:unregister", service);
    return true;
  }

  getService<T extends Service>(id: string): T | undefined {
    return this.services.get<T>(id);
  }

  // --- Contribution Management ---

  registerContributionPoint<T>(point: ContributionPoint<T>): void {
    this.contributions.registerPoint(point);
    this.eventBus.emit("point:register", point);
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
}
