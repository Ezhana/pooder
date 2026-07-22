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

`InteractionService.previewManipulation()` and
`InteractionService.commitManipulation()` are separate lifecycle boundaries.
Both return the same `InteractionManipulationResult` shape with an explicit
`phase`, `coordinateSpace: "scene"`, and one entry in `projectionPatches` per
projection target. Each target carries its own `GeometryRef`, so the operation
does not assume a renderer-specific geometry source. Move, resize, and rotate
therefore share one operation-result contract;
the platform adapter only locates each named backend projection and applies its
patch. It does not retain a second subject-membership or projection-baseline
list.

Every preview patch is derived from the projection's declarative
`AffinePlacement` through the runtime `GeometrySourceService`, never
accumulated from screen coordinates. The `ConstraintResolverService` and
`InteractionService` are required to use that same service instance, so
constraint geometry and projection geometry cannot disagree.

On commit, the result additionally contains a scene-space `documentPatch` and
`InteractionService` emits it for the logical subject. `EditorDocumentService`
converts the patch through the parent transform, mutates the document once,
and recompiles the RenderGraph. The browser platform does not inspect or mutate
`EditorObject` variants.

A viewport or surface-layout change is an authoritative preview barrier. The
browser adapter drops its active gesture handle and performs a full declarative
reconcile, allowing every temporary backend object position to be reconstructed
from the Document/RenderGraph under the new viewport transform.

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
