import { Service, ServiceIdentifier } from "./service";

interface ExtensionContext {
  readonly services: {
    get<T extends Service>(identifier: ServiceIdentifier<T>): T | undefined;
    getOrThrow<T extends Service>(
      identifier: ServiceIdentifier<T>,
      errorMessage?: string,
    ): T;
    has(identifier: ServiceIdentifier<Service>): boolean;
  };
}

export { ExtensionContext };
