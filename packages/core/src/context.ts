import EventBus from "./event";
import { ContributionRegistry } from "./contribution";

interface ExtensionContext {
  readonly eventBus: EventBus;
  readonly contributionRegistry: ContributionRegistry;
}

export { ExtensionContext };
