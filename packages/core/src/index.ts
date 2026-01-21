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
  readonly eventBus: EventBus = new EventBus();
  readonly services: ServiceRegistry = new ServiceRegistry();
  readonly contributionRegistry: ContributionRegistry = contributionRegistry;
  readonly commandService: CommandService;
  readonly extensionManager: ExtensionManager;

  constructor() {
    this.commandService = new CommandService();
    this.registerService(this.commandService);

    this.extensionManager = new ExtensionManager({
      eventBus: this.eventBus,
      contributionRegistry: this.contributionRegistry,
      serviceRegistry: this.services,
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

const p = new Pooder();
const svc = new CommandService();
p.registerService(svc);
const cs = p.services.get<CommandService>("CommandService");
console.log(cs);
console.log(p);
