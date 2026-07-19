import type Disposable from "./disposable";

export type TypedEventMap = object;

export type TypedEventListener<TEventMap extends TypedEventMap, TKey extends keyof TEventMap> = (
  event: TEventMap[TKey],
) => void;

/**
 * Small synchronous event primitive used by public services. Event names and
 * payloads are entirely described by TEventMap; arbitrary string events belong
 * only in the temporary legacy extension bridge.
 */
export class TypedEventEmitter<TEventMap extends TypedEventMap> {
  private readonly listeners = new Map<
    keyof TEventMap,
    Set<(event: TEventMap[keyof TEventMap]) => void>
  >();

  on<TKey extends keyof TEventMap>(
    type: TKey,
    listener: TypedEventListener<TEventMap, TKey>,
  ): Disposable {
    const listeners =
      this.listeners.get(type) ??
      new Set<(event: TEventMap[keyof TEventMap]) => void>();
    listeners.add(
      listener as (event: TEventMap[keyof TEventMap]) => void,
    );
    this.listeners.set(type, listeners);
    return {
      dispose: () => {
        listeners.delete(
          listener as (event: TEventMap[keyof TEventMap]) => void,
        );
        if (listeners.size === 0) this.listeners.delete(type);
      },
    };
  }

  emit<TKey extends keyof TEventMap>(type: TKey, event: TEventMap[TKey]): void {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    [...listeners].forEach((listener) => listener(event));
  }

  clear(): void {
    this.listeners.clear();
  }
}
