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
