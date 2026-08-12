# EditorDocument v7 Composite and geometry contract

`EditorObject` is a recursive exclusive union:

- Visual Object: `type: "image" | "path" | "shape" | "text"`, `source`, no
  `children`. `type` determines the visual renderer; `source` only describes
  whether content is an asset, inline, or absent.
- Composite Object: `type: "group"`, `children`, no `source`.

IDs are globally unique across the document tree. Object effects and
`GeometryRef` address those IDs. Missing targets, invalid source/children
combinations, and dependency cycles are schema errors.

Composite placement is parent-local and child placement is Composite-local.
The document compiler recursively multiplies `localToParent` matrices and gives
each Visual RenderIntent an absolute scene placement. Composite itself has no
renderer-native representation.

The built-in `document-object` GeometrySource resolves rect, path, and compound
snapshots from Object Source and the complete parent transform. Boolean
effects are applied in array order; `participation` independently selects
preview and export chains. A target Object owns `core.geometry.clip` or
`core.geometry.boolean` and references the source/operand Object by id. The
referenced object's final geometry is used for the requested purpose.

An interactive Composite produces a transparent proxy node. Member nodes carry
`compositeId`, remain non-interactive, and receive the same scene-space
manipulation patch while the proxy moves. Commit writes the Composite transform
back to the Document, after which every platform projection is rebuilt from
the persisted transform.
