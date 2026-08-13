# EditorDocument v8 object-tree contract

`EditorDocument` version 8 is the only public document model. It is parsed
strictly and has no aliases, migration wrapper, or runtime v7 migrator.

## Object tree

Each surface owns one `objects` array. Draw order is array order plus
depth-first traversal; index zero is bottommost. Traits never change ordering.
Document objects do not create render/scene layers: the compiler targets the
surface id as its render-layer id, while runtime render and scene layers remain
independent concepts.

`EditorObject` is an exclusive recursive union:

- `group` is a structural transform node with `children`. It has no
  `localBounds`, `pivot`, `opacity`, `clip`, `effects`, `source`, `contentFit`,
  or `paint`.
- `image`, `path`, and `shape` are pixel-producing leaves. Every leaf has
  `localBounds`; `pivot`, `opacity`, `clip`, and `effects` are optional.
- The document model has no text object. Canvas text belongs to scene elements
  or extensions; restoring document text requires another document version.

Every node owns `localToParent`, the sole object-local to parent-local
transform. A surface root object's parent origin is the origin of
`surface.geometry.canvasBounds`. Leaf `localBounds.x/y` describe intrinsic
geometry and are not an additional placement.

## Inheritance and interaction

- Effective visibility is the logical AND of `visible` along the ancestor
  chain. A child cannot re-enable a hidden ancestor.
- `locked`, `opacity`, `tags`, `traits`, and `behaviors` do not inherit.
- `opacity` is leaf-only, belongs to `[0, 1]`, defaults to `1`, and is applied
  per leaf.
- Interaction belongs to its host node. Hit testing selects the innermost
  node on the hit chain whose `selection.enabled` is true; selecting an enabled
  ancestor requires explicit drill-in behavior.
- Constraints resolve in the host node's parent-local space. Nested constraints
  resolve once from outermost to innermost and do not iterate.

An interactive group compiles to a transparent interaction proxy. Its bounds
are the derived union of descendant geometry. It never creates a renderer
native group.

## Geometry, paint, and effects

Image content mapping is described only by `contentFit`; `anchorX` and
`anchorY` are in `[0, 1]`, and `zoom` is greater than zero. Paths and shapes use
optional `paint`; millimetre-valued fields are named `strokeWidthMm` and
`dashMm`. Path/shape source bounds fix their content-to-frame mapping.

Effects are leaf-only and apply in array order. Groups have no opacity,
effects, or clipping because the core model has no offscreen compositing
boundary. A producer that needs shared clipping expands it onto each leaf.
Path clipping uses a leaf `core.geometry.clip` effect that references a path
object.

Geometry references to groups resolve to compound snapshots derived from their
children. IDs are globally unique across assets, surfaces, and all object
nodes.

## Flattening guarantee

Every group can be expanded in place without changing pixels: left-multiply
each child's `localToParent` by the group's matrix and AND each child's
`visible` with the group's visibility. This guarantee excludes group
interaction proxies, which are editing affordances and never exported.

The model deliberately does not support group opacity, group effects, or group
clipping. Fading each leaf can color overlaps differently from true group
opacity. A future whole-subtree pixel operation must be supplied by an
extension that explicitly declares offscreen-compositing capability.
