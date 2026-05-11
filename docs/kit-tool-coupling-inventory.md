# Kit Tool Coupling Inventory

Status: P0.S2 inventory
Date: 2026-05-11

This inventory records current `@pooder/kit` extension coupling before the
capability-first migration. It is intentionally descriptive: no runtime
ownership has moved yet.

## Ownership Labels

- Core contract: runtime abstractions that should move to or be represented by
  `@pooder/core`.
- Platform implementation: Fabric/browser rendering, export, interaction, or
  scene adapter behavior owned by `@pooder/platform-browser`.
- Kit capability: reusable optional behavior that belongs in `@pooder/kit`
  after it no longer contributes product tools.
- App workflow: storefront/product workflow semantics, toolbar identity,
  labels, and orchestration that should be owned by applications.
- Compatibility wrapper: legacy tool/factory/command shape kept during the
  migration window.

## Tool Contribution Summary

| Extension | Contributes `tools` | Primary target |
| --- | --- | --- |
| `ImageTool` | Yes, `pooder.kit.image` | Image placement kit capability plus compatibility wrapper |
| `WhiteInkTool` | Yes, `pooder.kit.white-ink` | White ink kit capability plus compatibility wrapper |
| `DielineTool` | Yes, `pooder.kit.dieline` | Dieline geometry/render kit capability plus compatibility wrapper |
| `FeatureTool` | Yes, `pooder.kit.feature` | Feature geometry kit capability; feature placement workflow moves to app |
| `SizeTool` | Yes, `pooder.kit.size` | Size/session-independent scene config capability plus compatibility wrapper |
| `TemplateOverlayTool` | No | Template overlay kit capability |
| `BackgroundTool` | No | Background layer kit capability |
| `RulerTool` | No | Ruler overlay kit capability |
| `DesignExportExtension` | No | Export kit/platform capability |
| `DielineWorkflowExtension` | No | App workflow or compatibility orchestration |
| `MirrorTool` | No | Browser/platform viewport helper or optional compatibility utility |
| `FilmTool` | No | Overlay kit capability or compatibility utility |

## `ImageTool`

- Extension id: `pooder.kit.image`.
- Tool: `pooder.kit.image`, label `Image`, `session` interaction, auto-begin
  session, block leave policy, commit command `completeImages`, rollback command
  `imageSessionReset`.
- Commands: `addImage`, `upsertImage`, `applyImageOperation`,
  `getImageViewState`, `setImageTransform`, `imageSessionReset`,
  `validateImageSession`, `completeImages`, `exportUserCroppedImage`,
  `focusImage`, `removeImage`, `updateImage`, `clearImages`, `bringToFront`,
  `sendToBack`.
- Config keys: `image.items`, `image.debug`, `image.control.*`,
  `image.frame.*`, `image.session.placementPolicy`; also responds to
  `size.*`.
- Layers: `image.user`, `image-overlay`.
- Events/listeners: listens to `tool:activated`, `object:modified`,
  `selection:created`, `selection:updated`, `selection:cleared`,
  `scene:layout:change`, `canvas:resized`, `scene:geometry:change`; emits
  `image:session:notice`, `image:state:change`, `image:working:change`.
- Dependencies: `CANVAS_SERVICE`, `CONFIGURATION_SERVICE`,
  `TOOL_SESSION_SERVICE`, `WORKBENCH_SERVICE`, Fabric controls, platform scene
  layout and geometry helpers.
- Coupling to migrate: hard-coded image layer ids, direct white ink session
  visibility predicate, tool-session dirty tracking keyed by kit tool id,
  toolbar label/interaction semantics, and command-only public surface.
- Ownership: image item state, placement, snapping, validation, frame/session
  overlay are kit capability; layer ids and workflow/session ids should become
  caller inputs; render realization is platform implementation; the current
  tool contribution and command names are compatibility wrapper; toolbar
  meaning is app workflow.
- Migration target: P3.S1 after core scene/session/capability contracts exist.

## `WhiteInkTool`

- Extension id: `pooder.kit.white-ink`.
- Tool: `pooder.kit.white-ink`, label `White Ink`, `session` interaction,
  auto-begin session, block leave policy, begin/rollback command
  `resetWorkingWhiteInks`, commit command `completeWhiteInks`.
