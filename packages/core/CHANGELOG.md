# @pooder/core

## Unreleased

### Added

- Added `CapabilityRegistryService`, public capability definition types, and
  `ExtensionContributions.capabilities` so extensions can expose discoverable
  capabilities without registering toolbar tools.
- Added `SceneService` and public headless scene types for dynamic layers,
  image/path/rect/text elements, scoped element queries, visibility metadata,
  and batched scene transactions.

### Planning Notes

- Track the capability-first architecture migration. Core is planned to own the
  runtime, capability registry, headless scene contracts, and workflow-neutral
  session contracts. See `../../docs/architecture-migration-plan.md`.
- Published naming and contribution policy for upcoming capability, scene,
  layer, element, and workflow session contracts. See
  `../../docs/naming-and-contribution-policy.md`.

## 3.0.0

### Major Changes

- Rebuild the runtime boundaries around a headless core, explicit kit capability dependencies, and a shell-only Vue package.

## 2.2.2

### Patch Changes

- image placement constraint

## 2.2.1

### Patch Changes

- bugfix

## 2.2.0

### Minor Changes

- service

## 2.1.0

### Minor Changes

- white ink tool and size tool

## 2.0.0

### Major Changes

- Virtual Features

## 1.2.0

### Minor Changes

- ruler and size

## 1.1.0

### Minor Changes

- bugfix

## 1.0.0

### Major Changes

- Architecture upgrade

## 0.1.0

### Minor Changes

- update

## 0.0.2

### Patch Changes

- changeset release
