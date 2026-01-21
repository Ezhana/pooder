import { Service, ServiceRegistry } from "./service";
import EventBus from "./event";
import { ExtensionManager } from "./extension";

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
  readonly extensionManager: ExtensionManager;

  constructor() {
    this.extensionManager = new ExtensionManager(this);
  }

  registerService(service: Service) {
    const serviceId = service.name;

    try {
      service?.init?.();
    } catch (e) {
      console.error(`Error initializing service ${serviceId}:`, e);
      return false;
    }

    this.services.set(serviceId, service);
    this.eventBus.emit("service:register", service);
    return true;
  }

  unregisterService(service: Service) {
    const serviceId = service.name;
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
}
