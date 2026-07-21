type CanvasContextStub = Record<string, unknown>;

function createCanvasContext(): CanvasContextStub {
  const gradient = {
    addColorStop() {},
  };

  return {
    arc() {},
    beginPath() {},
    bezierCurveTo() {},
    clearRect() {},
    clip() {},
    closePath() {},
    createLinearGradient: () => gradient,
    createPattern: () => ({}),
    createRadialGradient: () => gradient,
    drawImage() {},
    fill() {},
    fillRect() {},
    lineTo() {},
    measureText: () => ({ width: 0 }),
    moveTo() {},
    quadraticCurveTo() {},
    rect() {},
    restore() {},
    rotate() {},
    save() {},
    scale() {},
    setLineDash() {},
    setTransform() {},
    stroke() {},
    transform() {},
    translate() {},
  };
}

function createCanvasStub() {
  const context = createCanvasContext();
  return {
    height: 1,
    style: {},
    width: 1,
    addEventListener() {},
    getAttribute() {
      return null;
    },
    getContext() {
      return context;
    },
    removeEventListener() {},
    setAttribute() {},
  };
}

const documentStub = {
  body: {
    appendChild() {},
    removeChild() {},
  },
  addEventListener() {},
  createElement: () => createCanvasStub(),
  createElementNS: () => createCanvasStub(),
  removeEventListener() {},
};

const windowStub = {
  document: documentStub,
  devicePixelRatio: 1,
  navigator: { userAgent: "node" },
  addEventListener() {},
  getComputedStyle: () => ({}),
  removeEventListener() {},
};

const globals = globalThis as any;

globals.document ??= documentStub;
globals.self ??= windowStub;
globals.window ??= windowStub;
