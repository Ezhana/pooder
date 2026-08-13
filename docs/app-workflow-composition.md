# App Workflow Composition

Status: EditorDocument v8
Date: 2026-07-29

Applications compose workflows from EditorDocument, core services, browser
platform services, and the remaining focused Tool capabilities. Dieline and
Feature have no capability, tool, command, configuration state, or renderer
group.

## Document-owned dieline and feature

- A cutline is a normal leaf Object with a path/shape `source`, a
  `core.guide` trait, and the namespaced `guide:cut` tag.
- A Feature is a Group Object. The cutline owns ordered
  `core.geometry.boolean` effects that reference Feature operands by object id.
- A clipped artwork Object owns `core.geometry.clip` and references the
  cutline. Preview and export use the referenced object's final geometry.
- A Group provides local coordinates, logical selection, and linked interaction
  only. It is not a render or scene layer.
- Surface/group object arrays plus depth-first traversal define draw order.
  Index zero is bottommost; roles, traits, and runtime stack metadata do not
  participate in document ordering.
- Guide objects use the `core.guide` trait for guide behavior. Applications
  that need guides on top place the guide object or group last in the array.

The document compiler recursively composes transforms and emits every leaf
child as an independent RenderIntent. An interactive Group emits one
transparent proxy; it never creates a Fabric group.

## App-owned feature workflow

The application opens an `EditorDocumentService.openSession()` whose draft is
the product-level Feature preset. Its derive callback converts the preset to
`EditorGroupObject[]`. Working mutations regenerate RenderIntent
immediately; commit promotes the working document and rollback reapplies the
snapshot.

Group movement declares `path.follow` or `path.lowest-tangent` against:

```ts
{
  sourceId: "document-object",
  geometryId: cutlineObjectId
}
```

Interactive preview and completion validation both use the core
`ConstraintResolverService`. Applications subscribe to
`EditorDocumentService.onDidChange()`.

## Edge detection

Edge Detection remains a focused capability. After detection, the application
atomically updates the cutline's Object Source, source bounds/size, and frame
through `EditorDocumentService`. Runtime `dieline.*` configuration is input to
document creation only and is not mutated after the document exists.

## Workflow rules

- Object Source and Document transforms are persisted facts.
- Geometry snapshots, RenderIntent, RenderGraph, and Fabric objects are
  rebuildable projections.
- Tool availability is derived from Object behaviors, guide/feature traits,
  Interaction, extension state, and extension-owned Object effects.
