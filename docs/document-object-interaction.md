# Document Object Interaction

`PooderObject.interaction` describes only persistent selection, manipulation,
and manipulation constraints. Tool activation and session behavior belong to
extension-owned `PooderObject.behaviors`.

```ts
const imageSlot: PooderObject = {
  type: "image",
  id: "front.image",
  tags: ["slot:image"],
  localFrame: { x: 0, y: 0, width: 100, height: 100 },
  localToParent: [1, 0, 0, 1, 0, 0],
  locked: false,
  visible: true,
  source: { kind: "asset", assetId: "front.image.asset" },
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
        accepts: ["image/*"],
        placeholderSource: {
          kind: "asset",
          assetId: "asset:image-slot-placeholder",
        },
      },
    },
  ],
  interaction: {
    selection: { enabled: true },
    manipulation: {
      move: {
        enabled: true,
        constraints: [
          {
            spec: { type: "grid.snap", params: { size: 5 } },
          },
        ],
      },
      resize: { enabled: true },
      rotate: { enabled: false },
    },
  },
};
```

Behavior schemas are registered by their owning extension. Missing behavior or
constraint schemas are validation errors. Capabilities derive activation,
exclusive sessions, and transient session scenes from the behavior; none of
that session state is persisted in `PooderDocument`.

The browser adapter asks Core `InteractionService` for resolved selection and
manipulation state. A logical subject may compile into multiple render graph
projections. Preview patches are derived from declarative `AffinePlacement`,
and commit produces one scene-space document patch that
`PooderDocumentService` converts through the parent transform before mutating
the document.

`selection` and each manipulation operation default to disabled. Any enabled
manipulation operation implies selection and hit testing. Object locking
disables selection and manipulation; locking does not inherit through groups.
On a hit chain, the innermost node with enabled selection wins. Selecting an
enabled ancestor requires explicit drill-in behavior. Constraints resolve once,
outermost to innermost, in each host node's parent-local space.
