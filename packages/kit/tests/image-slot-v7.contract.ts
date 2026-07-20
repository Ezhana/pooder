import type { EditorDocument, EditorImageObject } from "@pooder/document";
import { validateEditorDocument } from "@pooder/document";
import {
  IMAGE_SLOT_CAPABILITY_ID,
  type ImageSlotCapabilityApi,
  type ImageSlotSessionResult,
} from "../src";

const placement = {
  fit: "cover",
  anchorX: 0.5,
  anchorY: 0.5,
  zoom: 1,
  rotation: 0,
  opacity: 1,
  clip: "frame",
} as const;

const emptySlot: EditorImageObject = {
  id: "artwork",
  frame: { x: 0, y: 0, width: 100, height: 100 },
  source: { kind: "image" },
  placement,
  slot: { accepts: ["image/*"] },
  interaction: { hitRegion: { type: "frame" } },
};

const document: EditorDocument = {
  version: 7,
  config: {},
  surfaces: [
    {
      id: "front",
      size: { width: 100, height: 100, unit: "mm" },
      frames: {
        previewBounds: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 },
        productionFrame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 },
        viewportFocusFrame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 },
      },
      layers: [{ id: "artwork", objects: [emptySlot] }],
    },
  ],
};

const diagnostics = validateEditorDocument(document);
if (diagnostics.length) throw new Error("v7 image slot contract is invalid");

declare const facade: ImageSlotCapabilityApi;
void facade.openSession({ objectId: emptySlot.id });
void facade.setResource(
  {
    kind: "url",
    url: "/artwork.png",
    intrinsicSize: { width: 1200, height: 1200 },
  },
  { placement: "reset" },
);
facade.updatePlacement({ zoom: 1.25, rotation: 15 });

const result: ImageSlotSessionResult = {
  type: "cleared",
  objectId: emptySlot.id,
};
void result;
void IMAGE_SLOT_CAPABILITY_ID;
