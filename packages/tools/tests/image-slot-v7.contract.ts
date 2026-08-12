import type { EditorDocument, EditorImageObject } from "@pooder/document";
import { validateEditorDocument } from "@pooder/document";
import {
  IMAGE_SLOT_CAPABILITY_ID,
  type ImageSlotCapabilityApi,
  type ImageSlotSessionResult,
} from "../src";

const appearance = {
  fit: "cover",
  anchorX: 0.5,
  anchorY: 0.5,
  zoom: 1,
  rotation: 0,
  opacity: 1,
  clip: "frame",
} as const;

const emptySlot: EditorImageObject = {
  type: "image",
  id: "artwork",
  tags: ["slot:artwork"],
  visible: true,
  locked: false,
  placement: {
    localBounds: { x: 0, y: 0, width: 100, height: 100 },
    localToParent: [1, 0, 0, 1, 0, 0],
    pivot: { x: 0, y: 0 },
  },
  source: null,
  appearance,
  behaviors: [
    {
      type: "pooder.image-slot",
      config: {
        accepts: ["image/*"],
        placeholderSource: {
          kind: "asset",
          assetId: "artwork.placeholder.asset",
        },
      },
    },
  ],
};

const document: EditorDocument = {
  version: 7,
  assets: [
    {
      id: "artwork.placeholder.asset",
      type: "image",
      source: { kind: "url", url: "/placeholder.svg" },
    },
    {
      id: "artwork.upload.asset",
      type: "image",
      source: { kind: "url", url: "/artwork.png" },
      intrinsicSize: { width: 1200, height: 1200 },
    },
  ],
  extensions: {},
  surfaces: [
    {
      id: "front",
      geometry: {
        canvasBounds: { x: 0, y: 0, width: 100, height: 100 },
        productionBounds: { x: 0, y: 0, width: 100, height: 100 },
      },
      layers: [
        {
          id: "front.artwork.layer",
          visible: true,
          locked: false,
          objects: [emptySlot],
        },
      ],
    },
  ],
};

const diagnostics = validateEditorDocument(document);
if (diagnostics.length) throw new Error("v7 image slot contract is invalid");

declare const facade: ImageSlotCapabilityApi;
void facade.openSession({ objectId: emptySlot.id });
void facade.setAsset("artwork.upload.asset", { placement: "reset" });
facade.updatePlacement({ zoom: 1.25, rotation: 15 });

const result: ImageSlotSessionResult = {
  type: "cleared",
  objectId: emptySlot.id,
};
void result;
void IMAGE_SLOT_CAPABILITY_ID;
