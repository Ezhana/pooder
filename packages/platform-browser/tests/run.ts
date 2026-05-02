import type { Service } from "@pooder/core";
import {
  attachBrowserHost,
  CANVAS_SERVICE,
  resolveViewPaddingPx,
  SCENE_LAYOUT_SERVICE,
} from "../src";

declare const process: {
  exit(code: number): never;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message} (expected ${String(expected)}, got ${String(actual)})`,
    );
  }
}

class FakeCanvasService {
  resizeCalls: Array<{ height: number; width: number }> = [];

  resize(width: number, height: number) {
    this.resizeCalls.push({ width, height });
  }
}

class FakeSceneLayoutService {}

function createRuntime() {
  const registered = new Map<unknown, Service>();
  const events: string[] = [];

  return {
    events,
    registered,
    runtime: {
      eventBus: {} as any,
      services: {
        register(service: Service, identifier?: unknown) {
          registered.set(identifier ?? service.constructor.name, service);
          return true;
        },
        unregister(
          serviceOrIdentifier: Service | unknown,
          identifier?: unknown,
        ) {
          const key =
            identifier ??
            (serviceOrIdentifier && typeof serviceOrIdentifier === "object"
              ? serviceOrIdentifier.constructor.name
              : serviceOrIdentifier);
          events.push(`unregister:${String(key)}`);
          return registered.delete(key);
        },
      },
    },
  };
}

function testAttachAndDetach() {
  const { registered, runtime } = createRuntime();
  const canvasService = new FakeCanvasService();
  const sceneLayoutService = new FakeSceneLayoutService();
  let observerCallback: ResizeObserverCallback | null = null;
  let disconnected = false;
  let observedTarget: Element | null = null;

  const container = {
    clientHeight: 180,
    clientWidth: 320,
  } as Element & { clientHeight: number; clientWidth: number };
  const canvas = { height: 0, width: 0 } as HTMLCanvasElement;

  const attachment = attachBrowserHost(runtime, {
    container,
    canvas,
    createCanvasService: () => canvasService as any,
    createSceneLayoutService: () => sceneLayoutService as any,
    createResizeObserver: (callback) => {
      observerCallback = callback;
      return {
        disconnect() {
          disconnected = true;
        },
        observe(target) {
          observedTarget = target;
        },
      };
    },
  });

  assert(
    canvas.width === 320,
    "canvas width should be initialized from container",
  );
  assert(
    canvas.height === 180,
    "canvas height should be initialized from container",
  );
  assert(
    attachment.canvasService === (canvasService as any),
    "canvas service should be exposed",
  );
  assert(
    attachment.sceneLayoutService === (sceneLayoutService as any),
    "scene layout service should be exposed",
  );
  assert(
    registered.get(CANVAS_SERVICE) === (canvasService as any),
    "canvas service should register",
  );
  assert(
    registered.get(SCENE_LAYOUT_SERVICE) === (sceneLayoutService as any),
    "scene layout service should register",
  );
  assert(
    observedTarget === container,
    "resize observer should watch host container",
  );
  const callback = observerCallback;
  if (!callback) {
    throw new Error("resize observer callback should be installed");
  }

  (callback as ResizeObserverCallback)(
    [
      {
        contentRect: {
          height: 240,
          width: 480,
        },
      } as ResizeObserverEntry,
    ],
    {} as ResizeObserver,
  );

  assert(
    canvasService.resizeCalls.length === 1 &&
      canvasService.resizeCalls[0]?.width === 480 &&
      canvasService.resizeCalls[0]?.height === 240,
    "resize callback should forward host size changes",
  );

  attachment.dispose();

  assert(disconnected, "dispose should disconnect the resize observer");
  assert(
    !registered.has(CANVAS_SERVICE),
    "dispose should unregister the canvas service",
  );
  assert(
    !registered.has(SCENE_LAYOUT_SERVICE),
    "dispose should unregister the scene layout service",
  );
}

function testFailedLayoutRegistrationRollsBackCanvasService() {
  const registered = new Map<unknown, Service>();
  const runtime = {
    eventBus: {} as any,
    services: {
      register(service: Service, identifier?: unknown) {
        if (identifier === SCENE_LAYOUT_SERVICE) {
          return false;
        }
        registered.set(identifier ?? service.constructor.name, service);
        return true;
      },
      unregister(serviceOrIdentifier: Service | unknown, identifier?: unknown) {
        const key =
          identifier ??
          (serviceOrIdentifier && typeof serviceOrIdentifier === "object"
            ? serviceOrIdentifier.constructor.name
            : serviceOrIdentifier);
        return registered.delete(key);
      },
    },
  };

  let threw = false;
  try {
    attachBrowserHost(runtime as any, {
      container: {
        clientHeight: 50,
        clientWidth: 50,
      } as any,
      canvas: { height: 0, width: 0 } as any,
      createCanvasService: () => new FakeCanvasService() as any,
      createSceneLayoutService: () => new FakeSceneLayoutService() as any,
      createResizeObserver: () => ({
        disconnect() {},
        observe() {},
      }),
    });
  } catch (error) {
    threw = true;
  }

  assert(threw, "failed scene layout registration should throw");
  assert(
    !registered.has(CANVAS_SERVICE),
    "failed attach should roll back canvas service",
  );
}

function testViewPaddingResolvesResponsively() {
  assertEqual(
    resolveViewPaddingPx("10%", 320, 480),
    32,
    "percentage padding should use the short side",
  );
  assertEqual(
    resolveViewPaddingPx(140, 320, 480),
    38.4,
    "fixed padding should shrink on compact canvases",
  );
  assertEqual(
    resolveViewPaddingPx("90%", 320, 480),
    80,
    "padding should preserve a minimum content area",
  );
  assertEqual(
    resolveViewPaddingPx("", 320, 480),
    0,
    "empty padding should be ignored",
  );
}

async function main() {
  testAttachAndDetach();
  testFailedLayoutRegistrationRollsBackCanvasService();
  testViewPaddingResolvesResponsively();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
