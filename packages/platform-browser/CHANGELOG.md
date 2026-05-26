# @pooder/platform-browser

## 2.0.0

### Major Changes

- Capability and Facade

### Patch Changes

- Updated dependencies
  - @pooder/core@4.0.0

## Unreleased

### Added

- Added `FabricRenderGraphAdapter` and browser host registration so core
  render graph layers and nodes sync into a reconciled Fabric draw list.
- Added graph-targeted runtime rendering so capabilities can render into
  caller-created layers through render intent patches while preserving graph
  stacking.
- Added tool-free render visibility predicates for caller-owned context values
  and workflow sessions while preserving legacy tool predicates.
- Added `BrowserSceneExportService` for platform-owned browser export of
  selected layers, selected elements, element-bounds crops, and scene frame
  crops.

### Planning Notes

- Track the capability-first architecture migration. The browser platform is
  planned to implement core scene and render contracts behind Fabric/browser
  adapters while keeping tool-free layer and element operations available. See
  `../../docs/architecture-migration-plan.md`.
- Published naming and contribution policy for upcoming scene adapter, layer,
  element, and render producer boundaries. See
  `../../docs/naming-and-contribution-policy.md`.
- Verified migration slice P4.S4 with Pooder package builds plus storefront
  type and production build integration checks.
- Added migration slice P6.S1 contract test coverage for browser scene adapter
  scoped layer sync, all core scene element type mappings, visibility, update,
  removal, and scene-owned stacking behavior.
- Added migration slice P6.S2 documentation for platform-owned browser service
  composition in capability-first applications.

## 1.0.2

### Patch Changes

- Improve small-screen canvas layout by using responsive view padding, removing fixed host minimums, and normalizing canvas-related source file names.

## 1.0.1

### Patch Changes

- Publish the browser platform package and update Vue/kit adapters to consume it.
