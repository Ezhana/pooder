import {
  CONFIGURATION_SERVICE,
  ExtensionContext,
  ExtensionContributions,
  ExtensionDefinition,
  ConfigurationService,
  TOOL_SESSION_SERVICE,
  ToolSessionService,
  WORKBENCH_SERVICE,
  WorkbenchService,
} from "@pooder/core";
import {
  CANVAS_SERVICE,
  CanvasService,
  RenderObjectSpec,
  RenderPatternSpec,
  SCENE_EXPORT_SERVICE,
  SceneExportService,
} from "@pooder/core";
import {
  buildSceneGeometry,
  computeSceneLayout,
  readSizeState,
  type SceneGeometrySnapshot,
  type SceneLayoutSnapshot,
} from "../../shared/scene/scene-layout-model";
import { type FrameRect, resolveSurfaceFrameRect } from "../../shared/scene/frame";
import {
  createSourceSizeCache,
  getCoverScale as getCoverScaleFromRect,
  type SourceSize,
} from "../../shared/imaging/sourceSizeCache";
import { SubscriptionBag } from "../../shared/runtime/subscriptions";
import {
  applyCommittedSnapshot,
  runDeferredConfigUpdate,
} from "../../shared/runtime/sessionState";
import {
  IMAGE_OBJECT_LAYER_ID,
  IMAGE_OVERLAY_LAYER_ID,
  KIT_LEGACY_LAYER_PRESET,
} from "../../shared/constants/layers";
import { createImageCommands } from "./commands";
import {
  IMAGE_PLACEMENT_CAPABILITY_ID,
  createImagePlacementCapabilityDefinition,
  normalizeImagePlacementConfigNamespace,
  normalizeImagePlacementLayerId,
  type ImagePlacementCapabilityApi,
  type ImagePlacementCapabilityOptions,
} from "./capability";
import { createImageConfigurations } from "./config";
import {
  computeImageOperationUpdates,
  resolveImageOperationArea,
  type ImageOperation,
} from "./imageOperations";
import { validateImagePlacement } from "./imagePlacement";
import { buildImageSessionOverlaySpecs } from "./sessionOverlay";

export interface ImageItem {
  id: string;
  url: string;
  opacity: number;
  scale?: number;
  angle?: number;
  left?: number;
  top?: number;
  sourceUrl?: string;
  committedUrl?: string;
}

export interface ImageTransformUpdates {
  scale?: number;
  angle?: number;
  left?: number;
  top?: number;
  opacity?: number;
}

export interface ImageViewState {
  items: ImageItem[];
  hasAnyImage: boolean;
  focusedId: string | null;
  focusedItem: ImageItem | null;
  isToolActive: boolean;
  isImageSelectionActive: boolean;
  hasWorkingChanges: boolean;
  source: "working" | "committed";
  placementPolicy: ImageSessionPlacementPolicy;
  sessionNotice: ImageSessionNotice | null;
}

export type ImageSessionPlacementPolicy = "free" | "warn" | "strict";

export interface ImageSessionNotice {
  code: "image-outside-frame";
  level: "warning" | "error";
  message: string;
  imageIds: string[];
  policy: ImageSessionPlacementPolicy;
}

interface RenderImageState {
  src: string;
  left: number;
  top: number;
  scale: number;
  angle: number;
  opacity: number;
}

interface FrameVisualConfig {
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "hidden";
  dashLength: number;
  innerBackground: string;
  outerBackground: string;
}

interface ImageControlVisualConfig {
  cornerSize: number;
  touchCornerSize: number;
  cornerStyle: "rect" | "circle";
  cornerColor: string;
  cornerStrokeColor: string;
  transparentCorners: boolean;
  borderColor: string;
  borderScaleFactor: number;
  padding: number;
}

interface ImageSessionOverlayState {
  layout: SceneLayoutSnapshot;
  geometry: SceneGeometrySnapshot;
}

export interface UpsertImageOptions {
  id?: string;
  mode?: "replace" | "add";
  addOptions?: Partial<ImageItem>;
  operation?: ImageOperation;
}

export interface UpdateImageOptions {
  target?: "auto" | "config" | "working";
}

export interface ExportCroppedImageOptions {
  multiplier?: number;
  format?: "png" | "jpeg";
}

export interface ImageExportUserCroppedImageOptions
  extends ExportCroppedImageOptions {
  imageIds?: string[];
}

export interface ImageExportUserCroppedImageResult {
  url: string;
  width: number;
  height: number;
  multiplier: number;
  format: "png" | "jpeg";
  imageIds: string[];
}

type ImageControlCapability = "rotate" | "scale" | "flipX" | "flipY";

interface ImageControlDescriptor {
  key: string;
  capability: ImageControlCapability;
}

type SnapAxis = "x" | "y";
type SnapLineKind = "edge" | "center";
type SnapLineId =
  | "frame-left"
  | "frame-center-x"
  | "frame-right"
  | "frame-top"
  | "frame-center-y"
  | "frame-bottom";

export interface ImageToolOptions extends ImagePlacementCapabilityOptions {
  id?: string;
  contributeTool?: boolean;
  contributeCommands?: boolean;
  contributeConfigurations?: boolean;
  toolName?: string;
}

interface SnapMatch {
  axis: SnapAxis;
  lineId: SnapLineId;
  kind: SnapLineKind;
  lineScene: number;
  deltaScene: number;
}

interface SnapCandidate {
  axis: SnapAxis;
  lineId: SnapLineId;
  kind: SnapLineKind;
  lineScene: number;
  deltaScene: number;
}

const IMAGE_DEFAULT_CONTROL_CAPABILITIES: ImageControlCapability[] = [
  "rotate",
  "scale",
];

const IMAGE_OBJECT_STACK = 660;
const IMAGE_OBJECT_ACTIVE_STACK = 760;
const IMAGE_OVERLAY_STACK = 800;
const IMAGE_MOVE_SNAP_THRESHOLD_PX = 6;
const IMAGE_CONTROL_DESCRIPTORS: ImageControlDescriptor[] = [
  {
    key: "tl",
    capability: "rotate",
  },
  {
    key: "br",
    capability: "scale",
  },
];

/**
 * @deprecated Compatibility wrapper for ImagePlacementCapability. Use
 * createImagePlacementCapability().
 */
export class ImageTool implements ExtensionDefinition {
  id: string;

  metadata = {
    name: "ImageTool",
  };
  activation = {
    requiresServices: [CANVAS_SERVICE, CONFIGURATION_SERVICE],
  };

  private items: ImageItem[] = [];
  private workingItems: ImageItem[] = [];
  private hasWorkingChanges = false;
  private loadResolvers: Map<string, () => void> = new Map();
  private sourceSizeCache = createSourceSizeCache((src) =>
    this.loadImageSize(src),
  );
  private canvasService?: CanvasService;
  private exportService?: SceneExportService;
  private context?: ExtensionContext;
  private isUpdatingConfig = false;
  private isToolActive = false;
  private isImageSelectionActive = false;
  private focusedImageId: string | null = null;
  private renderSeq = 0;
  private dirtyTrackerDisposable?: { dispose(): void };
  private cropShapeHatchPattern?: RenderPatternSpec;
  private cropShapeHatchPatternColor?: string;
  private cropShapeHatchPatternKey?: string;
  private imageSpecs: RenderObjectSpec[] = [];
  private overlaySpecs: RenderObjectSpec[] = [];
  private activeSnapX: SnapMatch | null = null;
  private activeSnapY: SnapMatch | null = null;
  private movingImageId: string | null = null;
  private sessionNotice: ImageSessionNotice | null = null;
  private hasRenderedSnapGuides = false;
  private canvasObjectMovingHandler?: (e: any) => void;
  private canvasMouseUpHandler?: (e: any) => void;
  private canvasBeforeRenderHandler?: () => void;
  private canvasAfterRenderHandler?: () => void;
  private renderProducerDisposable?: { dispose: () => void };
  private readonly subscriptions = new SubscriptionBag();
  private readonly capabilityId: string;
  private readonly configNamespace: string;
  private readonly imageLayerId: string;
  private readonly overlayLayerId: string;
  private readonly contributeLegacyCommands: boolean;
  private readonly contributeConfigDefinitions: boolean;
  private imageControlsByCapabilityKey: Map<string, Record<string, unknown>> =
    new Map();

