import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationService,
  ToolSessionService,
} from "@pooder/core";
import { CanvasService, RenderObjectSpec } from "../services";
import { resolveFeaturePosition } from "./geometry";
import { ConstraintRegistry, ConstraintFeature } from "./constraints";
import { completeFeaturesStrict } from "./featureComplete";
import {
  readSizeState,
  type SceneGeometrySnapshot as DielineGeometry,
} from "./sceneLayoutModel";

const FEATURE_OVERLAY_LAYER_ID = "feature-overlay";
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

export class FeatureTool implements Extension {
  id = "pooder.kit.feature";

  public metadata = {
    name: "FeatureTool",
  };

  private workingFeatures: ConstraintFeature[] = [];
  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private isUpdatingConfig = false;
  private isToolActive = false;
  private isFeatureSessionActive = false;
  private sessionOriginalFeatures: ConstraintFeature[] | null = null;
  private hasWorkingChanges = false;
  private dirtyTrackerDisposable?: { dispose(): void };
  private renderProducerDisposable?: { dispose: () => void };
  private specs: RenderObjectSpec[] = [];
  private renderSeq = 0;

  private handleMoving: ((e: any) => void) | null = null;
  private handleModified: ((e: any) => void) | null = null;
  private handleSceneGeometryChange:
    | ((geometry: DielineGeometry) => void)
    | null = null;

  private currentGeometry: DielineGeometry | null = null;

  constructor(
    options?: Partial<{
      features: ConstraintFeature[];
    }>,
  ) {
    if (options) {
      Object.assign(this, options);
    }
  }

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService = context.services.get<CanvasService>("CanvasService");

    if (!this.canvasService) {
      console.warn("CanvasService not found for FeatureTool");
      return;
    }

    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = this.canvasService.registerRenderProducer(
      this.id,
      () => ({
        passes: [
          {
            id: FEATURE_OVERLAY_LAYER_ID,
            stack: 880,
            order: 0,
            objects: this.specs,
          },
        ],
      }),
      { priority: 350 },
    );

    const configService = context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (configService) {
      const features = (configService.get("dieline.features", []) ||
        []) as ConstraintFeature[];
      this.workingFeatures = this.cloneFeatures(features);
      this.hasWorkingChanges = false;

      configService.onAnyChange((e: { key: string; value: any }) => {
        if (this.isUpdatingConfig) return;

        if (e.key === "dieline.features") {
          if (this.isFeatureSessionActive) return;
          const next = (e.value || []) as ConstraintFeature[];
          this.workingFeatures = this.cloneFeatures(next);
          this.hasWorkingChanges = false;
          this.redraw();
          this.emitWorkingChange();
        }
      });
    }

    const toolSessionService =
      context.services.get<ToolSessionService>("ToolSessionService");
    this.dirtyTrackerDisposable = toolSessionService?.registerDirtyTracker(
      this.id,
      () => this.hasWorkingChanges,
    );

    context.eventBus.on("tool:activated", this.onToolActivated);

