import type { EditorDocument, EditorImageObject } from "@pooder/document";
import { validateEditorDocument } from "@pooder/document";
import {
  IMAGE_SLOT_CAPABILITY_ID,
  type ImageSlotCapabilityApi,
  type ImageSlotSessionResult,
} from "../src";

const contentFit = {
  fit: "cover",
  anchorX: 0.5,
  anchorY: 0.5,
  zoom: 1,
  rotation: 0,
  clip: "frame",
} as const;

const emptySlot: EditorImageObject = {
  type: "image",
  id: "artwork",
  tags: ["slot:artwork"],
  visible: true,
  locked: false,
  localFrame: { x: 0, y: 0, width: 100, height: 100 },
  localToParent: [1, 0, 0, 1, 0, 0],
  localPivot: { x: 0, y: 0 },
  source: null,
  contentFit,
  opacity: 1,
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
  version: 8,
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
  extension: { required: [], states: {} },
  surfaces: [
    {
      id: "front",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      objects: [
        {
          type: "group",
          id: "front.artwork.group",
          tags: [],
          visible: true,
          locked: false,
          localToParent: [1, 0, 0, 1, 0, 0],
          children: [emptySlot],
        },
      ],
    },
  ],
};

const diagnostics = validateEditorDocument(document);
if (diagnostics.length) throw new Error("v8 image slot contract is invalid");

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
