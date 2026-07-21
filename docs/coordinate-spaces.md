# Coordinate spaces

Pooder uses exactly four coordinate spaces:

- `object-local`: geometry relative to the object itself, such as an
  object-relative clip path.
- `parent-local`: geometry relative to the containing document object or
  layer. Persisted document objects use this space.
- `scene`: the canonical editor and render-graph space.
- `screen`: browser viewport pixels.

Values that cross a service, package, render, interaction, geometry, or export
boundary must use `CoordinatePoint`, `CoordinateDelta`, `CoordinateRect`, or
`CoordinateMatrix`. Points, deltas, and rectangles carry `space`; matrices carry
both `from` and `to`. Untagged geometry is only valid as a private intermediate
inside one coordinate-space implementation.

## Boundary rules

- A document object's frame and transform are `parent-local`.
- A formal `RenderGraphNode` is always `scene`. A render intent in another
  space is rejected with `render-intent-non-scene-space`; its producer must
  project it before compilation.
- `ViewportSystem` owns every `scene`/`screen` point, length, and rectangle
  conversion. Canvas and renderer adapters only delegate to it.
- An interaction commit exposes either a tagged `scene-delta` or an
  `object-local` to `scene` matrix. Command payloads receive the same value.
- A `GeometrySourceProvider` declares the space of every snapshot and
  descriptor. Projection requests declare `from` and `to`; relabeling geometry
  without a projection is forbidden.
- Frame hit regions and scene export crops are explicitly `scene`.
- Clip sources declare their space. Object-relative clips use `object-local`;
  absolute clips retain their declared space and the browser adapter performs
  only the viewport projection required by that declaration.

There is no implicit fallback when spatial values cross these boundaries. Use
the constructors and conversion APIs from `@pooder/core` instead of casting or
copying a value with a different space label.

## Canonical affine placement

Every formal render node uses one placement contract:

```ts
interface AffinePlacement {
  localBounds: CoordinateRect<"object-local">;
  localToScene: Matrix2D<"object-local", "scene">;
  pivot: CoordinatePoint<"object-local">;
}
```

`localBounds` describes geometry only. Its `left` and `top` may be non-zero and
must never be interpreted as scene position. `localToScene` is the sole
placement fact and stays intact through RenderIntent and RenderGraph; nesting is
flattened by matrix multiplication. A document object may name a
`parentObjectId`; its frame and transform are then interpreted in that parent's
local space. Rotation, non-uniform and negative scale,
skew, and translation are therefore preserved without decomposition. `pivot`
is an editing anchor in local coordinates, not an additional transform.

The document compiler is the compatibility boundary that converts persisted
parent-local frame/transform fields into `AffinePlacement`. Platform adapters do
not infer origins from visual type. Fabric receives the normalized matrix after
one explicit conversion from declared local bounds to Fabric's center and one
viewport projection. Reapplying a viewport always starts from
`localToScene`, never from Fabric's previously projected screen transform.
