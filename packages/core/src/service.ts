import type EventBus from "./event";

export interface Service {
  init?(context: ServiceContext): void | Promise<void>;
  dispose?(context: ServiceContext): void | Promise<void>;
}

export interface ServiceToken<T extends Service = Service> {
  readonly kind: "service-token";
  readonly key: symbol;
  readonly name: string;
}

export type ServiceIdentifier<T extends Service = Service> =
  | string
  | ServiceToken<T>;

export interface ServiceContext {
  readonly eventBus: EventBus;
  get<T extends Service>(identifier: ServiceIdentifier<T>): T | undefined;
  getOrThrow<T extends Service>(
    identifier: ServiceIdentifier<T>,
    errorMessage?: string,
  ): T;
  has(identifier: ServiceIdentifier<Service>): boolean;
}

export interface RegisterServiceOptions {
  allowOverride?: boolean;
}

export interface RegisteredService<T extends Service = Service> {
  readonly id: string;
  readonly token?: ServiceToken<T>;
  readonly service: T;
}

interface ServiceEntry<T extends Service = Service> {
  token?: ServiceToken<T>;
  name: string;
  service: T;
}

interface NormalizedIdentifier<T extends Service = Service> {
  token?: ServiceToken<T>;
  name: string;
}

export function createServiceToken<T extends Service = Service>(
  name: string,
): ServiceToken<T> {
  if (!name) {
    throw new Error("Service token name is required.");
  }

  return Object.freeze({
    kind: "service-token" as const,
    key: Symbol(name),
    name,
  });
}

export function isServiceToken<T extends Service = Service>(
  identifier: unknown,
): identifier is ServiceToken<T> {
  return (
    typeof identifier === "object" &&
    identifier !== null &&
    "kind" in identifier &&
    (identifier as { kind?: unknown }).kind === "service-token"
  );
}

export class ServiceRegistry {
  private readonly servicesByName: Map<string, ServiceEntry> = new Map();
  private readonly servicesByToken: Map<symbol, ServiceEntry> = new Map();
  private readonly registrationOrder: ServiceEntry[] = [];

  register<T extends Service>(
    identifier: ServiceIdentifier<T>,
    service: T,
    options: RegisterServiceOptions = {},
  ): T {
    const normalized = this.normalizeIdentifier(identifier);
    const existing = this.findEntry(normalized);

    if (existing && !options.allowOverride) {
      throw new Error(`Service "${normalized.name}" is already registered.`);
    }
    if (existing) {
      this.removeEntry(existing);
    }

    const entry: ServiceEntry<T> = {
      token: normalized.token,
      name: normalized.name,
      service,
    };

    this.servicesByName.set(entry.name, entry);
    if (entry.token) {
      this.servicesByToken.set(entry.token.key, entry);
    }
    this.registrationOrder.push(entry as ServiceEntry);
    return service;
  }

  get<T extends Service>(identifier: ServiceIdentifier<T>): T | undefined;
  get<T extends Service>(identifier: ServiceToken<T>): T | undefined;
  get<T extends Service>(identifier: string): T | undefined;
  get<T extends Service>(identifier: ServiceIdentifier<T>): T | undefined {
    const normalized = this.normalizeIdentifier(identifier);
    const entry = this.findEntry(normalized);
    return entry?.service as T | undefined;
  }

  getOrThrow<T extends Service>(
    identifier: ServiceIdentifier<T>,
    errorMessage?: string,
  ): T;
  getOrThrow<T extends Service>(
    identifier: ServiceToken<T>,
    errorMessage?: string,
  ): T;
  getOrThrow<T extends Service>(identifier: string, errorMessage?: string): T;
  getOrThrow<T extends Service>(
    identifier: ServiceIdentifier<T>,
    errorMessage?: string,
  ): T {
    const service = this.get(identifier);
    if (service) {
      return service;
    }

    const normalized = this.normalizeIdentifier(identifier);
    throw new Error(errorMessage ?? `Service "${normalized.name}" not found.`);
  }

  has(identifier: ServiceIdentifier<Service>): boolean {
    const normalized = this.normalizeIdentifier(identifier);
    return Boolean(this.findEntry(normalized));
  }

  delete(identifier: ServiceIdentifier<Service>): boolean {
    const normalized = this.normalizeIdentifier(identifier);
    const entry = this.findEntry(normalized);
    if (!entry) {
      return false;
    }
    this.removeEntry(entry);
    return true;
  }

  list(): RegisteredService[] {
    return this.registrationOrder.map((entry) => ({
      id: entry.name,
      token: entry.token,
      service: entry.service,
    }));
  }

  clear() {
    this.servicesByName.clear();
    this.servicesByToken.clear();
    this.registrationOrder.length = 0;
  }

  private findEntry(
    identifier: NormalizedIdentifier,
  ): ServiceEntry | undefined {
    if (identifier.token) {
      return (
        this.servicesByToken.get(identifier.token.key) ??
        this.servicesByName.get(identifier.name)
      );
    }
    return this.servicesByName.get(identifier.name);
  }

  private normalizeIdentifier<T extends Service>(
    identifier: ServiceIdentifier<T>,
  ): NormalizedIdentifier<T> {
    if (isServiceToken(identifier)) {
      return { token: identifier, name: identifier.name };
    }

    const name = identifier.trim();
    if (!name) {
      throw new Error("Service identifier must be a non-empty string.");
    }
    return { name };
  }

  private removeEntry(entry: ServiceEntry) {
    this.servicesByName.delete(entry.name);
    if (entry.token) {
      this.servicesByToken.delete(entry.token.key);
    }

    const index = this.registrationOrder.lastIndexOf(entry);
    if (index >= 0) {
      this.registrationOrder.splice(index, 1);
    }
  }
}
