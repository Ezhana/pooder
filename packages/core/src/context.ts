import EventBus from "./event";
import { Service, ServiceIdentifier } from "./service";

interface ExtensionContext {
  /** @internal Available only to extensions wrapped by defineLegacyExtension(). */
  readonly eventBus: EventBus;
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
