# @pooder/platform-browser

## Unreleased

### Added

- Added `FabricSceneAdapter` and browser host registration so core
  `SceneService` layers and elements sync into scoped Fabric render passes
  without replacing existing render producer output.
- Added layer-targeted render producer passes so capabilities can render into
  caller-created layers through scoped sources while preserving scene layer
  stacking and compatibility pass ids.

### Planning Notes

- Track the capability-first architecture migration. The browser platform is
  planned to implement core scene and render contracts behind Fabric/browser
  adapters while keeping tool-free layer and element operations available. See
  `../../docs/architecture-migration-plan.md`.
- Published naming and contribution policy for upcoming scene adapter, layer,
  element, and render producer boundaries. See
  `../../docs/naming-and-contribution-policy.md`.

## 1.0.2

### Patch Changes

- Improve small-screen canvas layout by using responsive view padding, removing fixed host minimums, and normalizing canvas-related source file names.

## 1.0.1

### Patch Changes

- Publish the browser platform package and update Vue/kit adapters to consume it.
