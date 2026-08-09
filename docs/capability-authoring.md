# Capability Authoring Guide

Persistent document-object hit testing and activation are declared through
`EditorObject.interaction`; see [Document Object Interaction](./document-object-interaction.md).
Capabilities should use transient scenes for session-owned interaction visuals.

Status: P6.S2 documentation
Date: 2026-05-11

This guide describes how to add reusable Pooder behavior through capabilities.

## Ownership

- `@pooder/core` owns runtime-neutral contracts: extension lifecycle,
  capability registration, commands, configuration, workflow sessions, and the
  headless scene graph.
- `@pooder/platform-browser` owns browser and Fabric implementations for scene,
  render, export, canvas, and layout services.
- Individual Tool packages own optional reusable capabilities. Each package
  owns its capability and command ids, typed facade, factory, tests, and any
  persisted Document schema. Tool capabilities may expose config defaults,
  commands, and render producers, but must not define product toolbar
  items or workflow semantics.
- `@pooder/tools` is a migration aggregate for implementations that predate the
  package contract; new Tools must not be added to that monolith.
- `@pooder/kit` explicitly re-exports factories only and is never a Tool
  dependency.
- Applications own product tool ids, labels, icons, activity bars, workflow
  ordering, and orchestration.

## Capability Shape

Register new reusable behavior through `ExtensionContributions.capabilities`.
The public surface should be a typed facade, not a toolbar tool.

```ts
import type { CapabilityDefinition, ExtensionDefinition } from "@pooder/core";

export interface CropPreviewCapabilityApi {
  refresh(): void;
  setSourceLayerIds(layerIds: string[]): void;
}

export const CROP_PREVIEW_CAPABILITY_ID = "acme.crop-preview";

function createCropPreviewCapabilityDefinition(
  facade: CropPreviewCapabilityApi,
): CapabilityDefinition<CropPreviewCapabilityApi> {
  return {
    id: CROP_PREVIEW_CAPABILITY_ID,
    metadata: {
      name: "Crop Preview",
      tags: ["preview", "crop"],
    },
    facade,
  };
}

export class CropPreviewCapabilityExtension implements ExtensionDefinition {
  id = CROP_PREVIEW_CAPABILITY_ID;

  activate() {}

  contribute() {
    return {
      capabilities: [
        createCropPreviewCapabilityDefinition({
          refresh() {},
          setSourceLayerIds() {},
        }),
      ],
    };
  }
}
```

Applications resolve the facade through the runtime:

```ts
const cropPreview = runtime.capabilities.getOrThrow<CropPreviewCapabilityApi>(
  CROP_PREVIEW_CAPABILITY_ID,
);

cropPreview.refresh();
```

## Scene And Layer Contracts

Use `SceneService` for caller-owned layers and elements. Do not expose Fabric
objects from core or kit capability APIs.

```ts
import { SCENE_SERVICE, type SceneService } from "@pooder/core";

const scene = runtime.services.getOrThrow<SceneService>(SCENE_SERVICE);

scene.transaction(() => {
  if (!scene.getLayer("app.preview")) {
    scene.addLayer({
      id: "app.preview",
      order: 20,
      metadata: { owner: "app" },
    });
  }

  scene.addElement({
    id: "app.preview.crop",
    layerId: "app.preview",
    type: "rect",
    width: 120,
    height: 80,
    style: { stroke: "#00a3ff", fill: "transparent" },
  });
});
```

Capability options should accept caller-owned identifiers:

```ts
createCropPreviewCapability({
  layers: {
    sourceLayerIds: ["app.artwork"],
    targetLayerId: "app.preview",
  },
  configNamespace: "storefront.cropPreview",
});
```

## Commands

Prefer typed facade methods for new behavior. Add command contributions only
when a host integration needs command bus access.

- New command ids should be namespaced by package or capability.
- Commands delegate to the same typed facade implementation used by
  applications.
- Do not add unnamespaced global commands.

## Checklist

- The extension contributes a capability without contributing `tools`.
- Public APIs accept caller-provided layer ids, config namespaces, and workflow
  ids when those values cross ownership boundaries.
- Core-facing data uses `SceneLayer`, `SceneElement`, and typed facade shapes,
  not Fabric objects.
- Render producers target caller-owned layer ids and use tool-free visibility
  predicates where visibility is needed.
- Tests cover facade registration, layer/config option normalization, and any
  scene mutations performed by the capability.
- The package passes the dependency, removal, and standalone criteria in
  [Tool Package Contract](./tool-package-contract.md).
