import {
  CANVAS_SERVICE,
  CAPABILITY_REGISTRY_SERVICE,
  CONFIGURATION_SERVICE,
  ExtensionContext,
  ExtensionContributions,
  ExtensionDefinition,
  SCENE_EXPORT_SERVICE,
  SCENE_LAYOUT_SERVICE,
  SCENE_SERVICE,
  type CanvasService,
  type CapabilityRegistryService,
  type ConfigurationService,
  type RenderObjectSpec,
  type RenderPatternSpec,
  type SceneElement,
  type SceneExportService,
  type SceneLayoutService,
  type SceneService,
} from "@pooder/core";
import {
  createSourceSizeCache,
  getCoverScale as getCoverScaleFromRect,
  type SourceSize,
} from "../../shared/imaging/sourceSizeCache";
import { type FrameRect, resolveSurfaceFrameRect } from "../../shared/scene/frame";
import { KIT_LEGACY_LAYER_PRESET } from "../../shared/constants/layers";
import { SubscriptionBag } from "../../shared/runtime/subscriptions";
import {
  IMAGE_PLACEMENT_CAPABILITY_ID,
  createImagePlacementCapabilityDefinition,
  normalizeImagePlacementLayerId,
  type ImagePlacementCapabilityApi,
  type ImagePlacementCapabilityOptions,
  type ImagePlacementViewState,
} from "./capability";
import {
  computeImageOperationUpdates,
  resolveImageOperationArea,
  type ImageOperation,
} from "./imageOperations";
import { validateImagePlacement } from "./imagePlacement";
import { buildImageSessionOverlaySpecs } from "./sessionOverlay";
import {
  DIELINE_GEOMETRY_CAPABILITY_ID,
  type DielineGeometryCapabilityApi,
} from "../dieline/capability";

export interface ImagePlacementImageState {
  src?: string;
  assetId?: string;
  left?: number;
  top?: number;
  scale?: number;
  angle?: number;
  opacity?: number;
  metadata?: Record<string, unknown>;
}

export interface ImagePlacementSource {
  src: string;
  metadata?: Record<string, unknown>;
}

export interface ImagePlacementTransformUpdates {
  left?: number;
  top?: number;
  scale?: number;
  angle?: number;
  opacity?: number;
}

interface ImagePlacementSourceTransform {
  left: number;
  top: number;
  scale: number;
  angle: number;
  opacity: number;
}

export interface ImagePlacementPlaceholderStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDashArray?: number[];
  label?: string;
  labelFill?: string;
  labelFontSize?: number;
  labelFontFamily?: string;
}

export interface ImagePlacementSlotState {
  id: string;
  layerId: string;
  frame: FrameRect;
  fit: "cover" | "contain" | "stretch";
  order: number;
  visible: boolean;
  image: ImagePlacementImageState | null;
  hasImage: boolean;
  placeholderStyle?: ImagePlacementPlaceholderStyle;
  metadata?: Record<string, unknown>;
}

export interface ImagePlacementSessionNotice {
  ok: false;
  code: "image-missing" | "image-outside-frame" | "slot-not-found";
  level: "error" | "warning";
  message: string;
  slotIds: string[];
  policy: "free" | "warn" | "strict";
}

export interface ImageExportPlacementImageOptions {
  slotIds?: string[];
  multiplier?: number;
  format?: "png" | "jpeg";
}

export interface ImageExportPlacementImageResult {
  url: string;
  width: number;
  height: number;
  multiplier: number;
  format: "png" | "jpeg";
  slotIds: string[];
}

export interface ImageToolOptions extends ImagePlacementCapabilityOptions {
  id?: string;
}

type ImagePlacementPolicy = "free" | "warn" | "strict";
type SnapAxis = "x" | "y";
type SnapLineKind = "edge" | "center";
type SnapLineId =
  | "frame-left"
  | "frame-center-x"
  | "frame-right"
  | "frame-top"
  | "frame-center-y"
  | "frame-bottom";

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

const DEFAULT_IMAGE_LAYER_ID = KIT_LEGACY_LAYER_PRESET.imageObject;
const DEFAULT_OVERLAY_LAYER_ID = KIT_LEGACY_LAYER_PRESET.imageOverlay;
const IMAGE_OBJECT_STACK = 660;
const IMAGE_OVERLAY_STACK = 800;
const IMAGE_RENDER_SCOPE = "pooder.kit.image-placement";
const IMAGE_MOVE_SNAP_THRESHOLD_PX = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNormalized(value: number): number {
  return Math.max(-1, Math.min(2, value));
}

function cloneImageMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return isRecord(metadata) ? { ...metadata } : undefined;
}

function readMetadataSourceSrc(
  metadata: Record<string, unknown> | undefined,
): string {
  const sourceSrc = isRecord(metadata) && typeof metadata.sourceSrc === "string"
    ? metadata.sourceSrc.trim()
    : "";
  return sourceSrc;
}

function resolveImageTransformSnapshot(
  image: ImagePlacementImageState,
): ImagePlacementSourceTransform {
  return {
    left: clampNormalized(finiteNumber(image.left, 0.5)),
    top: clampNormalized(finiteNumber(image.top, 0.5)),
    scale: Math.max(0.05, finiteNumber(image.scale, 1)),
    angle: finiteNumber(image.angle, 0),
    opacity: finiteNumber(image.opacity, 1),
  };
}

function readMetadataSourceTransform(
  metadata: Record<string, unknown> | undefined,
  fallback: ImagePlacementSourceTransform,
): ImagePlacementSourceTransform {
  const transform = isRecord(metadata?.sourceTransform)
    ? metadata.sourceTransform
    : null;
  if (!transform) return fallback;
  return {
    left: clampNormalized(finiteNumber(transform.left, fallback.left)),
    top: clampNormalized(finiteNumber(transform.top, fallback.top)),
    scale: Math.max(0.05, finiteNumber(transform.scale, fallback.scale)),
    angle: finiteNumber(transform.angle, fallback.angle),
    opacity: finiteNumber(transform.opacity, fallback.opacity),
  };
}

function createEditableWorkingImage(
  committed: ImagePlacementImageState | null,
): ImagePlacementImageState | null {
  if (!committed) return null;
  const metadata = cloneImageMetadata(committed.metadata);
  const sourceSrc = readMetadataSourceSrc(metadata);
  if (!sourceSrc) {
    return {
      ...committed,
      ...(metadata ? { metadata } : {}),
    };
  }
  return {
    ...committed,
    ...readMetadataSourceTransform(
      metadata,
      resolveImageTransformSnapshot(committed),
    ),
    src: sourceSrc,
    metadata: {
      ...(metadata ?? {}),
      ...(committed.src ? { committedSrc: committed.src } : {}),
    },
  };
}

function stripDerivedImageMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next = cloneImageMetadata(metadata) ?? {};
  delete next.height;
  delete next.committedSrc;
  delete next.sourceSrc;
  delete next.sourceTransform;
  delete next.width;
  return next;
}

function normalizeImage(value: unknown): ImagePlacementImageState | null {
  if (!isRecord(value)) return null;
  const src = typeof value.src === "string" ? value.src.trim() : "";
  const assetId = typeof value.assetId === "string" ? value.assetId.trim() : "";
  const image: ImagePlacementImageState = {
    ...(src ? { src } : {}),
    ...(assetId ? { assetId } : {}),
    left: clampNormalized(finiteNumber(value.left, 0.5)),
    top: clampNormalized(finiteNumber(value.top, 0.5)),
    scale: Math.max(0.05, finiteNumber(value.scale, 1)),
    angle: finiteNumber(value.angle, 0),
    opacity: finiteNumber(value.opacity, 1),
    ...(isRecord(value.metadata) ? { metadata: { ...value.metadata } } : {}),
  };
  return image.src || image.assetId ? image : image;
}

function hasImageSource(image: ImagePlacementImageState | null): boolean {
  return Boolean(image?.src || image?.assetId);
}

function normalizeColor(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function normalizePlaceholderStyle(
  value: unknown,
): ImagePlacementPlaceholderStyle | undefined {
  if (!isRecord(value)) return undefined;
  const style: ImagePlacementPlaceholderStyle = {};
  const fill = normalizeColor(value.fill);
  const stroke = normalizeColor(value.stroke);
  const label = typeof value.label === "string" ? value.label : undefined;
  const labelFill = normalizeColor(value.labelFill);
  const labelFontFamily = normalizeColor(value.labelFontFamily);
  const strokeWidth = finiteNumber(value.strokeWidth, Number.NaN);
  const labelFontSize = finiteNumber(value.labelFontSize, Number.NaN);
  const strokeDashArray = Array.isArray(value.strokeDashArray)
    ? value.strokeDashArray
        .map((item) => finiteNumber(item, Number.NaN))
        .filter((item) => Number.isFinite(item) && item > 0)
    : undefined;
  if (fill) style.fill = fill;
  if (stroke) style.stroke = stroke;
  if (Number.isFinite(strokeWidth)) style.strokeWidth = Math.max(0, strokeWidth);
  if (strokeDashArray?.length) style.strokeDashArray = strokeDashArray;
  if (typeof label === "string") style.label = label;
  if (labelFill) style.labelFill = labelFill;
  if (Number.isFinite(labelFontSize)) {
    style.labelFontSize = Math.max(1, labelFontSize);
  }
  if (labelFontFamily) style.labelFontFamily = labelFontFamily;
  return Object.keys(style).length ? style : undefined;
}

function getImagePlacementData(element: SceneElement): Record<string, unknown> {
  const data = isRecord(element.data) ? element.data : {};
  const placement = isRecord(data.imagePlacement) ? data.imagePlacement : {};
  return placement;
}

function getSlotFrame(element: SceneElement): FrameRect | null {
  const placement = getImagePlacementData(element);
  const rawFrame = isRecord(placement.frame) ? placement.frame : undefined;
  if (rawFrame) {
    const width = finiteNumber(rawFrame.width, 0);
    const height = finiteNumber(rawFrame.height, 0);
    if (width > 0 && height > 0) {
      return {
        left: finiteNumber(rawFrame.x ?? rawFrame.left, 0),
        top: finiteNumber(rawFrame.y ?? rawFrame.top, 0),
        width,
        height,
      };
    }
  }

  if (element.type !== "rect") return null;
  const transform = element.transform || {};
  return {
    left: finiteNumber(transform.left, 0),
    top: finiteNumber(transform.top, 0),
    width: Math.max(1, finiteNumber(element.width, 1)),
    height: Math.max(1, finiteNumber(element.height, 1)),
  };
}

/**
 * @deprecated Compatibility class name. The implementation is now the
 * document-driven image placement capability.
 */
export class ImageTool implements ExtensionDefinition {
  id: string;
  metadata = {
    name: "ImagePlacementCapability",
  };
  activation = {
    requiresServices: [CANVAS_SERVICE, SCENE_SERVICE],
  };

  private canvasService?: CanvasService;
  private sceneService?: SceneService;
  private sceneLayoutService?: SceneLayoutService;
  private exportService?: SceneExportService;
  private context?: ExtensionContext;
  private sceneSubscription?: { dispose(): void };
  private renderProducerDisposable?: { dispose(): void };
  private readonly subscriptions = new SubscriptionBag();
  private readonly capabilityId: string;
  private readonly imageLayerId: string;
  private readonly overlayLayerId: string;
  private readonly requestUploadCallback: ImagePlacementCapabilityOptions["requestUpload"];
  private readonly sourceSizeCache = createSourceSizeCache((src) =>
    this.loadImageSize(src),
  );
  private workingImages = new Map<string, ImagePlacementImageState | null>();
  private pendingUploadSlotIds = new Set<string>();
  private activeSlotId: string | null = null;
  private sessionNotice: ImagePlacementSessionNotice | null = null;
  private renderSeq = 0;
  private activeSnapX: SnapMatch | null = null;
  private activeSnapY: SnapMatch | null = null;
  private movingSlotId: string | null = null;
  private hasRenderedSnapGuides = false;
  private canvasMouseUpHandler?: (event?: any) => void;
  private canvasObjectMovingHandler?: (event?: any) => void;
  private canvasBeforeRenderHandler?: (event?: any) => void;
  private canvasAfterRenderHandler?: (event?: any) => void;

  constructor(options: ImageToolOptions = {}) {
    this.id = String(options.id || IMAGE_PLACEMENT_CAPABILITY_ID).trim() ||
      IMAGE_PLACEMENT_CAPABILITY_ID;
    this.capabilityId = options.capabilityId || IMAGE_PLACEMENT_CAPABILITY_ID;
    this.imageLayerId = normalizeImagePlacementLayerId(
      options.layers?.imageLayerId,
      DEFAULT_IMAGE_LAYER_ID,
    );
    this.overlayLayerId = normalizeImagePlacementLayerId(
      options.layers?.overlayLayerId,
      DEFAULT_OVERLAY_LAYER_ID,
    );
    this.requestUploadCallback = options.requestUpload;
  }

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService = context.services.getOrThrow<CanvasService>(
      CANVAS_SERVICE,
    );
    this.sceneService = context.services.getOrThrow<SceneService>(SCENE_SERVICE);
    this.sceneLayoutService = context.services.get<SceneLayoutService>(
      SCENE_LAYOUT_SERVICE,
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
            stack: IMAGE_OBJECT_STACK,
            order: 0,
            objects: this.buildImageSpecs(),
          },
          {
            id: this.overlayLayerId,
            stack: IMAGE_OVERLAY_STACK,
            order: 0,
            objects: this.buildUploadSpecs(),
          },
          {
            id: `${this.overlayLayerId}.session`,
            stack: IMAGE_OVERLAY_STACK,
            order: 1,
            visibility: { op: "sessionActive", toolId: this.capabilityId },
            objects: this.buildSessionSpecs(),
          },
        ],
      }),
      { priority: 300 },
    );

    this.sceneSubscription?.dispose();
    this.sceneSubscription = this.sceneService.onDidChange(() => this.updateImages());
    this.subscriptions.on(context.eventBus, "selection:created", this.onSelectionChanged);
    this.subscriptions.on(context.eventBus, "selection:updated", this.onSelectionChanged);
    this.subscriptions.on(context.eventBus, "selection:cleared", this.onSelectionCleared);
    this.subscriptions.on(context.eventBus, "object:modified", this.onObjectModified);
    this.subscriptions.on(context.eventBus, "mouse:down", this.onMouseDown);
    this.subscriptions.on(context.eventBus, "scene:layout:change", this.onSceneFrameChanged);
    this.subscriptions.on(context.eventBus, "scene:geometry:change", this.onSceneFrameChanged);
    this.bindCanvasInteractionHandlers();
    this.updateImages();
  }

  deactivate() {
    this.subscriptions.disposeAll();
    this.sceneSubscription?.dispose();
    this.sceneSubscription = undefined;
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = undefined;
    this.workingImages.clear();
    this.activeSlotId = null;
    this.sourceSizeCache.clear();
    this.endMoveSnapInteraction();
    this.unbindCanvasInteractionHandlers();
    this.canvasService?.requestRenderAll();
    this.canvasService = undefined;
    this.sceneService = undefined;
    this.sceneLayoutService = undefined;
    this.exportService = undefined;
    this.context = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createImagePlacementCapabilityDefinition(this.getImagePlacementFacade(), {
          capabilityId: this.capabilityId,
          requestUpload: this.requestUploadCallback,
          layers: {
            imageLayerId: this.imageLayerId,
            overlayLayerId: this.overlayLayerId,
          },
        }),
      ],
    };
  }

  private getImagePlacementFacade(): ImagePlacementCapabilityApi {
    return {
      applyImageOperation: (slotId, operation) =>
        this.applyImageOperation(slotId, operation),
      beginSession: (slotId) => this.beginSession(slotId),
      clearImage: (slotId) => this.clearImage(slotId),
      completeSession: (slotId) => this.completeSession(slotId),
      exportPlacementImage: (options) => this.exportPlacementImage(options),
      focusSlot: (slotId, options) => this.focusSlot(slotId, options),
      getViewState: () => this.getViewState(),
      requestUpload: (slotId) => this.requestUpload(slotId),
      resetSession: (slotId) => this.resetSession(slotId),
      setImageSource: (slotId, source) => this.setImageSource(slotId, source),
      setImageTransform: (slotId, updates) =>
        this.setImageTransform(slotId, updates),
      validateSession: (slotId) => this.validateSession(slotId),
    };
  }

  private getSlotElements(): SceneElement[] {
    if (!this.sceneService) return [];
    return this.sceneService
      .listElements()
      .filter((element) => getImagePlacementData(element).enabled === true)
      .sort((a, b) => a.order - b.order);
  }

  private getSlotElement(slotId: string): SceneElement | undefined {
    return this.getSlotElements().find((slot) => slot.id === slotId);
  }

  private getCommittedImage(slot: SceneElement): ImagePlacementImageState | null {
    return normalizeImage(getImagePlacementData(slot).image);
  }

  private getEffectiveImage(slot: SceneElement): ImagePlacementImageState | null {
    if (this.workingImages.has(slot.id)) {
      return this.workingImages.get(slot.id) ?? null;
    }
    return this.getCommittedImage(slot);
  }

  private getSlotState(slot: SceneElement): ImagePlacementSlotState | null {
    const frame = getSlotFrame(slot);
    if (!frame) return null;
    const placement = getImagePlacementData(slot);
    const fit = placement.fit === "contain" || placement.fit === "stretch"
      ? placement.fit
      : "cover";
    const image = this.getEffectiveImage(slot);
    return {
      id: slot.id,
      layerId: slot.layerId,
      frame,
      fit,
      order: slot.order,
      visible: slot.visible,
      image,
      hasImage: hasImageSource(image),
      placeholderStyle: normalizePlaceholderStyle(placement.placeholder),
      metadata: isRecord(slot.metadata) ? { ...slot.metadata } : undefined,
    };
  }

  private getSlotStates(): ImagePlacementSlotState[] {
    return this.getSlotElements()
      .map((slot) => this.getSlotState(slot))
      .filter((slot): slot is ImagePlacementSlotState => Boolean(slot));
  }

  private getCommittedSlotStates(): ImagePlacementSlotState[] {
    return this.getSlotElements()
      .map((slot) => {
        const state = this.getSlotState(slot);
        const image = this.getCommittedImage(slot);
        return state
          ? {
              ...state,
              image,
              hasImage: hasImageSource(image),
            }
          : null;
      })
      .filter((slot): slot is ImagePlacementSlotState => Boolean(slot));
  }

  private getViewState(): ImagePlacementViewState {
    const slots = this.getSlotStates();
    const focusedSlot =
      slots.find((slot) => slot.id === this.activeSlotId) || null;
    return {
      slots,
      activeSlotId: this.activeSlotId,
      focusedSlot,
      hasAnyImage: slots.some((slot) => slot.hasImage),
      hasWorkingChanges: this.workingImages.size > 0,
      sessionNotice: this.sessionNotice,
    };
  }

  private emitStateChange() {
    this.context?.eventBus.emit("image:state:change", this.getViewState());
  }

  private setSessionNotice(notice: ImagePlacementSessionNotice | null) {
    this.sessionNotice = notice;
    this.context?.eventBus.emit("image:session:notice", notice);
    this.emitStateChange();
  }

  private async beginSession(slotId: string) {
    const slot = this.getSlotElement(slotId);
    if (!slot) return { ok: false, reason: "slot-not-found" };
    this.activeSlotId = slotId;
    if (!this.workingImages.has(slotId)) {
      this.workingImages.set(
        slotId,
        createEditableWorkingImage(this.getCommittedImage(slot)),
      );
    }
    this.setSessionNotice(null);
    await this.updateImagesAsync();
    return { ok: true };
  }

  private async requestUpload(slotId: string) {
    if (this.pendingUploadSlotIds.has(slotId)) {
      return { ok: false, reason: "upload-pending" };
    }
    const slot = this.getSlotStates().find((item) => item.id === slotId);
    if (!slot) return { ok: false, reason: "slot-not-found" };
    if (!this.requestUploadCallback) {
      return { ok: false, reason: "upload-unavailable" };
    }
    this.pendingUploadSlotIds.add(slotId);
    try {
      await this.beginSession(slotId);
      const source = await this.requestUploadCallback(slot);
      if (!source?.src) return { ok: false, reason: "upload-cancelled" };
      await this.setImageSource(slotId, source);
      await this.applyImageOperation(slotId, { type: slot.fit === "contain" ? "contain" : "cover" });
      this.focusSlot(slotId);
      return { ok: true };
    } finally {
      this.pendingUploadSlotIds.delete(slotId);
    }
  }

  private async setImageSource(slotId: string, source: ImagePlacementSource) {
    const src = String(source.src || "").trim();
    if (!src) return { ok: false, reason: "image-source-required" };
    const slot = this.getSlotElement(slotId);
    if (!slot) return { ok: false, reason: "slot-not-found" };
    if (!this.workingImages.has(slotId)) {
      await this.beginSession(slotId);
    }
    const current = this.workingImages.get(slotId) || this.getCommittedImage(slot) || {};
    this.workingImages.set(slotId, {
      ...current,
      src,
      metadata: {
        ...stripDerivedImageMetadata(current.metadata),
        ...(source.metadata ?? {}),
      },
      left: current.left ?? 0.5,
      top: current.top ?? 0.5,
      scale: current.scale ?? 1,
      angle: current.angle ?? 0,
      opacity: current.opacity ?? 1,
    });
    this.rememberSourceSizeFromMetadata(src, source.metadata);
    await this.updateImagesAsync();
    this.emitStateChange();
    return { ok: true };
  }

  private async setImageTransform(
    slotId: string,
    updates: ImagePlacementTransformUpdates,
  ) {
    const slot = this.getSlotElement(slotId);
    if (!slot) return { ok: false, reason: "slot-not-found" };
    if (!this.workingImages.has(slotId)) {
      await this.beginSession(slotId);
    }
    const current = this.workingImages.get(slotId) || this.getCommittedImage(slot) || {};
    const next: ImagePlacementImageState = { ...current };
    if (Number.isFinite(updates.left as number)) {
      next.left = clampNormalized(Number(updates.left));
    }
    if (Number.isFinite(updates.top as number)) {
      next.top = clampNormalized(Number(updates.top));
    }
    if (Number.isFinite(updates.scale as number)) {
      next.scale = Math.max(0.05, Number(updates.scale));
    }
    if (Number.isFinite(updates.angle as number)) {
      next.angle = Number(updates.angle);
    }
    if (Number.isFinite(updates.opacity as number)) {
      next.opacity = Number(updates.opacity);
    }
    this.workingImages.set(slotId, next);
    this.updateImages();
    this.emitStateChange();
    return { ok: true };
  }

  private async applyImageOperation(slotId: string, operation: ImageOperation) {
    const slot = this.getSlotStates().find((item) => item.id === slotId);
    const image = slot?.image;
    if (!slot) return { ok: false, reason: "slot-not-found" };
    if (!image?.src) return { ok: false, reason: "image-missing" };
    const source = await this.ensureSourceSize(image.src);
    if (!source) return { ok: false, reason: "image-size-unavailable" };
    const area = resolveImageOperationArea({
      frame: slot.frame,
      viewport: slot.frame,
      area: "area" in operation ? operation.area : undefined,
    });
    const updates = computeImageOperationUpdates({
      frame: slot.frame,
      source,
      operation,
      area,
    });
    return await this.setImageTransform(slotId, updates);
  }

  private async clearImage(slotId: string) {
    const slot = this.getSlotElement(slotId);
    if (!slot) return { ok: false, reason: "slot-not-found" };
    this.workingImages.set(slotId, null);
    this.updateImages();
    this.emitStateChange();
    return { ok: true };
  }

  private resetSession(slotId?: string) {
    if (slotId) {
      this.workingImages.delete(slotId);
      if (this.activeSlotId === slotId) this.activeSlotId = null;
    } else {
      this.workingImages.clear();
      this.activeSlotId = null;
    }
    this.setSessionNotice(null);
    this.updateImages();
  }

  private async validateSession(slotId?: string) {
    const policy = this.getPlacementPolicy();
    const targetIds = this.resolveSessionTargetIds(slotId);
    const targetIdSet = new Set(targetIds);
    const slots = this.getSlotStates().filter((slot) => targetIdSet.has(slot.id));
    const missing = slots.filter((slot) => !slot.image?.src);
    if (missing.length) {
      const notice = this.createNotice("image-missing", missing.map((slot) => slot.id), {
        level: "error",
        policy,
      });
      this.setSessionNotice(notice);
      return notice;
    }

    if (policy === "free") {
      this.setSessionNotice(null);
      return { ok: true as const };
    }

    const outside: string[] = [];
    for (const slot of slots) {
      const image = slot.image;
      if (!image?.src) continue;
      const source = await this.ensureSourceSize(image.src);
      if (!source) continue;
      const result = validateImagePlacement({
        frame: slot.frame,
        source,
        placement: {
          left: image.left ?? 0.5,
          top: image.top ?? 0.5,
          scale: image.scale ?? 1,
          angle: image.angle ?? 0,
        },
      });
      if (!result.ok) outside.push(slot.id);
    }
    if (outside.length) {
      const notice = this.createNotice("image-outside-frame", outside, {
        level: policy === "strict" ? "error" : "warning",
        policy,
      });
      this.setSessionNotice(notice);
      if (policy === "strict") {
        return notice;
      }
      return { ok: true as const };
    }
    this.setSessionNotice(null);
    return { ok: true as const };
  }

  private async completeSession(slotId?: string) {
    const validation = await this.validateSession(slotId);
    if ("ok" in validation && validation.ok === true) {
      const targetIds = this.resolveSessionTargetIds(slotId);
      const commitResult = await this.commitWorkingImagesAsCropped(targetIds);
      if (!commitResult.ok) return commitResult;
      if (!slotId || this.activeSlotId === slotId) this.activeSlotId = null;
      await this.updateImagesAsync();
      this.emitStateChange();
      return { ok: true };
    }
    return validation;
  }

  private resolveSessionTargetIds(slotId?: string): string[] {
    if (slotId) return [slotId];
    if (this.activeSlotId && this.workingImages.has(this.activeSlotId)) {
      return [this.activeSlotId];
    }
    return Array.from(this.workingImages.keys());
  }

  private async commitWorkingImagesAsCropped(slotIds: string[]) {
    if (!this.exportService) {
      return { ok: false, reason: "scene-export-unavailable" };
    }

    await this.updateImagesAsync();

    for (const slotId of slotIds) {
      if (!this.workingImages.has(slotId)) continue;
      const slot = this.getSlotStates().find((item) => item.id === slotId);
      if (!slot) return { ok: false, reason: "slot-not-found" };
      const image = this.workingImages.get(slotId);
      if (!image?.src) {
        this.commitSlotImage(slotId, null);
        continue;
      }

      let croppedImage: ImageExportPlacementImageResult;
      try {
        croppedImage = await this.exportCroppedSlotImage(slot);
      } catch {
        return { ok: false, reason: "image-crop-export-failed" };
      }

      const croppedSrc = croppedImage.url || image.src;
      const sourceSrc = readMetadataSourceSrc(image.metadata) || image.src;
      const sourceTransform = resolveImageTransformSnapshot(image);
      this.sourceSizeCache.rememberSourceSize(croppedSrc, {
        width: croppedImage.width,
        height: croppedImage.height,
      });
      this.commitSlotImage(slotId, {
        ...image,
        src: croppedSrc,
        left: 0.5,
        top: 0.5,
        scale: 1,
        angle: 0,
        metadata: {
          ...(image.metadata ?? {}),
          width: croppedImage.width,
          height: croppedImage.height,
          sourceSrc,
          sourceTransform,
        },
      });
    }

    this.setSessionNotice(null);
    return { ok: true };
  }

  private async exportCroppedSlotImage(
    slot: ImagePlacementSlotState,
  ): Promise<ImageExportPlacementImageResult> {
    if (!this.exportService) {
      throw new Error("SceneExportService not initialized");
    }
    const result = await this.exportService.exportImage({
      crop: { type: "sceneRect", rect: slot.frame },
      format: "png",
      includeHidden: true,
      multiplier: 2,
      sourceElementIds: [`session-image:${slot.id}`],
      sourceLayerIds: [`${this.overlayLayerId}.session`],
    });
    return {
      url: result.url,
      width: result.width,
      height: result.height,
      multiplier: result.multiplier,
      format: result.format,
      slotIds: [slot.id],
    };
  }

  private commitSlotImage(
    slotId: string,
    image: ImagePlacementImageState | null,
  ) {
    if (!this.sceneService) return;
    const slot = this.sceneService.getElement(slotId);
    if (!slot) return;
    const data = isRecord(slot.data) ? slot.data : {};
    const placement = isRecord(data.imagePlacement) ? data.imagePlacement : {};
    this.sceneService.updateElement(slotId, {
      data: {
        ...data,
        imagePlacement: {
          ...placement,
          image: image ?? undefined,
        },
      },
    });
    this.workingImages.delete(slotId);
  }

  private focusSlot(
    slotId: string | null,
    options: { syncCanvasSelection?: boolean; skipRender?: boolean } = {},
  ) {
    if (slotId && !this.getSlotElement(slotId)) {
      return { ok: false, reason: "slot-not-found" as const };
    }
    this.activeSlotId = slotId;
    if (options.syncCanvasSelection !== false && this.canvasService) {
      if (!slotId) {
        this.canvasService.discardActiveObject();
      } else {
        const obj =
          this.canvasService.getObject(`session-image:${slotId}`, `${this.overlayLayerId}.session`) ||
          this.canvasService.getObject(`image:${slotId}`, this.overlayLayerId) ||
          this.canvasService.getObject(`image:${slotId}`, this.imageLayerId) ||
          this.canvasService.getObject(`upload:${slotId}`, this.overlayLayerId);
        if (obj) this.canvasService.setActiveObject(obj as any);
      }
    }
    if (!options.skipRender) this.updateImages();
    this.emitStateChange();
    return { ok: true, id: slotId };
  }

  private async exportPlacementImage(
    options: ImageExportPlacementImageOptions = {},
  ) {
    if (!this.exportService) {
      throw new Error("SceneExportService not initialized");
    }
    await this.updateImagesAsync();
    const slotIds = options.slotIds?.length
      ? options.slotIds
      : this.getSlotStates().filter((slot) => slot.hasImage).map((slot) => slot.id);
    if (!slotIds.length) throw new Error("image-ids-required");
    const result = await this.exportService.exportImage({
      crop: { type: "sceneRect", rect: this.getSurfaceFrameRect() },
      format: options.format === "jpeg" ? "jpeg" : "png",
      includeHidden: true,
      multiplier: Math.max(1, options.multiplier ?? 2),
      sourceElementIds: slotIds.map((id) => `image:${id}`),
      sourceLayerIds: [this.imageLayerId],
    });
    return {
      url: result.url,
      width: result.width,
      height: result.height,
      multiplier: result.multiplier,
      format: result.format,
      slotIds,
    };
  }

  private createNotice(
    code: ImagePlacementSessionNotice["code"],
    slotIds: string[],
    options: {
      level?: ImagePlacementSessionNotice["level"];
      policy?: ImagePlacementPolicy;
    } = {},
  ): ImagePlacementSessionNotice {
    const policy = options.policy || this.getPlacementPolicy();
    return {
      ok: false,
      code,
      level: options.level || (policy === "strict" ? "error" : "warning"),
      message: code,
      slotIds,
      policy,
    };
  }

  private getPlacementPolicy(): ImagePlacementPolicy {
    const configService = this.context?.services.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    const policy = configService?.get<ImagePlacementPolicy>(
      "image.session.placementPolicy",
      "warn",
    );
    return policy === "free" || policy === "strict" ? policy : "warn";
  }

  private onSelectionChanged = (event: any) => {
    const selected = Array.isArray(event?.selected)
      ? event.selected[0]
      : event?.target;
    this.beginSessionFromCanvasTarget(selected);
  };

  private onMouseDown = (event: any) => {
    this.beginSessionFromCanvasTarget(event?.target);
  };

  private beginSessionFromCanvasTarget(target: any) {
    const selected = target;
    const slotId = selected?.data?.slotId;
    if (typeof slotId !== "string") return;
    this.activeSlotId = slotId;
    void this.beginSession(slotId);
  }

  private onSelectionCleared = () => {
    this.endMoveSnapInteraction();
    this.emitStateChange();
  };

  private bindCanvasInteractionHandlers() {
    if (!this.canvasService || this.canvasObjectMovingHandler) return;
    this.canvasMouseUpHandler = (event: any) => {
      const target = this.getActiveImageTarget(event?.target);
      if (
        target &&
        typeof target?.data?.slotId === "string" &&
        target.data.slotId === this.movingSlotId
      ) {
        this.applyMoveSnapToTarget(target);
      }
      this.endMoveSnapInteraction();
    };
    this.canvasObjectMovingHandler = (event: any) => {
      this.handleCanvasObjectMoving(event);
    };
    this.canvasBeforeRenderHandler = () => {
      this.handleCanvasBeforeRender();
    };
    this.canvasAfterRenderHandler = () => {
      this.handleCanvasAfterRender();
    };
    this.canvasService.onCanvasEvent("mouse:up", this.canvasMouseUpHandler);
    this.canvasService.onCanvasEvent("object:moving", this.canvasObjectMovingHandler);
    this.canvasService.onCanvasEvent("before:render", this.canvasBeforeRenderHandler);
    this.canvasService.onCanvasEvent("after:render", this.canvasAfterRenderHandler);
  }

  private unbindCanvasInteractionHandlers() {
    if (!this.canvasService) return;
    if (this.canvasMouseUpHandler) {
      this.canvasService.offCanvasEvent("mouse:up", this.canvasMouseUpHandler);
    }
    if (this.canvasObjectMovingHandler) {
      this.canvasService.offCanvasEvent("object:moving", this.canvasObjectMovingHandler);
    }
    if (this.canvasBeforeRenderHandler) {
      this.canvasService.offCanvasEvent("before:render", this.canvasBeforeRenderHandler);
    }
    if (this.canvasAfterRenderHandler) {
      this.canvasService.offCanvasEvent("after:render", this.canvasAfterRenderHandler);
    }
    this.canvasMouseUpHandler = undefined;
    this.canvasObjectMovingHandler = undefined;
    this.canvasBeforeRenderHandler = undefined;
    this.canvasAfterRenderHandler = undefined;
  }

  private getActiveImageTarget(target: any): any | null {
    if (!target) return null;
    if (target?.data?.type !== "image-placement-image") return null;
    if (target?.data?.source !== "working") return null;
    if (typeof target?.data?.slotId !== "string") return null;
    return target;
  }

  private getTargetBoundsScene(target: any): FrameRect | null {
    if (!this.canvasService || !target) return null;
    const rawBounds =
      typeof target.getBoundingRect === "function"
        ? target.getBoundingRect()
        : {
            left: finiteNumber(target.left, 0),
            top: finiteNumber(target.top, 0),
            width: finiteNumber(target.width, 0) * finiteNumber(target.scaleX, 1),
            height: finiteNumber(target.height, 0) * finiteNumber(target.scaleY, 1),
          };
    return this.canvasService.toSceneRect({
      left: finiteNumber(rawBounds.left, 0),
      top: finiteNumber(rawBounds.top, 0),
      width: finiteNumber(rawBounds.width, 0),
      height: finiteNumber(rawBounds.height, 0),
    });
  }

  private getSnapThresholdScene(px: number): number {
    return this.canvasService?.toSceneLength(px) ?? px;
  }

  private pickSnapMatch(candidates: SnapCandidate[]): SnapMatch | null {
    const threshold = this.getSnapThresholdScene(IMAGE_MOVE_SNAP_THRESHOLD_PX);
    let best: SnapCandidate | null = null;
    candidates.forEach((candidate) => {
      if (Math.abs(candidate.deltaScene) > threshold) return;
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

    const frameCenterX = frame.left + frame.width / 2;
    const frameCenterY = frame.top + frame.height / 2;
    const boundsCenterX = bounds.left + bounds.width / 2;
    const boundsCenterY = bounds.top + bounds.height / 2;

    return {
      x: this.pickSnapMatch([
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
          lineScene: frameCenterX,
          deltaScene: frameCenterX - boundsCenterX,
        },
        {
          axis: "x",
          lineId: "frame-right",
          kind: "edge",
          lineScene: frame.left + frame.width,
          deltaScene: frame.left + frame.width - (bounds.left + bounds.width),
        },
      ]),
      y: this.pickSnapMatch([
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
          lineScene: frameCenterY,
          deltaScene: frameCenterY - boundsCenterY,
        },
        {
          axis: "y",
          lineId: "frame-bottom",
          kind: "edge",
          lineScene: frame.top + frame.height,
          deltaScene: frame.top + frame.height - (bounds.top + bounds.height),
        },
      ]),
    };
  }

  private areSnapMatchesEqual(a: SnapMatch | null, b: SnapMatch | null): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.axis === b.axis && a.lineId === b.lineId && a.kind === b.kind;
  }

  private updateSnapMatchState(nextX: SnapMatch | null, nextY: SnapMatch | null) {
    const changed =
      !this.areSnapMatchesEqual(this.activeSnapX, nextX) ||
      !this.areSnapMatchesEqual(this.activeSnapY, nextY);
    this.activeSnapX = nextX;
    this.activeSnapY = nextY;
    if (changed) {
      this.canvasService?.requestRenderAll();
    }
  }

  private clearSnapPreview() {
    const shouldClear =
      this.hasRenderedSnapGuides || Boolean(this.activeSnapX) || Boolean(this.activeSnapY);
    this.activeSnapX = null;
    this.activeSnapY = null;
    this.hasRenderedSnapGuides = false;
    if (shouldClear) {
      this.canvasService?.clearTopContext();
      this.canvasService?.requestRenderAll();
    }
  }

  private endMoveSnapInteraction() {
    this.movingSlotId = null;
    this.clearSnapPreview();
  }

  private applyMoveSnapToTarget(target: any): {
    x: SnapMatch | null;
    y: SnapMatch | null;
  } {
    if (!this.canvasService) return { x: null, y: null };
    const slotId = target?.data?.slotId;
    const slot = this.getSlotStates().find((item) => item.id === slotId);
    if (!slot) return { x: null, y: null };
    const matches = this.computeMoveSnapMatches(
      this.getTargetBoundsScene(target),
      slot.frame,
    );
    const deltaScreenX = this.canvasService.toScreenLength(matches.x?.deltaScene ?? 0);
    const deltaScreenY = this.canvasService.toScreenLength(matches.y?.deltaScene ?? 0);
    if (deltaScreenX || deltaScreenY) {
      target.set?.({
        left: finiteNumber(target.left, 0) + deltaScreenX,
        top: finiteNumber(target.top, 0) + deltaScreenY,
      });
      target.setCoords?.();
    }
    return matches;
  }

  private handleCanvasObjectMoving(event: any) {
    const target = this.getActiveImageTarget(event?.target);
    if (!target || !this.canvasService) return;
    const slotId = target.data.slotId;
    const slot = this.getSlotStates().find((item) => item.id === slotId);
    if (!slot) {
      this.endMoveSnapInteraction();
      return;
    }
    this.movingSlotId = slotId;
    const matches = this.computeMoveSnapMatches(
      this.getTargetBoundsScene(target),
      slot.frame,
    );
    this.updateSnapMatchState(matches.x, matches.y);
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
    const context = this.canvasService?.getTopContext();
    if (!context) return;
    context.save();
    context.strokeStyle = "#1677ff";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.restore();
  }

  private handleCanvasAfterRender() {
    if (!this.canvasService || (!this.activeSnapX && !this.activeSnapY)) {
      return;
    }
    const guideSlotId = this.movingSlotId || this.activeSlotId;
    const slot = guideSlotId
      ? this.getSlotStates().find((item) => item.id === guideSlotId)
      : null;
    if (!slot) return;
    const frame = slot.frame;
    const frameScreen = this.canvasService.toScreenRect(frame);
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

  private onObjectModified = (event: any) => {
    const target = event?.target;
    const slotId = target?.data?.slotId;
    if (
      typeof slotId !== "string" ||
      target?.data?.type !== "image-placement-image" ||
      target?.data?.source !== "working"
    ) {
      return;
    }
    const slot = this.getSlotStates().find((item) => item.id === slotId);
    if (!slot || !this.canvasService) return;
    if (this.movingSlotId === slotId) {
      this.applyMoveSnapToTarget(target);
    }
    this.endMoveSnapInteraction();
    const center = this.canvasService.toScenePoint({
      x: finiteNumber(target.left, 0),
      y: finiteNumber(target.top, 0),
    });
    const sourceWidth = finiteNumber(target.width, 1);
    const sourceHeight = finiteNumber(target.height, 1);
    const source: SourceSize = { width: sourceWidth, height: sourceHeight };
    const coverScale = getCoverScaleFromRect(slot.frame, source);
    const sceneScale = this.canvasService.getSceneScale();
    const objectScale = finiteNumber(target.scaleX, 1) / Math.max(0.0001, sceneScale);
    void this.setImageTransform(slotId, {
      left: (center.x - slot.frame.left) / Math.max(1, slot.frame.width),
      top: (center.y - slot.frame.top) / Math.max(1, slot.frame.height),
      scale: objectScale / Math.max(0.0001, coverScale),
      angle: finiteNumber(target.angle, 0),
    });
  };

  private buildImageSpecs(): RenderObjectSpec[] {
    return this.getCommittedSlotStates()
      .filter((slot) => !this.workingImages.has(slot.id))
      .filter((slot) => slot.image?.src)
      .map((slot) => this.buildImageSpec(slot, { committed: true }))
      .filter((spec): spec is RenderObjectSpec => Boolean(spec));
  }

  private buildWorkingImageSpecs(): RenderObjectSpec[] {
    return this.getSlotStates()
      .filter((slot) => this.shouldRenderWorkingSlot(slot.id) && slot.image?.src)
      .map((slot) => this.buildImageSpec(slot, { committed: false }))
      .filter((spec): spec is RenderObjectSpec => Boolean(spec));
  }

  private buildSessionSpecs(): RenderObjectSpec[] {
    return [
      ...this.buildWorkingImageSpecs(),
      ...this.buildSessionOverlaySpecs(),
    ];
  }

  private shouldRenderWorkingSlot(slotId: string): boolean {
    if (!this.workingImages.has(slotId)) return false;
    return !this.activeSlotId || this.activeSlotId === slotId;
  }

  private buildImageSpec(
    slot: ImagePlacementSlotState,
    options: { committed: boolean },
  ): RenderObjectSpec | null {
    const image = slot.image;
    if (!image?.src) return null;
    const source = this.sourceSizeCache.getSourceSize(image.src) || {
      width: slot.frame.width,
      height: slot.frame.height,
    };
    const scale =
      getCoverScaleFromRect(slot.frame, source) * Math.max(0.05, image.scale ?? 1);
    return {
      id: options.committed ? `image:${slot.id}` : `session-image:${slot.id}`,
      type: "image",
      src: image.src,
      space: "scene",
      data: {
        id: slot.id,
        layerId: this.imageLayerId,
        type: "image-placement-image",
        slotId: slot.id,
        source: options.committed ? "committed" : "working",
      },
      props: {
        left: slot.frame.left + (image.left ?? 0.5) * slot.frame.width,
        top: slot.frame.top + (image.top ?? 0.5) * slot.frame.height,
        originX: "center",
        originY: "center",
        scaleX: scale,
        scaleY: scale,
        angle: image.angle ?? 0,
        opacity: image.opacity ?? 1,
        selectable: !options.committed,
        evented: true,
        hasControls: !options.committed,
        hasBorders: !options.committed,
        centeredRotation: true,
        lockMovementX: options.committed,
        lockMovementY: options.committed,
        lockRotation: options.committed,
        lockScalingFlip: true,
        lockScalingX: options.committed,
        lockScalingY: options.committed,
        lockUniScaling: !options.committed,
      },
    };
  }

  private buildSessionOverlaySpecs(): RenderObjectSpec[] {
    if (!this.canvasService || !this.sceneLayoutService) return [];
    const layout = this.sceneLayoutService.getLayout(true);
    if (!layout) return [];
    const geometry = this.normalizeSessionGeometry(
      this.getDielineGeometry() || this.sceneLayoutService.getGeometry(true),
      layout.scale,
    );
    const viewport = this.canvasService.getScreenViewportRect();
    return buildImageSessionOverlaySpecs({
      geometry,
      layout,
      viewport,
      hatchPattern: this.createHatchPattern(),
      visual: {
        dashLength: 8,
        innerBackground: "rgba(0, 0, 0, 0)",
        outerBackground: "rgba(245, 245, 245, 0.72)",
        strokeColor: "rgba(80, 80, 80, 0.9)",
        strokeStyle: "dashed",
        strokeWidth: 1,
      },
    });
  }

  private getDielineGeometry() {
    const registry = this.context?.services.get<CapabilityRegistryService>(
      CAPABILITY_REGISTRY_SERVICE,
    );
    return registry
      ?.getFacade<DielineGeometryCapabilityApi>(DIELINE_GEOMETRY_CAPABILITY_ID)
      ?.getGeometry();
  }

  private normalizeSessionGeometry(
    geometry: ReturnType<DielineGeometryCapabilityApi["getGeometry"]>,
    fallbackScale: number,
  ) {
    if (!geometry) return null;
    return {
      ...geometry,
      scale: finiteNumber(geometry.scale, fallbackScale),
    };
  }

  private createHatchPattern(
    color: string = "rgba(255, 0, 0, 0.35)",
  ): RenderPatternSpec {
    return {
      type: "pattern",
      kind: "diagonalHatch",
      color,
      size: 20,
      repetition: "repeat",
    };
  }

  private buildUploadSpecs(): RenderObjectSpec[] {
    return this.getSlotStates()
      .filter((slot) => !slot.image?.src)
      .flatMap((slot): RenderObjectSpec[] => {
        const style = slot.placeholderStyle ?? {};
        const label = style.label ?? "+";
        const specs: RenderObjectSpec[] = [
          {
            id: `upload:${slot.id}`,
            type: "rect",
            space: "scene",
            data: {
              id: slot.id,
              layerId: this.imageLayerId,
              type: "image-placement-upload",
              slotId: slot.id,
            },
            props: {
              left: slot.frame.left,
              top: slot.frame.top,
              width: slot.frame.width,
              height: slot.frame.height,
              originX: "left",
              originY: "top",
              fill: style.fill ?? "rgba(22, 119, 255, 0.08)",
              stroke: style.stroke ?? "#1677ff",
              strokeDashArray: style.strokeDashArray ?? [12, 8],
              strokeWidth: style.strokeWidth ?? 2,
              selectable: false,
              evented: true,
              hasBorders: false,
              hasControls: false,
              lockMovementX: true,
              lockMovementY: true,
              lockRotation: true,
              lockScalingFlip: true,
              lockScalingX: true,
              lockScalingY: true,
            },
          },
        ];
        if (label) {
          specs.push({
            id: `upload-label:${slot.id}`,
            type: "text",
            space: "scene",
            data: {
              type: "image-placement-upload-label",
              slotId: slot.id,
            },
            props: {
              left: slot.frame.left + slot.frame.width / 2,
              top: slot.frame.top + slot.frame.height / 2,
              originX: "center",
              originY: "center",
              text: label,
              fontSize:
                style.labelFontSize ??
                Math.max(18, Math.min(slot.frame.width, slot.frame.height) * 0.16),
              fill: style.labelFill ?? style.stroke ?? "#1677ff",
              ...(style.labelFontFamily ? { fontFamily: style.labelFontFamily } : {}),
              selectable: false,
              evented: false,
            },
          });
        }
        return specs;
      });
  }

  private updateImages() {
    void this.updateImagesAsync();
  }

  private async updateImagesAsync() {
    if (!this.canvasService) return;
    const seq = ++this.renderSeq;
    const imageSources = new Set<string>();
    [...this.getSlotStates(), ...this.getCommittedSlotStates()].forEach((slot) => {
      if (slot.image?.src) imageSources.add(slot.image.src);
    });
    await Promise.all(
      Array.from(imageSources).map((src) => this.ensureSourceSize(src)),
    );
    if (seq !== this.renderSeq) return;
    await this.canvasService.flushRenderFromProducers();
    this.emitStateChange();
  }

  private getSurfaceFrameRect(): FrameRect {
    if (!this.canvasService) return { left: 0, top: 0, width: 1, height: 1 };
    const layout = this.sceneLayoutService?.getLayout(true);
    if (layout) {
      return this.canvasService.toSceneRect({
        left: layout.cutRect.left,
        top: layout.cutRect.top,
        width: layout.cutRect.width,
        height: layout.cutRect.height,
      });
    }
    return resolveSurfaceFrameRect(this.canvasService);
  }

  private async ensureSourceSize(src: string): Promise<SourceSize | undefined> {
    return (await this.sourceSizeCache.ensureImageSize(src)) ?? undefined;
  }

  private async loadImageSize(src: string): Promise<SourceSize | null> {
    try {
      const canvasSize = await this.canvasService?.loadImageSize(src);
      if (canvasSize?.width && canvasSize?.height) {
        return canvasSize;
      }
    } catch {
      // Fall back to browser Image loading below.
    }

    return new Promise((resolve, reject) => {
      if (typeof Image === "undefined") {
        resolve(null);
        return;
      }
      const image = new Image();
      image.onload = () => {
        const width = Number(image.naturalWidth || image.width || 0);
        const height = Number(image.naturalHeight || image.height || 0);
        if (width <= 0 || height <= 0) {
          resolve(null);
          return;
        }
        resolve({ width, height });
      };
      image.onerror = () => resolve(null);
      image.src = src;
    });
  }

  private rememberSourceSizeFromMetadata(
    src: string,
    metadata: Record<string, unknown> | undefined,
  ) {
    if (!metadata) return;
    const width =
      finiteNumber(metadata.originalWidth, 0) ||
      finiteNumber(metadata.naturalWidth, 0) ||
      finiteNumber(metadata.width, 0);
    const height =
      finiteNumber(metadata.originalHeight, 0) ||
      finiteNumber(metadata.naturalHeight, 0) ||
      finiteNumber(metadata.height, 0);
    this.sourceSizeCache.rememberSourceSize(src, { width, height });
  }

  private onSceneFrameChanged = () => {
    this.updateImages();
  };
}
