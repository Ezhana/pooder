# Pooder Architecture Migration Plan

Status: draft
Date: 2026-05-11

This plan migrates Pooder from kit-owned business tools to a capability-first
architecture.

## Current Progress

Current milestone: M1 in progress; P1.S3 next.

Completed:

- P0.S1 migration plan has been published.
- Affected package changelogs have `Unreleased` planning notes.
- P0.S2 current kit tool coupling inventory has been published in
  `docs/kit-tool-coupling-inventory.md`.
- P0.S3 naming and contribution policy has been published in
  `docs/naming-and-contribution-policy.md`.
- P1.S1 core capability registry has been added. Extensions can now contribute
  typed capability definitions separately from toolbar tools.
- P1.S2 core headless scene contract has been added. Applications can create
  layers, manage image/path/rect/text elements, query by scope, and batch
  scene mutations in transactions without Fabric types.

Next recommended slice:

- P1.S3 - Workflow-Neutral Sessions.

Resume instruction for a new thread:

> Read `docs/architecture-migration-plan.md`, continue from `Current Progress`,
> and execute the next incomplete slice. Keep changes scoped to that slice,
> preserve compatibility wrappers, and update `Current Progress` plus relevant
> package changelogs before finishing.

## Target Boundary

- `@pooder/core` owns runtime mechanics: extension lifecycle, services, typed
  commands, events, headless scene contracts, capability registration, and
  workflow-neutral sessions.
- `@pooder/platform-browser` owns the Fabric/browser implementation of core
  scene and render contracts.
- `@pooder/kit` owns optional official capabilities such as image placement,
  edge detection, dieline geometry, white ink extraction, template overlays,
  rulers, and export helpers. It must not define product tools, toolbar items,
  labels, or application workflow semantics.
- Applications own product tools and workflows. For storefront customization,
  `image`, `whiteInk`, `dieline`, and `feature` are app-level concepts composed
  from core services and kit capabilities.

## Compatibility Rules

- Keep current `createImageExtension`, `createWhiteInkExtension`,
  `createDielineExtension`, and similar factory exports as compatibility
  wrappers until the deprecation phase.
- New capability APIs must be typed and namespaced. Avoid string-only command
  contracts for new public APIs unless they are explicitly bridged for runtime
  interoperability.
- Capability code must accept layer ids, config namespaces, and session ids from
  the caller whenever possible. Hard-coded business ids should become defaults,
  not required coupling.
- App-specific tool ids must not leak into `@pooder/kit`.
- Existing behavior should be preserved through adapter slices before removing
  old tool contributions.

## Phase 0 - Planning And Coupling Inventory

Goal: make the migration visible, auditable, and safe to execute in small
slices.

### Slice P0.S1 - Publish Migration Plan

Deliverables:

- Add this migration plan under `docs/`.
- Add `Unreleased` changelog entries to affected packages.
- Define package ownership boundaries and compatibility rules.

Acceptance:

- No runtime code changes.
- Changelogs point to the migration plan.

### Slice P0.S2 - Inventory Current Tool Coupling

Deliverables:

- List all `kit` classes that currently contribute `tools`.
- For each class, record its commands, config keys, layer ids, events, and
  dependencies.
- Mark each item as one of: core contract, platform implementation, kit
  capability, app workflow, or compatibility wrapper.

Known starting points:

- `ImageTool`
- `WhiteInkTool`
- `DielineTool`
- `FeatureTool`
- `SizeTool`
- `TemplateOverlayTool`
- `BackgroundTool`
- `RulerTool`
- `DesignExportExtension`
- `DielineWorkflowExtension`

Acceptance:

- Every current `kit` tool has an owner and migration target.
- No slice begins implementation with unknown config or layer ownership.

### Slice P0.S3 - Naming And Contribution Policy

Deliverables:

- Define `Capability`, `Scene`, `Layer`, `Element`, and `WorkflowSession`
  naming rules.
- Define when an extension may contribute commands, services, render producers,
  config definitions, and compatibility tools.
- Define deprecation labels for old `*Tool` exports.

Acceptance:

- New code has one preferred name for each architecture concept.
- Compatibility names are explicitly marked and do not become new public
  patterns.

## Phase 1 - Core Contracts

Goal: make `core` expressive enough that applications can create layers, add
elements, and apply capabilities without depending on kit-owned tools.

### Slice P1.S1 - Capability Registry

Deliverables:

