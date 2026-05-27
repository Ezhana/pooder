import {
  COMMAND_SERVICE,
  CommandService,
  CONFIGURATION_SERVICE,
  ExtensionContext,
  ExtensionContributions,
  ExtensionDefinition,
  ConfigurationService,
  type ExtensionActivationSpec,
  type RenderIntentCompilerContribution,
  type RenderIntentCompilerContext,
  type RenderIntentPatch,
  type RenderPatternSpec,
} from "@pooder/core";
import {
  CANVAS_SERVICE,
  CanvasService,
  RENDER_INTENT_SERVICE,
  RenderIntentService,
  RenderEffectSpec,
  RenderObjectSpec,
} from "@pooder/core";
import type { EditorDocument, EditorEffect } from "@pooder/document/kit";
import { ConstraintRegistry, ConstraintFeature } from "../constraints";
import { completeFeaturesStrict } from "../featureComplete";
import {
  projectPlacedFeatures,
  resolveFeaturePlacements,
} from "../featurePlacement";
import {
  computeSceneLayout,
  readSizeState,
  type SceneGeometrySnapshot as DielineGeometry,
} from "../../shared/scene/scene-layout-model";
import {
  DIELINE_LAYER_ID,
  FEATURE_DIELINE_LAYER_ID,
  FEATURE_OVERLAY_LAYER_ID,
  IMAGE_OBJECT_LAYER_ID,
  KIT_LEGACY_LAYER_PRESET,
} from "../../shared/constants/layers";
import { SubscriptionBag } from "../../shared/runtime/subscriptions";
import {
  clearRenderIntentSource,
  patchRenderObjectSpecs,
} from "../../shared/runtime/renderIntentPatches";
import { cloneWithJson } from "../../shared/runtime/sessionState";
import { buildDielineRenderBundle } from "../dieline/renderBuilder";
import { readDielineState } from "../dieline/model";
import {
  createFeatureCapabilityDefinition,
  FEATURE_CAPABILITY_ID,
  getFeatureConfigKey,
  normalizeFeatureConfigNamespace,
  normalizeFeatureLayerId,
  type FeatureCapabilityApi,
  type FeatureCapabilityOptions,
  type FeatureCompletionResult,
  type FeatureOperation,
  type ReplaceFeaturesOptions,
} from "./capability";
import { createLegacyCommandBridge } from "../legacyCommandBridge";
const FEATURE_STROKE_WIDTH = 2;
const DEFAULT_RECT_SIZE = 10;
const DEFAULT_CIRCLE_RADIUS = 5;

type MarkerPoint = { x: number; y: number };

interface GroupMemberOffset {
  index: number;
  dx: number;
  dy: number;
}

interface MarkerRenderState {
  feature: ConstraintFeature;
  index: number;
  position: MarkerPoint;
  geometry: DielineGeometry;
  scale: number;
}

interface MarkerData {
  type: "feature-marker";
  index: number;
  featureId: string;
  groupId?: string;
  markerRole: "handle" | "member" | "indicator";
  markerOffsetX: number;
  markerOffsetY: number;
  isGroup: boolean;
  indices?: number[];
  anchorIndex?: number;
  memberOffsets?: GroupMemberOffset[];
}

export interface FeatureToolOptions extends FeatureCapabilityOptions {
  id?: string;
  contributeTool?: boolean;
  contributeCommands?: boolean;
  toolName?: string;
  requireDielineExtension?: boolean;
  features?: ConstraintFeature[];
}

/**
 * @deprecated Compatibility wrapper for FeatureCapability. Use
 * createFeatureCapability().
 */
export class FeatureTool implements ExtensionDefinition {
  id: string;

  public metadata = {
    name: "FeatureTool",
  };
  activation: ExtensionActivationSpec;

  private workingFeatures: ConstraintFeature[] = [];
  private canvasService?: CanvasService;
  private renderIntentService?: RenderIntentService;
  private context?: ExtensionContext;
  private isUpdatingConfig = false;
  private isToolActive = false;
  private isFeatureSessionActive = false;
  private sessionOriginalFeatures: ConstraintFeature[] | null = null;
  private hasWorkingChanges = false;
  private dirtyTrackerDisposable?: { dispose(): void };
  private markerSpecs: RenderObjectSpec[] = [];
  private sessionDielineSpecs: RenderObjectSpec[] = [];
  private sessionDielineEffects: RenderEffectSpec[] = [];
  private renderSeq = 0;
  private readonly subscriptions = new SubscriptionBag();
  private readonly capabilityId: string;
  private readonly configNamespace: string;
  private readonly featuresConfigKey: string;
  private readonly markerLayerId: string;
  private readonly baseDielineLayerId: string;
  private readonly sessionDielineLayerId: string;
  private readonly imageClipLayerIds: string[];
  private readonly contributeLegacyCommands: boolean;

  private handleMoving: ((e: any) => void) | null = null;
  private handleModified: ((e: any) => void) | null = null;
  private handleSceneGeometryChange:
    | ((geometry: DielineGeometry) => void)
    | null = null;

  private currentGeometry: DielineGeometry | null = null;