- Commands: `addWhiteInk`, `upsertWhiteInk`, `getWhiteInks`,
  `getWhiteInkSettings`, `setWhiteInkPrintEnabled`,
  `setWhiteInkPreviewImageVisible`, `getWorkingWhiteInks`,
  `setWorkingWhiteInk`, `updateWhiteInk`, `removeWhiteInk`, `clearWhiteInks`,
  `resetWorkingWhiteInks`, `completeWhiteInks`, `setWhiteInkImage`.
- Config keys: `whiteInk.items`, `whiteInk.printWithWhiteInk`,
  `whiteInk.previewImageVisible`, `whiteInk.debug`; legacy read
  `whiteInk.customMask`; also responds to `image.items` and `size.*`.
- Layers: `white-ink.cover`, `white-ink.user`, `white-ink.overlay`; reads
  `image.user` objects for source image placement.
- Events/listeners: listens to `tool:activated`, `scene:layout:change`,
  `object:added`, `object:modified`, `object:removed`,
  `image:working:change`.
- Dependencies: requires `pooder.kit.image`; uses `CANVAS_SERVICE`,
  `CONFIGURATION_SERVICE`, `TOOL_SESSION_SERVICE`, `WORKBENCH_SERVICE`,
  platform render specs, and image source size cache.
- Coupling to migrate: hard dependency on image tool extension, hard-coded image
  and white ink layer ids, tool activation as preview mode, session dirty
  tracking keyed by kit tool id, and print/preview workflow semantics.
- Ownership: mask generation, preview rendering, cover rendering, settings, and
  white ink state are kit capability; selected source image/layer ownership and
  toolbar workflow are app workflow; current tool/commands are compatibility
  wrapper; browser rendering remains platform implementation.
- Migration target: P3.S3.

## `DielineTool`

- Extension id: `pooder.kit.dieline`.
- Tool: `pooder.kit.dieline`, label `Dieline`, `session` interaction,
  manual begin, block leave policy.
- Commands: `updateFeaturePosition`, `detectEdge`.
- Config keys: `dieline.shape`, `dieline.radius`, `dieline.shapeStyle`,
  `dieline.showBleedLines`, `dieline.strokeWidth`, `dieline.strokeColor`,
  `dieline.dashLength`, `dieline.style`, `dieline.offsetStrokeWidth`,
  `dieline.offsetStrokeColor`, `dieline.offsetDashLength`,
  `dieline.offsetStyle`, `dieline.insideColor`, `dieline.features`; also reads
  `dieline.pathData`, `dieline.customSourceWidthPx`,
  `dieline.customSourceHeightPx`, `image.items`, and `size.*`.
- Layers/effects: renders `dieline-overlay`; clips `image.user` through image
  clip effects when no session is active.
- Events/listeners: listens to config changes for `size.*` and `dieline.*`,
  and `canvas:resized`.
- Dependencies: `CANVAS_SERVICE`, `CONFIGURATION_SERVICE`, platform scene
  layout and geometry helpers, Fabric `Pattern`, image tracer command helper.
- Coupling to migrate: edge detection is mixed with dieline mutation/rendering,
  render visibility references image and white ink tool ids, image clipping
  targets hard-coded image layer id, and feature positions live under
  `dieline.features`.
- Ownership: edge detection should become a pure kit capability; dieline
  geometry/rendering is a layer-targeted kit capability; Fabric render effects
  are platform implementation; current tool registration is compatibility
  wrapper; toolbar/session semantics are app workflow.
- Migration target: P3.S2.

## `FeatureTool`

- Extension id: `pooder.kit.feature`.
- Tool: `pooder.kit.feature`, label `Feature`, `session` interaction, manual
  begin, block leave policy, begin command `beginFeatureSession`, commit command
  `completeFeatures`, rollback command `rollbackFeatureSession`.
- Commands: `beginFeatureSession`, `addFeature`, `addHole`,
  `addDoubleLayerHole`, `clearFeatures`, `rollbackFeatureSession`,
  `resetWorkingFeatures`, `updateWorkingGroupPosition`, `completeFeatures`.
- Config keys: reads and writes `dieline.features`; responds to `size.*` and
  `dieline.*`; reads `image.items` when resolving feature behavior.
- Layers/effects: renders `feature-overlay`; during an active feature session
  hides/replaces `dieline-overlay`, renders `feature-dieline-overlay`, and clips
  `image.user`.
- Events/listeners: listens to `tool:activated`, `scene:geometry:change`,
  Fabric `object:moving`, Fabric `object:modified`; emits
  `feature:working:change`.
