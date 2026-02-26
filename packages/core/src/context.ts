import EventBus from "./event";
import { Contribution } from "./contribution";
import { Service, ServiceIdentifier } from "./service";
import Disposable from "./disposable";

interface ExtensionContext {
  readonly eventBus: EventBus;
  readonly services: {
    get<T extends Service>(identifier: ServiceIdentifier<T>): T | undefined;
    getOrThrow<T extends Service>(
      identifier: ServiceIdentifier<T>,
      errorMessage?: string,
    ): T;
    has(identifier: ServiceIdentifier<Service>): boolean;
  };
  readonly contributions: {
    get<T>(pointId: string): Contribution<T>[];
    register<T>(pointId: string, contribution: Contribution<T>): Disposable;
  };
}

export { ExtensionContext };
