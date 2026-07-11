# Compatibility Surface Inventory

Status: current compatibility inventory
Date: 2026-05-26

This inventory tracks legacy surfaces that remain available while Pooder moves
to explicit capabilities, typed facades, and deterministic RenderIntent patch
ownership.

## Status Labels

| Status | Meaning |
| --- | --- |
| `active compatibility` | Still supported for existing callers. New code should prefer the typed replacement. |
| `deprecated bridge` | Kept only as a migration bridge with a documented replacement. |
| `dead API` | Accepted or present in types, but no longer used by core or kit behavior. |
| `remove in major` | Candidate for the next major cleanup once callers have migrated. |

## Surfaces

| Surface | Status | Replacement / owner |
| --- | --- | --- |
| Legacy global command ids | `deprecated bridge` | Use typed capability facades. Allowed bridges are listed in `packages/kit/src/extensions/legacyCommandBridge.ts`. |
| `exportImage` | `deprecated bridge` | `DesignExportCapabilityApi.exportImage()` or `SceneExportCapabilityApi.exportImage()`. |
| `detectEdge` | `deprecated bridge` | `EdgeDetectionCapabilityApi.detectEdge()`. |
| `updateFeaturePosition` | `deprecated bridge` | `DielineGeometryCapabilityApi.updateFeaturePosition()`. |
| Feature session commands | `deprecated bridge` | `FeatureCapabilityApi` methods: `beginSession`, `addFeature`, `addDoubleLayerHole`, `clearFeatures`, `rollbackSession`, `resetSession`, `updateWorkingGroupPosition`, `completeSession`. |
| Global events `image:state:change`, `image:session:notice`, `image:session:open`, `feature:working:change` | `active compatibility` | Capability-owned typed subscriptions should be added before new consumers depend on raw global events. |
| Service-local raw events like `change` and `definitions:change` | `active compatibility` | Public consumers should use typed service methods such as `onDidChange` and `onDefinitionsChange`. |
| `KIT_LEGACY_LAYER_PRESET` | `active compatibility` | Caller-owned layer ids passed through capability options. |
| Legacy layer constants `image.user`, `dieline-overlay`, `feature-overlay`, `feature-dieline-overlay` | `remove in major` | Use app-owned layer ids; use `KIT_LEGACY_LAYER_PRESET` only to preserve old layouts during migration. |
| Legacy config namespaces such as `dieline.*` | `active compatibility` | Capability options should pass app-owned `configNamespace` values. |
| `FeatureToolOptions.requireDielineExtension` | `deprecated bridge` | Prefer explicit capability registration and dependencies owned by the app. |

## RenderIntent Patch Ownership

RenderIntent patch sources should identify their owner:

- `document`: patches derived from persisted document state.
- `capability:<id>`: patches emitted by a typed capability.
- `session:<id>`: temporary workflow/session patches.
- `app:<id>`: application-owned runtime patches.

Runtime patch entries are sorted by `priority`, `phase`, `sequence`,
`sourceId`, and `patch.id`. Higher priority applies later. `patch.clear`
explicitly removes fields; `undefined` continues to mean “do not modify”.

Typed graph diagnostics are non-blocking unless marked `error`. Conflict
diagnostics are warnings by default for critical fields:
`visual.replacement`, `placement.frame`, `ordering.layerId`,
`interaction.session`, and `export.visibleWhen`.
