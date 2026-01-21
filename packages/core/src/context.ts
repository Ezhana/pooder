import EventBus from "./event";
import { ContributionRegistry } from "./contribution";
import { ServiceRegistry } from "./service";

interface ExtensionContext {
  readonly eventBus: EventBus;
  readonly contributions: ContributionRegistry;
  readonly services: ServiceRegistry;
}

export { ExtensionContext };
