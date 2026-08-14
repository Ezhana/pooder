# EditorDocument v8 object-tree contract

`EditorDocument` version 8 is the only public document model. It is parsed
strictly and has no aliases, migration wrapper, or runtime v7 migrator.

The document's `extension` facet is not a state map. `extension.required` is
the BFF-authored list of real extension/capability ids the runtime must load;
`extension.states` is persisted extension-owned state keyed by those ids. The
list is document-scoped and is not inferred from objects, behaviors, or
effects. Product toolbars are a separate catalog; several tools may share one
required extension.

## Object tree

Each surface owns one `objects` array. Draw order is array order plus
depth-first traversal; index zero is bottommost. Traits never change ordering.
Document objects do not create render/scene layers: the compiler targets the
surface id as its render-layer id, while runtime render and scene layers remain
independent concepts.

Render intents keep these two order dimensions separate. `ordering.layerOrder`
orders runtime render layers; `ordering.path` is the lexicographic draw path
within one layer. Document intents derive their path from object-tree indexes,
while extension intents must choose an explicit layer order when they need to
render before or after another runtime layer.

`EditorObject` is an exclusive recursive union:

- `group` is a structural transform node with `children`. It has no
  `localFrame`, `localPivot`, `opacity`, `effects`, `source`, `contentFit`, or
  `paint`.
- `image`, `path`, and `shape` are pixel-producing leaves. Every leaf has
  `localFrame`; `localPivot`, `opacity`, and `effects` are optional.
- The document model has no text object. Canvas text belongs to scene elements
  or extensions; restoring document text requires another document version.

Every node owns `localToParent`, the sole object-local to parent-local
transform. A surface root object's parent origin is the origin of
`surface.geometry.canvasBounds`. Leaf `localFrame` is the declared rectangle
content is placed into; its `x/y` describe geometry and are not an additional
placement. The three `local*` fields carry their coordinate space in the name
because the model is flat: there is no `placement` wrapper to supply it.

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
`anchorY` are in `[0, 1]`, and `zoom` is greater than zero. Its `clip` decides
whether content that overflows the frame is cropped, which completes the
mapping contract: `fit: "cover"` overflows by definition, so the crop belongs
beside it rather than on the node. Paths and shapes use optional `paint`;
millimetre-valued fields are named `strokeWidthMm` and `dashMm`. Path/shape
source bounds fix their content-to-frame mapping.

Effects are leaf-only and apply in array order. The dividing line is
ownership: `contentFit` describes an object's own interior, while effects
consume other objects. Clipping to another object's shape is therefore a
`core.geometry.clip` effect, not a `contentFit` concern. Groups have no
opacity, effects, or clipping because the core model has no offscreen
compositing boundary. A producer that needs shared clipping expands it onto
each leaf.

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