- Dependencies: requires `pooder.kit.dieline`; uses `CANVAS_SERVICE`,
  `CONFIGURATION_SERVICE`, `TOOL_SESSION_SERVICE`, `COMMAND_SERVICE`,
  constraints, feature placement/completion helpers, and command
  `getSceneGeometry`.
- Coupling to migrate: feature editing is stored under dieline config,
  workflow/session state is tied to a kit tool id, feature UI labels and
  operations are product workflow concepts, and it depends on command bus access
  to scene geometry.
- Ownership: reusable feature geometry, constraints, and render support are kit
  capability; placement workflow and toolbar affordances are app workflow;
  scene geometry access should become a core/platform contract; current tool is
  compatibility wrapper.
- Migration target: P3.S6 and P4.S1/P4.S2.

## `SizeTool`

- Extension id: `pooder.kit.size`.
- Tool: `pooder.kit.size`, label `Size`, `instant` interaction.
- Commands: `getSizeState`, `updateSizeDimensions`,
  `setSizeConstraintMode`, `setSizeDisplayUnit`, `setSizeCut`,
  `getSelectedImageSize`.
- Config keys: `size.unit`, `size.actualWidthMm`, `size.actualHeightMm`,
  `size.constraintMode`, `size.aspectRatio`, `size.cutMode`,
  `size.cutMarginMm`, `size.viewPadding`, `size.minMm`, `size.maxMm`,
  `size.stepMm`.
- Layers: no render layer; `getSelectedImageSize` reads `image.user` canvas
  objects.
- Events/listeners: emits `size:state:changed`.
- Dependencies: `CANVAS_SERVICE`, `CONFIGURATION_SERVICE`, platform size and
  scene layout helpers.
- Coupling to migrate: product-facing size tool registration and label, command
  names, and selected-image lookup through hard-coded image layer id.
- Ownership: unit conversion, size constraints, and scene size state are core or
  platform contracts depending on final scene model; optional convenience
  commands are kit capability; current tool contribution is compatibility
  wrapper; toolbar workflow is app-owned.
- Migration target: P3.S4 after P1/P2 scene contracts clarify ownership.

## `TemplateOverlayTool`

- Extension id: `pooder.kit.template-overlay`.
- Tool: none.
- Commands: `templateOverlay.getConfig`, `templateOverlay.replaceConfig`,
  `templateOverlay.patchConfig`, `templateOverlay.clearConfig`.
- Config keys: `templateOverlay.config` with slots `normal`, `frame`, `prod`,
  `small`, `back`, `render`, optional clip config and `targetLayerIds`; also
  responds to `size.*`.
- Layers/effects: `template-overlay.normal`, `template-overlay.frame`,
  `template-overlay.prod`, `template-overlay.small`,
  `template-overlay.render`; clip effect defaults to target `image.user`.
- Events/listeners: listens to `scene:layout:change`, `canvas:resized`, and
  template/size config changes.
- Dependencies: `CANVAS_SERVICE`, `CONFIGURATION_SERVICE`, platform render
  specs, Fabric image loading.
- Coupling to migrate: default clip target is a hard-coded image layer id and
  slot names encode current product overlay assumptions.
- Ownership: template overlay config normalization and rendering are kit
  capability; caller-owned target layers are required for new API; Fabric image
  rendering is platform implementation.
- Migration target: P3.S4.

## `BackgroundTool`

- Extension id: `pooder.kit.background`.
- Tool: none.
- Commands: `background.getConfig`, `background.resetConfig`,
  `background.replaceConfig`, `background.patchConfig`,
  `background.upsertLayer`, `background.removeLayer`.
- Config keys: `background.config`; also responds to `size.*`.
- Layers: `background`.
- Events/listeners: listens to `canvas:resized`, `scene:layout:change`, and
  background/size config changes.
- Dependencies: `CANVAS_SERVICE`, `CONFIGURATION_SERVICE`, platform scene
  layout helpers, Fabric image loading.
- Coupling to migrate: background layer id and default config are kit defaults;
  layer ids should be caller-controlled where this participates in app scenes.
- Ownership: reusable background layer rendering is kit capability; browser
  rendering is platform implementation.
- Migration target: P3.S4.

## `RulerTool`

- Extension id: `pooder.kit.ruler`.
- Tool: none.
- Commands: `setTheme`.
- Config keys: `ruler.thickness`, `ruler.gap`, `ruler.backgroundColor`,
  `ruler.textColor`, `ruler.lineColor`, `ruler.fontSize`, `ruler.debug`; also
  responds to `size.*`.
