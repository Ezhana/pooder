import { Service, ServiceRegistry } from "./service";
import EventBus from "./event";
import { ExtensionManager } from "./extension";
import { ContributionRegistry, contributionRegistry } from "./contribution";
import CommandService from "./services/CommandService";

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
  public readonly eventBus: EventBus = new EventBus();
  public readonly services: ServiceRegistry = new ServiceRegistry();
  public readonly extensions: ExtensionManager;

  public readonly contributions: ContributionRegistry = contributionRegistry;

  constructor() {
    this.registerService(new CommandService());

    this.extensions = new ExtensionManager({
      eventBus: this.eventBus,
      contributions: this.contributions,
      services: this.services,
    });
  }

  registerService(service: Service) {
    const serviceName = service.constructor.name;

    try {
      service?.init?.();
    } catch (e) {
      console.error(`Error initializing service ${serviceName}:`, e);
      return false;
    }

    this.services.register(serviceName, service);
    this.eventBus.emit("service:register", serviceName);
    return true;
  }

  unregisterService(service: Service) {
    const serviceName = service.constructor.name;
    if (!this.services.has(serviceName)) {
      console.warn(`Service ${serviceName} is not registered.`);
      return true;
    }

    try {
      service?.dispose?.();
    } catch (e) {
      console.error(`Error disposing service ${serviceName}:`, e);
      return false;
    }

    this.services.delete(serviceName);
    this.eventBus.emit("service:unregister", service);
    return true;
  }
}
