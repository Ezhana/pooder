# Document Object Interaction

`EditorObject.interaction` is the only declaration source for persistent
document-object interaction. Capabilities may interpret the declared command,
constraints, and session, but they must not make document objects interactive
by writing renderer flags such as `evented` or `selectable`.

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
      action: { command: "pooder.kit.image-placement.open-session" },
      session: {
        channel: "image-placement",
        groupId: "editor-interaction",
        sessionId: "front.image",
        mode: "exclusive",
        scope: "subject",
        leavePolicy: "block",
      },
    },
  },
};
```

The browser adapter evaluates `enabledWhen` and derives renderer hit testing,
selection, controls, and drag behavior from the interaction aspect. An
activation emits a typed interaction event; the interaction capability obtains
the declared workflow session and executes the declared command.

Exclusive editor sessions share `EDITOR_INTERACTION_SESSION_GROUP_ID`. While
one is active, persistent convenience entries should be disabled with a
workflow-session condition. A capability that needs editable objects during a
session owns a renderable, transient `SceneService` scene for that session and
removes it on commit, rollback, cancellation, or deactivation.

The former `interactive`, `interaction`, `constraint`, and
`object-constraint` effect-based paths are not supported. Effects describe
visual or domain capability behavior; object interaction belongs on the object.