- Add a core `CapabilityRegistryService`.
- Define a public `CapabilityDefinition` shape with id, metadata,
  dependencies, optional commands, optional service facade, and lifecycle hooks.
- Allow extensions to contribute capabilities separately from tools.

Acceptance:

- Capabilities can be discovered without registering toolbar tools.
- Existing extensions can register capabilities while still exposing legacy
  tool wrappers.

### Slice P1.S2 - Headless Scene Contract

Deliverables:

- Add core scene interfaces for layers and elements.
- Support dynamic layer creation, ordering, visibility metadata, element
  add/update/remove, and scoped queries.
- Define transactions for batched layer and element changes.

Acceptance:

- An app can create a layer, add an image/path/rect/text element, and update it
  through core contracts.
- No Fabric types leak from core APIs.

### Slice P1.S3 - Workflow-Neutral Sessions

Deliverables:

- Split session state from tool registration.
- Support sessions keyed by caller-defined workflow ids.
- Preserve leave policies and dirty tracking without requiring a kit tool id.

Acceptance:

- App tools can use sessions without `kit` contributing those tools.
- Legacy `ToolSessionService` behavior remains available through an adapter.

### Slice P1.S4 - Typed Runtime Facades

Deliverables:

- Add typed access patterns for capability services.
- Keep command bus support for compatibility and cross-extension orchestration.
- Document event naming and payload ownership rules.

Acceptance:

- New app code can prefer typed capability calls over raw command strings.
- Old command ids keep working during the migration window.

## Phase 2 - Browser Platform Scene Implementation

Goal: move Fabric-specific rendering and interaction behind platform contracts.

### Slice P2.S1 - SceneService Fabric Adapter

Deliverables:

- Implement the core scene contract in `@pooder/platform-browser`.
- Map core layers and elements to Fabric objects.
- Keep managed pass rendering compatible with existing render producers.

Acceptance:

- Core scene operations render correctly in the browser host.
- Existing render producer output still works.

### Slice P2.S2 - Layer-Based Render Pipeline

Deliverables:

- Make render passes align with scene layers.
- Allow capability render producers to target caller-provided layer ids.
- Preserve stack/order semantics.

Acceptance:

- A capability can render into an app-created layer without owning the app
  workflow.

### Slice P2.S3 - Tool-Free Visibility Predicates

Deliverables:

- Replace direct `activeToolIn` and `sessionActive(toolId)` coupling in new APIs
  with generic context predicates.
- Keep old predicates for compatibility.

Acceptance:

- New render specs can depend on workflow/session context without referencing
  kit tool ids.

### Slice P2.S4 - Export Adapter

Deliverables:

- Expose browser export through platform scene/layer contracts.
- Support exporting selected layers, element bounds, and frame crops.

Acceptance:

- Export does not require `DesignExportExtension` to know app tool semantics.

## Phase 3 - Kit Capability Extraction

Goal: turn current `kit` tools into reusable capabilities with compatibility
wrappers.

### Slice P3.S1 - Image Placement Capability

Deliverables:

- Extract image item state, placement, snapping, controls, validation, and
  session overlay into an image placement capability.
- Accept caller layer ids and config namespace.
- Keep `ImageTool` as a wrapper around the capability.

Acceptance:

- Storefront can place images through the capability facade.
- Legacy image commands and tool activation still work.

### Slice P3.S2 - Edge Detection And Dieline Geometry Capabilities

Deliverables:

- Split edge detection from dieline state mutation.
- Expose edge detection as pure input/output capability.
- Expose dieline geometry/rendering as a layer-targeted capability.
- Move `DielineWorkflowExtension` orchestration to app or compatibility code.

Acceptance:

- An app can export an image crop, detect edges, create a dieline layer, and add
  a path without invoking a kit-owned dieline tool.

### Slice P3.S3 - White Ink Capability

Deliverables:

- Extract white ink mask generation, preview rendering, cover rendering, and
  print settings into a capability.
- Decouple from image tool activation and hard-coded image layer ids.
- Keep `WhiteInkTool` as a wrapper during compatibility.

Acceptance:

- White ink extraction can run against caller-selected image elements or layers.
- Existing white ink session behavior still works through the wrapper.

### Slice P3.S4 - Template, Background, Size, Ruler Capabilities

Deliverables:

- Convert mostly presentational helpers into layer/config capabilities.
- Ensure each capability can be enabled independently.
- Move toolbar and workflow decisions to callers.

Acceptance:

- Applications can opt into each capability without receiving a business tool.

