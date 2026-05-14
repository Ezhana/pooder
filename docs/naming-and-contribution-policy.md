# Naming And Contribution Policy

Status: P0.S3 policy
Date: 2026-05-11

This policy defines the preferred architecture names and contribution rules for
new capability-first code. Compatibility names may remain during the migration,
but new public APIs should not copy the legacy `*Tool` pattern.

## Architecture Names

### Capability

- A `Capability` is reusable domain behavior that can be installed without
  adding a product toolbar item.
- Public capability ids use reverse-DNS namespaces and a noun phrase:
  `pooder.kit.image-placement`, `pooder.kit.white-ink`,
  `pooder.kit.dieline-geometry`.
- Public TypeScript names use `<Domain>Capability` for definitions and
  `<Domain>CapabilityService` or `<Domain>CapabilityApi` for callable facades.
- Capability commands, when needed for compatibility, use a namespaced command
  id such as `imagePlacement.addImage` instead of adding new global verbs such
  as `addImage`.
- Capability options must accept caller-provided layer ids, config namespaces,
  and workflow/session ids when those identifiers affect app ownership.

### Scene

- A `Scene` is the headless document graph and coordinate space owned by core.
- Public scene contracts use `Scene*` names: `SceneService`, `SceneLayer`,
  `SceneElement`, `SceneTransaction`.
- Browser/Fabric implementations use adapter names, not core names:
  `FabricRenderGraphAdapter`, `BrowserSceneHost`, or similar.
- Existing layout helpers such as `SceneLayoutSnapshot` may remain while the
  migration is in progress, but new APIs should distinguish layout snapshots
  from mutable scene graph contracts.

### Layer

- A `Layer` is a caller-addressable scene/render grouping.
- Public ids should be caller-provided strings. Kit defaults may exist only as
  compatibility defaults or presets.
- Type names use `SceneLayer`, `LayerId`, `LayerOrder`, and `LayerVisibility`.
- New layer-targeted APIs must use option names such as `targetLayerId`,
  `sourceLayerIds`, or `layerIds`; avoid embedding app meanings like
  `image.user` into capability APIs.

### Element

- An `Element` is a scene object, independent of Fabric/browser object types.
- Type names use `SceneElement`, `ImageElement`, `PathElement`, `RectElement`,
  `TextElement`, and `ElementId`.
- Element APIs should accept `elementId` and `layerId` separately.
- Fabric objects, render specs, and DOM nodes are platform implementation
  details and must not appear in new core public contracts.

### WorkflowSession

- A `WorkflowSession` is caller-owned workflow state, not a kit tool id.
- Type names use `WorkflowSession`, `WorkflowSessionId`,
  `WorkflowSessionState`, and `WorkflowSessionLeavePolicy`.
- Session ids must be accepted from callers. Legacy tool ids may be used only
  by compatibility wrappers.
- New visibility/session predicates should refer to generic workflow context,
  not hard-coded kit ids such as `pooder.kit.image`.

### Events

- Public runtime event names use owner-scoped namespaces such as
  `workflow:session:change`, `scene:layout:change`, or
  `pooder.kit.image-placement:state:change`.
- Event payload ownership follows the emitter. Core owns core service payloads;
  platform packages own browser/Fabric adapter payloads; kit capabilities own
  capability-specific payloads; applications own product workflow payloads.
- New public events must have exported TypeScript payload types or be exposed
  through typed subscription methods such as `onDidChange`.
- Service-local raw names such as `change` may stay private behind typed
  service APIs. New cross-package listeners must not depend on those raw local
  names directly.
- Legacy global events such as `tool:activated` and `tool:session:change` remain
  compatibility bridges until the deprecation/removal phase.

## Extension Contribution Rules

### Commands

- Extensions may contribute commands for compatibility, cross-extension
  orchestration, and stable host integration.
- New public behavior should prefer typed capability services/facades over raw
  command strings.
- New command ids must be namespaced by capability or package domain. Legacy
  global ids such as `addImage`, `detectEdge`, and `exportImage` stay as bridges
  until their deprecation/removal slices.

### Services

- Core services own runtime-neutral contracts: capability registry, scene,
  events, commands, configuration, and workflow sessions.
- Platform services implement browser/Fabric adapters for core contracts.
- Kit services may expose reusable capability facades but must not require app
  toolbar ids or product workflow semantics.
- Service tokens and service names must describe the contract, not the legacy
  tool that first used it.

### Render Producers

- Platform-browser owns render producer execution and Fabric object materializing.
- Kit capabilities may contribute render producers only when render output is
  reusable and can target caller-provided layer ids.
- New render producers must not depend on `activeToolIn`,
  `sessionActive(toolId)`, or hard-coded app tool ids. Use generic workflow or
  context predicates once available.
- Existing hard-coded layers may remain as compatibility defaults during the
  migration.

### Configuration Definitions

- Config keys must be namespaced by capability or app domain:
  `imagePlacement.items`, `whiteInk.items`, `dielineGeometry.shape`.
- Kit capabilities may define reusable defaults. App-specific labels, toolbar
  state, and workflow choices belong in application config.
- Compatibility wrappers may continue reading and writing legacy keys such as
  `image.items`, `whiteInk.items`, and `dieline.features`.
- New config schemas should keep layer ids, config namespaces, and session ids
  caller-controlled where ownership crosses package boundaries.

### Compatibility Tools

- `tools` contributions are allowed in `@pooder/kit` only for compatibility
  wrappers around legacy public behavior.
- New kit capabilities must not introduce product toolbar items, product labels,
  icons, or workflow semantics.
- Applications own tool catalogs, labels, icons, ordering, visibility, and
  workflow handlers.
- A compatibility tool must delegate to the capability facade once that facade
  exists, and must keep its old commands only as bridges.

## Deprecation Labels

Use these labels when P5.S1 starts marking old exports:

- Class-level JSDoc for legacy tool classes:
  `@deprecated Compatibility wrapper for <CapabilityName>. Use <replacement>.`
- Factory-level JSDoc for legacy factory exports:
  `@deprecated Compatibility factory for <ToolName>. Use <replacement>.`
- Command bridge documentation:
  `Legacy command bridge for <oldCommand>. Prefer <typedFacade>.<method>().`
- Changelog label:
  `Deprecated compatibility wrapper: <ExportName> -> <ReplacementName>.`

Examples:

```ts
/**
 * @deprecated Compatibility wrapper for ImagePlacementCapability. Use
 * createImagePlacementCapability().
 */
export class ImageTool {}

/**
 * @deprecated Compatibility factory for ImageTool. Use
 * createImagePlacementCapability().
 */
export const createImageExtension = () => new ImageTool();
```

Deprecation labels must include a concrete replacement. If no replacement exists
yet, defer the deprecation until the replacement slice ships.

## Slice Application

- P1 code should introduce the preferred `Capability*`, `Scene*`, `Layer*`,
  `Element*`, and `WorkflowSession*` names.
- P2 code should use adapter names for browser/Fabric implementations and avoid
  leaking Fabric types into core contracts.
- P3 code should extract kit capabilities under capability names and keep old
  `*Tool` exports as wrappers.
- P4 code should move product tool catalogs and workflow handlers to
  applications.
- P5 code should apply the deprecation labels above before removing wrappers in
  the next major release.
