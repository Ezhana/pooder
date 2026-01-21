interface Service {
  init?(): void;
  dispose?(): void;
}

class ServiceRegistry extends Map<string, Service> {}

export { Service, ServiceRegistry };
