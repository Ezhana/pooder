/**
 * Pre-convergence v7 fixture kept as the stage-0 contract baseline.
 *
 * Later stages deliberately update this fixture in lockstep with the public
 * EditorDocument contract. It covers ordering, two-sided surfaces, custom
 * dieline/feature objects, an image slot, and a production-mask declaration.
 */
export const REPRESENTATIVE_V7_DOCUMENT_INPUT = {
  version: 7,
  config: {
    scene: { unit: "mm" },
  },
  views: [
    { id: "front-view", title: "Front", surfaceIds: ["front"] },
    { id: "back-view", title: "Back", surfaceIds: ["back"] },
  ],
  surfaces: [
    {
      id: "front",
      title: "Front",
      size: { width: 100, height: 120, unit: "mm" },
      frames: {
        previewBounds: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
        productionFrame: { xMm: 3, yMm: 3, widthMm: 94, heightMm: 114 },
        exportFrame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
        viewportFocusFrame: { xMm: 5, yMm: 5, widthMm: 90, heightMm: 110 },
      },
      layers: [
        {
          id: "front.production",
          role: "production",
          objects: [
            {
              id: "front.dieline",
              frame: { x: 3, y: 3, width: 94, height: 114 },
              tags: ["dieline"],
              source: {
                kind: "path",
                pathData: "M 3 3 H 97 V 117 H 3 Z",
                sourceBounds: { x: 3, y: 3, width: 94, height: 114 },
              },
              effects: [{ type: "guide", role: "cut" }],
            },
            {
              id: "front.feature.hole",
              frame: { x: 46, y: 8, width: 8, height: 8 },
              tags: ["feature", "hole"],
              source: { kind: "shape", shape: "circle", params: {} },
            },
          ],
          effects: [
            {
              id: "front.production-mask.white-ink",
              type: "production-mask",
              payload: {
                process: "white-ink",
                enabled: true,
                reference: {
                  type: "document-object",
                  objectId: "front.image-slot",
                },
                source: {
                  type: "image-resource",
                  resource: {
                    kind: "url",
                    url: "https://example.test/front-white-ink.png",
                  },
                },
                alpha: {
                  selection: "transparent",
                  mapping: "threshold",
                  threshold: 0.2,
                  softness: 0.05,
                  outputOpacity: 1,
                },
              },
            },
          ],
        },
        {
          id: "front.content",
          role: "content",
          objects: [
            {
              id: "front.image-slot",
              frame: { x: 10, y: 15, width: 80, height: 90 },
              source: {
                kind: "image",
                resource: {
                  kind: "url",
                  url: "https://example.test/front-artwork.png",
                },
              },
              placement: {
                fit: "cover",
                anchorX: 0.5,
                anchorY: 0.5,
                zoom: 1,
                rotation: 0,
                opacity: 1,
                clip: "frame",
              },
              slot: { accepts: ["image/png", "image/jpeg"] },
            },
          ],
        },
      ],
    },
    {
      id: "back",
      title: "Back",
      size: { width: 100, height: 120, unit: "mm" },
      frames: {
        previewBounds: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
        productionFrame: { xMm: 3, yMm: 3, widthMm: 94, heightMm: 114 },
        exportFrame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 120 },
        viewportFocusFrame: { xMm: 5, yMm: 5, widthMm: 90, heightMm: 110 },
      },
      layers: [
        {
          id: "back.content",
          role: "content",
          objects: [
            {
              id: "back.artwork",
              frame: { x: 10, y: 15, width: 80, height: 90 },
              source: { kind: "shape", shape: "rect", params: {} },
            },
          ],
        },
      ],
    },
  ],
} as const;
