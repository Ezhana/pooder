# Kit Extension Inventory

Status: current extension inventory
Date: 2026-05-11

This inventory reflects `packages/tools/src/extensions/` as it exists now. Older
kit-owned product tools and removed compatibility surfaces are intentionally not
listed here.

## Current Extension Summary

| Extension | Capability id | Contributes `tools` | Primary behavior |
| --- | --- | --- | --- |
| `ClipCapabilityExtension` | `pooder.kit.clip` | No | Object-level clipping effect support |
| `ConfigurableVisualCapabilityExtension` | `pooder.kit.configurable-visual` | No | Config-driven visual replacement patches |
| `DesignExportCapabilityExtension` | `pooder.kit.design-export` | No | Design/image export facade |
| `EdgeDetectionCapabilityExtension` | `pooder.kit.edge-detection` | No | Image edge detection facade |
| `ImageMaskCapabilityExtension` | `pooder.kit.image-mask` | No | Image alpha/mask extraction |
| `ImagePlacementCapabilityExtension` | `pooder.kit.image-placement` | No | Image placement state, sessions, transforms, and export |
| `MirrorCapabilityExtension` | `pooder.kit.mirror` | No | Object-level mirror transform effect and runtime facade |
| `SceneExportCapabilityExtension` | `pooder.kit.scene-export` | No | Scene/layer/element export facade |

## Notes

- Dieline and Feature are EditorDocument concepts, not Kit capabilities.
  Edge Detection remains a capability whose result is written to the cutline
  object through `EditorDocumentService`.
- Empty or removed extension directories are not part of the supported kit
  extension surface.
- Product toolbar catalogs, labels, ordering, activation, and workflow
  orchestration belong to applications.
