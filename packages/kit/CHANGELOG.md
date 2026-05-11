# @pooder/kit

## Unreleased

### Added

- Added a typed `pooder.kit.image-placement` capability facade and a
  capability-only image placement extension that accepts caller-provided layer
  ids and config namespaces while keeping `ImageTool` as the compatibility
  wrapper.
- Added typed `pooder.kit.edge-detection` and
  `pooder.kit.dieline-geometry` capability facades so callers can detect image
  edges, apply detected dieline paths, target caller-owned layers, and upsert
  scene path elements without invoking a kit-owned dieline tool.
- Added a typed `pooder.kit.white-ink` capability facade and capability-only
  white ink extension that accepts caller-provided source layer ids, render
  layer ids, and config namespaces while keeping `WhiteInkTool` as the
  compatibility wrapper.
- Added typed `pooder.kit.template-overlay`, `pooder.kit.background`,
  `pooder.kit.size`, and `pooder.kit.ruler` capability facades with
  capability-only extensions so presentational helpers can be enabled
  independently without registering kit-owned toolbar tools.

### Changed

- Updated the legacy `exportImage` design export command to delegate browser
  export work to `@pooder/platform-browser` while preserving compatibility
  layer defaults and result shape.
- Updated legacy dieline commands and workflow orchestration to delegate through
  typed edge detection, image placement, and dieline geometry facades when
  available, with command/config fallbacks preserved for compatibility.
- Updated legacy white ink commands to delegate through the white ink
  capability wrapper and made white ink settings namespace-aware for
  capability-only use.
- Updated legacy template overlay, background, size, and ruler wrappers to
  register typed capability facades while preserving existing command/config
  compatibility. Capability-only variants accept caller-owned config
  namespaces or layer ids where supported.

### Planning Notes

- Track the capability-first architecture migration. Kit is planned to stop
  contributing product tools and instead expose optional capabilities such as
  image placement, edge detection, dieline geometry, white ink extraction,
  template overlays, rulers, and export helpers. See
  `../../docs/architecture-migration-plan.md`.
- Published the current kit tool coupling inventory for migration slice P0.S2.
  See `../../docs/kit-tool-coupling-inventory.md`.
- Published naming and contribution policy for capability-first kit APIs and
  legacy `*Tool` compatibility wrappers. See
  `../../docs/naming-and-contribution-policy.md`.

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
