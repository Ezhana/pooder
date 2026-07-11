# @pooder/kit

## 9.0.0

### Major Changes

- Capability and Facade

### Patch Changes

- Updated dependencies
  - @pooder/document@2.0.0
  - @pooder/core@4.0.0

## Unreleased

### Added

- Added a centralized legacy command bridge map documenting each global command
  id, typed capability facade replacement, and compatibility target.
- Added a typed `pooder.kit.image-placement` capability facade and a
  capability-only image placement extension that accepts caller-provided layer
  ids and config namespaces.
- Added typed `pooder.kit.edge-detection` and
  `pooder.kit.dieline-geometry` capability facades so callers can detect image
  edges, apply detected dieline paths, target caller-owned layers, and upsert
  scene path elements without invoking a kit-owned dieline tool.
- Added a typed `pooder.kit.design-export` capability facade and
  capability-only design export extension for layer, element, scene-rect, and
  frame exports while keeping the legacy `exportImage` command bridge.
- Added a typed `pooder.kit.feature` capability facade and capability-only
  feature extension for feature geometry, constraints, placement, projection,
  and session render support.
- Added a typed `pooder.kit.mirror` capability facade and object-level
  document effect for horizontal and vertical mirror transforms.
- Added `KIT_LEGACY_LAYER_PRESET` for callers that intentionally need the
  former storefront-oriented kit layer ids during migration.

### Changed

- Updated document RenderIntent effect application to use the same core
  patch-entry merge and diagnostics path as runtime patches.
- Updated the legacy `exportImage` design export command to delegate browser
  export work to `@pooder/platform-browser` while preserving compatibility
  layer defaults and result shape.
- Updated legacy dieline commands and workflow orchestration to delegate through
  typed edge detection, image placement, and dieline geometry facades when
  available, with command/config fallbacks preserved for compatibility.
- Updated the legacy design export wrapper to register the typed export facade
  while preserving the existing `exportImage` command behavior.
- Updated the legacy feature wrapper to register the typed feature facade while
  preserving existing feature tool and command behavior.
- Removed kit-owned product tool contributions from legacy image, dieline, and
  feature compatibility wrappers while keeping capability,
  command bridge, config, and render producer contributions.
- Replaced the viewport mirror helper with the object-level
  `MirrorCapabilityExtension`.
- Moved former app-specific default layer ids behind the explicit
  `KIT_LEGACY_LAYER_PRESET`; capability options should pass caller-owned layer
  ids through their `layers` option.

### Deprecated

- Deprecated compatibility wrapper: `createImageExtension` ->
  `createImagePlacementCapability()`.
- Deprecated compatibility wrapper: `DielineTool` ->
  `createDielineGeometryCapability()`.
- Deprecated compatibility wrapper: `createDielineExtension` ->
  `createDielineGeometryCapability()`.
- Deprecated compatibility wrapper: `FeatureTool` ->
  `createFeatureCapability()`.
- Deprecated compatibility wrapper: `createFeatureExtension` ->
  `createFeatureCapability()`.

### Removed

- Removed legacy `tools` contributions for `pooder.kit.image`,
  `pooder.kit.dieline`, and `pooder.kit.feature` so installing kit no longer
  adds product tools.
- Removed public compatibility factories `createImageExtension`,
  `createDielineExtension`, and `createFeatureExtension`. Use
  `createImagePlacementCapability`, `createDielineGeometryCapability`, and
  `createFeatureCapability` instead.
- Removed public wrapper barrel exports for legacy kit tools.
- Removed legacy viewport mirror command/config support.

### Migration Examples

- Replace `createImageExtension()` with
  `createImagePlacementCapability({ layers: { imageLayerId: "app.image" } })`.
- Replace `createDielineExtension()` with
  `createDielineGeometryCapability({ layers: { targetLayerId: "app.dieline" } })`.
- Use `KIT_LEGACY_LAYER_PRESET` only when intentionally preserving the former
  kit layer ids during a major-version migration.

### Planning Notes

- Track the capability-first architecture migration. Kit is planned to stop
  contributing product tools and instead expose optional capabilities such as
  image placement, edge detection, dieline geometry, mirror transforms, and
  export helpers. See
  `../../docs/architecture-migration-plan.md`.
- Published the current kit tool coupling inventory for migration slice P0.S2.
  See `../../docs/kit-tool-coupling-inventory.md`.