  constructor(options: ImageToolOptions = {}) {
    this.id = normalizeImagePlacementLayerId(options.id, "pooder.kit.image");
    this.capabilityId = options.capabilityId || IMAGE_PLACEMENT_CAPABILITY_ID;
    this.configNamespace = normalizeImagePlacementConfigNamespace(
      options.configNamespace,
    );
    this.imageLayerId = normalizeImagePlacementLayerId(
      options.layers?.imageLayerId,
      KIT_LEGACY_LAYER_PRESET.imageObject,
    );
    this.overlayLayerId = normalizeImagePlacementLayerId(
      options.layers?.overlayLayerId,
      KIT_LEGACY_LAYER_PRESET.imageOverlay,
    );
    this.contributeLegacyCommands = options.contributeCommands !== false;
    this.contributeConfigDefinitions =
      options.contributeConfigurations !== false;
  }

  activate(context: ExtensionContext) {
    this.subscriptions.disposeAll();
    this.context = context;
    this.canvasService = context.services.getOrThrow<CanvasService>(
      CANVAS_SERVICE,
    );
    this.exportService = context.services.get<SceneExportService>(
      SCENE_EXPORT_SERVICE,
    );
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = this.canvasService.registerRenderProducer(
      this.id,
      () => ({
        passes: [
          {
            id: this.imageLayerId,
            stack: this.isToolActive
              ? IMAGE_OBJECT_ACTIVE_STACK
              : IMAGE_OBJECT_STACK,
            order: 0,
            visibility: {
              op: "not",
              expr: {
                op: "sessionActive",
                toolId: "pooder.kit.white-ink",
              },
            },
            objects: this.imageSpecs,
          },
          {
            id: this.overlayLayerId,
            stack: IMAGE_OVERLAY_STACK,
            order: 0,
            visibility: {
              op: "not",
              expr: {
                op: "sessionActive",
                toolId: "pooder.kit.white-ink",
              },
            },
            objects: this.overlaySpecs,
          },
        ],
      }),
      { priority: 300 },
    );
    this.bindCanvasInteractionHandlers();

    this.subscriptions.on(
      context.eventBus,
      "tool:activated",
      this.onToolActivated,
    );
    this.subscriptions.on(
      context.eventBus,
      "object:modified",
      this.onObjectModified,
    );
    this.subscriptions.on(
      context.eventBus,
      "selection:created",
      this.onSelectionChanged,
    );
    this.subscriptions.on(
      context.eventBus,
      "selection:updated",
      this.onSelectionChanged,
    );
    this.subscriptions.on(
      context.eventBus,
      "selection:cleared",
      this.onSelectionCleared,
    );
    this.subscriptions.on(
      context.eventBus,
      "scene:layout:change",
      this.onSceneLayoutChanged,
    );
    this.subscriptions.on(
      context.eventBus,
      "canvas:resized",
      this.onSceneLayoutChanged,
    );
    this.subscriptions.on(
      context.eventBus,
      "scene:geometry:change",
      this.onSceneGeometryChanged,
    );

    const configService = context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    this.applyCommittedItems(
      configService.get(this.getConfigKey("items"), []) || [],
    );

    this.subscriptions.onConfigChange(
      configService,
      (e: { key: string; value: any }) => {
        if (this.isUpdatingConfig) return;

        if (e.key === this.getConfigKey("items")) {
          this.applyCommittedItems(e.value || []);
          this.updateImages();
          return;
        }

        if (
          e.key.startsWith("size.") ||
          e.key.startsWith(this.getConfigKey("frame.")) ||
          e.key.startsWith(this.getConfigKey("session.")) ||
          e.key.startsWith(this.getConfigKey("control."))
        ) {
          if (e.key === this.getConfigKey("session.placementPolicy")) {
            this.clearSessionNotice();
          }
          this.updateImages();
        }
      },
    );

    this.updateImages();
  }

  deactivate(context: ExtensionContext) {
    this.subscriptions.disposeAll();
    this.dirtyTrackerDisposable?.dispose();
    this.dirtyTrackerDisposable = undefined;
    this.cropShapeHatchPattern = undefined;
    this.cropShapeHatchPatternColor = undefined;
    this.cropShapeHatchPatternKey = undefined;
    this.sourceSizeCache.clear();
    this.imageSpecs = [];
    this.overlaySpecs = [];
    this.exportService = undefined;
    this.endMoveSnapInteraction();
    this.unbindCanvasInteractionHandlers();

    this.clearRenderedImages();
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = undefined;
    this.emitImageStateChange();
    if (this.canvasService) {
      void this.canvasService.flushRenderFromProducers();
      this.canvasService = undefined;
    }
    this.context = undefined;
  }

  private onToolActivated = (event: {
    id: string | null;
    previous?: string | null;
    reason?: string;
  }) => {
    const before = this.isToolActive;
    this.syncToolActiveFromWorkbench(event.id);
    if (!this.isToolActive) {
      this.endMoveSnapInteraction();
      this.setImageFocus(null, {
        syncCanvasSelection: true,
        skipRender: true,
      });
    }
    this.debug("tool:activated", {
      id: event.id,
      previous: event.previous,
      reason: event.reason,
      before,
      isToolActive: this.isToolActive,
      focusedImageId: this.focusedImageId,
    });
    if (!this.isToolActive && this.isDebugEnabled()) {
      console.trace("[ImageTool] tool deactivated trace");
    }
    this.updateImages();
  };

  private onSelectionChanged = (e: any) => {
    const list: any[] = [];
    if (Array.isArray(e?.selected)) {
      list.push(...e.selected);
    }
    if (Array.isArray(e?.target?._objects)) {
      list.push(...e.target._objects);
    }
    if (e?.target && !Array.isArray(e?.target?._objects)) {
      list.push(e.target);
    }

    const selectedImage = list.find(
      (obj: any) => obj?.data?.layerId === this.imageLayerId,
    );
    this.isImageSelectionActive = !!selectedImage;
    if (selectedImage?.data?.id) {
      this.focusedImageId = selectedImage.data.id;
    } else if (list.length > 0) {
      this.focusedImageId = null;
    }
    this.debug("selection:changed", {
      listSize: list.length,
      isImageSelectionActive: this.isImageSelectionActive,
      focusedImageId: this.focusedImageId,
    });
    this.updateImages();
  };

  private onSelectionCleared = () => {
    this.endMoveSnapInteraction();
    this.setImageFocus(null, {
      syncCanvasSelection: false,
      skipRender: true,
    });
    this.debug("selection:cleared applied");
    this.updateImages();
  };

  private onSceneLayoutChanged = () => {
    this.canvasService?.requestRenderAll();
    this.updateImages();
  };

  private onSceneGeometryChanged = () => {
    this.updateImages();
  };

  private bindCanvasInteractionHandlers() {
    if (!this.canvasService || this.canvasObjectMovingHandler) return;
    this.canvasMouseUpHandler = (e: any) => {
      const target = this.getActiveImageTarget(e?.target);
      if (
        target &&
        typeof target?.data?.id === "string" &&
        target.data.id === this.movingImageId
      ) {
        this.applyMoveSnapToTarget(target);
      }
      this.endMoveSnapInteraction();
    };
    this.canvasObjectMovingHandler = (e: any) => {
      this.handleCanvasObjectMoving(e);
    };
    this.canvasBeforeRenderHandler = () => {
      this.handleCanvasBeforeRender();
    };
    this.canvasAfterRenderHandler = () => {
      this.handleCanvasAfterRender();
    };
    this.canvasService.onCanvasEvent("mouse:up", this.canvasMouseUpHandler);
    this.canvasService.onCanvasEvent(
      "object:moving",
      this.canvasObjectMovingHandler,
    );
    this.canvasService.onCanvasEvent(
      "before:render",
      this.canvasBeforeRenderHandler,
    );
    this.canvasService.onCanvasEvent("after:render", this.canvasAfterRenderHandler);
  }

