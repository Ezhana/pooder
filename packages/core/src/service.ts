import EventBus from "./event";

export { Service, ServiceRegistry, ServiceManager };
interface Service {
  id: string;
  init?(): void;
  dispose?(): void;
}
class ServiceRegistry extends Map<string, Service> {}
class ServiceManager {
  private serviceRegistry;

  constructor(serviceRegistry: ServiceRegistry) {
    this.serviceRegistry = serviceRegistry;
  }

  register(service: Service): void {
    if (this.serviceRegistry.has(service.id)) {
      console.warn(`Service ${service.id} is already registered.`);
      return;
    }

    this.serviceRegistry.set(service.id, service);
    if (service.init) {
      service.init();
    }

    EventBus.emit("service:registered", service);
  }

  unregister(id: string): void {
    const service = this.serviceRegistry.get(id);
    service?.dispose?.();
    this.serviceRegistry.delete(id);
    EventBus.emit("service:unregistered", service);
  }

  get<T extends Service>(id: string): T | undefined {
    return this.serviceRegistry.get(id) as T;
  }

  dispose(): void {
    this.serviceRegistry.forEach((service) => {
      service?.dispose?.();
    });
    this.serviceRegistry.clear();
  }
}
