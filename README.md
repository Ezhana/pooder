# Pooder

English | [简体中文](./README.zh-CN.md)

A document-driven canvas editing engine. Applications submit a strict `PooderDocument` (v8). Pooder validates it, compiles it into render intents, projects those onto a browser canvas, and exposes reusable editing behavior through **capabilities**. Product toolbars, copy, and workflow orchestration belong to the application, not the engine.

Pooder currently lives as a Popecho git submodule (`external/pooder`). Its packages are included through the root workspace glob `external/pooder/packages/*`. You can also install and build from this directory on its own.

## Concepts

| Term | Meaning |
| --- | --- |
| **PooderDocument** | The only public persistence model. `version` must be `8`. No aliases, migration layer, or v7 runtime. |
| **Surface** | One document-side face (for example the front). `bounds` is the scene world in millimetres. |
| **Scene** | The runtime graph. `document-core` maps `Surface.id` to `sceneId`. Core, rendering, and export use `sceneId` exclusively. |
| **Capability** | Installable reusable behavior: a factory, a typed facade, and optional document schema. Not a toolbar button. |
| **Session** | Transient workflow state derived from object `behaviors`. It is not written into `PooderDocument`. |

Data flow:

```text
PooderDocument  ──apply──►  document-core  ──RenderIntent──►  platform-browser (Fabric)
     ▲                         │                                      │
     │                         │ Scene / Geometry / Interaction       │
     └──── mutate / session ◄──┘                                      ▼
                                                                   <canvas>
```

## Packages

| Package | Role |
| --- | --- |
| `@pooder/document` | Runtime-neutral v8 contract: parse, validate, visit. Usable in Node / BFF. Must not depend on DOM, Canvas, or Fabric. |
| `@pooder/core` | Headless runtime: extension lifecycle, services, scenes, coordinates, commands, sessions, RenderIntent. |
| `@pooder/document-core` | Bridges the document onto the runtime: `PooderDocumentService`, compilation, surface ↔ scene. |
| `@pooder/platform-browser` | Browser host: Fabric adapter, canvas, viewport, export, image resources. |
| `@pooder/geometry-paper` | Lazily loaded Paper.js geometry backend. Importing the module does not touch the DOM. |
| `@pooder/vue` | Vue 3 host. The **root entry is SSR-safe**; canvas and tool registration live in `@pooder/vue/editor`. |
| `@pooder/tools` | Migration aggregate for existing capabilities (image-slot, mirror, edge-detection, image-mask, export). |
| `@pooder/production-mask` | Standalone tool package: document-backed production masks (white ink and similar). |
| `@pooder/image-mask-contract` | Neutral contract for cross-tool collaboration. Implementations must not depend on each other. |
| `@pooder/kit` | Optional convenience entry that **re-exports tool factories only**. New applications should depend on concrete tool packages. |
| `@pooder/integration-tests` | Cross-package integration tests (private, not published). |

Production dependency direction:

```text
application
├── @pooder/document
├── @pooder/vue
├── @pooder/tools            (or a standalone tool package)
└── @pooder/production-mask

@pooder/vue
├── @pooder/core
├── @pooder/document-core
└── @pooder/platform-browser ── @pooder/geometry-paper

@pooder/document-core ── @pooder/core + @pooder/document
@pooder/tools         ── @pooder/core + @pooder/document + neutral contracts
@pooder/kit           ── @pooder/tools
```

A tool package must not depend on `@pooder/kit`, and must not depend on another tool's implementation. Cross-capability collaboration goes through contract packages and runtime facades only.

## Quick start (Vue)

Vue 3 is required. The `@pooder/vue` root entry does not export the canvas host, so SSR does not pull in browser side effects.

```ts
import {
  createPooderRuntime,
  installPooderDocument,
  PooderRuntimeProvider,
} from "@pooder/vue";
import {
  PooderCanvasHost,
  flushPooderTools,
  registerPooderTools,
} from "@pooder/vue/editor";
import {
  createCapabilitiesForDocument,
  createExportCapability,
} from "@pooder/tools";
import type { PooderDocument } from "@pooder/document";

const document: PooderDocument = {
  version: 8,
  assets: [],
  extension: { required: [], states: {} },
  surfaces: [
    {
      id: "front",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      objects: [
        {
          type: "shape",
          id: "panel",
          tags: [],
          visible: true,
          locked: false,
          localFrame: { x: 0, y: 0, width: 30, height: 40 },
          localToParent: [1, 0, 0, 1, 10, 20],
          localPivot: { x: 0, y: 0 },
          source: {
            kind: "inline",
            content: {
              shape: "rect",
              params: { width: 30, height: 40 },
            },
          },
        },
      ],
    },
  ],
};

const runtime = createPooderRuntime();
const documentService = installPooderDocument(runtime);

registerPooderTools(runtime, [
  createExportCapability(),
  ...createCapabilitiesForDocument(document),
]);

await flushPooderTools(runtime);
const result = await documentService.apply(document);
if (!result.ok) throw new Error(result.diagnostics[0]?.message ?? "apply failed");
```

```vue
<template>
  <PooderRuntimeProvider :runtime="runtime">
    <PooderCanvasHost />
  </PooderRuntimeProvider>
</template>
```

`PooderCanvasHost` registers the Paper geometry backend and attaches browser services (canvas, export, image resources). After that, mutate the document with `documentService.mutate()` / `openSession()`, and switch faces with `runtime.activateSurface(id)`.

Without Vue, construct `new Pooder()` from `@pooder/core`, then call `registerPooderDocumentService` (`@pooder/document-core`) and `attachBrowserHost` (`@pooder/platform-browser`).

