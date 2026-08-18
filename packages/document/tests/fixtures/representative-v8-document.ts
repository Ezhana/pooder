/**
 * Representative strict v8 fixture. It covers ordering, two-sided surfaces,
 * custom dieline/feature objects, an image slot, and a production-mask
 * declaration.
 */
export const REPRESENTATIVE_V8_DOCUMENT_INPUT = {
  version: 8,
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
    {
      id: "image-slot-placeholder",
      type: "image",
      source: { kind: "url", url: "https://example.test/placeholder.svg" },
    },
  ],
  extension: {
    required: [
      "pooder.kit.image-slot",
      "pooder.production-mask",
      "pooder.kit.edge-detection",
    ],
    states: {
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
  },
  surfaces: [
    {
      id: "front",
      title: "Front",
      bounds: { x: 0, y: 0, width: 100, height: 120 },
      insets: { top: 3, right: 3, bottom: 3, left: 3 },
      objects: [
        {
          type: "group",
          id: "front.content",
          tags: [],
          visible: true,
          locked: false,
          localToParent: [1, 0, 0, 1, 0, 0],
          children: [
            {
              type: "image",
              id: "front.image-slot",
              tags: ["slot:front"],
              visible: true,
              locked: false,
              localFrame: { x: 0, y: 0, width: 80, height: 90 },
              localToParent: [1, 0, 0, 1, 10, 15],
              localPivot: { x: 0, y: 0 },
              source: {
                kind: "asset",
                assetId: "front-artwork",
              },
              contentFit: {
                fit: "cover",
                anchorX: 0.5,
                anchorY: 0.5,
                zoom: 1,
                rotation: 0,
                clip: "frame",
              },
              opacity: 1,
              behaviors: [
                {
                  type: "pooder.image-slot",
                  config: {
                    accepts: ["image/png", "image/jpeg"],
                    placeholderSource: {
                      kind: "asset",
                      assetId: "image-slot-placeholder",
                    },
                  },
                },
              ],
            },
          ],
        },
        {
          type: "group",
          id: "front.production",
          tags: [],
          visible: true,
          locked: true,
          localToParent: [1, 0, 0, 1, 0, 0],
          children: [
            {
              type: "path",
              id: "front.dieline",
              tags: ["guide:cut"],
              visible: true,
              locked: true,
              localFrame: { x: 0, y: 0, width: 94, height: 114 },
              localToParent: [1, 0, 0, 1, 3, 3],
              localPivot: { x: 0, y: 0 },
              source: {
                kind: "inline",
                content: {
                  pathData: "M 3 3 H 97 V 117 H 3 Z",
                  sourceBounds: { x: 3, y: 3, width: 94, height: 114 },
                },
              },
              paint: {
                fill: null,
                stroke: "#ff00ff",
                strokeWidthMm: 0.2,
                dashMm: [],
              },
              opacity: 1,
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
              type: "shape",
              id: "front.feature.hole",
              tags: ["feature:hole"],
              visible: false,
              locked: true,
              localFrame: { x: 0, y: 0, width: 8, height: 8 },
              localToParent: [1, 0, 0, 1, 46, 8],
              localPivot: { x: 0, y: 0 },
              source: {
                kind: "inline",
                content: { shape: "circle", params: {} },
              },
              paint: { fill: "#000000" },
              opacity: 1,
              traits: [
                {
                  type: "popecho.feature-operand",
                  payload: { operation: "subtract" },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "back",
      title: "Back",
      bounds: { x: 0, y: 0, width: 100, height: 120 },
      insets: { top: 3, right: 3, bottom: 3, left: 3 },
      objects: [
        {
          type: "group",
          id: "back.content",
          tags: [],
          visible: true,
          locked: false,
          localToParent: [1, 0, 0, 1, 0, 0],
          children: [
            {
              type: "shape",
              id: "back.artwork",
              tags: ["artwork:back"],
              visible: true,
              locked: false,
              localFrame: { x: 0, y: 0, width: 80, height: 90 },
              localToParent: [1, 0, 0, 1, 10, 15],
              localPivot: { x: 0, y: 0 },
              source: {
                kind: "inline",
                content: { shape: "rect", params: {} },
              },
            },
          ],
        },
      ],
    },
  ],
} as const;
