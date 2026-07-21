# Geometry sources

`GeometrySourceService` is the renderer-independent boundary for reusable
geometry. Consumers retain a `GeometryRef`; they do not embed snapshots or call
backend-specific geometry objects.

## Reference and snapshot contract

A `GeometryRef` identifies the source and geometry. Its optional `purpose` is
either `preview` or `export`, so a source may return a cheaper interactive path
and a production-accurate output path for the same logical geometry. `variant`
selects another domain-specific representation, such as a surface.

Every resolved `GeometrySnapshot` explicitly contains:

- `space`, the coordinate space of all geometry values;
- `bounds`, in that same space;
- a path, primitive, or compound geometry payload;
- `localToScene`, whose input must equal `space` and whose output is `scene`;
- the normalized `ref` used to resolve it.

Compound snapshots contain child `GeometryRef` values, never nested snapshots.
This keeps source lookup, representation selection, cloning, and coordinate
validation inside `GeometrySourceService`.

## Operations and projection

All public operations accept a `GeometryRef`: `getBounds`, `nearestPoint`,
`normalAt`, `contains`, `sample`, and `project`. An optional operation space
projects the snapshot before evaluating it. Projection never relabels values:
the implementation must transform the geometry, bounds, and placement.

Core owns renderer-neutral algorithms for rectangles, polygons, point sets,
and compounds. Path implementations are registered with `registerBackend`.
A backend receives immutable snapshot data and implements path queries and
projection without exposing its native path objects through the source API.

Renderer adapters may publish geometry sources, but a source cannot require a
specific renderer or leak renderer objects in its snapshot. Browser viewport
conversion happens before publishing a scene-space snapshot.
