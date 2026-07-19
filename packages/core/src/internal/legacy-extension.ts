import type { ExtensionContext } from "../context";
import type { ExtensionDefinition } from "../extension";
import EventBus from "../event";
import type { CanvasService } from "../render";
import type { Service, ServiceIdentifier } from "../service";
import SceneService from "../services/SceneService";
import SessionService from "../services/SessionService";
import { CANVAS_SERVICE, SCENE_SERVICE, SESSION_SERVICE } from "../services/tokens";

export class LegacyRuntimeEventBridge {
  private canvasSubscription?: { dispose(): void };

  constructor(private readonly eventBus: EventBus) {}

  on(event: string, handler: (...args: any[]) => void | boolean, priority = 0): void {
    this.eventBus.on(event, handler, priority);
  }

  off(event: string, handler: (...args: any[]) => void | boolean): void {
    this.eventBus.off(event, handler);
  }

  emit(event: string, ...args: any[]): void {
    this.eventBus.emit(event, ...args);
  }

  count(event: string): number {
    return this.eventBus.count(event);
  }

  clear(): void {
    this.eventBus.clear();
  }

  attachCanvas(canvas: CanvasService | undefined): void {
    if (!canvas || typeof canvas.on !== "function" || this.canvasSubscription) return;
    const subscriptions = [
      canvas.on("resized", (event) => this.emit("canvas:resized", event)),
      canvas.on("selection", (event) =>
        this.emit(`selection:${event.kind}`, { target: event.target }),
      ),
      canvas.on("objectChange", (event) =>
        this.emit(`object:${event.kind}`, { target: event.target }),
      ),
      canvas.on("pointer", (event) =>
        this.emit(event.kind === "down" ? "mouse:down" : "mouse:dblclick", {
          target: event.target,
        }),
      ),
    ];
    this.canvasSubscription = {
      dispose: () => subscriptions.forEach((subscription) => subscription.dispose()),
    };
  }
}

export class LegacySessionAdapter implements Service {
  constructor(readonly target: SessionService) {}

  init(): void {}

  requestSession(input?: Record<string, unknown>): Promise<Record<string, any>> {
    return this.target.requestSession(input as any) as Promise<Record<string, any>>;
  }
  createSession(input?: Record<string, unknown>): Record<string, any> {
    return this.target.createSession(input as any) as unknown as Record<string, any>;
  }
  updateSession(sessionId: string, update: Record<string, unknown>): Record<string, any> {
    return this.target.updateSession(sessionId, update as any) as unknown as Record<string, any>;
  }
  getSession(sessionId: string): Record<string, any> | undefined {
    return this.target.getSession(sessionId) as unknown as Record<string, any> | undefined;
  }
  isSessionActive(sessionId: string): boolean { return this.target.isSessionActive(sessionId); }
  markDirty(sessionId: string, dirty = true): void { this.target.markDirty(sessionId, dirty); }
  commitSession(sessionId: string): Promise<Record<string, any>> {
    return this.target.commitSession(sessionId) as Promise<Record<string, any>>;
  }
  rollbackSession(sessionId: string): Promise<void> { return this.target.rollbackSession(sessionId); }
  cancelSession(sessionId: string, detail?: unknown): Promise<void> {
    return this.target.cancelSession(sessionId, detail);
  }
}

export class LegacyOverlaySceneAdapter implements Service {
  constructor(readonly target: SceneService) {}

  init(): void {}

  ensureScene(scene: Record<string, unknown>): Record<string, any> {
    return this.target.ensureScene(scene as any) as unknown as Record<string, any>;
  }
}

export interface LegacyExtensionContext {
  readonly eventBus: LegacyRuntimeEventBridge;
  readonly services: ExtensionContext["services"];
}

type LegacyExtension = ExtensionDefinition & {
  activate(context: ExtensionContext): void | Promise<void>;
  deactivate?(context: ExtensionContext): void | Promise<void>;
};

const wrappedExtensions = new WeakSet<object>();
const bridgesByBus = new WeakMap<EventBus, LegacyRuntimeEventBridge>();