  constructor(options: FeatureToolOptions = {}) {
    this.id = normalizeFeatureLayerId(options.id, FEATURE_CAPABILITY_ID);
    this.capabilityId = options.capabilityId || FEATURE_CAPABILITY_ID;
    this.configNamespace = normalizeFeatureConfigNamespace(
      options.configNamespace,
    );
    this.featuresConfigKey = getFeatureConfigKey(
      this.configNamespace,
      "features",
    );
    this.markerLayerId = normalizeFeatureLayerId(
      options.layers?.markerLayerId,
      KIT_LEGACY_LAYER_PRESET.featureOverlay,
    );
    this.baseDielineLayerId = normalizeFeatureLayerId(
      options.layers?.baseDielineLayerId,
      KIT_LEGACY_LAYER_PRESET.dieline,
    );
    this.sessionDielineLayerId = normalizeFeatureLayerId(
      options.layers?.sessionDielineLayerId,
      KIT_LEGACY_LAYER_PRESET.featureDieline,
    );
    this.imageClipLayerIds = options.layers?.imageClipLayerIds?.map((id) =>
      normalizeFeatureLayerId(id, KIT_LEGACY_LAYER_PRESET.imageObject),
    ) || [KIT_LEGACY_LAYER_PRESET.imageObject];
    this.contributeLegacyCommands = options.contributeCommands !== false;
    this.workingFeatures = this.cloneFeatures(options.features || []);

    const requireDielineExtension = options.requireDielineExtension ?? false;
    this.activation = {
      requiresExtensions: requireDielineExtension ? ["pooder.kit.dieline"] : [],
      requiresServices: [CANVAS_SERVICE, CONFIGURATION_SERVICE, RENDER_INTENT_SERVICE],
    };
  }

  activate(context: ExtensionContext) {
    this.subscriptions.disposeAll();
    this.context = context;
    this.canvasService = context.services.getOrThrow<CanvasService>(
      CANVAS_SERVICE,
    );
    this.renderIntentService = context.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );

    const configService = context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    const features = (configService.get(this.featuresConfigKey, []) ||
      []) as ConstraintFeature[];
    this.workingFeatures = this.cloneFeatures(features);
    this.hasWorkingChanges = false;

    this.subscriptions.onConfigChange(
      configService,
      (e: { key: string; value: any }) => {
        if (this.isUpdatingConfig) return;

        if (e.key === this.featuresConfigKey) {
          if (this.isFeatureSessionActive && this.hasFeatureSessionDraft()) {
            return;
          }
          if (this.hasFeatureSessionDraft()) {
            this.clearFeatureSessionState();
          }
          const next = (e.value || []) as ConstraintFeature[];
          this.workingFeatures = this.cloneFeatures(next);
          this.hasWorkingChanges = false;
          this.redraw();
          this.emitWorkingChange();
          return;
        }

        if (
          e.key.startsWith("size.") ||
          e.key.startsWith("scene.") ||
          e.key.startsWith(`${this.configNamespace}.`)
        ) {
          void this.refreshGeometry();
          this.redraw({ enforceConstraints: true });
        }
      },
    );

    this.subscriptions.on(context.eventBus, "tool:activated", this.onToolActivated);

