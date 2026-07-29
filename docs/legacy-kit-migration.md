# Legacy Kit Migration Notes

Status: EditorDocument v7
Date: 2026-07-29

DielineGeometry and Feature capabilities were removed without compatibility
factories, readers, command bridges, events, or migration helpers. Represent a
cutline with Object Source plus `guide`, and represent Feature presets as
Composite Objects with built-in `boolean` effects. See
`editor-document-v7-composites.md`.

Other Kit extensions remain separate migrations. Applications should continue
to install only the focused capability factories they need, keep product tool
catalogs and sessions in the application, and prefer typed capability facades
over remaining legacy command ids.
