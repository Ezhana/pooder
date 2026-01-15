import { EventHandler } from "./types";

export { EventBus, EventListener };

interface EventListener {
  handler: EventHandler;
  priority: number;
}
type EventListenersMap = Map<string, EventListener[]>;
class EventBus {
  private events: EventListenersMap = new Map();

  on(event: string, handler: EventHandler, priority: number = 0) {
    if (this.events.has(event)) {
      const listeners = this.events.get(event);
      listeners!.push({ handler, priority });
      listeners!.sort((a, b) => b.priority - a.priority);
    } else {
      this.events.set(event, [{ handler, priority }]);
    }
  }

  off(event: string, handler: EventHandler) {
    const listeners = this.events.get(event);
    if (!listeners) return;

    const index = listeners.findIndex((l) => l.handler === handler);
    listeners.splice(index, 1);
  }

  emit(event: string, ...args: any[]) {
    const listeners = this.events.get(event);
    if (!listeners) return;

    for (const { handler } of listeners) {
      const result = handler(...args);
      if (result === false) break;
    }
  }

  clear() {
    this.events.clear();
  }

  count(event: string) {
    return this.events.get(event)?.length ?? 0;
  }
}
