# Legacy Kit Migration Notes

Status: P6.S2 documentation
Date: 2026-05-11

This guide summarizes how to move callers from legacy kit-owned tool surfaces
to capability-first APIs.

## What Changed

- Installing `@pooder/kit` no longer adds product toolbar tools for image,
  dieline, or feature workflows.
- Applications own toolbar catalogs, labels, icons, activation, session policy,
  and workflow orchestration.
- Kit exposes typed capabilities and compatibility command bridges where they
  are still part of the public surface.
- Former storefront-oriented default layer ids are available only through the
  explicit `KIT_LEGACY_LAYER_PRESET`.

## Factory Replacements

| Legacy surface | Replacement |
| --- | --- |
| `createImageExtension()` | `createImagePlacementCapability()` |
| `createDielineExtension()` | `createDielineGeometryCapability()` plus `createEdgeDetectionCapability()` when edge detection is needed |
| `createFeatureExtension()` | `createFeatureCapability()` |

The removed public wrapper barrels for legacy kit tools should not be imported
by new callers.

## Before And After

Before, kit factories registered product tools and workflows:

```ts
runtime.extensions.registerMany([
  createImageExtension(),
  createDielineExtension(),
]);
```

After, the application registers capabilities and owns the app tool catalog:

```ts
runtime.extensions.registerMany([
  createImagePlacementCapability({
    configNamespace: "storefrontImage",
    layers: { imageLayerId: "app.image" },
  }),
  createEdgeDetectionCapability(),
  createDielineGeometryCapability({
    configNamespace: "storefrontDieline",
    layers: { targetLayerId: "app.dieline" },
  }),
]);
```

## Command Bridges

Prefer typed facades:

```ts
const image =
  runtime.capabilities.getOrThrow<ImagePlacementCapabilityApi>(
    "pooder.kit.image-placement",
  );

await image.upsertImage(url);
```

Use legacy command ids only when a host integration still depends on the
command bus. Command bridges are compatibility surfaces, not the preferred API
for new app code.

The supported legacy command bridge map lives in
`packages/kit/src/extensions/legacyCommandBridge.ts`. New command bus
integrations must use namespaced command ids unless they are explicitly added
to that bridge map with a typed facade replacement.

## Layer Migration

Old kit integrations often relied on fixed layer ids such as `image.user`,
`dieline-overlay`, or `feature-overlay`. New integrations should pass app-owned
ids through capability options.

```ts
createImagePlacementCapability({
  layers: { imageLayerId: "app.image" },
});

createDielineGeometryCapability({
  layers: {
    targetLayerId: "app.dieline",
    imageClipLayerIds: ["app.image"],
  },
});
```

Use `KIT_LEGACY_LAYER_PRESET` only when intentionally preserving old layer ids
during a major-version migration.

```ts
createImagePlacementCapability({
  layers: { imageLayerId: KIT_LEGACY_LAYER_PRESET.imageObject },
});
```

## Migration Checklist

- Replace removed legacy factories with capability factories.
- Move activity bar metadata and workflow handlers into the application.
- Pass app-owned layer ids and config namespaces into capability options.
- Resolve typed facades through `runtime.capabilities` instead of relying on
  kit tool activation.
- Keep command-bus usage only for compatibility integrations.
- Run package build and focused type checks after migrating callers.