- Published naming and contribution policy for capability-first kit APIs and
  legacy `*Tool` compatibility wrappers. See
  `../../docs/naming-and-contribution-policy.md`.
- Verified migration slice P4.S4 with Pooder package builds plus storefront
  type and production build integration checks.
- Added migration slice P6.S1 contract test coverage for kit capability
  definition metadata, caller-owned config namespaces and layer ids,
  capability-only registration, and layer-targeted dieline scene path upserts.
- Added migration slice P6.S2 documentation for kit capability authoring,
  app-owned workflow composition, legacy factory replacements, command bridges,
  and `KIT_LEGACY_LAYER_PRESET` layer migration.

## 8.0.0

### Major Changes

- Add editor-level design image export and remove the old dieline cut image command.

## 7.0.3

### Patch Changes

- Improve small-screen canvas layout by using responsive view padding, removing fixed host minimums, and normalizing canvas-related source file names.
- Updated dependencies
  - @pooder/platform-browser@1.0.2

## 7.0.2

### Patch Changes

- 6bc4e3c: Improve template overlay clipping and image layer rendering behavior.

## 7.0.1

### Patch Changes

- Publish the browser platform package and update Vue/kit adapters to consume it.
- Updated dependencies
  - @pooder/platform-browser@1.0.1

## 7.0.0

### Major Changes

- Rebuild the runtime boundaries around a headless core, explicit kit capability dependencies, and a shell-only Vue package.

### Patch Changes

- Updated dependencies
  - @pooder/core@3.0.0

## 6.3.1

### Patch Changes

- image placement constraint
- Updated dependencies
  - @pooder/core@2.2.2

## 6.3.0

### Minor Changes

- pooder facade

## 6.2.2

### Patch Changes

- bugfix

## 6.2.1

### Patch Changes

- bugfix

## 6.2.0

### Minor Changes

- refactor the dieline feature and modify the image snap

## 6.1.2

### Patch Changes

- snapping

## 6.1.1

### Patch Changes

- bugfix
- Updated dependencies
  - @pooder/core@2.2.1

## 6.1.0

### Minor Changes

- project structure

## 6.0.1

### Patch Changes

- image control

## 6.0.0

### Major Changes

- pass compositor

## 5.4.0

### Minor Changes

- spec framework

## 5.3.1

### Patch Changes

- fix edge detection and expand

## 5.3.0

### Minor Changes

- refactor tracer and white ink bugfix

## 5.2.0

### Minor Changes

- image hatch overlay

## 5.1.0

### Minor Changes

- service

### Patch Changes

- Updated dependencies
  - @pooder/core@2.2.0

## 5.0.4

### Patch Changes

- bugfix

## 5.0.3

### Patch Changes

- bugfix

## 5.0.2

### Patch Changes

- bugfix

## 5.0.1

### Patch Changes

- bugfix

## 5.0.0

### Major Changes

- white ink tool and size tool

### Patch Changes

- Updated dependencies
  - @pooder/core@2.1.0

## 4.3.1

### Patch Changes

- bugfix

## 4.3.0

### Minor Changes

- bridge and constraints

## 4.2.0

### Minor Changes

- viewport system, constraints and features

## 4.1.0

### Minor Changes

- Restriction strategy

## 4.0.0

### Major Changes

- Virtual Features

### Patch Changes

- Updated dependencies
  - @pooder/core@2.0.0

## 3.5.0

### Minor Changes

- edge features

## 3.4.0

### Minor Changes

- bugfix

## 3.3.0

### Minor Changes

- hole shape

## 3.2.0

### Minor Changes

- ruler and size

### Patch Changes

- Updated dependencies
  - @pooder/core@1.2.0

## 3.1.0

### Minor Changes

- feat: anchor position

## 3.0.1

### Patch Changes

- Updated dependencies
  - @pooder/core@1.1.0

## 3.0.0

### Major Changes

- Architecture upgrade

### Patch Changes

- Updated dependencies
  - @pooder/core@1.0.0

## 2.0.0

### Major Changes

- update

### Patch Changes

- Updated dependencies
  - @pooder/core@0.1.0

## 1.0.0

### Major Changes

- fix

## 0.0.2

### Patch Changes

- changeset release
- Updated dependencies
  - @pooder/core@0.0.2