- Layers: `ruler-overlay`.
- Events/listeners: listens to `canvas:resized` and ruler/size config changes.
- Dependencies: `CANVAS_SERVICE`, `CONFIGURATION_SERVICE`, platform scene
  layout and geometry helpers.
- Coupling to migrate: visibility predicate references white ink tool id and
  layer id is hard-coded.
- Ownership: ruler rendering and theme config are kit capability; scene
  geometry is platform/core contract; current command is compatibility surface.
- Migration target: P3.S4 and P2.S3 for tool-free visibility predicates.

## `DesignExportExtension`

- Extension id: `pooder.kit.design-export`.
- Tool: none.
- Commands: `exportImage`.
- Config keys: no contributed config; uses size/surface frame configuration
  through `resolveSurfaceFrameRect`.
- Layers: defaults export source layers to `image.user` and `white-ink.user`;
  accepts `layerIds` override.
- Events/listeners: none.
- Dependencies: `CANVAS_SERVICE`, `CONFIGURATION_SERVICE`, Fabric canvas clone
  and browser `document`.
- Coupling to migrate: default exported layer ids are current product layers;
  export works by inspecting Fabric objects directly.
- Ownership: export facade/options are kit capability; Fabric export adapter is
  platform implementation; `exportImage` command remains compatibility bridge.
- Migration target: P3.S5, with platform support from P2.S4.

## `DielineWorkflowExtension`

- Extension id: `pooder.kit.dieline-workflow`.
- Tool: none.
- Commands: `detectDielineFromFrame`, `uploadAndDetectEdge`.
- Config keys: writes `dieline.shape`, `dieline.pathData`,
  `dieline.customSourceWidthPx`, `dieline.customSourceHeightPx`,
  `size.cutMode`, `size.cutMarginMm`.
- Layers: no direct render layer; orchestrates `exportUserCroppedImage`,
  `detectEdge`, and `upsertImage`.
- Events/listeners: none.
- Dependencies: requires `pooder.kit.image` and `pooder.kit.dieline`; uses
  `COMMAND_SERVICE` and `CONFIGURATION_SERVICE`.
- Coupling to migrate: storefront workflow orchestration lives in kit and calls
  legacy commands by string id.
- Ownership: orchestration is app workflow or compatibility wrapper; edge
  detection and dieline config application should become typed capabilities.
- Migration target: P3.S2 and P4.S3.

## `MirrorTool`

- Extension id: `pooder.kit.mirror`.
- Tool: none.
- Commands: `setMirror`.
- Config keys: `mirror.enabled`.
- Layers: none; mutates Fabric viewport transform.
- Events/listeners: listens to `mirror.enabled` config changes.
- Dependencies: `CANVAS_SERVICE`, `CONFIGURATION_SERVICE`.
- Coupling to migrate: direct Fabric viewport mutation belongs behind browser
  platform APIs if retained.
- Ownership: platform implementation or optional compatibility utility; current
  command/config are compatibility surface.
- Migration target: not in current known slices; revisit during P2/P3 policy.

## `FilmTool`

- Extension id: `pooder.kit.film`.
- Tool: none.
- Commands: `setFilmImage`.
- Config keys: `film.url`, `film.opacity`.
- Layers: `overlay`.
- Events/listeners: listens to `canvas:resized` and `film.*` config changes.
- Dependencies: `CANVAS_SERVICE`, `CONFIGURATION_SERVICE`, Fabric image
  loading.
- Coupling to migrate: generic layer id `overlay` and viewport-cover behavior
  are hard-coded.
- Ownership: reusable overlay rendering can be kit capability; browser image
  rendering remains platform implementation; command/config are compatibility
  surface.
- Migration target: not in current known slices; consider with P3.S4.

## Migration Readiness Notes

- Unknown ownership blockers for P0.S2 are resolved: every current kit extension
  with `Tool` naming or factory exposure has an owner and target.
- App-specific tool ids currently leak through render visibility predicates:
  `activeToolIn`, `sessionActive`, and `anySessionActive` are used in image,
  dieline, ruler, feature, and tests. P2.S3 should replace these for new APIs.
- Hard-coded layer ids are concentrated in `shared/constants/layers.ts`; later
  capability APIs should accept caller-provided layer ids and keep these values
  only as compatibility defaults.
- Several public commands are string-only compatibility APIs. New capability
  APIs should expose typed facades and bridge these command ids until the
  deprecation/removal phases.
