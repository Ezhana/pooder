export interface Service {
  init?(): void;
  dispose?(): void;
}

export class ServiceRegistry {
  private services: Map<string, Service> = new Map();

  register<T extends Service>(name: string, service: T): T {
    this.services.set(name, service);
    return service;
  }

  get<T extends Service>(serviceName: string): T | undefined {
    return this.services.get(serviceName) as T | undefined;
  }

  has(serviceName: string): boolean {
    return this.services.has(serviceName);
  }

  delete(serviceName: string): void {
    this.services.delete(serviceName);
  }
}
