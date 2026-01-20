import { ServiceManager, Service, ServiceRegistry } from "./service";
import { ExtensionManager, ExtensionRegistry } from "./extension";

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
  services: ServiceRegistry = new ServiceRegistry();
  extensions: ExtensionRegistry = new ExtensionRegistry();

  private serviceManager: ServiceManager = new ServiceManager(this.services);
  private extensionManager: ExtensionManager = new ExtensionManager(
    this.extensions,
  );

  constructor() {}

  registerService(service: Service) {
    this.serviceManager.register(service);
  }
}
