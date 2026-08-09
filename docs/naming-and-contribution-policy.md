# Naming And Contribution Policy

This policy defines the capability-first architecture and public naming rules.

## Ownership

- Core owns runtime-neutral services, scenes, coordinates, sessions, commands,
  and extension lifecycle.
- Platform packages implement browser and renderer adapters without leaking
  their implementation types into Core contracts.
- Tool packages own reusable capabilities, typed facades, schemas, commands,
  and render producers.
- Applications own product tool ids, labels, icons, ordering, availability,
  and workflow orchestration.

## Names

- Reusable behavior is a `Capability`; callable APIs use
  `<Domain>CapabilityApi` and definitions use `<Domain>CapabilityExtension`.
- Capability ids are stable, namespaced noun phrases.
- Scene contracts use `Scene*`, caller-addressable groupings use `Layer*`, and
  logical renderable entries use `Object*` or `SceneElement*` as appropriate.
- Public events use owner-scoped names and exported payload types, or typed
  subscription methods such as `onDidChange`.
- Commands are namespaced. New behavior should prefer typed capability facades
  over raw command strings.

## Contributions

- Extensions may contribute capabilities, services, commands, document schema,
  and reusable render behavior. They do not contribute product toolbar items.
- Cross-owner identifiers such as layer ids, config namespaces, and session ids
  are caller-controlled.
- Render producers target caller-owned layers and must not depend on app tool
  ids.
- Tool configuration contains reusable defaults only. Product labels and
  workflow choices belong to the application.
- Public APIs expose Core contracts, never Fabric objects, DOM nodes, or other
  platform implementation details.

## EditorDocument

- Only the strict v7 model is public. APIs do not expose aliases, migration
  wrappers, or alternate spellings.
- Extensions register schemas for every extension state, trait, behavior,
  constraint, and extension-owned Object effect they persist.
- Tool activation/session state is derived from Object behaviors. Interaction
  contains selection, manipulation, and constraints only.
- Product metadata does not enter the generic document model; express durable
  semantics through typed traits and extension state.
