# Kit Extension Inventory

Status: current extension inventory
Date: 2026-05-11

This inventory reflects `packages/kit/src/extensions/` as it exists now. Older
kit-owned product tools and removed compatibility surfaces are intentionally not
listed here.

## Current Extension Summary

| Extension | Capability id | Contributes `tools` | Primary behavior |
| --- | --- | --- | --- |
| `ClipCapabilityExtension` | `pooder.kit.clip` | No | Object-level clipping effect support |
| `ConfigurableVisualCapabilityExtension` | `pooder.kit.configurable-visual` | No | Config-driven visual replacement patches |
| `DesignExportCapabilityExtension` | `pooder.kit.design-export` | No | Design/image export facade |
| `DielineGeometryCapabilityExtension` | `pooder.kit.dieline-geometry` | No | Dieline geometry, render, and scene path helpers |
| `EdgeDetectionCapabilityExtension` | `pooder.kit.edge-detection` | No | Image edge detection facade |
| `FeatureCapabilityExtension` | `pooder.kit.feature` | No | Feature geometry and render support |
| `ImageMaskCapabilityExtension` | `pooder.kit.image-mask` | No | Image alpha/mask extraction |
| `ImagePlacementCapabilityExtension` | `pooder.kit.image-placement` | No | Image placement state, sessions, transforms, and export |
| `MirrorCapabilityExtension` | `pooder.kit.mirror` | No | Object-level mirror transform effect and runtime facade |
| `SceneExportCapabilityExtension` | `pooder.kit.scene-export` | No | Scene/layer/element export facade |

## Notes

- `DielineTool` and `FeatureTool` still exist as internal implementation bases
  for their capability extensions, but they are not exported from the public
  extension barrels and do not contribute product toolbar tools in the current
  capability-first API.
- Empty or removed extension directories are not part of the supported kit
  extension surface.
- Product toolbar catalogs, labels, ordering, activation, and workflow
  orchestration belong to applications.
