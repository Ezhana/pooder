import EventBus from "./event";
import { Contribution } from "./contribution";
import { Service } from "./service";

interface ExtensionContext {
  readonly eventBus: EventBus;
  readonly services: {
    get<T extends Service>(serviceName: string): T | undefined;
  };
  readonly contributions: {
    get<T>(pointId: string): Contribution<T>[];
    register<T>(pointId: string, contribution: Contribution<T>): void;
    unregister<T>(pointId: string, id: string): void;
  };
}

export { ExtensionContext };