  private unbindCanvasInteractionHandlers() {
    if (!this.canvasService) return;
    if (this.canvasMouseUpHandler) {
      this.canvasService.offCanvasEvent("mouse:up", this.canvasMouseUpHandler);
    }
    if (this.canvasObjectMovingHandler) {
      this.canvasService.offCanvasEvent(
        "object:moving",
        this.canvasObjectMovingHandler,
      );
    }
    if (this.canvasBeforeRenderHandler) {
      this.canvasService.offCanvasEvent(
        "before:render",
        this.canvasBeforeRenderHandler,
      );
    }
    if (this.canvasAfterRenderHandler) {
      this.canvasService.offCanvasEvent(
        "after:render",
        this.canvasAfterRenderHandler,
      );
    }
    this.canvasMouseUpHandler = undefined;
    this.canvasObjectMovingHandler = undefined;
    this.canvasBeforeRenderHandler = undefined;
    this.canvasAfterRenderHandler = undefined;
  }

  private getActiveImageTarget(target: any): any | null {
    if (!this.isToolActive) return null;
    if (!target) return null;
    if (target?.data?.layerId !== this.imageLayerId) return null;
    if (typeof target?.data?.id !== "string") return null;
    return target;
  }

  private getTargetBoundsScene(target: any): FrameRect | null {
    if (!this.canvasService || !target) return null;
    const rawBounds =
      typeof target.getBoundingRect === "function"
        ? target.getBoundingRect()
        : {
            left: Number(target.left || 0),
            top: Number(target.top || 0),
            width: Number(target.width || 0),
            height: Number(target.height || 0),
          };
    return this.canvasService.toSceneRect({
      left: Number(rawBounds.left || 0),
      top: Number(rawBounds.top || 0),
      width: Number(rawBounds.width || 0),
      height: Number(rawBounds.height || 0),
    });
  }

  private getSnapThresholdScene(px: number): number {
    if (!this.canvasService) return px;
    return this.canvasService.toSceneLength(px);
  }

  private pickSnapMatch(candidates: SnapCandidate[]): SnapMatch | null {
    if (!candidates.length) return null;

    const snapThreshold = this.getSnapThresholdScene(
      IMAGE_MOVE_SNAP_THRESHOLD_PX,
    );

    let best: SnapCandidate | null = null;
    candidates.forEach((candidate) => {
      if (Math.abs(candidate.deltaScene) > snapThreshold) return;
      if (!best || Math.abs(candidate.deltaScene) < Math.abs(best.deltaScene)) {
        best = candidate;
      }
    });
    return best;
  }

  private computeMoveSnapMatches(
    bounds: FrameRect | null,
    frame: FrameRect,
  ): { x: SnapMatch | null; y: SnapMatch | null } {
    if (!bounds || frame.width <= 0 || frame.height <= 0) {
      return { x: null, y: null };
    }

    const xCandidates: SnapCandidate[] = [
      {
        axis: "x",
        lineId: "frame-left",
        kind: "edge",
        lineScene: frame.left,
        deltaScene: frame.left - bounds.left,
      },
      {
        axis: "x",
        lineId: "frame-center-x",
        kind: "center",
        lineScene: frame.left + frame.width / 2,
        deltaScene:
          frame.left + frame.width / 2 - (bounds.left + bounds.width / 2),
      },
      {
        axis: "x",
        lineId: "frame-right",
        kind: "edge",
        lineScene: frame.left + frame.width,
        deltaScene: frame.left + frame.width - (bounds.left + bounds.width),
      },
    ];
    const yCandidates: SnapCandidate[] = [
      {
        axis: "y",
        lineId: "frame-top",
        kind: "edge",
        lineScene: frame.top,
        deltaScene: frame.top - bounds.top,
      },
      {
        axis: "y",
        lineId: "frame-center-y",
        kind: "center",
        lineScene: frame.top + frame.height / 2,
        deltaScene:
          frame.top + frame.height / 2 - (bounds.top + bounds.height / 2),
      },
      {
        axis: "y",
        lineId: "frame-bottom",
        kind: "edge",
        lineScene: frame.top + frame.height,
        deltaScene: frame.top + frame.height - (bounds.top + bounds.height),
      },
    ];

    return {
      x: this.pickSnapMatch(xCandidates),
      y: this.pickSnapMatch(yCandidates),
    };
  }