### Slice P3.S5 - Export Capability

Deliverables:

- Convert design export into a capability facade.
- Support layer lists, crop rects, frame crops, format, and multiplier.
- Keep old `exportImage` command as a bridge.

Acceptance:

- Export is usable by app workflows and other capabilities without a kit tool.

### Slice P3.S6 - Feature Capability

Deliverables:

- Separate feature geometry and render support from the storefront "feature"
  tool.
- Move feature placement workflows to app composition.

Acceptance:

- Feature rendering and geometry can be reused without registering a kit tool.

## Phase 4 - Application Workflow Composition

Goal: move storefront customization tools to the application layer.

### Slice P4.S1 - Storefront Tool Catalog

Deliverables:

- Define a storefront-owned tool catalog with ids, labels, icons, visibility,
  session policies, and workflow handlers.
- Stop deriving app tool availability from kit extension ids.

Acceptance:

- `CustomizationActivityBar.client.vue` reads app tool metadata only.

### Slice P4.S2 - Editor Controller Capability Wiring

Deliverables:

- Replace `TOOL_TO_EXTENSION_ID` with workflow handlers that call capability
  facades.
- Keep existing `CustomizationEditor` public facade stable where practical.

Acceptance:

- Storefront workflows use kit capabilities directly.
- Runtime workbench activation no longer requires kit-contributed tools.

### Slice P4.S3 - Dieline Workflow Move

Deliverables:

- Move "export crop -> detect edge -> apply dieline" orchestration to
  storefront or an app-owned workflow package.
- Keep kit edge detection and dieline geometry reusable.

Acceptance:

- `DielineWorkflowExtension` is no longer required for the app workflow, or is
  clearly marked as compatibility.

### Slice P4.S4 - Build And Type Verification

Deliverables:

- Add or update focused type/build checks for affected packages and storefront
  integration.
- Avoid manual walkthrough unless explicitly requested.

Acceptance:

- Type checks and builds pass for migrated slices.

## Phase 5 - Deprecation And Removal

Goal: remove old coupling after callers have migrated.

### Slice P5.S1 - Deprecate Kit Tool Contributions

Deliverables:

- Mark old `*Tool` classes and `create*Extension` factories as deprecated when
  they register business tools.
- Document replacements for each old factory.

Acceptance:

- Consumers have direct migration paths to capability factories.

### Slice P5.S2 - Remove Kit-Owned Business Tools

Deliverables:

- Remove `tools` contributions from kit capabilities.
- Keep only capabilities, commands needed for interop, config definitions, and
  render producers.

Acceptance:

- Installing `@pooder/kit` no longer adds product tools to a runtime.

### Slice P5.S3 - Major Release Cleanup

Deliverables:

- Remove compatibility wrappers in the next major version.
- Remove app-specific default layer ids from public kit APIs or move them behind
  explicit presets.
- Update package changelogs with breaking changes and migration examples.

Acceptance:

- Public API matches the target boundary.

## Phase 6 - Hardening

Goal: make the new architecture maintainable after migration.

### Slice P6.S1 - Contract Tests

Deliverables:

- Add core scene and capability registry contract tests.
- Add browser adapter tests for layer and element behavior.
- Add kit capability tests for pure transforms and layer-targeted rendering.

Acceptance:

- Capability slices can be changed without app-specific regressions.

### Slice P6.S2 - Documentation

Deliverables:

- Add capability authoring docs.
- Add app workflow composition examples.
- Add compatibility migration notes for legacy `kit` tools.

Acceptance:

- New capabilities can be built without copying old `Tool` patterns.

## Suggested Milestones

- M0: migration plan and changelog tracking published.
- M1: core capability registry and scene contracts available.
- M2: browser scene adapter supports dynamic layers and elements.
- M3: image and export capabilities extracted with legacy wrappers.
- M4: edge detection, dieline, and white ink capabilities extracted.
- M5: storefront tools composed at the app layer.
- M6: legacy kit tool contributions deprecated.
- M7: compatibility wrappers removed in a major release.

## Slice Review Checklist

- Does this slice move one concern toward its target owner?
- Can it ship without forcing all callers to migrate at once?
- Are layer ids, config namespaces, and workflow ids caller-controlled?
- Does new public code avoid app-specific tool semantics in `@pooder/kit`?
- Are legacy commands or factories preserved when needed?
- Are type/build checks enough for the slice, unless a manual walkthrough is
  explicitly requested?
