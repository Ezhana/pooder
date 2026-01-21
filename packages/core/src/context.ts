import EventBus from "./event";

interface ExtensionContext {
  readonly eventBus: EventBus;
}

export { ExtensionContext };
