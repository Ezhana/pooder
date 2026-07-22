delete globalThis.window;
delete globalThis.document;
delete globalThis.HTMLCanvasElement;

await import("../packages/core/dist/index.mjs");
await import("../packages/geometry-paper/dist/index.mjs");
await import("../packages/tools/dist/index.mjs");
await import("../packages/platform-browser/dist/index.mjs");
