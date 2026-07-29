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
- A `GeometrySource` declares the space, bounds, and `localToScene` matrix of
  every snapshot. Geometry is accessed through `GeometryRef`; projection
  transforms values to the requested space and never merely relabels them.
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
placement fact and stays intact through RenderIntent and RenderGraph. A
Composite owns recursive `children`; each child frame and transform is
parent-local, and nesting is flattened by recursive matrix multiplication.
Rotation, non-uniform and negative scale,
skew, and translation are therefore preserved without decomposition. `pivot`
is an editing anchor in local coordinates, not an additional transform.

The document compiler is the compatibility boundary that converts persisted
parent-local frame/transform fields into `AffinePlacement`. Platform adapters do
not infer origins from visual type. Fabric receives the normalized matrix after
one explicit conversion from declared local bounds to Fabric's center and one
viewport projection. Reapplying a viewport always starts from
`localToScene`, never from Fabric's previously projected screen transform.

## Image-local geometry

Image fit is a local geometry capability. `cover`, `contain`, and `stretch`
produce an `imageLocalToObjectLocal` matrix; they never produce Fabric
`left`, `top`, `scale`, `angle`, or origin fields. Anchor values are normalized
coordinates in the object's local frame and are clamped to `[0, 1]`.
“Image-local” is the image visual's `object-local` domain, not a fifth global
coordinate space; the matrix name distinguishes it from the containing
document object's local domain.

The document compiler composes matrices in one direction:

`image-local → object-local → parent-local → scene`

Real resources and empty-slot presentation resources call the same geometry
resolver. Changing the image source therefore cannot change the document frame
or its scene placement. A frame clip remains an object-local rectangle in the
geometry result; the render compiler projects it with the object's canonical
matrix when it creates the scene clip node.
