# App Workflow Composition

Status: P6.S2 documentation
Date: 2026-05-11

Applications compose product workflows from core services, browser platform
services, and kit capabilities. Kit no longer owns storefront tool ids or
business workflow orchestration.

## Register Capabilities

Install only the capabilities the app workflow needs, and pass app-owned layer
ids and config namespaces.

```ts
import { Pooder } from "@pooder/core";
import {
  createDesignExportCapability,
  createDielineGeometryCapability,
  createEdgeDetectionCapability,
  createImagePlacementCapability,
  type ImagePlacementCapabilityApi,
} from "@pooder/tools";

const runtime = new Pooder();

runtime.extensions.registerMany([
  createImagePlacementCapability({
    configNamespace: "storefrontImage",
    layers: {
      imageLayerId: "app.image",
      overlayLayerId: "app.image.overlay",
    },
  }),
  createEdgeDetectionCapability(),
  createDielineGeometryCapability({
    configNamespace: "storefrontDieline",
    layers: {
      targetLayerId: "app.dieline",
      imageClipLayerIds: ["app.image"],
    },
  }),
  createDesignExportCapability({
    layers: {
      sourceLayerIds: ["app.image", "app.dieline"],
    },
  }),
]);

await runtime.extensions.flushActivation();
```

The browser host still needs platform services such as canvas, layout, scene
adapter, and export. Applications should attach those platform services in the
same place they create the canvas host.

## Define App Tools Outside Kit

Store product tool metadata in the application. The catalog owns labels,
icons, ordering, workflow handlers, and visibility.

```ts
type StorefrontToolId = "image" | "whiteInk" | "dieline";

interface StorefrontTool {
  id: StorefrontToolId;
  label: string;
  workflow: "session" | "instant";
  activate(): Promise<void> | void;
}

const tools: StorefrontTool[] = [
  {
    id: "image",
    label: "Image",
    workflow: "session",
    activate: async () => {
      const image =
        runtime.capabilities.getOrThrow<ImagePlacementCapabilityApi>(
          "pooder.kit.image-placement",
        );
      await image.validateSession();
    },
  },
];
```

The application may still map legacy kit ids to app tool ids during migration,
but the app catalog should be the source of truth.

## Compose A Dieline Workflow

A product workflow can orchestrate multiple kit capabilities without activating
a kit-owned toolbar tool.

```ts
import type {
  DesignExportCapabilityApi,
  DielineGeometryCapabilityApi,
  EdgeDetectionCapabilityApi,
} from "@pooder/tools";

async function applyDielineFromArtwork() {
  const exportImage =
    runtime.capabilities.getOrThrow<DesignExportCapabilityApi>(
      "pooder.kit.design-export",
    );
  const edgeDetection =
    runtime.capabilities.getOrThrow<EdgeDetectionCapabilityApi>(
      "pooder.kit.edge-detection",
    );
  const dieline =
    runtime.capabilities.getOrThrow<DielineGeometryCapabilityApi>(
      "pooder.kit.dieline-geometry",
    );

  const crop = await exportImage.exportImage({
    sourceLayerIds: ["app.image"],
    crop: { type: "frame", frame: "trim" },
    format: "png",
  });

  const edge = await edgeDetection.detectEdge(crop.url);

  dieline.applyDetectedPath(edge, {
    sourceImage: {
      width: crop.width,
      height: crop.height,
    },
  });

  dieline.upsertPathElement({
    layerId: "app.dieline",
    elementId: "app.dieline.path",
    pathData: edge.pathData,
    style: { stroke: "#00a3ff", fill: "transparent" },
  });
}
```

## Workflow Rules

- App tool ids should be short product concepts such as `image`, `whiteInk`, or
  `dieline`; kit capability ids stay namespaced, such as
  `pooder.kit.image-placement`.
- App workflows call typed capability facades directly.
- App workflows create or pass app-owned layer ids before invoking kit
  capabilities.
- Session, activation, dirty state, route state, and toolbar visibility belong
  to the application. Use core workflow sessions if the workflow needs
  runtime-managed session state.
- Do not infer app tool availability from installed kit extensions.