    this.setup();
  }

  deactivate(context: ExtensionContext) {
    context.eventBus.off("tool:activated", this.onToolActivated);
    this.restoreSessionFeaturesToConfig();
    this.dirtyTrackerDisposable?.dispose();
    this.dirtyTrackerDisposable = undefined;
    this.teardown();
    this.canvasService = undefined;
    this.context = undefined;
  }

  private onToolActivated = (event: { id: string | null }) => {
    this.isToolActive = event.id === this.id;
    if (!this.isToolActive) {
      this.restoreSessionFeaturesToConfig();
    }
    this.updateVisibility();
  };

  private updateVisibility() {
    this.redraw();
  }

  contribute() {
    return {
      [ContributionPointIds.TOOLS]: [
        {
          id: this.id,
          name: "Feature",
          interaction: "session",
          commands: {
            begin: "beginFeatureSession",
            commit: "completeFeatures",
            rollback: "rollbackFeatureSession",
          },
          session: {
            autoBegin: false,
            leavePolicy: "block",
          },
        },
      ],
      [ContributionPointIds.COMMANDS]: [
        {
          command: "beginFeatureSession",
          title: "Begin Feature Session",
          handler: async () => {
            if (this.isFeatureSessionActive) {
              return { ok: true };
            }
            const original = this.getCommittedFeatures();
            this.sessionOriginalFeatures = this.cloneFeatures(original);
            this.isFeatureSessionActive = true;
            await this.refreshGeometry();
            this.setWorkingFeatures(this.cloneFeatures(original));
            this.hasWorkingChanges = false;
            this.redraw();
            this.emitWorkingChange();
            this.updateCommittedFeatures([]);
            return { ok: true };
          },
        },
        {
          command: "addFeature",
          title: "Add Edge Feature",
          handler: (type: "add" | "subtract" = "subtract") => {
            return this.addFeature(type);
          },
        },
        {
          command: "addHole",
          title: "Add Hole",
          handler: () => {
            return this.addFeature("subtract");
          },
        },
        {
          command: "addDoubleLayerHole",
          title: "Add Double Layer Hole",
          handler: () => {
            return this.addDoubleLayerHole();
          },
        },
        {
          command: "clearFeatures",
          title: "Clear Features",
          handler: () => {
            this.setWorkingFeatures([]);
            this.hasWorkingChanges = true;
            this.redraw();
            this.emitWorkingChange();
            return true;
          },
        },
        {
          command: "getWorkingFeatures",
          title: "Get Working Features",
          handler: () => {
            return this.cloneFeatures(this.workingFeatures);
          },
        },
        {
          command: "setWorkingFeatures",
          title: "Set Working Features",
          handler: async (features: ConstraintFeature[]) => {
            await this.refreshGeometry();
            this.setWorkingFeatures(this.cloneFeatures(features || []));
            this.hasWorkingChanges = true;
            this.redraw();
            this.emitWorkingChange();
            return { ok: true };
          },
        },
        {
          command: "rollbackFeatureSession",
          title: "Rollback Feature Session",
          handler: async () => {
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
          },
        },
        {
          command: "resetWorkingFeatures",
          title: "Reset Working Features",
          handler: async () => {
            await this.resetWorkingFeaturesFromSource();
            return { ok: true };
          },
        },
        {
          command: "updateWorkingGroupPosition",
          title: "Update Working Group Position",
          handler: (groupId: string, x: number, y: number) => {
            return this.updateWorkingGroupPosition(groupId, x, y);
          },
        },
        {
          command: "completeFeatures",
          title: "Complete Features",
          handler: () => {
            return this.completeFeatures();
          },
        },
      ] as CommandContribution[],
    };
  }

  private cloneFeatures(features: ConstraintFeature[]): ConstraintFeature[] {
    return JSON.parse(JSON.stringify(features || [])) as ConstraintFeature[];
  }

  private getConfigService(): ConfigurationService | undefined {
    return this.context?.services.get<ConfigurationService>(
      "ConfigurationService",
    );
  }

  private getCommittedFeatures(): ConstraintFeature[] {
    const configService = this.getConfigService();
    const committed = (configService?.get("dieline.features", []) ||
      []) as ConstraintFeature[];
    return this.cloneFeatures(committed);
  }

  private updateCommittedFeatures(next: ConstraintFeature[]) {
    const configService = this.getConfigService();
    if (!configService) return;
    this.isUpdatingConfig = true;
    try {
      configService.update("dieline.features", next);
    } finally {
      this.isUpdatingConfig = false;
    }
  }

  private clearFeatureSessionState() {
    this.isFeatureSessionActive = false;
    this.sessionOriginalFeatures = null;
  }

  private restoreSessionFeaturesToConfig() {
    if (!this.isFeatureSessionActive) return;
    const original = this.cloneFeatures(
      this.sessionOriginalFeatures || this.getCommittedFeatures(),
    );
    this.updateCommittedFeatures(original);
    this.clearFeatureSessionState();
  }

  private emitWorkingChange() {
    this.context?.eventBus.emit("feature:working:change", {
      features: this.cloneFeatures(this.workingFeatures),
    });
  }

  private async refreshGeometry() {
    if (!this.context) return;
    const commandService = this.context.services.get<any>("CommandService");
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
      this.isFeatureSessionActive && this.sessionOriginalFeatures
        ? this.sessionOriginalFeatures
        : this.getCommittedFeatures(),
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
      "ConfigurationService",
    );
    if (!configService) return { ok: false };

    const sizeState = readSizeState(configService);
    const dielineWidth = sizeState.actualWidthMm;
    const dielineHeight = sizeState.actualHeightMm;

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

  private completeFeatures(): {
    ok: boolean;
    issues?: Array<{
      featureId: string;
      groupId?: string;
      reason: string;
    }>;
  } {
    const configService = this.context?.services.get<ConfigurationService>(
      "ConfigurationService",
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
    const dielineWidth = sizeState.actualWidthMm;
    const dielineHeight = sizeState.actualHeightMm;

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

  private addFeature(type: "add" | "subtract") {
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
    const canvas = this.canvasService.canvas;

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

    const commandService = this.context.services.get<any>("CommandService");
    if (commandService) {
      try {
        Promise.resolve(commandService.executeCommand("getSceneGeometry")).then(
          (g) => {
            if (g) {
              this.currentGeometry = g as DielineGeometry;
              this.redraw();
            }
          },
        );
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
      canvas.on("object:moving", this.handleMoving);
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
      canvas.on("object:modified", this.handleModified);
    }
  }

  private teardown() {
    if (!this.canvasService) return;
    const canvas = this.canvasService.canvas;

    if (this.handleMoving) {
      canvas.off("object:moving", this.handleMoving);
      this.handleMoving = null;
    }
    if (this.handleModified) {
      canvas.off("object:modified", this.handleModified);
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
    this.specs = [];
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = undefined;
    void this.canvasService.flushRenderFromProducers();
  }

  private getDraggableMarkerTarget(target: any): any | null {
    if (!this.isFeatureSessionActive || !this.isToolActive) return null;
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
    this.emitWorkingChange();
  }

  private redraw(options: { enforceConstraints?: boolean } = {}) {
    void this.redrawAsync(options);
  }

  private async redrawAsync(options: { enforceConstraints?: boolean } = {}) {
    if (!this.canvasService) return;

    const seq = ++this.renderSeq;
    this.specs = this.buildFeatureSpecs();
    if (seq !== this.renderSeq) return;

    await this.canvasService.flushRenderFromProducers();
    if (seq !== this.renderSeq) return;
    if (options.enforceConstraints) {
      this.enforceConstraints();
    }
  }

  private buildFeatureSpecs(): RenderObjectSpec[] {
    if (
      !this.isFeatureSessionActive ||
      !this.currentGeometry ||
      this.workingFeatures.length === 0
    ) {
      return [];
    }

    const groups = new Map<string, MarkerRenderState[]>();
    const singles: MarkerRenderState[] = [];

    this.workingFeatures.forEach((feature, index) => {
      const geometry = this.getGeometryForFeature(this.currentGeometry!, feature);
      const position = resolveFeaturePosition(feature, geometry);
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
    const sessionVisible = this.isToolActive && this.isFeatureSessionActive;
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
    const markers = this.canvasService.canvas
      .getObjects()
      .filter(
        (obj: any) =>
          obj?.data?.type === "feature-marker" &&
          this.toFeatureIndex(obj?.data?.index) === index,
      );

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

    const handles = this.canvasService.canvas
      .getObjects()
      .filter(
        (obj: any) =>
          obj?.data?.type === "feature-marker" &&
          obj?.data?.markerRole === "handle",
      );

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

    this.canvasService.canvas.requestRenderAll();
  }
}
