import EventBus from "./event";
import { ContributionRegistry } from "./contribution";
import { ServiceRegistry } from "./service";

interface ExtensionContext {
  readonly eventBus: EventBus;
  readonly contributionRegistry: ContributionRegistry;
  readonly serviceRegistry: ServiceRegistry;
}

export { ExtensionContext };
