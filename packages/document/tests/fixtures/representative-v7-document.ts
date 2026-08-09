/**
 * Representative converged v7 fixture. It covers ordering, two-sided
 * surfaces, custom
 * dieline/feature objects, an image slot, and a production-mask declaration.
 */
export const REPRESENTATIVE_V7_DOCUMENT_INPUT = {
  version: 7,
  assets: [
    {
      id: "front-artwork",
      type: "image",
      source: { kind: "url", url: "https://example.test/front-artwork.png" },
    },
    {
      id: "front-white-ink",
      type: "image",
      source: { kind: "url", url: "https://example.test/front-white-ink.png" },
    },
  ],
  extensions: {
    "pooder.production-mask": {
      masks: {
        "front.white-ink": {
          surfaceId: "front",
          process: "white-ink",
          production: {
            enabled: true,
            referenceObjectId: "front.image-slot",
            source: { kind: "asset", assetId: "front-white-ink" },
            alpha: {
              selection: "transparent",
              mapping: "threshold",
              threshold: 0.2,
              softness: 0.05,
              outputOpacity: 1,
            },
          },
          presentation: {
            originalVisible: true,
            originalMaskVisible: true,
            currentMaskVisible: true,
          },
        },
      },
    },
  },
  surfaces: [
    {
      id: "front",
      title: "Front",
      geometry: {
        canvasBounds: { x: 0, y: 0, width: 100, height: 120 },
        productionBounds: { x: 3, y: 3, width: 94, height: 114 },
        exportBounds: { x: 0, y: 0, width: 100, height: 120 },
        safeBounds: { x: 5, y: 5, width: 90, height: 110 },
      },
      layers: [
        {
          id: "front.production",
          role: "production",
          visible: true,
          locked: true,
          objects: [
            {
              id: "front.dieline",
              tags: ["guide:cut"],
              visible: true,
              locked: true,
              placement: {
                localBounds: { x: 0, y: 0, width: 94, height: 114 },
                localToParent: [1, 0, 0, 1, 3, 3],
                pivot: { x: 0, y: 0 },
              },
              source: {
                kind: "path",
                pathData: "M 3 3 H 97 V 117 H 3 Z",
                sourceBounds: { x: 3, y: 3, width: 94, height: 114 },
              },
              appearance: {
                fill: "none",
                stroke: "#ff00ff",
                strokeWidth: 0.2,
                opacity: 1,
                dash: [],
              },
              traits: [{ type: "core.guide" }],
              effects: [
                {
                  type: "core.geometry.boolean",
                  operandObjectId: "front.feature.hole",
                  operation: "subtract",
                },
              ],
            },
            {
              id: "front.feature.hole",
              tags: ["feature:hole"],
              visible: false,
              locked: true,
              placement: {
                localBounds: { x: 0, y: 0, width: 8, height: 8 },
                localToParent: [1, 0, 0, 1, 46, 8],
                pivot: { x: 0, y: 0 },
              },
              source: { kind: "shape", shape: "circle", params: {} },
              appearance: { fill: "#000000", opacity: 1 },
              traits: [
                {
                  type: "popecho.feature-operand",
                  payload: { operation: "subtract" },
                },
              ],
            },
          ],
        },
        {
          id: "front.content",
          role: "content",
          visible: true,
          locked: false,
          objects: [
            {
              id: "front.image-slot",
              tags: ["slot:front"],
              visible: true,
              locked: false,
              placement: {
                localBounds: { x: 0, y: 0, width: 80, height: 90 },
                localToParent: [1, 0, 0, 1, 10, 15],
                pivot: { x: 0, y: 0 },
              },
              source: {
                kind: "image",
                assetId: "front-artwork",
              },
              appearance: {
                fit: "cover",
                anchorX: 0.5,
                anchorY: 0.5,
                zoom: 1,
                rotation: 0,
                opacity: 1,
                clip: "frame",
              },
              behaviors: [
                {
                  type: "pooder.image-slot",
                  config: {
                    accepts: ["image/png", "image/jpeg"],
                    placeholderSelector: { ids: ["front.image-placeholder"] },
                  },
                },
              ],
            },
            {
              id: "front.image-placeholder",
              tags: ["placeholder:image-slot", "slot:front"],
              visible: false,
              locked: true,
              placement: {
                localBounds: { x: 0, y: 0, width: 80, height: 90 },
                localToParent: [1, 0, 0, 1, 10, 15],
                pivot: { x: 0, y: 0 },
              },
              source: { kind: "shape", shape: "rect", params: {} },
              appearance: { fill: "#dbeafe", stroke: "#2563eb" },
              traits: [{ type: "core.placeholder" }],
            },
          ],
        },
      ],
    },
    {
      id: "back",
      title: "Back",
      geometry: {
        canvasBounds: { x: 0, y: 0, width: 100, height: 120 },
        productionBounds: { x: 3, y: 3, width: 94, height: 114 },
        exportBounds: { x: 0, y: 0, width: 100, height: 120 },
        safeBounds: { x: 5, y: 5, width: 90, height: 110 },
      },
      layers: [
        {
          id: "back.content",
          role: "content",
          visible: true,
          locked: false,
          objects: [
            {
              id: "back.artwork",
              tags: ["artwork:back"],
              visible: true,
              locked: false,
              placement: {
                localBounds: { x: 0, y: 0, width: 80, height: 90 },
                localToParent: [1, 0, 0, 1, 10, 15],
                pivot: { x: 0, y: 0 },
              },
              source: { kind: "shape", shape: "rect", params: {} },
            },
          ],
        },
      ],
    },
  ],
} as const;
