# EditorDocument v7 Composite and geometry contract

`EditorObject` is a recursive exclusive union:

- Visual Object: `source`, no `children`.
- Composite Object: `children`, no `source`.

IDs are globally unique across the document tree. Object effects and
`GeometryRef` address those IDs. Missing targets, invalid source/children
combinations, and dependency cycles are schema errors.

Composite frames are parent-local and child frames are Composite-local. The
document compiler recursively multiplies the transforms and gives each Visual
RenderIntent an absolute scene placement. Composite itself has no renderer
native representation.

The built-in `document-object` GeometrySource resolves rect, path, and compound
snapshots from Object Source and the complete parent transform. Boolean
operands are ordered by effect `order`; `participation` independently selects
preview and export chains. `clip-source` uses the final geometry for the
requested purpose.

An interactive Composite produces a transparent proxy node. Member nodes carry
`compositeId`, remain non-interactive, and receive the same scene-space
manipulation patch while the proxy moves. Commit writes the Composite transform
back to the Document, after which every platform projection is rebuilt from
the persisted transform.
