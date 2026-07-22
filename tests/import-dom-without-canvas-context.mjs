const documentStub = {
  createElement(tagName) {
    return tagName === "canvas"
      ? { getContext: () => null, style: {} }
      : { style: {} };
  },
  createElementNS(_namespace, tagName) {
    return this.createElement(tagName);
  },
};

globalThis.document = documentStub;
globalThis.window = {
  document: documentStub,
  devicePixelRatio: 1,
  navigator: { userAgent: "import-safety-test" },
};
globalThis.HTMLCanvasElement = class HTMLCanvasElement {
  getContext() {
    return null;
  }
};

await import("../packages/core/dist/index.mjs");
await import("../packages/geometry-paper/dist/index.mjs");
await import("../packages/tools/dist/index.mjs");
await import("../packages/platform-browser/dist/index.mjs");
