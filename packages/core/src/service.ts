interface Service {
  name: string;
  init(): void;
  dispose(): void;
}

class ServiceRegistry extends Map<string, Service> {}

export { Service, ServiceRegistry };