  private areSnapMatchesEqual(
    a: SnapMatch | null,
    b: SnapMatch | null,
  ): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.lineId === b.lineId && a.axis === b.axis && a.kind === b.kind;
  }

  private updateSnapMatchState(
    nextX: SnapMatch | null,
    nextY: SnapMatch | null,
  ) {
    const changed =
      !this.areSnapMatchesEqual(this.activeSnapX, nextX) ||
      !this.areSnapMatchesEqual(this.activeSnapY, nextY);
    this.activeSnapX = nextX;
    this.activeSnapY = nextY;
    if (changed) {
      this.canvasService?.requestRenderAll();
    }
  }

  private clearSnapGuideContext() {
    this.canvasService?.clearTopContext();
  }

  private clearSnapPreview() {
    const shouldClearCanvas =
      this.hasRenderedSnapGuides || !!this.activeSnapX || !!this.activeSnapY;
    this.activeSnapX = null;
    this.activeSnapY = null;
    this.hasRenderedSnapGuides = false;
    if (shouldClearCanvas) {
      this.clearSnapGuideContext();
    }
    this.canvasService?.requestRenderAll();
  }

  private endMoveSnapInteraction() {
    this.movingImageId = null;
    this.clearSnapPreview();
  }

  private applyMoveSnapToTarget(target: any): {
    x: SnapMatch | null;
    y: SnapMatch | null;
  } {
    if (!this.canvasService) {
      return { x: null, y: null };
    }
    const frame = this.getSurfaceFrameRect();
    if (frame.width <= 0 || frame.height <= 0) {
      return { x: null, y: null };
    }
    const bounds = this.getTargetBoundsScene(target);
    const matches = this.computeMoveSnapMatches(bounds, frame);
    const deltaScreenX = this.canvasService.toScreenLength(
      matches.x?.deltaScene ?? 0,
    );
    const deltaScreenY = this.canvasService.toScreenLength(
      matches.y?.deltaScene ?? 0,
    );
    if (deltaScreenX || deltaScreenY) {
      target.set({
        left: Number(target.left || 0) + deltaScreenX,
        top: Number(target.top || 0) + deltaScreenY,
      });
      target.setCoords();
    }
    return matches;
  }

  private handleCanvasBeforeRender() {
    if (!this.canvasService) return;
    if (!this.hasRenderedSnapGuides && !this.activeSnapX && !this.activeSnapY) {
      return;
    }
    this.canvasService.clearTopContext();
    this.hasRenderedSnapGuides = false;
  }

  private drawSnapGuideLine(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    if (!this.canvasService) return;
    const ctx = this.canvasService.getTopContext();
    if (!ctx) return;
    const color =
      this.getConfig<string>(this.getConfigKey("control.borderColor"), "#1677ff") ||
      "#1677ff";
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  private handleCanvasAfterRender() {
    if (!this.canvasService || !this.isImageEditingVisible()) {
      return;
    }

    const frame = this.getSurfaceFrameRect();
    if (frame.width <= 0 || frame.height <= 0) {
      return;
    }
    const frameScreen = this.getSurfaceFrameRectScreen(frame);
    let drew = false;

    if (this.activeSnapX) {
      const x = this.canvasService.toScreenPoint({
        x: this.activeSnapX.lineScene,
        y: frame.top,
      }).x;
      this.drawSnapGuideLine(
        { x, y: frameScreen.top },
        { x, y: frameScreen.top + frameScreen.height },
      );
      drew = true;
    }

    if (this.activeSnapY) {
      const y = this.canvasService.toScreenPoint({
        x: frame.left,
        y: this.activeSnapY.lineScene,
      }).y;
      this.drawSnapGuideLine(
        { x: frameScreen.left, y },
        { x: frameScreen.left + frameScreen.width, y },
      );
      drew = true;
    }
    this.hasRenderedSnapGuides = drew;
  }

  private handleCanvasObjectMoving(e: any) {
    const target = this.getActiveImageTarget(e?.target);
    if (!target || !this.canvasService) return;
    this.movingImageId =
      typeof target?.data?.id === "string" ? target.data.id : null;

    const frame = this.getSurfaceFrameRect();
    if (frame.width <= 0 || frame.height <= 0) {
      this.endMoveSnapInteraction();
      return;
    }
    const rawBounds = this.getTargetBoundsScene(target);
    const matches = this.computeMoveSnapMatches(rawBounds, frame);
    this.updateSnapMatchState(matches.x, matches.y);
  }

  private syncToolActiveFromWorkbench(fallbackId?: string | null) {
    const wb = this.context?.services.get<WorkbenchService>(WORKBENCH_SERVICE);
    const activeId = wb?.activeToolId;
    if (typeof activeId === "string") {
      this.isToolActive = activeId === this.id;
      return;
    }
    if (fallbackId !== undefined) {
      this.isToolActive = fallbackId === this.id;
      return;
    }
    if (activeId === null) {
      return;
    }
    this.isToolActive = fallbackId === this.id;
  }

  private isImageEditingVisible(): boolean {
    return (
      this.isToolActive || this.isImageSelectionActive || !!this.focusedImageId
    );
  }

  private getEnabledImageControlCapabilities(): ImageControlCapability[] {
    return IMAGE_DEFAULT_CONTROL_CAPABILITIES;
  }

  private getImageControls(
    capabilities: ImageControlCapability[],
  ): Record<string, unknown> {
    const normalized = [...new Set(capabilities)].sort();
    const cacheKey = normalized.join("|");
    const cached = this.imageControlsByCapabilityKey.get(cacheKey);
    if (cached) {
      return cached;
    }

    const enabled = new Set(normalized);
    const controls: Record<string, unknown> = {};
    IMAGE_CONTROL_DESCRIPTORS.forEach((descriptor) => {
      if (!enabled.has(descriptor.capability)) return;
      controls[descriptor.key] = { actionName: descriptor.capability };
    });

    this.imageControlsByCapabilityKey.set(cacheKey, controls);
    return controls;
  }

  private getImageControlVisualConfig(): ImageControlVisualConfig {
    const cornerSizeRaw = Number(
      this.getConfig<number>(this.getConfigKey("control.cornerSize"), 14) ??
        14,
    );
    const touchCornerSizeRaw = Number(
      this.getConfig<number>(
        this.getConfigKey("control.touchCornerSize"),
        24,
      ) ?? 24,
    );
    const borderScaleFactorRaw = Number(
      this.getConfig<number>(
        this.getConfigKey("control.borderScaleFactor"),
        1.5,
      ) ?? 1.5,
    );
    const paddingRaw = Number(
      this.getConfig<number>(this.getConfigKey("control.padding"), 0) ?? 0,
    );
    const cornerStyleRaw = (this.getConfig<string>(
      this.getConfigKey("control.cornerStyle"),
      "circle",
    ) || "circle") as string;
    const cornerStyle: "rect" | "circle" =
      cornerStyleRaw === "rect" ? "rect" : "circle";

    return {
      cornerSize: Number.isFinite(cornerSizeRaw)
        ? Math.max(4, Math.min(64, cornerSizeRaw))
        : 14,
      touchCornerSize: Number.isFinite(touchCornerSizeRaw)
        ? Math.max(8, Math.min(96, touchCornerSizeRaw))
        : 24,
      cornerStyle,
      cornerColor:
        this.getConfig<string>(
          this.getConfigKey("control.cornerColor"),
          "#ffffff",
        ) || "#ffffff",
      cornerStrokeColor:
        this.getConfig<string>(
          this.getConfigKey("control.cornerStrokeColor"),
          "#1677ff",
        ) || "#1677ff",
      transparentCorners: !!this.getConfig<boolean>(
        this.getConfigKey("control.transparentCorners"),
        false,
      ),
      borderColor:
        this.getConfig<string>(
          this.getConfigKey("control.borderColor"),
          "#1677ff",
        ) || "#1677ff",
      borderScaleFactor: Number.isFinite(borderScaleFactorRaw)
        ? Math.max(0.5, Math.min(8, borderScaleFactorRaw))
        : 1.5,
      padding: Number.isFinite(paddingRaw)
        ? Math.max(0, Math.min(64, paddingRaw))
        : 0,
    };
  }

  private applyImageObjectInteractionState(obj: any) {
    if (!obj) return;
    const visible = this.isImageEditingVisible();
    const visual = this.getImageControlVisualConfig();
    obj.set({
      selectable: visible,
      evented: visible,
      hasControls: visible,
      hasBorders: visible,
      lockScalingFlip: true,
      cornerSize: visual.cornerSize,
      touchCornerSize: visual.touchCornerSize,
      cornerStyle: visual.cornerStyle,
      cornerColor: visual.cornerColor,
      cornerStrokeColor: visual.cornerStrokeColor,
      transparentCorners: visual.transparentCorners,
      borderColor: visual.borderColor,
      borderScaleFactor: visual.borderScaleFactor,
      padding: visual.padding,
    });
    obj.setCoords?.();
  }

  private refreshImageObjectInteractionState() {
    this.getImageObjects().forEach((obj) =>
      this.applyImageObjectInteractionState(obj),
    );
  }

  private isDebugEnabled(): boolean {
    return !!this.getConfig<boolean>(this.getConfigKey("debug"), false);
  }

  private debug(message: string, payload?: any) {
    if (!this.isDebugEnabled()) return;
    if (payload === undefined) {
      console.log(`[ImageTool] ${message}`);
      return;
    }
    console.log(`[ImageTool] ${message}`, payload);
  }

  contribute(): ExtensionContributions {
    const contributions: ExtensionContributions = {
      capabilities: [
        createImagePlacementCapabilityDefinition(
          this.getImagePlacementFacade(),
          {
            capabilityId: this.capabilityId,
            configNamespace: this.configNamespace,
            layers: {
              imageLayerId: this.imageLayerId,
              overlayLayerId: this.overlayLayerId,
            },
          },
        ),
      ],
    };

    if (this.contributeConfigDefinitions) {
      contributions.configurations = createImageConfigurations(
        this.configNamespace,
      );
    }

    if (this.contributeLegacyCommands) {
      contributions.commands = createImageCommands(this);
    }

    return contributions;
  }

  private getImagePlacementFacade(): ImagePlacementCapabilityApi {
    return {
      addImage: (url, options, operation) =>
        this.addImageEntry(url, options, operation),
      applyImageOperation: (id, operation, options) =>
        this.applyImageOperation(id, operation, options),
      completeSession: () => this.completeImageSession(),
      exportUserCroppedImage: (options) =>
        this.exportUserCroppedImage(options),
      focusImage: (id, options) => this.setImageFocus(id, options),
      getViewState: () => this.getImageViewState(),
      resetSession: () => this.resetImageSession(),
      setImageTransform: (id, updates, options) =>
        this.setImageTransform(id, updates, options),
      upsertImage: (url, options) => this.upsertImageEntry(url, options),
      validateSession: () => this.validateImageSession(),
    };
  }

  private getConfigKey(path: string): string {
    return `${this.configNamespace}.${path}`;
  }

  private normalizeItem(item: ImageItem): ImageItem {
    const url = typeof item.url === "string" ? item.url : "";
    const sourceUrl =
      typeof item.sourceUrl === "string" && item.sourceUrl.length > 0
        ? item.sourceUrl
        : url;
    const committedUrl =
      typeof item.committedUrl === "string" && item.committedUrl.length > 0
        ? item.committedUrl
        : undefined;

    return {
      ...item,
      url: url || sourceUrl,
      sourceUrl,
      committedUrl,
      opacity: Number.isFinite(item.opacity as any) ? item.opacity : 1,
      scale: Number.isFinite(item.scale as any) ? item.scale : 1,
      angle: Number.isFinite(item.angle as any) ? item.angle : 0,
      left: Number.isFinite(item.left as any) ? item.left : 0.5,
      top: Number.isFinite(item.top as any) ? item.top : 0.5,
    };
  }

  private normalizeItems(items: ImageItem[]): ImageItem[] {
    return (items || []).map((item) => this.normalizeItem(item));
  }

  private cloneItems(items: ImageItem[]): ImageItem[] {
    return this.normalizeItems((items || []).map((i) => ({ ...i })));
  }

  private getViewItems(): ImageItem[] {
    return this.isToolActive ? this.workingItems : this.items;
  }

  private getPlacementPolicy(): ImageSessionPlacementPolicy {
    const policy = this.getConfig<ImageSessionPlacementPolicy>(
      this.getConfigKey("session.placementPolicy"),
      "free",
    );
    return policy === "warn" || policy === "strict" ? policy : "free";
  }

  private areSessionNoticesEqual(
    a: ImageSessionNotice | null,
    b: ImageSessionNotice | null,
  ): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return (
      a.code === b.code &&
      a.level === b.level &&
      a.message === b.message &&
      a.policy === b.policy &&
      JSON.stringify(a.imageIds) === JSON.stringify(b.imageIds)
    );
  }

  private setSessionNotice(
    notice: ImageSessionNotice | null,
    options: { emit?: boolean } = {},
  ) {
    if (this.areSessionNoticesEqual(this.sessionNotice, notice)) {
      return;
    }
    this.sessionNotice = notice;
    if (options.emit !== false) {
      this.context?.eventBus.emit("image:session:notice", this.sessionNotice);
      this.emitImageStateChange();
    }
  }

  private clearSessionNotice(options: { emit?: boolean } = {}) {
    this.setSessionNotice(null, options);
  }

  private getImageViewState(): ImageViewState {
    this.syncToolActiveFromWorkbench();
    const items = this.cloneItems(this.getViewItems());
    const focusedItem =
      this.focusedImageId == null
        ? null
        : items.find((item) => item.id === this.focusedImageId) || null;

    return {
      items,
      hasAnyImage: items.length > 0,
      focusedId: this.focusedImageId,
      focusedItem,
      isToolActive: this.isToolActive,
      isImageSelectionActive: this.isImageSelectionActive,
      hasWorkingChanges: this.hasWorkingChanges,
      source: this.isToolActive ? "working" : "committed",
      placementPolicy: this.getPlacementPolicy(),
      sessionNotice: this.sessionNotice,
    };
  }

  private emitImageStateChange() {
    this.context?.eventBus.emit("image:state:change", this.getImageViewState());
  }

  private emitWorkingChange(changedId: string | null = null) {
    this.context?.eventBus.emit("image:working:change", {
      changedId,
      items: this.cloneItems(this.workingItems),
    });
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 9);
  }

  private hasImageItem(id: string): boolean {
    return (
      this.items.some((item) => item.id === id) ||
      this.workingItems.some((item) => item.id === id)
    );
  }

  private setImageFocus(
    id: string | null,
    options: { syncCanvasSelection?: boolean; skipRender?: boolean } = {},
  ) {
    const syncCanvasSelection = options.syncCanvasSelection !== false;

    if (id && !this.hasImageItem(id)) {
      return { ok: false, reason: "image-not-found" as const };
    }

    this.focusedImageId = id;
    this.isImageSelectionActive = !!id;

    if (syncCanvasSelection && this.canvasService) {
      if (!id) {
        this.canvasService.discardActiveObject();
      } else {
        const obj = this.getImageObject(id);
        if (obj) {
          this.applyImageObjectInteractionState(obj);
          this.canvasService.setActiveObject(obj);
        }
      }
      this.canvasService.requestRenderAll();
    }

    if (!options.skipRender) {
      this.updateImages();
    } else {
      this.emitImageStateChange();
    }

    return { ok: true, id };
  }

  private async addImageEntry(
    url: string,
    options?: Partial<ImageItem>,
    operation?: ImageOperation,
  ): Promise<string> {
    this.syncToolActiveFromWorkbench();
    this.clearSessionNotice({ emit: false });
    const id = this.generateId();
    const newItem = this.normalizeItem({
      id,
      url,
      opacity: 1,
      ...options,
    } as ImageItem);

    const waitLoaded = this.waitImageLoaded(id, true);
    if (this.isToolActive) {
      this.workingItems = this.cloneItems([...this.workingItems, newItem]);
      this.hasWorkingChanges = true;
      this.updateImages();
      this.emitWorkingChange(id);
    } else {
      this.updateConfig([...this.items, newItem]);
    }
    const loaded = await waitLoaded;
    if (loaded && operation) {
      await this.applyImageOperation(id, operation, {
        target: this.isToolActive ? "working" : "config",
      });
    }
    if (loaded) {
      this.setImageFocus(id);
    }
    return id;
  }

  private async upsertImageEntry(
    url: string,
    options: UpsertImageOptions = {},
  ): Promise<{ id: string; mode: "replace" | "add" }> {
    this.syncToolActiveFromWorkbench();
    const mode = options.mode || (options.id ? "replace" : "add");
    if (mode === "replace") {
      if (!options.id) {
        throw new Error("replace-target-id-required");
      }
      const targetId = options.id;
      if (!this.hasImageItem(targetId)) {
        throw new Error("replace-target-not-found");
      }
      if (this.isToolActive) {
        const current =
          this.workingItems.find((item) => item.id === targetId) ||
          this.items.find((item) => item.id === targetId);
        this.purgeSourceSizeCacheForItem(current);
        this.updateImageInWorking(targetId, {
          url,
          sourceUrl: url,
          committedUrl: undefined,
        });
      } else {
        await this.updateImageInConfig(targetId, { url });
      }
      const loaded = await this.waitImageLoaded(targetId, true);
      if (loaded && options.operation) {
        await this.applyImageOperation(targetId, options.operation, {
          target: this.isToolActive ? "working" : "config",
        });
      }
      if (loaded) {
        this.setImageFocus(targetId);
      }
      return { id: targetId, mode: "replace" };
    }

    const id = await this.addImageEntry(
      url,
      options.addOptions,
      options.operation,
    );
    return { id, mode: "add" };
  }

  private async updateImage(
    id: string,
    updates: Partial<ImageItem>,
    options: UpdateImageOptions = {},
  ) {
    this.syncToolActiveFromWorkbench();
    const target = options.target || "auto";

    if (target === "working" || (target === "auto" && this.isToolActive)) {
      this.updateImageInWorking(id, updates);
      return;
    }

    await this.updateImageInConfig(id, updates);
  }

  private getConfig<T>(key: string, fallback?: T): T | undefined {
    if (!this.context) return fallback;
    const configService = this.context.services.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    if (!configService) return fallback;
    return (configService.get(key, fallback) as T) ?? fallback;
  }

  private applyCommittedItems(nextItems: ImageItem[]) {
    const session = {
      committed: this.items,
      working: this.workingItems,
      hasWorkingChanges: this.hasWorkingChanges,
    };
    applyCommittedSnapshot(session, this.normalizeItems(nextItems), {
      clone: (items) => this.cloneItems(items),
      toolActive: this.isToolActive,
      preserveDirtyWorking: true,
    });
    this.items = session.committed;
    this.workingItems = session.working;
    this.hasWorkingChanges = session.hasWorkingChanges;
  }

  private updateConfig(newItems: ImageItem[], skipCanvasUpdate = false) {
    if (!this.context) return;
    this.clearSessionNotice({ emit: false });
    this.applyCommittedItems(newItems);
    runDeferredConfigUpdate(
      this,
      () => {
        const configService = this.context?.services.get<ConfigurationService>(
          CONFIGURATION_SERVICE,
        );
        configService?.update(this.getConfigKey("items"), this.items);

        if (!skipCanvasUpdate) {
          this.updateImages();
        }
      },
      50,
    );
  }

  private getSurfaceFrameRect(): FrameRect {
    const configService = this.context?.services.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    return resolveSurfaceFrameRect(this.canvasService, configService);
  }

  private getSurfaceFrameRectScreen(frame?: FrameRect): FrameRect {
    if (!this.canvasService) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
    return this.canvasService.toScreenRect(frame || this.getSurfaceFrameRect());
  }

  private getImageObjects(): any[] {
    if (!this.canvasService) return [];
    return this.canvasService.getObjects({ layerId: this.imageLayerId }) as any[];
  }

  private getOverlayObjects(): any[] {
    if (!this.canvasService) return [];
    return this.canvasService.getPassObjects(this.overlayLayerId) as any[];
  }

  private getImageObject(id: string): any | undefined {
    return this.getImageObjects().find((obj: any) => obj?.data?.id === id);
  }

  private clearRenderedImages() {
    if (!this.canvasService) return;
    this.imageSpecs = [];
    this.overlaySpecs = [];
    this.canvasService.requestRenderFromProducers();
  }

  private purgeSourceSizeCacheForItem(item?: ImageItem) {
    if (!item) return;
    const sources = [item.url, item.sourceUrl, item.committedUrl].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    sources.forEach((src) => this.sourceSizeCache.deleteSourceSize(src));
  }

  private rememberSourceSize(src: string, obj: any) {
    const width = Number(obj?.width || 0);
    const height = Number(obj?.height || 0);
    if (src && width > 0 && height > 0) {
      this.sourceSizeCache.rememberSourceSize(src, { width, height });
    }
  }

  private getSourceSize(src: string, obj?: any): SourceSize {
    const cached = src ? this.sourceSizeCache.getSourceSize(src) : undefined;
    if (cached) return cached;

    const width = Number(obj?.width || 0);
    const height = Number(obj?.height || 0);
    if (src && width > 0 && height > 0) {
      const size = { width, height };
      this.sourceSizeCache.rememberSourceSize(src, size);
      return size;
    }

    return { width: 1, height: 1 };
  }

  private async ensureSourceSize(src: string): Promise<SourceSize | null> {
    return this.sourceSizeCache.ensureImageSize(src);
  }

  private async loadImageSize(src: string): Promise<SourceSize | null> {
    return this.canvasService?.loadImageSize(src) ?? null;
  }

  private getCoverScale(frame: FrameRect, size: SourceSize): number {
    return getCoverScaleFromRect(frame, size);
  }

  private resolvePlacementState(item: ImageItem) {
    return {
      left: Number.isFinite(item.left as any) ? (item.left as number) : 0.5,
      top: Number.isFinite(item.top as any) ? (item.top as number) : 0.5,
      scale: Math.max(0.05, item.scale ?? 1),
      angle: Number.isFinite(item.angle as any) ? (item.angle as number) : 0,
    };
  }

  private async validatePlacementForItem(item: ImageItem): Promise<boolean> {
    const frame = this.getSurfaceFrameRect();
    if (!frame.width || !frame.height) {
      return true;
    }

    const src = item.sourceUrl || item.url;
    if (!src) {
      return true;
    }

    const source = await this.resolveImageSourceSize(item.id, src);
    if (!source) {
      return true;
    }

    return validateImagePlacement({
      frame,
      source,
      placement: this.resolvePlacementState(item),
    }).ok;
  }

  private async validateImageSession() {
    const policy = this.getPlacementPolicy();
    if (policy === "free") {
      this.clearSessionNotice();
      return { ok: true, policy };
    }

    const invalidImageIds: string[] = [];
    for (const item of this.workingItems) {
      const valid = await this.validatePlacementForItem(item);
      if (!valid) {
        invalidImageIds.push(item.id);
      }
    }

    if (!invalidImageIds.length) {
      this.clearSessionNotice();
      return { ok: true, policy };
    }

    const notice: ImageSessionNotice = {
      code: "image-outside-frame",
      level: policy === "strict" ? "error" : "warning",
      message:
        policy === "strict"
          ? "图片位置不能超出 frame，请调整后再提交。"
          : "图片位置已超出 frame，建议调整后再提交。",
      imageIds: invalidImageIds,
      policy,
    };
    this.setSessionNotice(notice);
    this.setImageFocus(invalidImageIds[0], {
      syncCanvasSelection: true,
      skipRender: true,
    });
    return {
      ok: policy !== "strict",
      reason: notice.code,
      message: notice.message,
      imageIds: notice.imageIds,
      policy: notice.policy,
    };
  }

  private getFrameVisualConfig(): FrameVisualConfig {
    const strokeStyleRaw = (this.getConfig<string>(
      this.getConfigKey("frame.strokeStyle"),
      "dashed",
    ) || "dashed") as string;
    const strokeStyle: "solid" | "dashed" | "hidden" =
      strokeStyleRaw === "dashed" || strokeStyleRaw === "hidden"
        ? strokeStyleRaw
        : "dashed";

    const strokeWidth = Number(
      this.getConfig<number>(this.getConfigKey("frame.strokeWidth"), 2) ?? 2,
    );
    const dashLength = Number(
      this.getConfig<number>(this.getConfigKey("frame.dashLength"), 8) ?? 8,
    );

    return {
      strokeColor:
        this.getConfig<string>(
          this.getConfigKey("frame.strokeColor"),
          "#808080",
        ) ||
        "#808080",
      strokeWidth: Number.isFinite(strokeWidth) ? Math.max(0, strokeWidth) : 2,
      strokeStyle,
      dashLength: Number.isFinite(dashLength) ? Math.max(1, dashLength) : 8,
      innerBackground:
        this.getConfig<string>(
          this.getConfigKey("frame.innerBackground"),
          "rgba(0,0,0,0)",
        ) || "rgba(0,0,0,0)",
      outerBackground:
        this.getConfig<string>(
          this.getConfigKey("frame.outerBackground"),
          "#f5f5f5",
        ) ||
        "#f5f5f5",
    };
  }

  private resolveSessionOverlayState(): ImageSessionOverlayState | null {
    if (!this.canvasService || !this.context) {
      return null;
    }
    const configService = this.context.services.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    if (!configService) {
      return null;
    }

    const layout = computeSceneLayout(
      this.canvasService,
      readSizeState(configService),
    );
    if (!layout) {
      this.debug("overlay:layout:missing");
      return null;
    }

    const geometry = buildSceneGeometry(configService, layout);
    this.debug("overlay:state:resolved", {
      cutRect: layout.cutRect,
      shape: geometry.shape,
      shapeStyle: geometry.shapeStyle,
      radius: geometry.radius,
      offset: geometry.offset,
    });
    return { layout, geometry };
  }

  private getCropShapeHatchPattern(
    color = "rgba(255, 0, 0, 0.6)",
  ): RenderPatternSpec | undefined {
    const cacheKey = color;
    if (
      this.cropShapeHatchPattern &&
      this.cropShapeHatchPatternColor === color &&
      this.cropShapeHatchPatternKey === cacheKey
    ) {
      return this.cropShapeHatchPattern;
    }

    const size = 16;
    const pattern: RenderPatternSpec = {
      type: "pattern",
      kind: "diagonalHatch",
      color,
      size,
      repetition: "repeat",
    };
    this.cropShapeHatchPattern = pattern;
    this.cropShapeHatchPatternColor = color;
    this.cropShapeHatchPatternKey = cacheKey;
    return pattern;
  }

  private resolveRenderImageState(item: ImageItem): RenderImageState {
    const active = this.isToolActive;
    const sourceUrl = item.sourceUrl || item.url;
    const committedUrl = item.committedUrl;

    if (!active && committedUrl) {
      return {
        src: committedUrl,
        left: 0.5,
        top: 0.5,
        scale: 1,
        angle: 0,
        opacity: item.opacity,
      };
    }

    return {
      src: sourceUrl || item.url,
      left: Number.isFinite(item.left as any) ? (item.left as number) : 0.5,
      top: Number.isFinite(item.top as any) ? (item.top as number) : 0.5,
      scale: Math.max(0.05, item.scale ?? 1),
      angle: Number.isFinite(item.angle as any) ? (item.angle as number) : 0,
      opacity: item.opacity,
    };
  }

  private computeCanvasProps(
    render: RenderImageState,
    size: SourceSize,
    frame: FrameRect,
  ) {
    const left = render.left;
    const top = render.top;
    const zoom = render.scale;
    const angle = render.angle;

    const centerX = frame.left + left * frame.width;
    const centerY = frame.top + top * frame.height;
    const scale = this.getCoverScale(frame, size) * zoom;

    return {
      left: centerX,
      top: centerY,
      scaleX: scale,
      scaleY: scale,
      angle,
      originX: "center" as const,
      originY: "center" as const,
      uniformScaling: true,
      lockScalingFlip: true,
      selectable: this.isImageEditingVisible(),
      evented: this.isImageEditingVisible(),
      hasControls: this.isImageEditingVisible(),
      hasBorders: this.isImageEditingVisible(),
      opacity: render.opacity,
    };
  }

  private toSceneObjectScale(value: number): number {
    if (!this.canvasService) return value;
    return value / this.canvasService.getSceneScale();
  }

  private getCurrentSrc(obj: any): string | undefined {
    if (!obj) return undefined;
    if (typeof obj.getSrc === "function") return obj.getSrc();
    return obj?._originalElement?.src;
  }

  private async buildImageSpecs(
    items: ImageItem[],
    frame: FrameRect,
  ): Promise<RenderObjectSpec[]> {
    const specs: RenderObjectSpec[] = [];

    for (const item of items) {
      const render = this.resolveRenderImageState(item);
      if (!render.src) continue;

      const ensured = await this.ensureSourceSize(render.src);
      const sourceSize = ensured || this.getSourceSize(render.src);
      const props = this.computeCanvasProps(render, sourceSize, frame);

      specs.push({
        id: item.id,
        type: "image",
        src: render.src,
        data: {
          id: item.id,
          layerId: this.imageLayerId,
          type: "image-item",
        },
        props,
      });
    }

    return specs;
  }

  private buildOverlaySpecs(
    overlayState: ImageSessionOverlayState | null,
  ): RenderObjectSpec[] {
    const visible = this.isImageEditingVisible();
    if (!visible || !overlayState || !this.canvasService) {
      this.debug("overlay:hidden", {
        visible,
        cutRect: overlayState?.layout.cutRect,
        isToolActive: this.isToolActive,
        isImageSelectionActive: this.isImageSelectionActive,
        focusedImageId: this.focusedImageId,
      });
      return [];
    }

    const viewport = this.canvasService.getScreenViewportRect();
    const visual = this.getFrameVisualConfig();
    const specs = buildImageSessionOverlaySpecs({
      viewport: {
        left: viewport.left,
        top: viewport.top,
        width: viewport.width,
        height: viewport.height,
      },
      layout: overlayState.layout,
      geometry: overlayState.geometry,
      visual,
      hatchPattern: this.getCropShapeHatchPattern(),
    });
    this.debug("overlay:built", {
      cutRect: overlayState.layout.cutRect,
      shape: overlayState.geometry.shape,
      overlayIds: specs.map((spec) => ({
        id: spec.id,
        zIndex: spec.data?.zIndex,
      })),
    });
    return specs;
  }

  private updateImages() {
    void this.updateImagesAsync();
  }

  private async updateImagesAsync() {
    if (!this.canvasService) return;
    this.syncToolActiveFromWorkbench();
    const seq = ++this.renderSeq;

    const renderItems = this.isToolActive ? this.workingItems : this.items;
    const frame = this.getSurfaceFrameRect();
    const desiredIds = new Set(renderItems.map((item) => item.id));
    if (this.focusedImageId && !desiredIds.has(this.focusedImageId)) {
      this.setImageFocus(null, {
        syncCanvasSelection: false,
        skipRender: true,
      });
    }

    const imageSpecs = await this.buildImageSpecs(renderItems, frame);
    if (seq !== this.renderSeq) return;

    const overlayState = this.resolveSessionOverlayState();

    this.imageSpecs = imageSpecs;
    this.overlaySpecs = this.buildOverlaySpecs(overlayState);
    await this.canvasService.flushRenderFromProducers();
    if (seq !== this.renderSeq) return;
    this.refreshImageObjectInteractionState();

    renderItems.forEach((item) => {
      if (!this.getImageObject(item.id)) return;
      const resolver = this.loadResolvers.get(item.id);
      if (!resolver) return;
      resolver();
      this.loadResolvers.delete(item.id);
    });

    if (this.focusedImageId && this.isToolActive) {
      this.setImageFocus(this.focusedImageId, {
        syncCanvasSelection: true,
        skipRender: true,
      });
    }

    const overlayCanvasCount = this.getOverlayObjects().length;

    this.debug("render:done", {
      seq,
      renderCount: renderItems.length,
      overlayCount: this.overlaySpecs.length,
      overlayCanvasCount,
      isToolActive: this.isToolActive,
      isImageSelectionActive: this.isImageSelectionActive,
      focusedImageId: this.focusedImageId,
    });
    this.emitImageStateChange();
    this.canvasService.requestRenderAll();
  }

  private clampNormalized(value: number): number {
    return Math.max(-1, Math.min(2, value));
  }

  private async setImageTransform(
    id: string,
    updates: ImageTransformUpdates,
    options: UpdateImageOptions = {},
  ) {
    const next: Partial<ImageItem> = {};

    if (Number.isFinite(updates.scale as number)) {
      next.scale = Math.max(0.05, Number(updates.scale));
    }
    if (Number.isFinite(updates.angle as number)) {
      next.angle = Number(updates.angle);
    }
    if (Number.isFinite(updates.left as number)) {
      next.left = this.clampNormalized(Number(updates.left));
    }
    if (Number.isFinite(updates.top as number)) {
      next.top = this.clampNormalized(Number(updates.top));
    }
    if (Number.isFinite(updates.opacity as number)) {
      next.opacity = Math.max(0, Math.min(1, Number(updates.opacity)));
    }

    if (!Object.keys(next).length) return;
    await this.updateImage(id, next, options);
  }

  private resetImageSession() {
    this.clearSessionNotice({ emit: false });
    this.workingItems = this.cloneItems(this.items);
    this.hasWorkingChanges = false;
    this.updateImages();
    this.emitWorkingChange();
  }

  private onObjectModified = (e: any) => {
    if (!this.isToolActive) return;
    const target = e?.target;
    const id = target?.data?.id;
    const layerId = target?.data?.layerId;
    if (typeof id !== "string" || layerId !== this.imageLayerId) return;
    if (this.movingImageId === id) {
      this.applyMoveSnapToTarget(target);
    }
    const frame = this.getSurfaceFrameRect();
    this.endMoveSnapInteraction();
    if (!frame.width || !frame.height) return;

    const center = target.getCenterPoint
      ? target.getCenterPoint()
      : { x: Number(target.left ?? 0), y: Number(target.top ?? 0) };
    const centerScene = this.canvasService
      ? this.canvasService.toScenePoint({ x: center.x, y: center.y })
      : { x: center.x, y: center.y };

    const objectScale = Number.isFinite(target?.scaleX) ? target.scaleX : 1;
    const objectScaleScene = this.toSceneObjectScale(objectScale || 1);

    const workingItem = this.workingItems.find((item) => item.id === id);
    const sourceKey = workingItem?.sourceUrl || workingItem?.url || "";
    const sourceSize = this.getSourceSize(sourceKey, target);
    const coverScale = this.getCoverScale(frame, sourceSize);

    const updates: Partial<ImageItem> = {
      left: this.clampNormalized((centerScene.x - frame.left) / frame.width),
      top: this.clampNormalized((centerScene.y - frame.top) / frame.height),
      angle: Number.isFinite(target.angle) ? target.angle : 0,
      scale: Math.max(0.05, objectScaleScene / coverScale),
    };

    this.focusedImageId = id;
    this.updateImageInWorking(id, updates);
  };

  private updateImageInWorking(id: string, updates: Partial<ImageItem>) {
    const index = this.workingItems.findIndex((item) => item.id === id);
    if (index < 0) return;

    this.clearSessionNotice({ emit: false });
    const next = [...this.workingItems];
    next[index] = this.normalizeItem({ ...next[index], ...updates });
    this.workingItems = next;
    this.hasWorkingChanges = true;
    this.setImageFocus(id, {
      syncCanvasSelection: false,
      skipRender: true,
    });
    if (this.isToolActive) {
      this.updateImages();
    }
    this.emitWorkingChange(id);
  }

  private async updateImageInConfig(id: string, updates: Partial<ImageItem>) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return;

    this.clearSessionNotice({ emit: false });
    const replacingSource =
      typeof updates.url === "string" && updates.url.length > 0;
    const next = [...this.items];
    const base = next[index];
    const replacingUrl = replacingSource ? (updates.url as string) : undefined;

    next[index] = this.normalizeItem({
      ...base,
      ...updates,
      ...(replacingSource
        ? {
            url: replacingUrl,
            sourceUrl: replacingUrl,
            committedUrl: undefined,
          }
        : {}),
    });

    this.updateConfig(next);

    if (replacingSource) {
      this.purgeSourceSizeCacheForItem(base);
    }
  }

  private waitImageLoaded(id: string, forceWait = false): Promise<boolean> {
    if (!forceWait && this.getImageObject(id)) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.loadResolvers.delete(id);
        resolve(false);
      }, 4000);

      this.loadResolvers.set(id, () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
  }

  private async resolveImageSourceSize(
    id: string,
    src: string,
  ): Promise<SourceSize | null> {
    const obj = this.getImageObject(id);
    if (obj) {
      this.rememberSourceSize(src, obj);
    }
    const ensured = await this.ensureSourceSize(src);
    if (ensured) return ensured;
    if (!obj) return null;

    const width = Number(obj?.width || 0);
    const height = Number(obj?.height || 0);
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }

  private async applyImageOperation(
    id: string,
    operation: ImageOperation,
    options: UpdateImageOptions = {},
  ) {
    if (!this.canvasService) return;

    this.syncToolActiveFromWorkbench();
    const target = options.target || "auto";
    const renderItems =
      target === "working" || (target === "auto" && this.isToolActive)
        ? this.workingItems
        : this.items;
    const current = renderItems.find((item) => item.id === id);
    if (!current) return;

    const render = this.resolveRenderImageState(current);
    const source = await this.resolveImageSourceSize(id, render.src);
    if (!source) return;

    const frame = this.getSurfaceFrameRect();
    const viewport = this.canvasService.getSceneViewportRect();
    const area =
      operation.type === "resetTransform"
        ? resolveImageOperationArea({ frame, viewport })
        : resolveImageOperationArea({
            frame,
            viewport,
            area: operation.area,
          });
    const updates = computeImageOperationUpdates({
      frame,
      source,
      operation,
      area,
    });

    if (target === "working" || (target === "auto" && this.isToolActive)) {
      this.updateImageInWorking(id, updates);
      return;
    }

    await this.updateImageInConfig(id, updates);
  }

  private async commitWorkingImagesAsCropped() {
    if (!this.canvasService) {
      return { ok: false, reason: "canvas-not-ready" };
    }

    await this.updateImagesAsync();

    const frame = this.getSurfaceFrameRect();
    if (!frame.width || !frame.height) {
      return { ok: false, reason: "frame-not-ready" };
    }

    const next: ImageItem[] = [];
    for (const item of this.workingItems) {
      const sourceUrl = item.sourceUrl || item.url;
      const previousCommitted = item.committedUrl;
      const committedImage = await this.exportCroppedImageByIds([item.id], {
        format: "png",
        multiplier: 2,
      });
      const committedUrl = committedImage.url || sourceUrl;
      this.sourceSizeCache.rememberSourceSize(committedUrl, {
        width: committedImage.width,
        height: committedImage.height,
      });
      next.push(
        this.normalizeItem({
          ...item,
          url: sourceUrl,
          sourceUrl,
          committedUrl,
        }),
      );
      if (
        previousCommitted &&
        previousCommitted !== sourceUrl &&
        previousCommitted !== committedUrl
      ) {
        this.sourceSizeCache.deleteSourceSize(previousCommitted);
      }
    }

    this.hasWorkingChanges = false;
    this.clearSessionNotice({ emit: false });
    this.workingItems = this.cloneItems(next);
    this.updateConfig(next);
    this.emitWorkingChange(this.focusedImageId);
    return { ok: true };
  }

  private async completeImageSession() {
    const sessionState =
      this.context?.services.get<ToolSessionService>(TOOL_SESSION_SERVICE);
    const workbench =
      this.context?.services.get<WorkbenchService>(WORKBENCH_SERVICE);
    console.info("[ImageTool] completeImageSession:start", {
      activeToolId: workbench?.activeToolId ?? null,
      isToolActive: this.isToolActive,
      dirtyBeforeComplete: this.hasWorkingChanges,
      workingCount: this.workingItems.length,
      committedCount: this.items.length,
      sessionDirty: sessionState?.isDirty(this.id),
    });
    const validation = await this.validateImageSession();
    if (!validation.ok) {
      console.warn("[ImageTool] completeImageSession:validation-failed", {
        validation,
        dirtyAfterValidation: this.hasWorkingChanges,
      });
      return validation;
    }
    const result = await this.commitWorkingImagesAsCropped();
    console.info("[ImageTool] completeImageSession:done", {
      result,
      dirtyAfterComplete: this.hasWorkingChanges,
      workingCount: this.workingItems.length,
      committedCount: this.items.length,
      sessionDirty: sessionState?.isDirty(this.id),
    });
    return result;
  }

  private async exportCroppedImageByIds(
    imageIds: string[],
    options: ExportCroppedImageOptions,
  ): Promise<ImageExportUserCroppedImageResult> {
    if (!this.exportService) {
      throw new Error("SceneExportService not initialized");
    }

    const normalizedIds = [...new Set(imageIds)].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    if (!normalizedIds.length) {
      throw new Error("image-ids-required");
    }

    const frame = this.getSurfaceFrameRect();
    const multiplier = Math.max(1, options.multiplier ?? 2);
    const format: "png" | "jpeg" = options.format === "jpeg" ? "jpeg" : "png";
    const result = await this.exportService.exportImage({
      crop: { type: "sceneRect", rect: frame },
      format,
      includeHidden: true,
      multiplier,
      sourceElementIds: normalizedIds,
      sourceLayerIds: [this.imageLayerId],
    });

    return {
      url: result.url,
      width: result.width,
      height: result.height,
      multiplier: result.multiplier,
      format: result.format,
      imageIds: result.sourceElementIds.length
        ? result.sourceElementIds
        : normalizedIds,
    };
  }

  private async exportUserCroppedImage(
    options: ImageExportUserCroppedImageOptions = {},
  ): Promise<ImageExportUserCroppedImageResult> {
    if (!this.canvasService) {
      throw new Error("CanvasService not initialized");
    }

    await this.updateImagesAsync();
    this.syncToolActiveFromWorkbench();

    const imageIds =
      options.imageIds && options.imageIds.length > 0
        ? options.imageIds
        : (this.isToolActive ? this.workingItems : this.items).map(
            (item) => item.id,
          );
    if (!imageIds.length) {
      throw new Error("no-images-to-export");
    }

    return await this.exportCroppedImageByIds(imageIds, options);
  }
}