    this.setup();
  }

  deactivate(context: ExtensionContext) {
    this.subscriptions.disposeAll();
    this.restoreCommittedFeaturesToConfig();
    this.clearFeatureSessionState();
    this.dirtyTrackerDisposable?.dispose();
    this.dirtyTrackerDisposable = undefined;
    this.teardown();
    this.canvasService = undefined;
    this.renderIntentService = undefined;
    this.context = undefined;
  }

  private onToolActivated = (event: { id: string | null }) => {
    this.isToolActive = event.id === this.id;
    if (!this.isToolActive) {
      this.suspendFeatureSession();
    }
    this.updateVisibility();
  };

  private updateVisibility() {
    this.redraw();
  }

  private isSessionVisible(): boolean {
    return this.isFeatureSessionActive;
  }

  contribute(): ExtensionContributions {
    const contributions: ExtensionContributions = {
      capabilities: [
        createFeatureCapabilityDefinition(this.getFeatureFacade(), {
          capabilityId: this.capabilityId,
          configNamespace: this.configNamespace,
          layers: {
            baseDielineLayerId: this.baseDielineLayerId,
            imageClipLayerIds: this.imageClipLayerIds,
            markerLayerId: this.markerLayerId,
            sessionDielineLayerId: this.sessionDielineLayerId,
          },
        }),
      ],
      renderIntentCompilers: [this.createRenderIntentCompiler()],
    };

    if (this.contributeLegacyCommands) {
      contributions.commands = [
        createLegacyCommandBridge(
          "beginFeatureSession",
          "Begin Feature Session",
          async () => this.beginFeatureSession(),
        ),
        createLegacyCommandBridge(
          "addFeature",
          "Add Edge Feature",
          (type: FeatureOperation = "subtract") => {
            return this.addFeature(type);
          },
        ),
        createLegacyCommandBridge(
          "addHole",
          "Add Hole",
          () => {
            return this.addFeature("subtract");
          },
        ),
        createLegacyCommandBridge(
          "addDoubleLayerHole",
          "Add Double Layer Hole",
          () => {
            return this.addDoubleLayerHole();
          },
        ),
        createLegacyCommandBridge(
          "clearFeatures",
          "Clear Features",
          () => this.clearFeatures(),
        ),
        createLegacyCommandBridge(
          "rollbackFeatureSession",
          "Rollback Feature Session",
          async () => this.rollbackFeatureSession(),
        ),
        createLegacyCommandBridge(
          "resetWorkingFeatures",
          "Reset Working Features",
          async () => {
            await this.resetWorkingFeaturesFromSource();
            return { ok: true };
          },
        ),
        createLegacyCommandBridge(
          "updateWorkingGroupPosition",
          "Update Working Group Position",
          (groupId: string, x: number, y: number) => {
            return this.updateWorkingGroupPosition(groupId, x, y);
          },
        ),
        createLegacyCommandBridge(
          "completeFeatures",
          "Complete Features",
          () => {
            return this.completeFeatures();
          },
        ),
      ];
    }

    return contributions;
  }

  private createRenderIntentCompiler(): RenderIntentCompilerContribution<
    EditorEffect,
    EditorDocument
  > {
    return {
      capabilityId: this.capabilityId,
      effectType: "feature",
      compile: (context) => this.compileDocumentFeatureEffect(context),
    };
  }

  private compileDocumentFeatureEffect(
    context: RenderIntentCompilerContext<EditorEffect, EditorDocument>,
  ): RenderIntentPatch[] | void {
    const payload =
      context.effect.payload && typeof context.effect.payload === "object"
        ? context.effect.payload
        : {};
    if (!Array.isArray((payload as Record<string, unknown>).features)) return;
    const features = (payload as Record<string, unknown>).features as Array<
      Record<string, unknown>
    >;
    const layerId = context.target.layerId || this.markerLayerId;
    return features.map((feature, index) => {
      const id =
        typeof feature.id === "string" && feature.id.trim()
          ? feature.id.trim()
          : `feature-${index + 1}`;
      return {
        id: `${layerId}.${id}`,
        subject: {
          kind: "object",
          surfaceId: context.target.surfaceId,
          layerId,
          objectId: `${layerId}.${id}`,
          objectType: "rect",
        },
        ordering: {
          layerId,
          layerOrder: 0,
          objectOrder: index,
          channel: "overlay",
          stack: 760,
        },
        visual: { type: "rect" },
        placement: {
          width: DEFAULT_RECT_SIZE,
          height: DEFAULT_RECT_SIZE,
        },
        props: {
          fill: "rgba(255,255,255,0.85)",
          stroke: "#111827",
          strokeWidth: FEATURE_STROKE_WIDTH,
          selectable: false,
          evented: false,
          excludeFromExport: true,
        },
        export: {
          visible: true,
        },
        data: {
          type: "feature",
          feature,
        },
      };
    });
  }

  private cloneFeatures(features: ConstraintFeature[]): ConstraintFeature[] {
    return cloneWithJson(features || []) as ConstraintFeature[];
  }

  private getConfigService(): ConfigurationService | undefined {
    return this.context?.services.get<ConfigurationService>(CONFIGURATION_SERVICE);
  }

  private getCommittedFeatures(): ConstraintFeature[] {
    const configService = this.getConfigService();
    const committed = (configService?.get(this.featuresConfigKey, []) ||
      []) as ConstraintFeature[];
    return this.cloneFeatures(committed);
  }

  private updateCommittedFeatures(next: ConstraintFeature[]) {
    const configService = this.getConfigService();
    if (!configService) return;
    this.isUpdatingConfig = true;
    try {
      configService.update(this.featuresConfigKey, next);
    } finally {
      this.isUpdatingConfig = false;
    }
  }

  private getFeatureFacade(): FeatureCapabilityApi {
    return {
      addDoubleLayerHole: () => this.addDoubleLayerHole(),
      addFeature: (type = "subtract") => this.addFeature(type),
      beginSession: () => this.beginFeatureSession(),
      clearFeatures: () => this.clearFeatures(),
      completeSession: () => this.completeFeatures(),
      getFeatures: () => this.getCommittedFeatures(),
      getMarkerRenderSpecs: () => this.markerSpecs.map((spec) => ({ ...spec })),
      getWorkingFeatures: () => this.cloneFeatures(this.workingFeatures),
      projectPlacements: (placements, geometry, scale) =>
        projectPlacedFeatures(placements, geometry, scale),
      refresh: () => {
        void this.refreshGeometry();
        this.redraw({ enforceConstraints: true });
      },
      replaceFeatures: (features, options) =>
        this.replaceFeatures(features, options),
      resetSession: () => this.resetWorkingFeaturesFromSource().then(() => ({
        ok: true,
      })),
      resolvePlacements: (features, geometry) =>
        resolveFeaturePlacements(features, geometry),
      rollbackSession: () => this.rollbackFeatureSession(),
      updateWorkingGroupPosition: (groupId, x, y) =>
        this.updateWorkingGroupPosition(groupId, x, y),
    };
  }

  private async beginFeatureSession(): Promise<{ ok: boolean }> {
    if (this.isFeatureSessionActive) {
      return { ok: true };
    }
    if (!this.hasFeatureSessionDraft()) {
      const original = this.getCommittedFeatures();
      this.sessionOriginalFeatures = this.cloneFeatures(original);
      this.setWorkingFeatures(this.cloneFeatures(original));
      this.hasWorkingChanges = false;
    }
    this.isFeatureSessionActive = true;
    await this.refreshGeometry();
    this.redraw();
    this.emitWorkingChange();
    return { ok: true };
  }

  private async rollbackFeatureSession(): Promise<{ ok: boolean }> {
    const original = this.cloneFeatures(
      this.sessionOriginalFeatures || this.getCommittedFeatures(),
    );
    await this.refreshGeometry();
    this.setWorkingFeatures(original);
    this.hasWorkingChanges = false;
    this.clearFeatureSessionState();
    this.redraw();
    this.emitWorkingChange();
    this.updateCommittedFeatures(original);
    return { ok: true };
  }

  private replaceFeatures(
    features: ConstraintFeature[],
    options: ReplaceFeaturesOptions = {},
  ): { ok: boolean } {
    const next = this.cloneFeatures(features);
    const target = options.target || "working";

    if (target === "working" || target === "both") {
      this.setWorkingFeatures(this.cloneFeatures(next));
      this.hasWorkingChanges = options.markDirty ?? target === "working";
    }

    if (target === "committed" || target === "both") {
      this.updateCommittedFeatures(this.cloneFeatures(next));
      if (target === "committed") {
        this.setWorkingFeatures(this.cloneFeatures(next));
        this.hasWorkingChanges = false;
      }
    }

    this.redraw({ enforceConstraints: true });
    this.emitWorkingChange();
    return { ok: true };
  }

  private clearFeatures(): boolean {
    this.setWorkingFeatures([]);
    this.hasWorkingChanges = true;
    this.redraw();
    this.emitWorkingChange();
    return true;
  }

  private hasFeatureSessionDraft(): boolean {
    return Array.isArray(this.sessionOriginalFeatures);
  }

  private clearFeatureSessionState() {
    this.isFeatureSessionActive = false;
    this.sessionOriginalFeatures = null;
  }

  private restoreCommittedFeaturesToConfig() {
    if (!this.hasFeatureSessionDraft()) return;
    const original = this.cloneFeatures(
      this.sessionOriginalFeatures || this.getCommittedFeatures(),
    );
    this.updateCommittedFeatures(original);
  }

  private suspendFeatureSession() {
    if (!this.isFeatureSessionActive) return;
    this.restoreCommittedFeaturesToConfig();
    this.isFeatureSessionActive = false;
  }

  private emitWorkingChange() {
    this.context?.eventBus.emit("feature:working:change", {
      features: this.cloneFeatures(this.workingFeatures),
    });
  }

  private async refreshGeometry() {
    if (!this.context) return;
    const commandService =
      this.context.services.get<CommandService>(COMMAND_SERVICE);
    if (!commandService) return;
    try {
      const g = await Promise.resolve(
        commandService.executeCommand("getSceneGeometry"),
      );
      if (g) this.currentGeometry = g as DielineGeometry;
    } catch (e) {}
  }

  private async resetWorkingFeaturesFromSource() {
    const next = this.cloneFeatures(
      this.sessionOriginalFeatures || this.getCommittedFeatures(),
    );
    await this.refreshGeometry();
    this.setWorkingFeatures(next);
    this.hasWorkingChanges = false;
    this.redraw();
    this.emitWorkingChange();
  }

  private setWorkingFeatures(next: ConstraintFeature[]) {
    this.workingFeatures = next;
  }

  private updateWorkingGroupPosition(groupId: string, x: number, y: number) {
    if (!groupId) return { ok: false };

    const configService = this.context?.services.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    if (!configService) return { ok: false };

    const sizeState = readSizeState(configService);
    const dielineWidth = sizeState.sceneFrames.productionFrame.widthMm;
    const dielineHeight = sizeState.sceneFrames.productionFrame.heightMm;

    let changed = false;
    const next = this.workingFeatures.map((f) => {
      if (f.groupId !== groupId) return f;
      let nx = x;
      let ny = y;
      if (f.constraints && dielineWidth > 0 && dielineHeight > 0) {
        const constrained = ConstraintRegistry.apply(nx, ny, f, {
          dielineWidth,
          dielineHeight,
        });
        nx = constrained.x;
        ny = constrained.y;
      }

      if (f.x !== nx || f.y !== ny) {
        changed = true;
        return { ...f, x: nx, y: ny };
      }
      return f;
    });

    if (!changed) return { ok: true };

    this.setWorkingFeatures(next);
    this.hasWorkingChanges = true;
    this.redraw({ enforceConstraints: true });
    this.emitWorkingChange();

    return { ok: true };
  }

  private completeFeatures(): FeatureCompletionResult {
    const configService = this.context?.services.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    if (!configService) {
      return {
        ok: false,
        issues: [
          { featureId: "unknown", reason: "ConfigurationService not found" },
        ],
      };
    }

    const sizeState = readSizeState(configService);
    const dielineWidth = sizeState.sceneFrames.productionFrame.widthMm;
    const dielineHeight = sizeState.sceneFrames.productionFrame.heightMm;

    const result = completeFeaturesStrict(
      this.workingFeatures,
      { dielineWidth, dielineHeight },
      (next) => {
        this.updateCommittedFeatures(next as ConstraintFeature[]);
        this.workingFeatures = this.cloneFeatures(next as ConstraintFeature[]);
        this.emitWorkingChange();
      },
    );

    if (!result.ok) {
      return {
        ok: false,
        issues: result.issues,
      };
    }

    this.hasWorkingChanges = false;
    this.clearFeatureSessionState();
    this.redraw();
    return { ok: true };
  }

  private addFeature(type: FeatureOperation) {
    if (!this.canvasService) return false;

    const newFeature: ConstraintFeature = {
      id: Date.now().toString(),
      operation: type,
      shape: "rect",
      x: 0.5,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      renderBehavior: "edge",
      constraints: [{ type: "path" }],
    };

    this.setWorkingFeatures([...(this.workingFeatures || []), newFeature]);
    this.hasWorkingChanges = true;
    this.redraw();
    this.emitWorkingChange();
    return true;
  }

  private addDoubleLayerHole() {
    if (!this.canvasService) return false;

    const groupId = Date.now().toString();
    const timestamp = Date.now();

    const lug: ConstraintFeature = {
      id: `${timestamp}-lug`,
      groupId,
      operation: "add",
      shape: "circle",
      x: 0.5,
      y: 0,
      radius: 20,
      rotation: 0,
      renderBehavior: "edge",
      constraints: [{ type: "path" }],
    };

    const hole: ConstraintFeature = {
      id: `${timestamp}-hole`,
      groupId,
      operation: "subtract",
      shape: "circle",
      x: 0.5,
      y: 0,
      radius: 15,
      rotation: 0,
      renderBehavior: "edge",
      constraints: [{ type: "path" }],
    };

    this.setWorkingFeatures([...(this.workingFeatures || []), lug, hole]);
    this.hasWorkingChanges = true;
    this.redraw();
    this.emitWorkingChange();
    return true;
  }

  private getGeometryForFeature(
    geometry: DielineGeometry,
    _feature?: ConstraintFeature,
  ): DielineGeometry {
    return geometry;
  }

  private setup() {
    if (!this.canvasService || !this.context) return;

    if (!this.handleSceneGeometryChange) {
      this.handleSceneGeometryChange = (geometry: DielineGeometry) => {
        this.currentGeometry = geometry;
        this.redraw({ enforceConstraints: true });
      };
      this.context.eventBus.on(
        "scene:geometry:change",
        this.handleSceneGeometryChange,
      );
    }

    const commandService =
      this.context.services.get<CommandService>(COMMAND_SERVICE);
    if (commandService) {
      try {
        Promise.resolve(commandService.executeCommand("getSceneGeometry"))
          .then((g) => {
            if (g) {
              this.currentGeometry = g as DielineGeometry;
              this.redraw();
            }
          })
          .catch(() => {});
      } catch (e) {}
    }

    if (!this.handleMoving) {
      this.handleMoving = (e: any) => {
        const target = this.getDraggableMarkerTarget(e?.target);
        if (!target || !this.currentGeometry) return;

        const feature = this.getFeatureForMarker(target);
        const geometry = this.getGeometryForFeature(this.currentGeometry, feature);
        const snapped = this.constrainPosition(
          {
            x: Number(target.left || 0),
            y: Number(target.top || 0),
          },
          geometry,
          feature,
        );

        target.set({
          left: snapped.x,
          top: snapped.y,
        });
        target.setCoords();

        this.syncMarkerVisualsByTarget(target, snapped);
      };
      this.canvasService.onCanvasEvent("object:moving", this.handleMoving);
    }

    if (!this.handleModified) {
      this.handleModified = (e: any) => {
        const target = this.getDraggableMarkerTarget(e?.target);
        if (!target) return;

        if (target.data?.isGroup) {
          this.syncGroupFromCanvas(target);
        } else {
          this.syncFeatureFromCanvas(target);
        }
      };
      this.canvasService.onCanvasEvent("object:modified", this.handleModified);
    }
  }

  private teardown() {
    if (!this.canvasService) return;

    if (this.handleMoving) {
      this.canvasService.offCanvasEvent("object:moving", this.handleMoving);
      this.handleMoving = null;
    }
    if (this.handleModified) {
      this.canvasService.offCanvasEvent("object:modified", this.handleModified);
      this.handleModified = null;
    }
    if (this.handleSceneGeometryChange && this.context) {
      this.context.eventBus.off(
        "scene:geometry:change",
        this.handleSceneGeometryChange,
      );
      this.handleSceneGeometryChange = null;
    }

    this.renderSeq += 1;
    this.markerSpecs = [];
    this.sessionDielineSpecs = [];
    this.sessionDielineEffects = [];
    clearRenderIntentSource(this.renderIntentService, this.id);
  }

  private createHatchPattern(
    color: string = "rgba(0, 0, 0, 0.3)",
  ): RenderPatternSpec {
    return {
      type: "pattern",
      kind: "diagonalHatch",
      color,
      size: 20,
      repetition: "repeat",
    };
  }

  private getDraggableMarkerTarget(target: any): any | null {
    if (!this.isSessionVisible()) return null;
    if (!target || target.data?.type !== "feature-marker") return null;
    if (target.data?.markerRole !== "handle") return null;
    return target;
  }

  private getFeatureForMarker(target: any): ConstraintFeature | undefined {
    const data = target?.data || {};
    const index = data.isGroup
      ? this.toFeatureIndex(data.anchorIndex)
      : this.toFeatureIndex(data.index);
    if (index === null) return undefined;
    return this.workingFeatures[index];
  }

  private constrainPosition(
    p: MarkerPoint,
    geometry: DielineGeometry,
    feature?: ConstraintFeature,
  ): MarkerPoint {
    if (!feature) {
      return { x: p.x, y: p.y };
    }

    const minX = geometry.x - geometry.width / 2;
    const minY = geometry.y - geometry.height / 2;

    const nx = geometry.width > 0 ? (p.x - minX) / geometry.width : 0.5;
    const ny = geometry.height > 0 ? (p.y - minY) / geometry.height : 0.5;

    const scale = geometry.scale || 1;
    const dielineWidth = geometry.width / scale;
    const dielineHeight = geometry.height / scale;

    const activeConstraints = feature.constraints?.filter(
      (c) => !c.validateOnly,
    );

    const constrained = ConstraintRegistry.apply(
      nx,
      ny,
      feature,
      {
        dielineWidth,
        dielineHeight,
        geometry,
      },
      activeConstraints,
    );

    return {
      x: minX + constrained.x * geometry.width,
      y: minY + constrained.y * geometry.height,
    };
  }

  private toNormalizedPoint(
    point: MarkerPoint,
    geometry: DielineGeometry,
  ): MarkerPoint {
    const left = geometry.x - geometry.width / 2;
    const top = geometry.y - geometry.height / 2;
    return {
      x: geometry.width > 0 ? (point.x - left) / geometry.width : 0.5,
      y: geometry.height > 0 ? (point.y - top) / geometry.height : 0.5,
    };
  }

  private syncFeatureFromCanvas(target: any) {
    if (!this.currentGeometry) return;

    const index = this.toFeatureIndex(target.data?.index);
    if (index === null || index >= this.workingFeatures.length) return;

    const feature = this.workingFeatures[index];
    const geometry = this.getGeometryForFeature(this.currentGeometry, feature);
    const normalized = this.toNormalizedPoint(
      {
        x: Number(target.left || 0),
        y: Number(target.top || 0),
      },
      geometry,
    );

    const updatedFeature = {
      ...feature,
      x: normalized.x,
      y: normalized.y,
    };

    const next = [...this.workingFeatures];
    next[index] = updatedFeature;
    this.setWorkingFeatures(next);
    this.hasWorkingChanges = true;
    this.redraw();
    this.emitWorkingChange();
  }

  private syncGroupFromCanvas(target: any) {
    if (!this.currentGeometry) return;

    const indices = this.readGroupIndices(target.data?.indices);
    if (indices.length === 0) return;
    const offsets = this.readGroupMemberOffsets(target.data?.memberOffsets, indices);

    const anchorCenter = {
      x: Number(target.left || 0),
      y: Number(target.top || 0),
    };

    const next = [...this.workingFeatures];
    let changed = false;
    offsets.forEach((entry) => {
      const index = entry.index;
      if (index < 0 || index >= next.length) return;
      const feature = next[index];
      const geometry = this.getGeometryForFeature(this.currentGeometry!, feature);
      const normalized = this.toNormalizedPoint(
        {
          x: anchorCenter.x + entry.dx,
          y: anchorCenter.y + entry.dy,
        },
        geometry,
      );

      if (feature.x !== normalized.x || feature.y !== normalized.y) {
        next[index] = {
          ...feature,
          x: normalized.x,
          y: normalized.y,
        };
        changed = true;
      }
    });

    if (!changed) return;
    this.setWorkingFeatures(next);
    this.hasWorkingChanges = true;
    this.redraw();
    this.emitWorkingChange();
  }

  private redraw(options: { enforceConstraints?: boolean } = {}) {
    void this.redrawAsync(options);
  }

  private async redrawAsync(options: { enforceConstraints?: boolean } = {}) {
    if (!this.canvasService) return;

    const seq = ++this.renderSeq;
    this.markerSpecs = this.buildMarkerSpecs();
    const sessionRender = this.buildSessionDielineRender();
    this.sessionDielineSpecs = sessionRender.specs;
    this.sessionDielineEffects = sessionRender.effects;
    if (seq !== this.renderSeq) return;

    this.publishRenderIntents();
    if (seq !== this.renderSeq) return;
    if (options.enforceConstraints) {
      this.enforceConstraints();
    }
  }

  private publishRenderIntents() {
    clearRenderIntentSource(this.renderIntentService, this.id);
    patchRenderObjectSpecs(this.renderIntentService, this.markerSpecs, {
      sourceId: this.id,
      layerId: this.markerLayerId,
      stack: 880,
      layerOrder: 0,
      channel: "overlay",
    });
    if (!this.isSessionVisible()) return;
    patchRenderObjectSpecs(this.renderIntentService, this.sessionDielineSpecs, {
      sourceId: this.id,
      layerId: this.sessionDielineLayerId,
      stack: 705,
      layerOrder: 0,
      channel: "overlay",
    });
    this.sessionDielineEffects.forEach((effect, index) => {
      this.imageClipLayerIds.forEach((layerId) => {
        this.renderIntentService?.patchIntent(this.id, {
          id: `${this.id}.effect.${layerId}.${index}`,
          subject: {
            kind: "layer",
            surfaceId: "legacy",
            layerId,
          },
          ordering: {
            layerId,
            stack: 705,
            layerOrder: 0,
            objectOrder: 10_000 + index,
          },
          effects: [effect],
        });
      });
    });
  }

  private buildSessionDielineRender(): {
    specs: RenderObjectSpec[];
    effects: RenderEffectSpec[];
  } {
    if (!this.isSessionVisible() || !this.canvasService) {
      return { specs: [], effects: [] };
    }
    const configService = this.getConfigService();
    if (!configService) {
      return { specs: [], effects: [] };
    }
    const sceneLayout = computeSceneLayout(
      this.canvasService,
      readSizeState(configService),
    );
    if (!sceneLayout) {
      return { specs: [], effects: [] };
    }

    const state = readDielineState(configService, undefined, this.configNamespace);
    state.features = this.cloneFeatures(this.workingFeatures);

    return buildDielineRenderBundle({
      state,
      sceneLayout,
      canvasWidth: sceneLayout.canvasWidth || this.canvasService.getViewportSize().width || 800,
      canvasHeight:
        sceneLayout.canvasHeight || this.canvasService.getViewportSize().height || 600,
      hasImages: this.hasImageItems(),
      createHatchPattern: (color) => this.createHatchPattern(color),
      clipActiveWhen: { op: "const", value: true },
      ids: {
        inside: "feature.session.dieline.inside",
        bleedZone: "feature.session.dieline.bleed-zone",
        offsetBorder: "feature.session.dieline.offset-border",
        border: "feature.session.dieline.border",
        clip: "feature.session.dieline.clip.image",
        clipSource: "feature.session.dieline.effect.clip-path",
      },
    });
  }

  private hasImageItems(): boolean {
    if (!this.canvasService) return false;
    return this.imageClipLayerIds.some(
      (layerId) =>
        this.canvasService!.selectObjects({ layerIds: [layerId] }).length > 0,
    );
  }

  private buildMarkerSpecs(): RenderObjectSpec[] {
    if (
      !this.isFeatureSessionActive ||
      !this.currentGeometry ||
      this.workingFeatures.length === 0
    ) {
      return [];
    }

    const groups = new Map<string, MarkerRenderState[]>();
    const singles: MarkerRenderState[] = [];
    const placements = resolveFeaturePlacements(
      this.workingFeatures,
      {
        shape: this.currentGeometry.shape,
        shapeStyle: this.currentGeometry.shapeStyle,
        pathData: this.currentGeometry.pathData,
        customSourceWidthPx: this.currentGeometry.customSourceWidthPx,
        customSourceHeightPx: this.currentGeometry.customSourceHeightPx,
        x: this.currentGeometry.x,
        y: this.currentGeometry.y,
        width: this.currentGeometry.width,
        height: this.currentGeometry.height,
        radius: this.currentGeometry.radius,
        scale: this.currentGeometry.scale || 1,
      },
    );

    placements.forEach((placement, index) => {
      const feature = placement.feature;
      const geometry = this.getGeometryForFeature(this.currentGeometry!, feature);
      const position = {
        x: placement.centerX,
        y: placement.centerY,
      };
      const scale = geometry.scale || 1;
      const marker: MarkerRenderState = {
        feature,
        index,
        position,
        geometry,
        scale,
      };

      if (feature.groupId) {
        const list = groups.get(feature.groupId) || [];
        list.push(marker);
        groups.set(feature.groupId, list);
        return;
      }
      singles.push(marker);
    });

    const specs: RenderObjectSpec[] = [];

    singles.forEach((marker) => {
      this.appendMarkerSpecs(specs, marker, {
        markerRole: "handle",
        isGroup: false,
      });
    });

    groups.forEach((members, groupId) => {
      if (!members.length) return;
      const anchor = members[0];
      const memberOffsets: GroupMemberOffset[] = members.map((member) => ({
        index: member.index,
        dx: member.position.x - anchor.position.x,
        dy: member.position.y - anchor.position.y,
      }));
      const indices = members.map((member) => member.index);

      members
        .filter((member) => member.index !== anchor.index)
        .forEach((member) => {
          this.appendMarkerSpecs(specs, member, {
            markerRole: "member",
            isGroup: false,
            groupId,
          });
        });

      this.appendMarkerSpecs(specs, anchor, {
        markerRole: "handle",
        isGroup: true,
        groupId,
        indices,
        anchorIndex: anchor.index,
        memberOffsets,
      });
    });

    return specs;
  }

  private appendMarkerSpecs(
    specs: RenderObjectSpec[],
    marker: MarkerRenderState,
    options: {
      markerRole: "handle" | "member";
      isGroup: boolean;
      groupId?: string;
      indices?: number[];
      anchorIndex?: number;
      memberOffsets?: GroupMemberOffset[];
    },
  ) {
    const { feature, index, position, scale, geometry } = marker;
    const baseRadius =
      feature.shape === "circle"
        ? (feature.radius ?? DEFAULT_CIRCLE_RADIUS)
        : (feature.radius ?? 0);
    const baseWidth =
      feature.shape === "circle"
        ? baseRadius * 2
        : (feature.width ?? DEFAULT_RECT_SIZE);
    const baseHeight =
      feature.shape === "circle"
        ? baseRadius * 2
        : (feature.height ?? DEFAULT_RECT_SIZE);
    const visualWidth = baseWidth * scale;
    const visualHeight = baseHeight * scale;
    const visualRadius = baseRadius * scale;
    const color =
      feature.color || (feature.operation === "add" ? "#00FF00" : "#FF0000");
    const strokeDash =
      feature.strokeDash ||
      (feature.operation === "subtract" ? [4, 4] : undefined);

    const interactive = options.markerRole === "handle";
    const sessionVisible = this.isSessionVisible();
    const baseData = this.buildMarkerData(marker, options);
    const commonProps = {
      visible: sessionVisible,
      selectable: interactive && sessionVisible,
      evented: interactive && sessionVisible,
      hasControls: false,
      hasBorders: false,
      hoverCursor: interactive ? "move" : "default",
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      fill: "transparent",
      stroke: color,
      strokeWidth: FEATURE_STROKE_WIDTH,
      strokeDashArray: strokeDash,
      originX: "center" as const,
      originY: "center" as const,
      left: position.x,
      top: position.y,
      angle: feature.rotation || 0,
    };

    const markerId = this.markerId(index);
    if (feature.shape === "rect") {
      specs.push({
        id: markerId,
        type: "rect",
        space: "screen",
        data: baseData,
        props: {
          ...commonProps,
          width: visualWidth,
          height: visualHeight,
          rx: visualRadius,
          ry: visualRadius,
        },
      });
    } else {
      specs.push({
        id: markerId,
        type: "rect",
        space: "screen",
        data: baseData,
        props: {
          ...commonProps,
          width: visualWidth,
          height: visualHeight,
          rx: visualRadius,
          ry: visualRadius,
        },
      });
    }

    if (feature.bridge?.type === "vertical") {
      const featureTopY = position.y - visualHeight / 2;
      const dielineTopY = geometry.y - geometry.height / 2;
      const bridgeHeight = Math.max(0, featureTopY - dielineTopY);
      if (bridgeHeight <= 0.001) {
        return;
      }
      specs.push({
        id: this.bridgeIndicatorId(index),
        type: "rect",
        space: "screen",
        data: {
          ...baseData,
          markerRole: "indicator",
          markerOffsetX: 0,
          markerOffsetY: -visualHeight / 2,
        } as MarkerData,
        props: {
          visible: sessionVisible,
          selectable: false,
          evented: false,
          width: visualWidth,
          height: bridgeHeight,
          fill: "transparent",
          stroke: "#888",
          strokeWidth: 1,
          strokeDashArray: [2, 2],
          opacity: 0.5,
          originX: "center",
          originY: "bottom",
          left: position.x,
          top: position.y - visualHeight / 2,
        },
      });
    }
  }

  private buildMarkerData(
    marker: MarkerRenderState,
    options: {
      markerRole: "handle" | "member";
      isGroup: boolean;
      groupId?: string;
      indices?: number[];
      anchorIndex?: number;
      memberOffsets?: GroupMemberOffset[];
    },
  ): MarkerData {
    const data: MarkerData = {
      type: "feature-marker",
      index: marker.index,
      featureId: marker.feature.id,
      markerRole: options.markerRole,
      markerOffsetX: 0,
      markerOffsetY: 0,
      isGroup: options.isGroup,
    };
    if (options.groupId) data.groupId = options.groupId;
    if (options.indices) data.indices = options.indices;
    if (options.anchorIndex !== undefined) data.anchorIndex = options.anchorIndex;
    if (options.memberOffsets) data.memberOffsets = options.memberOffsets;
    return data;
  }

  private markerId(index: number): string {
    return `feature.marker.${index}`;
  }

  private bridgeIndicatorId(index: number): string {
    return `feature.marker.${index}.bridge`;
  }

  private toFeatureIndex(value: unknown): number | null {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 0) return null;
    return numeric;
  }

  private readGroupIndices(raw: unknown): number[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((value) => this.toFeatureIndex(value))
      .filter((value): value is number => value !== null);
  }

  private readGroupMemberOffsets(
    raw: unknown,
    fallbackIndices: number[] = [],
  ): GroupMemberOffset[] {
    if (Array.isArray(raw)) {
      const parsed = raw
        .map((entry) => {
          const index = this.toFeatureIndex((entry as any)?.index);
          const dx = Number((entry as any)?.dx);
          const dy = Number((entry as any)?.dy);
          if (index === null || !Number.isFinite(dx) || !Number.isFinite(dy)) {
            return null;
          }
          return { index, dx, dy };
        })
        .filter((value): value is GroupMemberOffset => !!value);
      if (parsed.length > 0) return parsed;
    }

    return fallbackIndices.map((index) => ({ index, dx: 0, dy: 0 }));
  }

  private syncMarkerVisualsByTarget(target: any, center: MarkerPoint) {
    if (target.data?.isGroup) {
      const indices = this.readGroupIndices(target.data?.indices);
      const offsets = this.readGroupMemberOffsets(target.data?.memberOffsets, indices);
      offsets.forEach((entry) => {
        this.syncMarkerVisualObjectsToCenter(entry.index, {
          x: center.x + entry.dx,
          y: center.y + entry.dy,
        });
      });
      this.canvasService?.requestRenderAll();
      return;
    }

    const index = this.toFeatureIndex(target.data?.index);
    if (index === null) return;
    this.syncMarkerVisualObjectsToCenter(index, center);
    this.canvasService?.requestRenderAll();
  }

  private syncMarkerVisualObjectsToCenter(index: number, center: MarkerPoint) {
    if (!this.canvasService) return;
    const markers = this.canvasService
      .selectObjects({ types: ["feature-marker"] })
      .filter((obj: any) => this.toFeatureIndex(obj?.data?.index) === index);

    markers.forEach((marker: any) => {
      const offsetX = Number(marker?.data?.markerOffsetX || 0);
      const offsetY = Number(marker?.data?.markerOffsetY || 0);
      marker.set({
        left: center.x + offsetX,
        top: center.y + offsetY,
      });
      marker.setCoords();
    });
  }

  private enforceConstraints() {
    if (!this.canvasService || !this.currentGeometry) return;

    const handles = this.canvasService.selectObjects({
      types: ["feature-marker"],
      data: { markerRole: "handle" },
    });

    handles.forEach((marker: any) => {
      const feature = this.getFeatureForMarker(marker);
      if (!feature) return;
      const geometry = this.getGeometryForFeature(this.currentGeometry!, feature);
      const snapped = this.constrainPosition(
        {
          x: Number(marker.left || 0),
          y: Number(marker.top || 0),
        },
        geometry,
        feature,
      );
      marker.set({ left: snapped.x, top: snapped.y });
      marker.setCoords();
      this.syncMarkerVisualsByTarget(marker, snapped);
    });

    this.canvasService.requestRenderAll();
  }
}
