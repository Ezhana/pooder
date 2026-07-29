# App Workflow Composition

Status: EditorDocument v7
Date: 2026-07-29

Applications compose workflows from EditorDocument, core services, browser
platform services, and the remaining focused Tool capabilities. Dieline and
Feature have no capability, tool, command, configuration state, or renderer
group.

## Document-owned dieline and feature

- A cutline is a normal Visual Object with a path/shape `source` and a
  `guide` effect whose role is `cut`.
- A Feature is a Composite Object. Its Visual children use ordered `boolean`
  effects to modify the cutline by object id.
- `clip-source` on the cutline targets artwork objects. Preview and export use
  the source object's final geometry for their respective purpose.
- Layer remains the coarse render partition. Composite provides local
  coordinates, logical selection, and linked interaction only.

The document compiler recursively composes transforms and emits every Visual
child as an independent RenderIntent. An interactive Composite emits one
transparent proxy; it never creates a Fabric group.

## App-owned feature workflow

The application opens an `EditorDocumentService.openSession()` whose draft is
the product-level Feature preset. Its derive callback converts the preset to
`EditorCompositeObject[]`. Working mutations regenerate RenderIntent
immediately; commit promotes the working document and rollback reapplies the
snapshot.

Composite movement declares `path.follow` or `path.lowest-tangent` against:

```ts
{
  sourceId: "document-object",
  geometryId: cutlineObjectId
}
```

Interactive preview and completion validation both use the core
`ConstraintResolverService`. Applications subscribe to
`EditorDocumentService.onDidChange()` instead of legacy global events.

## Edge detection

Edge Detection remains a focused capability. After detection, the application
atomically updates the cutline's Object Source, source bounds/size, and frame
through `EditorDocumentService`. Runtime `dieline.*` configuration is input to
document creation only and is not mutated after the document exists.

## Workflow rules

- Object Source and Document transforms are persisted facts.
- Geometry snapshots, RenderIntent, RenderGraph, and Fabric objects are
  rebuildable projections.
- Tool availability is derived from image slots, cut guides, Composite tags,
  Interaction, and remaining generic effects.
- Other Kit extensions still using legacy wrappers are separate migrations.