When a BFF or Node process only handles documents, depend on `@pooder/document` alone:

```ts
import { parseDocument, validateDocument } from "@pooder/document";

const document = parseDocument(payload);
const diagnostics = validateDocument(document);
```

## PooderDocument v8

There is one public model. The field set is exact: `version`, `assets`, `extension`, `surfaces`.

```ts
interface PooderDocument {
  version: 8;
  assets: Asset[];
  extension: {
    required: string[]; // BFF-authored capability / extension ids; never inferred
    states: Record<string, JsonValue>;
  };
  surfaces: Surface[];
}
```

Object-tree rules:

- Each surface owns one `objects` tree. Draw order is array order plus depth-first traversal; index `0` is bottommost.
- A `group` supplies local coordinates, selection, and linked interaction only. It has no `localFrame`, opacity, or effects, and it is not a render layer.
- Leaves are `image`, `path`, and `shape` only. There is no document-level text object.
- Every node has `localToParent`. Leaves also have `localFrame`: the millimetre rectangle content is placed into.
- Tool activation comes from `behaviors`. `interaction` describes selection, manipulation, and constraints only.
- Clipping to another object is a `core.geometry.clip` effect, not a `contentFit` concern.

`PooderDocumentService.activateSurface(surfaceId)` is the document-facing switch API. It calls `SceneService.setActiveRoot(sceneId)`.

The full object-tree contract is in [docs/pooder-document-v8-groups.md](./docs/pooder-document-v8-groups.md).

## Capabilities

Applications install capabilities from `extension.required` and object behaviors. `createCapabilitiesForDocument()` collects the capabilities that still live in `@pooder/tools`.

| Capability | Package | Default id |
| --- | --- | --- |
| Image slot | `@pooder/tools` | `pooder.kit.image-slot` |
| Mirror | `@pooder/tools` | `pooder.kit.mirror` |
| Edge detection | `@pooder/tools` | `pooder.kit.edge-detection` |
| Image mask | `@pooder/tools` | `pooder.kit.image-mask` |
| Export | `@pooder/tools` | `pooder.export` |
| Production mask | `@pooder/production-mask` | `pooder.production-mask` |

`pooder.kit.*` is a compatibility namespace. **Do not use it for new ids.** New tools should be standalone packages (see `@pooder/production-mask`) rather than additions to `@pooder/tools`.

Resolve a facade:

```ts
import { requirePooderCapability } from "@pooder/vue/editor";
import {
  EXPORT_CAPABILITY_ID,
  type ExportCapabilityApi,
} from "@pooder/tools";

const exporter = requirePooderCapability<ExportCapabilityApi>(
  runtime,
  EXPORT_CAPABILITY_ID,
);
await exporter.exportImage({ sceneId: "front", purpose: "design" });
```

Cutlines and features have no dedicated capability. They are ordinary document objects with `core.guide` / geometry effects. Applications orchestrate them with `openSession()`. See [docs/app-workflow-composition.md](./docs/app-workflow-composition.md).

## Coordinates and geometry

Geometry values that cross a package boundary must be space-tagged. There are exactly four spaces: `object-local`, `parent-local`, `scene`, and `screen`. Render-node placement uses `AffinePlacement.localToScene` only. Do not treat `localFrame.x` / `localFrame.y` as scene translation.

See [docs/coordinate-spaces.md](./docs/coordinate-spaces.md) and [docs/geometry-sources.md](./docs/geometry-sources.md).

## Development

pnpm 10 is required. From this directory:

```bash
pnpm install
pnpm build                          # build packages/*
pnpm --filter @pooder/core test:foundation
pnpm --filter @pooder/document-core test
pnpm --filter @pooder/platform-browser test:foundation
pnpm --filter @pooder/integration-tests test
pnpm test:import-safety             # import contracts without window / canvas context
pnpm test:package-boundaries        # tool package boundaries
```

From the Popecho repo root, after changing Pooder or the customization pipeline:

```bash
pnpm build:pooder
pnpm test:contracts                 # build + foundation/affine/document-core/platform/integration/entrypoint contracts
pnpm check:architecture             # includes docs/dependency-boundaries.md
```

Publishing uses [changesets](./.changeset/README.md): `pnpm changeset` → `pnpm version-packages` → `pnpm release`.

## Further reading

| Document | Contents |
| --- | --- |
| [docs/naming-and-contribution-policy.md](./docs/naming-and-contribution-policy.md) | Naming, ownership, public API boundaries |
| [docs/capability-authoring.md](./docs/capability-authoring.md) | How to author a capability |
| [docs/tool-package-contract.md](./docs/tool-package-contract.md) | Contract a standalone tool package must satisfy |
| [docs/document-object-interaction.md](./docs/document-object-interaction.md) | `interaction` vs `behaviors` |
| [docs/app-workflow-composition.md](./docs/app-workflow-composition.md) | How apps compose dieline / feature / export workflows |
| [docs/pooder-document-v8-groups.md](./docs/pooder-document-v8-groups.md) | v8 object tree, inheritance, flatten guarantee |

## Ownership

- **Core** owns runtime-neutral services and contracts. It does not leak Fabric or DOM types.
- **Platform** implements the browser adapter. Public APIs still return Core contracts.
- **Tool** owns its capability / command ids, facade, factory, tests, and persisted schema.
- **Application** owns product tool ids, labels, icons, ordering, visibility, and workflow.

Extensions may contribute capabilities, services, commands, document schema, and reusable render behavior. They must not contribute product toolbar items.