export function getLegacyRuntimeEventBridge(runtime: unknown): LegacyRuntimeEventBridge {
  const candidate = runtime as {
    eventBus?: EventBus;
    services?: {
      get<T extends Service>(identifier: ServiceIdentifier<T>): T | undefined;
      onDidChange?(listener: (event: {
        type: "registered" | "unregistered";
        id: string;
        service: Service;
      }) => void): { dispose(): void };
    };
  };
  if (!candidate.eventBus) {
    throw new Error("Legacy runtime bridge requires a Pooder runtime.");
  }
  const bridge = getOrCreateBridge(candidate.eventBus);
  bridge.attachCanvas(candidate.services?.get(CANVAS_SERVICE));
  candidate.services?.onDidChange?.((event) => {
    if (event.type === "registered" && event.id === CANVAS_SERVICE.name) {
      bridge.attachCanvas(event.service as CanvasService);
    }
  });
  return bridge;
}

/**
 * Temporary mechanical wrapper for pre-V2 extensions. It replaces only the
 * context views; the extension's working state and lifecycle remain untouched.
 */
export function defineLegacyExtension<T extends LegacyExtension>(extension: T): T {
  if (wrappedExtensions.has(extension)) return extension;
  wrappedExtensions.add(extension);

  const activate = extension.activate.bind(extension);
  const deactivate = extension.deactivate?.bind(extension);
  const contexts = new WeakMap<ExtensionContext, ExtensionContext>();

  extension.activate = ((context: ExtensionContext) => {
    const legacyContext = createLegacyContext(context);
    contexts.set(context, legacyContext);
    return activate(legacyContext);
  }) as T["activate"];

  if (deactivate) {
    extension.deactivate = ((context: ExtensionContext) =>
      deactivate(contexts.get(context) ?? createLegacyContext(context))) as T["deactivate"];
  }

  return extension;
}

function createLegacyContext(context: ExtensionContext): ExtensionContext {
  const session = context.services.get(SESSION_SERVICE);
  const scene = context.services.get(SCENE_SERVICE);
  const sessionAdapter = session
    ? createForwardingAdapter(new LegacySessionAdapter(session), session)
    : undefined;
  const sceneAdapter = scene
    ? createForwardingAdapter(new LegacyOverlaySceneAdapter(scene), scene)
    : undefined;

  const services = {
    get<T extends Service>(identifier: ServiceIdentifier<T>): T | undefined {
      if (identifier === SESSION_SERVICE && sessionAdapter) return sessionAdapter as unknown as T;
      if (identifier === SCENE_SERVICE && sceneAdapter) return sceneAdapter as unknown as T;
      return context.services.get(identifier);
    },
    getOrThrow<T extends Service>(
      identifier: ServiceIdentifier<T>,
      errorMessage?: string,
    ): T {
      const service = services.get(identifier);
      if (service) return service;
      throw new Error(errorMessage ?? `Legacy extension service not found.`);
    },
    has(identifier: ServiceIdentifier<Service>): boolean {
      return services.get(identifier) !== undefined;
    },
  };

  const eventBridge = getOrCreateBridge(context.eventBus);
  eventBridge.attachCanvas(context.services.get(CANVAS_SERVICE));
  return {
    eventBus: eventBridge as unknown as EventBus,
    services,
  };
}

function getOrCreateBridge(eventBus: EventBus): LegacyRuntimeEventBridge {
  const existing = bridgesByBus.get(eventBus);
  if (existing) return existing;
  const bridge = new LegacyRuntimeEventBridge(eventBus);
  bridgesByBus.set(eventBus, bridge);
  return bridge;
}

function createForwardingAdapter<TAdapter extends object, TTarget extends object>(
  adapter: TAdapter,
  target: TTarget,
): TAdapter & TTarget {
  return new Proxy(adapter as TAdapter & TTarget, {
    get(current, property, receiver) {
      if (Reflect.has(current, property)) return Reflect.get(current, property, receiver);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(_current, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}
