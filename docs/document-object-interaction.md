# Document Object Interaction

`EditorObject.interaction` is the only declaration source for persistent
document-object interaction. `@pooder/core` owns condition evaluation,
selection, activation/session/command dispatch, and manipulation constraints.
Capabilities must not make document objects interactive by writing renderer
flags such as `evented` or `selectable`.

This contract is available only in `EditorDocument` v7. Older documents and the
former `interaction.drag`, `interaction.transform`, and `action.command`
fields fail validation; they are not migrated.

```ts
const imagePlacement: EditorObject = {
  id: "front.image",
  frame: { x: 0, y: 0, width: 100, height: 100 },
  source: { kind: "url", url: "" },
  interaction: {
    enabledWhen: {
      op: "not",
      expr: {
        op: "truthy",
        ref: {
          source: "workflowSession",
          field: "anyActive",
          scope: { groupId: "editor-interaction" },
        },
      },
    },
    activation: {
      trigger: "primary-pointer",
      action: { commandId: "pooder.kit.image-placement.open-session" },
      session: {
        channel: "image-placement",
        groupId: "editor-interaction",
        sessionId: "front.image",
        mode: "exclusive",
        scope: "subject",
        leavePolicy: "block",
      },
    },
    manipulation: {
      move: {
        enabled: true,
        constraints: [
          {
            activeWhen: { op: "const", value: true },
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

The browser adapter asks Core `InteractionService` for resolved state and
derives renderer hit testing, selection, movement, resize controls, and rotate
controls from it. Pointer activation calls the service directly. Fabric
`moving`, `scaling`, and `rotating` map to Core `move`, `resize`, and `rotate`
operations; every operation uses the same extensible `ConstraintResolverService`.

## Logical subjects and render projections

Interaction identity is the logical `subjectId`, not a backend render object.
A subject may compile into multiple independent `RenderGraphNode` projections.
`RenderGraph.projectionMemberships` is the authoritative one-to-many index;
selection, activation, and manipulation resolve a backend hit through that
membership before entering Core.

During a drag, the browser adapter applies one absolute scene-space preview
delta to every projection in the membership. These changes belong only to the
derived renderer state and are always calculated from the declarative
placement baseline, never accumulated from screen coordinates.

On commit, `InteractionService` emits a standard `SceneTransformPatch` for the
logical subject. `EditorDocumentService` converts the scene delta through the
parent transform, mutates the document once, and recompiles the RenderGraph.
The browser platform does not inspect or mutate `EditorObject` variants.

`activation` defaults to enabled. `selection` and each manipulation operation
default to disabled. Any enabled manipulation operation implies selection and
hit testing. Object or layer locking disables selection and manipulation, but
does not implicitly disable activation.

Exclusive editor sessions share `EDITOR_INTERACTION_SESSION_GROUP_ID`. While
one is active, persistent convenience entries should be disabled with a
workflow-session condition. A capability that needs editable objects during a
session owns a renderable, transient `SceneService` scene for that session and
removes it on commit, rollback, cancellation, or deactivation.

The former `interactive`, `interaction`, `constraint`, and
`object-constraint` effect-based paths are not supported. Effects describe
visual or domain capability behavior; object interaction belongs on the object.
