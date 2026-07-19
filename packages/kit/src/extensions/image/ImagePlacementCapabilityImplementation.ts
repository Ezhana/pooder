import {
  CANVAS_SERVICE,
  CAPABILITY_REGISTRY_SERVICE,
  CONFIGURATION_SERVICE,
  EDITOR_INTERACTION_SESSION_GROUP_ID,
  ExtensionContext,
  ExtensionContributions,
  ExtensionDefinition,
  RENDER_INTENT_SERVICE,
  SCENE_SERVICE,
  SCENE_EXPORT_SERVICE,
  SCENE_LAYOUT_SERVICE,
  SURFACE_FRAME_SERVICE,
  SESSION_SERVICE,
  IMAGE_GEOMETRY_DATA_KEY,
  computeDragInteraction,
  resolveImageFitScale,
  resolveImageGeometry,
  type CanvasService,
  type CanvasObjectLike,
  type CapabilityRegistryService,
  type ConfigurationService,
  type RenderEffectSpec,
  type RenderIntentCompilerContribution,
  type RenderIntentCompilerContext,
  type RenderIntentPatch,
  type RenderObjectSpec,
  type RenderGraphNode,
  type RenderIntentTransform,
  type RenderIntentService,
  type SceneElement,
  type SceneElementInput,
  type SceneHandle,
  type SceneExportService,
  type SceneLayoutService,
  type SurfaceFrameService,
  type SceneService,
  type SessionHandle,
  type SessionService,
  type InteractionSpec,
  type InteractionActivationCommandInput,
  type ImageGeometryDescriptor,
  type RuntimeConditionExpr,
  SessionConflictError,
  TypedEventEmitter,
} from "@pooder/core";
import type {
  EditorDocument,
  EditorEffect,
  EditorLayer,
  EditorObject,
  EditorObjectEffect,
  EditorSurface,
} from "@pooder/document";
import { isGenericEditorEffect } from "@pooder/document";
import { IMAGE_PLACEMENT_OPEN_SESSION_COMMAND_ID } from "../../document/imagePlacementInteraction";
import {
  createSourceSizeCache,
  type SourceSize,
} from "../../shared/imaging/sourceSizeCache";
import {
  type FrameRect,
  resolveSurfaceFrameRect,
} from "../../shared/scene/frame";
import { KIT_LEGACY_LAYER_PRESET } from "../../shared/constants/layers";
import { SubscriptionBag } from "../../shared/runtime/subscriptions";
import {
  IMAGE_PLACEMENT_CAPABILITY_ID,
  createImagePlacementCapabilityDefinition,
  normalizeImagePlacementLayerId,
  type ImagePlacementCapabilityApi,
  type ImagePlacementCapabilityChangeEvent,
  type ImagePlacementCapabilityOptions,
  type ImagePlacementCommitTarget,
  type ImagePlacementSessionInput,
  type ImageSessionProjection,
  type ImageSessionOverlayEntry,
  type ImageSessionOverlayLayer,
  type ImageSessionOverlayProvider,
  type ImageSessionProjectionPlacement,
  type ImageSessionProjectionSurfaceScope,
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
  clearRenderIntentSource,
  patchRenderObjectSpecs,
} from "../../shared/runtime/renderIntentPatches";
import {
  CONFIGURABLE_VISUAL_CAPABILITY_ID,
  type ConfigurableVisualCapabilityApi,
} from "../configurable-visual";

export interface ImagePlacementImageState {
  src?: string;
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

interface ImagePlacementEffectPayload {
  placementId?: unknown;
  accepts?: unknown;
  commitTarget?: unknown;
  fit?: unknown;
  placeholder?: unknown;
  sessionKey?: unknown;
  sessionProjections?: unknown;
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

export interface ImagePlacementState {
  id: string;
  layerId: string;
  frame: FrameRect;
  fit: "cover" | "contain" | "stretch";
  order: number;
  visible: boolean;
  image: ImagePlacementImageState | null;
  committedImage: ImagePlacementImageState | null;
  hasImage: boolean;
  hasCommittedImage: boolean;
  sessionKey: string;
  commitTarget: ImagePlacementCommitTarget;
  placeholderStyle?: ImagePlacementPlaceholderStyle;
  sessionProjections?: ImageSessionProjection[];
  metadata?: Record<string, unknown>;
}

export interface ImagePlacementSessionNotice {
  ok: false;
  code: "image-missing" | "image-outside-frame" | "placement-not-found";
  level: "error" | "warning";
  message: string;
  placementIds: string[];
  policy: "free" | "warn" | "strict";
}

export interface ImageExportPlacementImageOptions {
  placementIds?: string[];
  multiplier?: number;
  format?: "png" | "jpeg";
}

export interface ImageExportPlacementImageResult {
  url: string;
  width: number;
  height: number;
  multiplier: number;
  format: "png" | "jpeg";
  placementIds: string[];
  frame: FrameRect;
}

export interface ImagePlacementCapabilityImplementationOptions extends ImagePlacementCapabilityOptions {
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

interface ImagePlacementSessionDraft {
  placementId: string;
  image: ImagePlacementImageState | null;
}

interface ImagePlacementSessionResult extends ImagePlacementSessionDraft {}

class ImagePlacementCommitError extends Error {
  constructor(readonly outcome: { ok: false; reason: string }) {
    super(outcome.reason);
    this.name = "ImagePlacementCommitError";
  }
}

const DEFAULT_IMAGE_LAYER_ID = KIT_LEGACY_LAYER_PRESET.imageObject;
const DEFAULT_OVERLAY_LAYER_ID = KIT_LEGACY_LAYER_PRESET.imageOverlay;
const IMAGE_OBJECT_STACK = 660;
const IMAGE_OVERLAY_STACK = 800;
const IMAGE_RENDER_SCOPE = "pooder.kit.image-placement";
const IMAGE_RUNTIME_RENDER_SCOPE = "pooder.kit.image-placement.runtime";
const IMAGE_SESSION_SCENE_PREFIX = "pooder.kit.image-placement.session";
const IMAGE_SESSION_UNDERLAY_LAYER_ID = "image.session.underlay";
const IMAGE_SESSION_IMAGE_LAYER_ID = "image.session.image";
const IMAGE_SESSION_OVERLAY_LAYER_ID = "image.session.overlay";
const IMAGE_SESSION_CONTROLS_LAYER_ID = "image.session.controls";
const IMAGE_ACTIVE_PLACEMENT_CONTEXT_PREFIX =
  "image-placement.active-placement";
const IMAGE_SESSION_CHANNEL = "image-placement";
const IMAGE_UNSCOPED_SURFACE_ID = "image-placement.unscoped";
const IMAGE_MOVE_SNAP_THRESHOLD_PX = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEditorEffect(effect: EditorObjectEffect): effect is EditorEffect {
  return isGenericEditorEffect(effect);
}

function isImageObjectSource(source: EditorObject["source"]): boolean {
  return (
    source.kind === "url" ||
    source.kind === "data-url" ||
    source.kind === "blob-url"
  );
}

function readImageObjectSourceUrl(
  source: EditorObject["source"],
): string | undefined {
  if (source.kind === "url" || source.kind === "blob-url") return source.url;
  if (source.kind === "data-url") return source.dataUrl;
  return undefined;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function finitePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clampNormalized(value: number): number {
  return Math.max(-1, Math.min(2, value));
}

function cloneImageMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return isRecord(metadata) ? { ...metadata } : undefined;
}

function cloneImageState(
  image: ImagePlacementImageState | null | undefined,
): ImagePlacementImageState | null {
  if (!image) return null;
  return {
    ...image,
    ...(image.metadata ? { metadata: cloneImageMetadata(image.metadata) } : {}),
  };
}

function readMetadataSourceSrc(
  metadata: Record<string, unknown> | undefined,
): string {
  const source = isRecord(metadata?.source) ? metadata.source : undefined;
  const sourceSrc =
    typeof source?.src === "string"
      ? source.src.trim()
      : typeof metadata?.sourceSrc === "string"
        ? metadata.sourceSrc.trim()
        : "";
  return sourceSrc;
}

function createCommittedImagePlacementTransform(
  frame: FrameRect | null | undefined,
  metadata: Record<string, unknown> | undefined,
): RenderIntentTransform | undefined {
  if (!frame) return undefined;
  const derived = isRecord(metadata?.derived) ? metadata.derived : undefined;
  const imageWidth = finitePositiveNumber(derived?.width ?? metadata?.width);
  const imageHeight = finitePositiveNumber(derived?.height ?? metadata?.height);
  return {
    left: frame.left + frame.width / 2,
    top: frame.top + frame.height / 2,
    originX: "center",
    originY: "center",
    ...(imageWidth ? { scaleX: frame.width / imageWidth } : {}),
    ...(imageHeight ? { scaleY: frame.height / imageHeight } : {}),
  };
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
  const transform = isRecord(metadata?.transform)
    ? metadata.transform
    : isRecord(metadata?.sourceTransform)
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
    metadata: metadata ?? {},
  };
}

function readImageSourceSize(
  metadata: Record<string, unknown> | undefined,
): SourceSize | undefined {
  const source = isRecord(metadata?.source) ? metadata.source : undefined;
  const sourceMetadata = isRecord(source?.metadata)
    ? source.metadata
    : undefined;
  const width = finitePositiveNumber(
    source?.width ??
      source?.naturalWidth ??
      sourceMetadata?.width ??
      sourceMetadata?.naturalWidth ??
      metadata?.originalWidth ??
      metadata?.naturalWidth ??
      metadata?.width,
  );
  const height = finitePositiveNumber(
    source?.height ??
      source?.naturalHeight ??
      sourceMetadata?.height ??
      sourceMetadata?.naturalHeight ??
      metadata?.originalHeight ??
      metadata?.naturalHeight ??
      metadata?.height,
  );
  return width && height ? { width, height } : undefined;
}

function createImageGeometryDescriptor(
  frame: FrameRect | null | undefined,
  fit: ImageGeometryDescriptor["fit"],
  image: ImagePlacementImageState | null | undefined,
): ImageGeometryDescriptor | undefined {
  if (!frame || !image) return undefined;
  const editable = createEditableWorkingImage(image);
  if (!editable) return undefined;
  const src = editable.src?.trim() || "";
  if (!src) return undefined;
  const sourceSize = readImageSourceSize(editable.metadata);
  return {
    source: {
      src,
      ...(sourceSize ? { size: sourceSize } : {}),
    },
    frame: { ...frame },
    fit,
    transform: {
      anchorX: editable.left ?? 0.5,
      anchorY: editable.top ?? 0.5,
      zoom: editable.scale ?? 1,
      rotation: editable.angle ?? 0,
      opacity: editable.opacity ?? 1,
    },
    clip: { ...frame },
  };
}

function stripDerivedImageMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next = cloneImageMetadata(metadata) ?? {};
  delete next.height;
  delete next.committedSrc;
  delete next.derived;
  delete next.sourceSrc;
  delete next.sourceTransform;
  delete next.width;
  return next;
}

function readMetadataDerivedImage(
  metadata: Record<string, unknown> | undefined,
): ImagePlacementImageState | undefined {
  const derived = isRecord(metadata?.derived) ? metadata.derived : undefined;
  const src =
    typeof derived?.src === "string"
      ? derived.src.trim()
      : typeof derived?.url === "string"
        ? derived.url.trim()
        : typeof metadata?.committedSrc === "string"
          ? metadata.committedSrc.trim()
          : "";
  if (!src) return undefined;
  return {
    src,
    metadata: {
      ...(metadata ?? {}),
      ...derived,
    },
  };
}

async function createObjectUrlFromDataUrl(
  dataUrl: string,
): Promise<string | null> {
  if (
    !dataUrl.startsWith("data:") ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof Blob === "undefined" ||
    typeof fetch !== "function"
  ) {
    return null;
  }

  try {
    const blob = await (await fetch(dataUrl)).blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

async function normalizeCommittedExportUrl(url: string): Promise<string> {
  return (await createObjectUrlFromDataUrl(url)) ?? url;
}

function normalizeImage(value: unknown): ImagePlacementImageState | null {
  if (!isRecord(value)) return null;
  const src = typeof value.src === "string" ? value.src.trim() : "";
  const image: ImagePlacementImageState = {
    ...(src ? { src } : {}),
    left: clampNormalized(finiteNumber(value.left, 0.5)),
    top: clampNormalized(finiteNumber(value.top, 0.5)),
    scale: Math.max(0.05, finiteNumber(value.scale, 1)),
    angle: finiteNumber(value.angle, 0),
    opacity: finiteNumber(value.opacity, 1),
    ...(isRecord(value.metadata) ? { metadata: { ...value.metadata } } : {}),
  };
  return image;
}

function hasImageSource(image: ImagePlacementImageState | null): boolean {
  return Boolean(image?.src);
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
  if (Number.isFinite(strokeWidth))
    style.strokeWidth = Math.max(0, strokeWidth);
  if (strokeDashArray?.length) style.strokeDashArray = strokeDashArray;
  if (typeof label === "string") style.label = label;
  if (labelFill) style.labelFill = labelFill;
  if (Number.isFinite(labelFontSize)) {
    style.labelFontSize = Math.max(1, labelFontSize);
  }
  if (labelFontFamily) style.labelFontFamily = labelFontFamily;
  return Object.keys(style).length ? style : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function normalizeSessionProjectionPlacement(
  value: unknown,
): ImageSessionProjectionPlacement {
  return value === "below" || value === "controls" ? value : "above";
}

function normalizeSessionProjectionSurfaceScope(
  value: unknown,
): ImageSessionProjectionSurfaceScope {
  return value === "all" ? "all" : "same-surface";
}

function normalizeSessionProjections(value: unknown): ImageSessionProjection[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index): ImageSessionProjection | null => {
      if (!isRecord(item)) return null;
      const sourceTags = normalizeStringList(item.sourceTags);
      if (!sourceTags.length) return null;
      const id = String(item.id || `projection-${index + 1}`).trim();
      return {
        id: id || `projection-${index + 1}`,
        placement: normalizeSessionProjectionPlacement(item.placement),
        sourceTags,
        surfaceScope: normalizeSessionProjectionSurfaceScope(item.surfaceScope),
      };
    })
    .filter((item): item is ImageSessionProjection => Boolean(item));
}

function normalizeCommitTarget(
  value: unknown,
  fallbackObjectId: string,
): ImagePlacementCommitTarget {
  return (
    readCommitTarget(value) ?? {
      type: "document-object",
      objectId: fallbackObjectId,
    }
  );
}

function readCommitTarget(value: unknown): ImagePlacementCommitTarget | null {
  if (isRecord(value)) {
    const type = typeof value.type === "string" ? value.type.trim() : "";
    if (type === "configurable-visual") {
      const key = typeof value.key === "string" ? value.key.trim() : "";
      const configKey =
        typeof value.configKey === "string" ? value.configKey.trim() : "";
      if (key) {
        return {
          type: "configurable-visual",
          key,
          ...(configKey ? { configKey } : {}),
        };
      }
    }
    if (type === "document-object") {
      const objectId =
        typeof value.objectId === "string" ? value.objectId.trim() : "";
      if (objectId) return { type: "document-object", objectId };
    }
  }
  return null;
}

function normalizeConfigurableVisualCommitTarget(
  value: unknown,
): ImagePlacementCommitTarget | null {
  if (!isRecord(value)) return null;
  const key = typeof value.key === "string" ? value.key.trim() : "";
  if (!key) return null;
  const configKey =
    typeof value.configKey === "string" ? value.configKey.trim() : "";
  return {
    type: "configurable-visual",
    key,
    ...(configKey ? { configKey } : {}),
  };
}

function getImagePlacementData(element: SceneElement): Record<string, unknown> {
  const data = isRecord(element.data) ? element.data : {};
  const placement = isRecord(data.imagePlacement) ? data.imagePlacement : {};
  return placement;
}

function getPlacementFrame(element: SceneElement): FrameRect | null {
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

export class ImagePlacementCapabilityImplementation implements ExtensionDefinition {
  id: string;
  metadata = {
    name: "ImagePlacementCapability",
  };
  activation = {
    requiresServices: [
      CANVAS_SERVICE,
      RENDER_INTENT_SERVICE,
      SCENE_SERVICE,
      SESSION_SERVICE,
    ],
  };

  private canvasService?: CanvasService;
  private renderIntentService?: RenderIntentService;
  private sceneService?: SceneService;
  private sceneLayoutService?: SceneLayoutService;
  private surfaceFrameService?: SurfaceFrameService;
  private exportService?: SceneExportService;
  private sessionService?: SessionService;
  private context?: ExtensionContext;
  private sceneSubscription?: { dispose(): void };
  private readonly subscriptions = new SubscriptionBag();
  private readonly capabilityId: string;
  private readonly imageLayerId: string;
  private readonly overlayLayerId: string;
  private readonly sourceSizeCache = createSourceSizeCache((src) =>
    this.loadImageSize(src),
  );
  private workingImages = new Map<string, ImagePlacementImageState | null>();
  private retainedWorkingImageBaselines = new Map<
    string,
    ImagePlacementImageState | null
  >();
  private activeWorkingPlacementConditionKeys = new Set<string>();
  private pendingUploadPlacementIds = new Set<string>();
  private sessionIdsByPlacementId = new Map<string, string>();
  private suspendedDraftsBySessionId = new Map<
    string,
    ImagePlacementSessionDraft
  >();
  private sessionHandlesBySessionId = new Map<
    string,
    SessionHandle<ImagePlacementSessionDraft, ImagePlacementSessionResult>
  >();
  private sessionScenesBySessionId = new Map<string, SceneHandle>();
  private generatedCommittedExportObjectUrls = new Set<string>();
  private activePlacementId: string | null = null;
  private activeImageSessionId: string | null = null;
  private sessionNotice: ImagePlacementSessionNotice | null = null;
  private isPublishingImageSessionScenes = false;
  private renderSeq = 0;
  private activeSnapX: SnapMatch | null = null;
  private activeSnapY: SnapMatch | null = null;
  private movingPlacementId: string | null = null;
  private pendingCanvasTransformSync: Promise<void> = Promise.resolve();
  private readonly events = new TypedEventEmitter<{
    change: ImagePlacementCapabilityChangeEvent;
  }>();
  private readonly sessionOverlayProviders = new Map<
    string,
    ImageSessionOverlayProvider
  >();

  constructor(options: ImagePlacementCapabilityImplementationOptions = {}) {
    this.id =
      String(options.id || IMAGE_PLACEMENT_CAPABILITY_ID).trim() ||
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
  }

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService =
      context.services.getOrThrow<CanvasService>(CANVAS_SERVICE);
    this.renderIntentService = context.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    this.sceneService =
      context.services.getOrThrow<SceneService>(SCENE_SERVICE);
    this.sceneLayoutService =
      context.services.get<SceneLayoutService>(SCENE_LAYOUT_SERVICE);
    this.surfaceFrameService = context.services.get<SurfaceFrameService>(
      SURFACE_FRAME_SERVICE,
    );
    this.exportService =
      context.services.get<SceneExportService>(SCENE_EXPORT_SERVICE);
    this.sessionService =
      context.services.getOrThrow<SessionService>(SESSION_SERVICE);

    this.sceneSubscription?.dispose();
    this.sceneSubscription = this.sceneService?.onDidChange((event) => {
      if (
        this.isPublishingImageSessionScenes ||
        this.isSessionSceneChange(event)
      ) {
        return;
      }
      this.updateImages();
    });
    this.subscriptions.add(
      this.canvasService.on("selection", (event) => {
        if (event.kind === "cleared") this.onSelectionCleared();
      }),
    );
    this.subscriptions.add(
      this.canvasService.on("transform", (event) =>
        this.onCanvasTransform(event.kind, event.target),
      ),
    );
    this.subscriptions.add(
      this.sessionService.onDidTerminate((event) => {
        if (event.descriptor.ownerId !== this.id) return;
        this.finalizeTerminatedSession(
          event.descriptor.sessionId,
          event.reason,
        );
      }),
    );
    this.attachLayoutSubscriptions();
    this.updateImages();
  }

  async deactivate() {
    let sessionCleanupError: unknown;
    try {
      await this.cancelAllImageSessions();
    } catch (error) {
      sessionCleanupError = error;
    }
    this.subscriptions.disposeAll();
    this.sceneSubscription?.dispose();
    this.sceneSubscription = undefined;
    clearRenderIntentSource(
      this.renderIntentService,
      IMAGE_RUNTIME_RENDER_SCOPE,
    );
    this.workingImages.clear();
    this.retainedWorkingImageBaselines.clear();
    this.sessionOverlayProviders.clear();
    this.sessionIdsByPlacementId.clear();
    this.suspendedDraftsBySessionId.clear();
    this.sessionHandlesBySessionId.clear();
    this.sessionScenesBySessionId.clear();
    this.activePlacementId = null;
    this.activeImageSessionId = null;
    this.clearWorkingPlacementConditionContext();
    this.sourceSizeCache.clear();
    this.revokeAllGeneratedCommittedExportObjectUrls();
    this.endMoveSnapInteraction();
    this.pendingCanvasTransformSync = Promise.resolve();
    this.canvasService?.requestRenderAll();
    this.canvasService = undefined;
    this.renderIntentService = undefined;
    this.sceneService = undefined;
    this.sceneLayoutService = undefined;
    this.surfaceFrameService = undefined;
    this.exportService = undefined;
    this.sessionService = undefined;
    this.context = undefined;
    this.events.clear();
    if (sessionCleanupError) throw sessionCleanupError;
  }

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createImagePlacementCapabilityDefinition(
          this.getImagePlacementFacade(),
          {
            capabilityId: this.capabilityId,
            layers: {
              imageLayerId: this.imageLayerId,
              overlayLayerId: this.overlayLayerId,
            },
          },
        ),
      ],
      commands: [
        {
          id: IMAGE_PLACEMENT_OPEN_SESSION_COMMAND_ID,
          command: IMAGE_PLACEMENT_OPEN_SESSION_COMMAND_ID,
          title: "Open Image Placement Session",
          handler: (input: InteractionActivationCommandInput) =>
            this.openSessionFromInteraction(input),
        },
      ],
      renderIntentCompilers: [this.createRenderIntentCompiler()],
    };
  }

  private createRenderIntentCompiler(): RenderIntentCompilerContribution<
    EditorEffect<ImagePlacementEffectPayload>,
    EditorDocument
  > {
    return {
      capabilityId: this.capabilityId,
      effectType: "image-placement",
      compile: (context) => this.compileDocumentImagePlacementEffect(context),
    };
  }

  private compileDocumentImagePlacementEffect(
    context: RenderIntentCompilerContext<
      EditorEffect<ImagePlacementEffectPayload>,
      EditorDocument
    >,
  ): RenderIntentPatch | void {
    if (context.target.kind !== "object" || !context.target.objectId) return;
    const resolved = this.findDocumentImageObject(
      context.document,
      context.target.objectId,
    );
    if (!resolved) return;
    const { object } = resolved;
    if (!object.frame) return;

    const payload = isRecord(context.effect.payload)
      ? context.effect.payload
      : {};
    const fit =
      payload.fit === "contain" || payload.fit === "stretch"
        ? payload.fit
        : "cover";
    const sessionKey = this.normalizeSessionKey(payload.sessionKey, object.id);
    const commitTarget = this.resolveDocumentObjectCommitTarget(
      object,
      payload,
    );
    const frame = {
      left: object.frame.x,
      top: object.frame.y,
      width: object.frame.width,
      height: object.frame.height,
    };
    const committed = this.resolveDocumentCommittedImage(
      context.document,
      object,
    );
    const committedTransform = committed
      ? createCommittedImagePlacementTransform(frame, committed.metadata)
      : undefined;
    const imageGeometry = createImageGeometryDescriptor(frame, fit, committed);
    const imagePlacementData = {
      enabled: true,
      placementId: object.id,
      sessionKey,
      commitTarget,
      frame: object.frame,
      ...(committed ? { image: committed } : {}),
      fit,
      accepts: Array.isArray(payload.accepts) ? payload.accepts : ["image"],
      ...(isRecord(payload.placeholder)
        ? { placeholder: payload.placeholder }
        : {}),
      sessionProjections: normalizeSessionProjections(
        payload.sessionProjections,
      ),
    };
    return {
      id: object.id,
      ...(committed
        ? {
            visual: { type: "image", replacement: committed },
          }
        : {}),
      placement: {
        fit,
        ...(committedTransform ? { transform: committedTransform } : {}),
      },
      data: {
        id: object.id,
        layerId: resolved.layer.id,
        imagePlacement: imagePlacementData,
        placementId: object.id,
        sessionKey,
        commitTarget,
        source: committed ? "committed" : "target",
        type: committed ? "image-placement-image" : "image-placement-target",
        ...(imageGeometry ? { [IMAGE_GEOMETRY_DATA_KEY]: imageGeometry } : {}),
      },
    };
  }

  private resolveDocumentObjectCommitTarget(
    object: EditorObject,
    payload: ImagePlacementEffectPayload,
  ): ImagePlacementCommitTarget {
    if (isRecord(payload.commitTarget)) {
      return normalizeCommitTarget(payload.commitTarget, object.id);
    }
    const configurableVisualEffect = object.effects?.find(
      (effect): effect is EditorEffect =>
        isEditorEffect(effect) && effect.type === "configurable-visual",
    );
    const configurableVisualTarget = normalizeConfigurableVisualCommitTarget(
      configurableVisualEffect?.payload,
    );
    return (
      configurableVisualTarget ?? {
        type: "document-object",
        objectId: object.id,
      }
    );
  }

  private findDocumentImageObject(
    document: EditorDocument,
    objectId: string,
  ): {
    surface: EditorSurface;
    layer: EditorLayer;
    object: EditorObject;
  } | null {
    for (const surface of document.surfaces) {
      for (const layer of surface.layers) {
        const object = layer.objects?.find((item) => item.id === objectId);
        if (object && isImageObjectSource(object.source)) {
          return { surface, layer, object };
        }
      }
    }
    return null;
  }

  private resolveDocumentImageState(
    _document: EditorDocument,
    object: EditorObject,
  ): ImagePlacementImageState | undefined {
    const placementMetadata = isRecord(object.metadata?.imagePlacement)
      ? object.metadata.imagePlacement
      : undefined;
    const source = isRecord(placementMetadata?.source)
      ? placementMetadata.source
      : undefined;
    const src =
      typeof source?.src === "string" && source.src
        ? source.src
        : readImageObjectSourceUrl(object.source);
    const placementTransform = readMetadataSourceTransform(placementMetadata, {
      left: 0.5,
      top: 0.5,
      scale: 1,
      angle: 0,
      opacity: 1,
    });
    if (!src) return undefined;
    return {
      src,
      left: placementTransform.left,
      top: placementTransform.top,
      scale: placementTransform.scale,
      angle: placementTransform.angle,
      opacity: placementTransform.opacity,
      ...(placementMetadata ? { metadata: { ...placementMetadata } } : {}),
    };
  }

  private resolveDocumentCommittedImage(
    _document: EditorDocument,
    object: EditorObject,
  ): ImagePlacementImageState | undefined {
    const metadata = isRecord(object.metadata?.imagePlacement)
      ? object.metadata.imagePlacement
      : {};
    return readMetadataDerivedImage(metadata);
  }

  private getImagePlacementFacade(): ImagePlacementCapabilityApi {
    return {
      onDidChange: (listener) => this.events.on("change", listener),
      applyOperation: (input, operation) =>
        this.applyImageOperation(input, operation),
      clearImage: (input) => this.clearImage(input),
      commitSession: (input) => this.completeSession(input),
      exportPlacementImage: (options) => this.exportPlacementImage(options),
      focusPlacement: (placementId, options) =>
        this.focusPlacement(placementId, options),
      getViewState: () => this.getViewState(),
      openSession: (input) => this.beginSession(input, "api"),
      rollbackSession: async (input) => {
        await this.resetSession(input);
        return { ok: true };
      },
      setSource: (input, source) =>
        this.setImageSource(
          input,
          typeof source === "string" ? { src: source } : source,
        ),
      setTransform: (input, transform) =>
        this.setImageTransform(input, transform),
      validateSession: (input) => this.validateSession(input),
      registerSessionOverlayProvider: (provider) =>
        this.registerSessionOverlayProvider(provider),
      refresh: () => this.updateImagesAsync(),
    };
  }

  private registerSessionOverlayProvider(
    provider: ImageSessionOverlayProvider,
  ): { dispose(): void } {
    const id = String(provider?.id || "").trim();
    if (!id) {
      throw new Error("Image session overlay provider requires id.");
    }
    const registered = { ...provider, id };
    this.sessionOverlayProviders.set(id, registered);
    this.publishImageSessionScenes();
    this.canvasService?.requestRenderAll();
    return {
      dispose: () => {
        if (this.sessionOverlayProviders.get(id) !== registered) return;
        this.sessionOverlayProviders.delete(id);
        this.publishImageSessionScenes();
        this.canvasService?.requestRenderAll();
      },
    };
  }

  private getPlacementElements(): SceneElement[] {
    const graphPlacements = this.getGraphPlacementElements();
    const scenePlacements = (this.sceneService?.selectElements() ?? [])
      .filter((element) => getImagePlacementData(element).enabled === true)
      .sort((a, b) => a.order - b.order);
    if (graphPlacements.length === 0) return scenePlacements;

    const graphPlacementIds = new Set(
      graphPlacements.map((placement) => placement.id),
    );
    return [
      ...graphPlacements,
      ...scenePlacements.filter(
        (placement) => !graphPlacementIds.has(placement.id),
      ),
    ].sort((a, b) => a.order - b.order);
  }

  private getGraphPlacementElements(): SceneElement[] {
    const graph = this.renderIntentService?.getGraph();
    if (!graph) return [];
    return graph.layers
      .flatMap((layer) =>
        layer.nodes.map((node) => this.graphNodeToPlacementElement(node)),
      )
      .filter((element): element is SceneElement => Boolean(element))
      .sort((a, b) => a.order - b.order);
  }

  private graphNodeToPlacementElement(
    node: RenderGraphNode,
  ): SceneElement | null {
    const imagePlacement = isRecord(node.data.imagePlacement)
      ? node.data.imagePlacement
      : undefined;
    if (!imagePlacement || imagePlacement.enabled !== true) return null;
    const frame = node.frame;
    return {
      id: node.subjectId,
      layerId: node.layerId,
      type: "rect",
      order: node.sortKey.objectOrder,
      visible: node.visible,
      metadata: isRecord(node.data) ? { ...node.data } : undefined,
      data: {
        id: node.subjectId,
        layerId: node.layerId,
        placementId: node.subjectId,
        type: "image-placement-target",
        sessionKey:
          typeof imagePlacement.sessionKey === "string"
            ? imagePlacement.sessionKey
            : node.subjectId,
        imagePlacement: {
          ...imagePlacement,
          commitTarget: readCommitTarget(imagePlacement.commitTarget) ??
            normalizeConfigurableVisualCommitTarget(
              node.data.configurableVisual,
            ) ?? { type: "document-object", objectId: node.subjectId },
        },
      },
      effects: node.effects,
      style: node.props,
      transform: {
        left: frame?.x ?? 0,
        top: frame?.y ?? 0,
        originX: "left",
        originY: "top",
      },
      width: frame?.width ?? 1,
      height: frame?.height ?? 1,
    };
  }

  private getPlacementElement(placementId: string): SceneElement | undefined {
    return this.getPlacementElements().find(
      (placement) => placement.id === placementId,
    );
  }

  private getCommittedImage(
    placement: SceneElement,
  ): ImagePlacementImageState | null {
    return normalizeImage(getImagePlacementData(placement).image);
  }

  private getEffectiveImage(
    placement: SceneElement,
  ): ImagePlacementImageState | null {
    if (this.workingImages.has(placement.id)) {
      return this.workingImages.get(placement.id) ?? null;
    }
    return this.getCommittedImage(placement);
  }

  private getPlacementState(element: SceneElement): ImagePlacementState | null {
    const frame = getPlacementFrame(element);
    if (!frame) return null;
    const placementData = getImagePlacementData(element);
    const fit =
      placementData.fit === "contain" || placementData.fit === "stretch"
        ? placementData.fit
        : "cover";
    const committedImage = this.getCommittedImage(element);
    const image = this.getEffectiveImage(element);
    const metadata = isRecord(element.metadata)
      ? { ...element.metadata }
      : undefined;
    return {
      id: element.id,
      layerId: element.layerId,
      frame,
      fit,
      order: element.order,
      visible: element.visible,
      image,
      committedImage,
      hasImage: hasImageSource(image),
      hasCommittedImage: hasImageSource(committedImage),
      sessionKey:
        typeof placementData.sessionKey === "string"
          ? placementData.sessionKey
          : this.getFallbackImageSessionId(element.id),
      commitTarget: readCommitTarget(placementData.commitTarget) ??
        normalizeConfigurableVisualCommitTarget(
          metadata?.configurableVisual,
        ) ?? { type: "document-object", objectId: element.id },
      placeholderStyle: normalizePlaceholderStyle(placementData.placeholder),
      sessionProjections: normalizeSessionProjections(
        placementData.sessionProjections,
      ),
      metadata,
    };
  }

  private getPlacementStates(): ImagePlacementState[] {
    return this.getPlacementElements()
      .map((placement) => this.getPlacementState(placement))
      .filter((placement): placement is ImagePlacementState =>
        Boolean(placement),
      );
  }

  private getCommittedPlacementStates(): ImagePlacementState[] {
    return this.getPlacementElements()
      .map((placement) => {
        const state = this.getPlacementState(placement);
        const image = this.getCommittedImage(placement);
        return state
          ? {
              ...state,
              image,
              committedImage: image,
              hasImage: hasImageSource(image),
              hasCommittedImage: hasImageSource(image),
            }
          : null;
      })
      .filter((placement): placement is ImagePlacementState =>
        Boolean(placement),
      );
  }

  private getViewState(): ImagePlacementViewState {
    const placements = this.getPlacementStates();
    const focusedPlacement =
      placements.find((placement) => placement.id === this.activePlacementId) ||
      null;
    return {
      placements,
      activePlacementId: this.activePlacementId,
      focusedPlacement,
      hasAnyImage: placements.some((placement) => placement.hasImage),
      hasWorkingChanges: this.workingImages.size > 0,
      sessionNotice: this.sessionNotice,
    };
  }

  private emitStateChange() {
    this.events.emit("change", { type: "state", state: this.getViewState() });
  }

  private setSessionNotice(notice: ImagePlacementSessionNotice | null) {
    if (this.sessionNotice === notice) return;
    this.sessionNotice = notice;
    this.events.emit("change", { type: "session-notice", notice });
    this.emitStateChange();
  }

  private normalizeSessionInput(input?: ImagePlacementSessionInput | string): {
    placementId: string;
    sessionId: string;
  } {
    const placementId =
      typeof input === "string"
        ? input.trim()
        : String(input?.placementId || "").trim();
    const sessionId =
      typeof input === "object" ? String(input.sessionId || "").trim() : "";
    return {
      placementId,
      sessionId: sessionId || this.getFallbackImageSessionId(placementId),
    };
  }

  private getActiveSessionInput(input?: ImagePlacementSessionInput | string) {
    if (input !== undefined) {
      return this.normalizeSessionInput(input);
    }

    const placementId = this.activePlacementId || "";
    const sessionId = placementId
      ? this.sessionIdsByPlacementId.get(placementId) ||
        this.activeImageSessionId ||
        ""
      : this.activeImageSessionId || "";

    return {
      placementId,
      sessionId: sessionId || this.getFallbackImageSessionId(placementId),
    };
  }

  private setWorkingImageDraft(
    placementId: string,
    sessionId: string,
    image: ImagePlacementImageState | null,
  ) {
    this.workingImages.set(placementId, image);
    void sessionId;
  }

  private async beginSession(
    input: ImagePlacementSessionInput | string,
    source: "api" | "document-interaction" = "api",
  ) {
    const { placementId, sessionId } = this.normalizeSessionInput(input);
    const placement = this.getPlacementElement(placementId);
    if (!placement) return { ok: false, reason: "placement-not-found" };
    const placementState = this.getPlacementState(placement);
    if (!placementState) return { ok: false, reason: "placement-not-found" };
    if (!this.sessionService || !this.sceneService) {
      return { ok: false, reason: "session-services-unavailable" };
    }

    const isNewSession = !this.sessionHandlesBySessionId.has(sessionId);
    const previousActiveSessionId = this.activeImageSessionId;
    if (previousActiveSessionId && previousActiveSessionId !== sessionId) {
      await this.sessionHandlesBySessionId
        .get(previousActiveSessionId)
        ?.cancel();
    }

    const previousSessionId = this.sessionIdsByPlacementId.get(placementId);
    const suspendedDraft = this.suspendedDraftsBySessionId.get(sessionId);
    const initialImage = suspendedDraft
      ? cloneImageState(suspendedDraft.image)
      : previousSessionId === sessionId && this.workingImages.has(placementId)
        ? cloneImageState(this.workingImages.get(placementId))
        : createEditableWorkingImage(this.getCommittedImage(placement));
    const initialDraft: ImagePlacementSessionDraft = {
      placementId,
      image: initialImage,
    };
    let handle: SessionHandle<
      ImagePlacementSessionDraft,
      ImagePlacementSessionResult
    >;
    try {
      handle = await this.sessionService.open({
        descriptor: {
          sessionId,
          ownerId: this.id,
          scope: {
            surfaceId: this.resolvePlacementSurfaceId(placementState),
            subjectId: placementId,
            channel: IMAGE_SESSION_CHANNEL,
            groupId: EDITOR_INTERACTION_SESSION_GROUP_ID,
          },
          interactionMode: "exclusive",
          leavePolicy: "block",
        },
        initialDraft,
        lifecycle: {
          validate: async () => {
            if (
              this.workingImages.has(placementId) &&
              !this.workingImages.get(placementId)?.src
            ) {
              return { ok: true };
            }
            const validation = await this.validateSession({
              placementId,
              sessionId,
            });
            return validation.ok
              ? { ok: true }
              : { ok: false, detail: validation };
          },
          commit: () => this.commitImageSession(placementId, sessionId),
          rollback: () =>
            this.rollbackImageSession(placementId, sessionId, false),
          cancel: () => this.rollbackImageSession(placementId, sessionId, true),
        },
      });
    } catch (error) {
      if (error instanceof SessionConflictError) {
        return { ok: false, reason: "session-conflict" };
      }
      throw error;
    }

    this.sessionHandlesBySessionId.set(sessionId, handle);
    this.activePlacementId = placementId;
    this.activeImageSessionId = sessionId;
    this.sessionIdsByPlacementId.set(placementId, sessionId);
    this.ensureImageSessionScene(placementState, sessionId, handle);
    this.patchCommittedImageConditionsForPlacements();
    this.workingImages.set(
      placementId,
      cloneImageState(handle.getDraft().image),
    );
    const workingImage = this.workingImages.get(placementId);
    if (workingImage?.src) {
      this.rememberSourceSizeFromMetadata(
        workingImage.src,
        workingImage.metadata,
      );
    }
    this.syncWorkingPlacementConditionContext();
    this.setSessionNotice(null);
    this.publishImageSessionScenes();
    await this.updateImagesAsync();
    if (isNewSession) {
      this.events.emit("change", {
        type: "session-opened",
        event: {
          sessionId,
          sessionKey: placementState.sessionKey,
          placementId,
          source,
          scope: {
            surfaceId: this.resolvePlacementSurfaceId(placementState),
            subjectId: placementId,
            channel: IMAGE_SESSION_CHANNEL,
            groupId: EDITOR_INTERACTION_SESSION_GROUP_ID,
          },
        },
      });
    }
    return { ok: true };
  }

  private async openSessionFromInteraction(
    input: InteractionActivationCommandInput | undefined,
  ) {
    const placementId = String(input?.subjectId || "").trim();
    const sessionId = String(
      input?.session?.sessionId || input?.sessionId || "",
    ).trim();
    return await this.beginSession(
      { placementId, sessionId },
      "document-interaction",
    );
  }

  private async ensurePlacementSession(placementId: string, sessionId: string) {
    if (
      this.workingImages.has(placementId) &&
      this.sessionIdsByPlacementId.get(placementId) === sessionId
    ) {
      return { ok: true };
    }
    return await this.beginSession({ placementId, sessionId });
  }

  private async requestUpload(input: ImagePlacementSessionInput | string) {
    const { placementId, sessionId } = this.normalizeSessionInput(input);
    if (this.pendingUploadPlacementIds.has(placementId)) {
      return { ok: false, reason: "upload-pending" };
    }
    const placement = this.getPlacementStates().find(
      (item) => item.id === placementId,
    );
    if (!placement) return { ok: false, reason: "placement-not-found" };
    void sessionId;
    return { ok: false, reason: "upload-unavailable" };
  }

  private async setImageSource(
    input: ImagePlacementSessionInput | string,
    source: ImagePlacementSource,
  ) {
    const { placementId, sessionId } = this.normalizeSessionInput(input);
    const src = String(source.src || "").trim();
    if (!src) return { ok: false, reason: "image-source-required" };
    const placement = this.getPlacementElement(placementId);
    if (!placement) return { ok: false, reason: "placement-not-found" };
    const session = await this.ensurePlacementSession(placementId, sessionId);
    if (!session.ok) return session;
    const current =
      this.workingImages.get(placementId) ||
      this.getCommittedImage(placement) ||
      {};
    this.setWorkingImageDraft(placementId, sessionId, {
      ...current,
      src,
      metadata: {
        ...stripDerivedImageMetadata(current.metadata),
        ...(source.metadata ?? {}),
        source: {
          src,
          ...(source.metadata ? { metadata: { ...source.metadata } } : {}),
        },
      },
      left: current.left ?? 0.5,
      top: current.top ?? 0.5,
      scale: current.scale ?? 1,
      angle: current.angle ?? 0,
      opacity: current.opacity ?? 1,
    });
    this.upsertImageSessionDraft(
      placementId,
      this.workingImages.get(placementId) ?? null,
      sessionId,
    );
    this.syncWorkingPlacementConditionContext();
    this.rememberSourceSizeFromMetadata(src, source.metadata);
    if (!this.retainedWorkingImageBaselines.has(placementId)) {
      this.retainWorkingImageBaseline(placementId);
    }
    this.publishImageSessionScenes();
    this.emitStateChange();
    await this.updateImagesAsync();
    return { ok: true };
  }

  private async setImageTransform(
    input: ImagePlacementSessionInput | string,
    updates: ImagePlacementTransformUpdates,
    options: { skipRender?: boolean } = {},
  ) {
    const { placementId, sessionId } = this.normalizeSessionInput(input);
    const placement = this.getPlacementElement(placementId);
    if (!placement) return { ok: false, reason: "placement-not-found" };
    const session = await this.ensurePlacementSession(placementId, sessionId);
    if (!session.ok) return session;
    const current =
      this.workingImages.get(placementId) ||
      this.getCommittedImage(placement) ||
      {};
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
    next.metadata = {
      ...(next.metadata ?? {}),
      transform: resolveImageTransformSnapshot(next),
    };
    this.setWorkingImageDraft(placementId, sessionId, next);
    this.publishImageSessionScenes();
    this.upsertImageSessionDraft(placementId, next, sessionId);
    this.syncWorkingPlacementConditionContext();
    if (!options.skipRender) {
      this.updateImages();
    }
    this.emitStateChange();
    return { ok: true };
  }

  private async applyImageOperation(
    input: ImagePlacementSessionInput | string,
    operation: ImageOperation,
  ) {
    const { placementId, sessionId } = this.normalizeSessionInput(input);
    const placement = this.getPlacementStates().find(
      (item) => item.id === placementId,
    );
    const image = placement?.image;
    if (!placement) return { ok: false, reason: "placement-not-found" };
    if (!image?.src) return { ok: false, reason: "image-missing" };
    const source = await this.ensureSourceSize(image.src);
    if (!source) return { ok: false, reason: "image-size-unavailable" };
    const area = resolveImageOperationArea({
      frame: placement.frame,
      viewport: placement.frame,
      area: "area" in operation ? operation.area : undefined,
    });
    const updates = computeImageOperationUpdates({
      frame: placement.frame,
      source,
      fit: placement.fit,
      operation,
      area,
    });
    return await this.setImageTransform({ placementId, sessionId }, updates);
  }

  private async clearImage(input: ImagePlacementSessionInput | string) {
    const { placementId, sessionId } = this.normalizeSessionInput(input);
    const placement = this.getPlacementElement(placementId);
    if (!placement) return { ok: false, reason: "placement-not-found" };
    const session = await this.ensurePlacementSession(placementId, sessionId);
    if (!session.ok) return session;
    this.setWorkingImageDraft(placementId, sessionId, null);
    this.upsertImageSessionDraft(placementId, null, sessionId);
    this.syncWorkingPlacementConditionContext();
    this.updateImages();
    this.emitStateChange();
    return { ok: true };
  }

  private async resetSession(input?: ImagePlacementSessionInput | string) {
    const { placementId, sessionId } = this.getActiveSessionInput(input);
    for (const id of this.resolveSessionTargetIds(placementId)) {
      const targetSessionId =
        id === placementId
          ? sessionId
          : this.sessionIdsByPlacementId.get(id) ||
            this.getFallbackImageSessionId(id);
      const handle = this.sessionHandlesBySessionId.get(targetSessionId);
      if (handle) {
        await handle.rollback();
      } else {
        this.restoreOrDeleteWorkingImage(id);
      }
    }
    if (placementId) {
      if (this.activePlacementId === placementId) {
        this.activePlacementId = null;
        this.activeImageSessionId = null;
      }
    } else {
      Array.from(this.workingImages.keys()).forEach((id) =>
        this.restoreOrDeleteWorkingImage(id),
      );
      this.activePlacementId = null;
      this.activeImageSessionId = null;
    }
    this.syncWorkingPlacementConditionContext();
    this.setSessionNotice(null);
    this.publishRuntimeRenderIntents();
    this.updateImages();
  }

  private async validateSession(input?: ImagePlacementSessionInput | string) {
    const { placementId } = this.getActiveSessionInput(input);
    const policy = this.getPlacementPolicy();
    const targetIds = this.resolveSessionTargetIds(placementId);
    await this.pendingCanvasTransformSync;
    const targetIdSet = new Set(targetIds);
    const placements = this.getPlacementStates().filter((placement) =>
      targetIdSet.has(placement.id),
    );
    const missing = placements.filter((placement) => !placement.image?.src);
    if (missing.length) {
      const notice = this.createNotice(
        "image-missing",
        missing.map((placement) => placement.id),
        {
          level: "error",
          policy,
        },
      );
      this.setSessionNotice(notice);
      return notice;
    }

    if (policy === "free") {
      this.setSessionNotice(null);
      return { ok: true as const };
    }

    const outside: string[] = [];
    for (const placement of placements) {
      const image = placement.image;
      if (!image?.src) continue;
      const source = await this.ensureSourceSize(image.src);
      if (!source) continue;
      const result = validateImagePlacement({
        frame: placement.frame,
        source,
        fit: placement.fit,
        placement: {
          left: image.left ?? 0.5,
          top: image.top ?? 0.5,
          scale: image.scale ?? 1,
          angle: image.angle ?? 0,
        },
      });
      if (!result.ok) outside.push(placement.id);
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

  private async completeSession(input?: ImagePlacementSessionInput | string) {
    const { placementId, sessionId } = this.getActiveSessionInput(input);
    const targetIds = this.resolveSessionTargetIds(placementId);
    for (const id of targetIds) {
      const targetSessionId =
        id === placementId
          ? sessionId
          : this.sessionIdsByPlacementId.get(id) ||
            this.getFallbackImageSessionId(id);
      const ensured = await this.ensurePlacementSession(id, targetSessionId);
      if (!ensured.ok) return ensured;
      const handle = this.sessionHandlesBySessionId.get(targetSessionId);
      if (!handle) return { ok: false, reason: "session-not-found" };
      try {
        const outcome = await handle.commit();
        if (!outcome.ok) {
          const detail = outcome.validation.detail;
          return isRecord(detail) && detail.ok === false
            ? (detail as unknown as ImagePlacementSessionNotice)
            : { ok: false, reason: "validation-failed" };
        }
      } catch (error) {
        if (error instanceof ImagePlacementCommitError) return error.outcome;
        throw error;
      }
    }
    await this.updateImagesAsync();
    this.emitStateChange();
    return { ok: true };
  }

  private async commitImageSession(
    placementId: string,
    _sessionId: string,
  ): Promise<ImagePlacementSessionResult> {
    const image = cloneImageState(this.workingImages.get(placementId));
    const outcome = await this.commitWorkingImagesAsCropped([placementId]);
    if (!outcome.ok) {
      throw new ImagePlacementCommitError({
        ok: false,
        reason: outcome.reason ?? "image-commit-failed",
      });
    }
    return { placementId, image };
  }

  private rollbackImageSession(
    placementId: string,
    sessionId: string,
    preserveDraft: boolean,
  ): void {
    if (preserveDraft) {
      const draft = this.sessionHandlesBySessionId.get(sessionId)?.getDraft();
      if (draft) {
        this.suspendedDraftsBySessionId.set(sessionId, {
          placementId: draft.placementId,
          image: cloneImageState(draft.image),
        });
      }
    } else {
      this.suspendedDraftsBySessionId.delete(sessionId);
    }
    this.restoreOrDeleteWorkingImage(placementId);
    this.retainedWorkingImageBaselines.delete(placementId);
    if (this.sessionIdsByPlacementId.get(placementId) === sessionId) {
      this.sessionIdsByPlacementId.delete(placementId);
    }
    if (this.activeImageSessionId === sessionId) {
      this.activeImageSessionId = null;
      this.activePlacementId = null;
    }
    this.syncWorkingPlacementConditionContext();
    this.setSessionNotice(null);
    this.publishRuntimeRenderIntents();
  }

  private finalizeTerminatedSession(
    sessionId: string,
    reason: "committed" | "rolled-back" | "cancelled",
  ): void {
    const handle = this.sessionHandlesBySessionId.get(sessionId);
    const placementId = handle?.getDraft().placementId;
    this.sessionHandlesBySessionId.delete(sessionId);
    this.sessionScenesBySessionId.delete(sessionId);
    if (
      placementId &&
      this.sessionIdsByPlacementId.get(placementId) === sessionId
    ) {
      this.sessionIdsByPlacementId.delete(placementId);
    }
    if (this.activeImageSessionId === sessionId) {
      this.activeImageSessionId = null;
      this.activePlacementId = null;
    }
    if (reason !== "cancelled") {
      this.suspendedDraftsBySessionId.delete(sessionId);
    }
    if (reason === "committed" && placementId) {
      this.retainedWorkingImageBaselines.delete(placementId);
    }
    this.syncWorkingPlacementConditionContext();
    this.publishRuntimeRenderIntents();
    this.events.emit("change", {
      type: "session-closed",
      event: { sessionId, placementId: placementId ?? null, reason },
    });
    this.emitStateChange();
  }

  private async cancelAllImageSessions(): Promise<void> {
    const errors: unknown[] = [];
    for (const handle of [
      ...this.sessionHandlesBySessionId.values(),
    ].reverse()) {
      try {
        await handle.cancel();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(
        errors,
        "Image placement session cleanup failed.",
      );
    }
  }

  private resolveSessionTargetIds(placementId?: string): string[] {
    if (placementId) return [placementId];
    if (
      this.activePlacementId &&
      this.workingImages.has(this.activePlacementId)
    ) {
      return [this.activePlacementId];
    }
    return Array.from(this.workingImages.keys());
  }

  private async commitWorkingImagesAsCropped(placementIds: string[]) {
    if (!this.exportService) {
      return { ok: false, reason: "scene-export-unavailable" };
    }

    await this.updateImagesAsync();

    for (const placementId of placementIds) {
      if (!this.workingImages.has(placementId)) continue;
      const placement = this.getPlacementStates().find(
        (item) => item.id === placementId,
      );
      if (!placement) return { ok: false, reason: "placement-not-found" };
      const image = this.workingImages.get(placementId);
      if (!image?.src) {
        this.commitPlacementImage(placementId, null);
        continue;
      }

      let croppedImage: ImageExportPlacementImageResult;
      try {
        croppedImage = await this.exportCroppedPlacementImage(placement);
      } catch {
        return { ok: false, reason: "image-crop-export-failed" };
      }

      const persistsCommittedVisual =
        placement.commitTarget.type === "configurable-visual";
      const croppedSrc = croppedImage.url
        ? await normalizeCommittedExportUrl(croppedImage.url)
        : image.src;
      if (!persistsCommittedVisual) {
        this.rememberGeneratedCommittedExportObjectUrl(
          croppedImage.url,
          croppedSrc,
        );
      }
      const sourceSrc = readMetadataSourceSrc(image.metadata) || image.src;
      const sourceTransform = resolveImageTransformSnapshot(image);
      const sourceSize = this.sourceSizeCache.getSourceSize(sourceSrc);
      const rawSourceMetadata = isRecord(image.metadata?.source)
        ? image.metadata.source
        : {};
      const sourceMetadata = { ...rawSourceMetadata };
      delete sourceMetadata.src;
      this.sourceSizeCache.rememberSourceSize(croppedSrc, {
        width: croppedImage.width,
        height: croppedImage.height,
      });
      this.commitPlacementImage(placementId, {
        ...image,
        src: croppedSrc,
        left: 0.5,
        top: 0.5,
        scale: 1,
        angle: 0,
        metadata: {
          ...stripDerivedImageMetadata(image.metadata),
          source: {
            ...sourceMetadata,
            ...(sourceSrc ? { src: sourceSrc } : {}),
            ...(sourceSize ? { ...sourceSize } : {}),
          },
          transform: sourceTransform,
          derived: {
            src: croppedSrc,
            width: croppedImage.width,
            height: croppedImage.height,
            multiplier: croppedImage.multiplier,
            format: croppedImage.format,
          },
        },
      });
    }

    this.setSessionNotice(null);
    return { ok: true };
  }

  private async exportCroppedPlacementImage(
    placement: ImagePlacementState,
  ): Promise<ImageExportPlacementImageResult> {
    if (!this.exportService) {
      throw new Error("SceneExportService not initialized");
    }
    const result = await this.exportService.exportImage({
      crop: { type: "sceneRect", rect: placement.frame },
      format: "png",
      includeHidden: true,
      multiplier: 2,
      source: {
        elementIds: [this.getWorkingImageNodeId(placement.id)],
        layerIds: [IMAGE_SESSION_IMAGE_LAYER_ID],
      },
    });
    return {
      url: result.url,
      width: result.width,
      height: result.height,
      multiplier: result.multiplier,
      format: result.format,
      placementIds: [placement.id],
      frame: { ...placement.frame },
    };
  }

  private commitPlacementImage(
    placementId: string,
    image: ImagePlacementImageState | null,
  ) {
    const placementElement = this.getPlacementElement(placementId);
    const previousCommittedImage = placementElement
      ? this.getCommittedImage(placementElement)
      : null;
    const placementState = placementElement
      ? this.getPlacementState(placementElement)
      : null;
    const commitTarget = placementState?.commitTarget ?? {
      type: "document-object" as const,
      objectId: placementId,
    };
    if (commitTarget.type === "configurable-visual") {
      this.commitConfigurableVisualImage(commitTarget, image);
    }

    const placement = placementElement;
    if (this.renderIntentService && placement) {
      const data = isRecord(placement.data) ? placement.data : {};
      const placementData = isRecord(data.imagePlacement)
        ? data.imagePlacement
        : {};
      const frame = getPlacementFrame(placement);
      const committedTransform = image
        ? createCommittedImagePlacementTransform(frame, image.metadata)
        : undefined;
      const imageGeometry = createImageGeometryDescriptor(
        frame,
        placementState?.fit ?? "cover",
        image,
      );
      this.renderIntentService.patchIntent(IMAGE_RENDER_SCOPE, {
        id:
          commitTarget.type === "document-object"
            ? commitTarget.objectId
            : placementId,
        subject: {
          kind: "object",
          surfaceId:
            typeof placement.metadata?.documentSurfaceId === "string"
              ? placement.metadata.documentSurfaceId
              : IMAGE_UNSCOPED_SURFACE_ID,
          layerId: placement.layerId,
          objectId:
            commitTarget.type === "document-object"
              ? commitTarget.objectId
              : placementId,
          objectType: "image",
        },
        visual: {
          type: "image",
          replacement: image
            ? {
                ...(image.src ? { src: image.src } : {}),
                ...(image.metadata ? { metadata: image.metadata } : {}),
              }
            : {},
        },
        placement: {
          frame: {
            x: frame?.left ?? 0,
            y: frame?.top ?? 0,
            width: frame?.width ?? 1,
            height: frame?.height ?? 1,
          },
          ...(committedTransform ? { transform: committedTransform } : {}),
        },
        ordering: {
          layerId: placement.layerId,
          objectOrder: placement.order,
        },
        export: {
          visibleWhen: this.getCommittedImageVisibleWhen(placementId),
        },
        data: {
          imagePlacement: {
            ...placementData,
            image: image ?? undefined,
          },
          ...(image
            ? {
                placementId,
                source: "committed",
                type: "image-placement-image",
                ...(imageGeometry
                  ? { [IMAGE_GEOMETRY_DATA_KEY]: imageGeometry }
                  : {}),
              }
            : {}),
        },
      });
    }
    if (this.sceneService) {
      const scenePlacement = this.sceneService.selectOneElement({
        ids: [placementId],
      });
      if (scenePlacement) {
        const data = isRecord(scenePlacement.data) ? scenePlacement.data : {};
        const placement = isRecord(data.imagePlacement)
          ? data.imagePlacement
          : {};
        this.sceneService.updateElement(placementId, {
          data: {
            ...data,
            imagePlacement: {
              ...placement,
              image: image ?? undefined,
            },
          },
        });
      }
    }
    if (
      previousCommittedImage?.src &&
      previousCommittedImage.src !== image?.src
    ) {
      this.revokeGeneratedCommittedExportObjectUrl(previousCommittedImage.src);
    }
    this.workingImages.delete(placementId);
    this.retainedWorkingImageBaselines.delete(placementId);
    this.syncWorkingPlacementConditionContext();
  }

  private commitConfigurableVisualImage(
    target: Extract<
      ImagePlacementCommitTarget,
      { type: "configurable-visual" }
    >,
    image: ImagePlacementImageState | null,
  ) {
    const configurableVisual = this.getConfigurableVisualFacade();
    if (!configurableVisual) return;
    if (!image?.src) {
      configurableVisual.clearCommittedVisual({
        ...(target.configKey ? { configKey: target.configKey } : {}),
        key: target.key,
      });
      return;
    }
    configurableVisual.setCommittedVisual({
      ...(target.configKey ? { configKey: target.configKey } : {}),
      key: target.key,
      src: image.src,
      opacity: image.opacity,
      metadata: image.metadata,
    });
  }

  private getConfigurableVisualFacade(): ConfigurableVisualCapabilityApi | null {
    const registry = this.context?.services.get<CapabilityRegistryService>(
      CAPABILITY_REGISTRY_SERVICE,
    );
    return (
      registry?.getFacade<ConfigurableVisualCapabilityApi>(
        CONFIGURABLE_VISUAL_CAPABILITY_ID,
      ) ?? null
    );
  }

  private rememberGeneratedCommittedExportObjectUrl(
    originalUrl: string,
    committedUrl: string,
  ) {
    if (
      originalUrl !== committedUrl &&
      originalUrl.startsWith("data:") &&
      committedUrl.startsWith("blob:")
    ) {
      this.generatedCommittedExportObjectUrls.add(committedUrl);
    }
  }

  private revokeGeneratedCommittedExportObjectUrl(url: string) {
    if (
      !this.generatedCommittedExportObjectUrls.delete(url) ||
      typeof URL === "undefined" ||
      typeof URL.revokeObjectURL !== "function"
    ) {
      return;
    }

    try {
      URL.revokeObjectURL(url);
    } catch {
      // Best-effort cleanup for browser-owned object URLs.
    }
  }

  private revokeAllGeneratedCommittedExportObjectUrls() {
    Array.from(this.generatedCommittedExportObjectUrls).forEach((url) => {
      this.revokeGeneratedCommittedExportObjectUrl(url);
    });
  }

  private retainWorkingImageBaseline(placementId: string) {
    if (!this.workingImages.has(placementId)) return;
    this.retainedWorkingImageBaselines.set(
      placementId,
      cloneImageState(this.workingImages.get(placementId)),
    );
  }

  private restoreOrDeleteWorkingImage(placementId: string) {
    if (!this.retainedWorkingImageBaselines.has(placementId)) {
      this.workingImages.delete(placementId);
      return;
    }
    const baseline = cloneImageState(
      this.retainedWorkingImageBaselines.get(placementId),
    );
    if (baseline) {
      this.workingImages.set(placementId, baseline);
    } else {
      this.workingImages.delete(placementId);
    }
  }

  private getCommittedImageVisibleWhen(
    placementId: string,
  ): RuntimeConditionExpr {
    return {
      op: "not",
      expr: {
        op: "truthy",
        ref: {
          source: "context",
          key: this.getWorkingPlacementConditionKey(placementId),
        },
      },
    };
  }

  private patchCommittedImageConditionsForPlacements(placementIds?: string[]) {
    const targetIds =
      placementIds ??
      this.getCommittedPlacementStates()
        .filter((placement) => placement.hasImage)
        .map((placement) => placement.id);
    targetIds.forEach((placementId) =>
      this.patchCommittedImageConditions(placementId),
    );
  }

  private patchCommittedImageConditions(placementId: string) {
    const placement = this.getPlacementElement(placementId);
    if (!placement || !this.renderIntentService) return;
    const data = isRecord(placement.data) ? placement.data : {};
    const placementData = isRecord(data.imagePlacement)
      ? data.imagePlacement
      : {};
    const image = this.getCommittedImage(placement);
    const placementState = this.getPlacementState(placement);
    const frame = getPlacementFrame(placement);
    const committedTransform = image
      ? createCommittedImagePlacementTransform(frame, image.metadata)
      : undefined;
    const imageGeometry = createImageGeometryDescriptor(
      frame,
      placementState?.fit ?? "cover",
      image,
    );
    this.renderIntentService.patchIntent(IMAGE_RENDER_SCOPE, {
      id: placementId,
      subject: {
        kind: "object",
        surfaceId:
          typeof placement.metadata?.documentSurfaceId === "string"
            ? placement.metadata.documentSurfaceId
            : IMAGE_UNSCOPED_SURFACE_ID,
        layerId: placement.layerId,
        objectId: placementId,
        objectType: "image",
      },
      ordering: {
        layerId: placement.layerId,
        objectOrder: placement.order,
      },
      placement: {
        frame: {
          x: frame?.left ?? 0,
          y: frame?.top ?? 0,
          width: frame?.width ?? 1,
          height: frame?.height ?? 1,
        },
        ...(committedTransform ? { transform: committedTransform } : {}),
      },
      export: {
        visibleWhen: this.getCommittedImageVisibleWhen(placementId),
      },
      visual: image
        ? {
            type: "image",
            replacement: {
              ...(image.src ? { src: image.src } : {}),
              ...(image.metadata ? { metadata: image.metadata } : {}),
            },
          }
        : undefined,
      data: {
        imagePlacement: {
          ...placementData,
          image: image ?? undefined,
        },
        ...(image
          ? {
              placementId,
              source: "committed",
              type: "image-placement-image",
              ...(imageGeometry
                ? { [IMAGE_GEOMETRY_DATA_KEY]: imageGeometry }
                : {}),
            }
          : {}),
      },
    });
  }

  private getWorkingPlacementConditionKey(placementId: string): string {
    return `${this.capabilityId}.${IMAGE_ACTIVE_PLACEMENT_CONTEXT_PREFIX}.${placementId}`;
  }

  private syncWorkingPlacementConditionContext() {
    if (!this.renderIntentService) return;
    const nextKeys = new Set<string>();
    this.workingImages.forEach((_image, placementId) => {
      nextKeys.add(this.getWorkingPlacementConditionKey(placementId));
    });

    nextKeys.forEach((key) => {
      this.renderIntentService?.setRuntimeConditionValue(key, true);
    });
    this.activeWorkingPlacementConditionKeys.forEach((key) => {
      if (nextKeys.has(key)) return;
      this.renderIntentService?.deleteRuntimeConditionValue(key);
    });
    this.activeWorkingPlacementConditionKeys = nextKeys;
  }

  private clearWorkingPlacementConditionContext() {
    this.activeWorkingPlacementConditionKeys.forEach((key) => {
      this.renderIntentService?.deleteRuntimeConditionValue(key);
    });
    this.activeWorkingPlacementConditionKeys.clear();
  }

  private focusPlacement(
    placementId: string | null,
    options: { syncCanvasSelection?: boolean; skipRender?: boolean } = {},
  ) {
    const placement = placementId
      ? this.getPlacementElement(placementId)
      : undefined;
    if (placementId && !placement) {
      return { ok: false, reason: "placement-not-found" as const };
    }
    this.activePlacementId = placementId;
    this.syncWorkingPlacementConditionContext();
    if (options.syncCanvasSelection !== false && this.canvasService) {
      if (!placementId) {
        this.canvasService.discardActiveObject();
      } else {
        const candidates = this.canvasService.selectObjects({
          ids: [
            this.getWorkingImageNodeId(placementId),
            `image:${placementId}`,
            `upload:${placementId}`,
          ],
          layerIds: [
            `image.session.image`,
            ...(placement?.layerId ? [placement.layerId] : []),
            this.overlayLayerId,
            this.imageLayerId,
          ],
        });
        const preferredIds = [
          this.getWorkingImageNodeId(placementId),
          `image:${placementId}`,
          `upload:${placementId}`,
        ];
        const preferredLayerIds = [
          `image.session.image`,
          placement?.layerId,
          this.overlayLayerId,
          this.imageLayerId,
        ].filter((id): id is string => Boolean(id));
        const obj = candidates.find((candidate: any) => {
          const data = candidate?.data ?? {};
          return (
            preferredIds.includes(String(data.id || "").trim()) &&
            preferredLayerIds.includes(String(data.layerId || "").trim())
          );
        });
        if (obj) this.canvasService.setActiveObject(obj as any);
      }
    }
    if (!options.skipRender) this.updateImages();
    this.emitStateChange();
    return { ok: true, id: placementId };
  }

  private async exportPlacementImage(
    options: ImageExportPlacementImageOptions = {},
  ) {
    if (!this.exportService) {
      throw new Error("SceneExportService not initialized");
    }
    await this.updateImagesAsync();
    const requestedPlacementIds = options.placementIds?.length
      ? new Set(options.placementIds)
      : null;
    const placements = this.getPlacementStates().filter((placement) => {
      if (requestedPlacementIds) return requestedPlacementIds.has(placement.id);
      return placement.hasImage;
    });
    const placementIds = placements.map((placement) => placement.id);
    if (!placementIds.length) throw new Error("image-ids-required");
    const sourceLayerIds = Array.from(
      new Set(
        placements.map((placement) => placement.layerId || this.imageLayerId),
      ),
    );
    const frame = this.getSurfaceFrameRect();
    const result = await this.exportService.exportImage({
      crop: { type: "sceneRect", rect: frame },
      format: options.format === "jpeg" ? "jpeg" : "png",
      includeHidden: true,
      multiplier: Math.max(1, options.multiplier ?? 2),
      source: {
        elementIds: placementIds.map((id) => `image:${id}`),
        layerIds: sourceLayerIds.length ? sourceLayerIds : [this.imageLayerId],
      },
    });
    return {
      url: result.url,
      width: result.width,
      height: result.height,
      multiplier: result.multiplier,
      format: result.format,
      placementIds,
      frame,
    };
  }

  private createNotice(
    code: ImagePlacementSessionNotice["code"],
    placementIds: string[],
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
      placementIds,
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

  private onSelectionCleared = () => {
    this.endMoveSnapInteraction();
    this.emitStateChange();
  };

  private onCanvasTransform(
    kind: "move" | "resize" | "rotate" | "commit",
    target: CanvasObjectLike | undefined,
  ): void {
    const imageTarget = this.getActiveImageTarget(target);
    if (!imageTarget) return;
    if (kind === "move") {
      this.handleCanvasObjectMoving(imageTarget);
      return;
    }
    if (kind !== "commit") return;
    const placementId = this.getWorkingImageTargetPlacementId(imageTarget);
    if (placementId && this.movingPlacementId === placementId) {
      this.applyMoveSnapToTarget(imageTarget);
    }
    this.endMoveSnapInteraction();
    this.pendingCanvasTransformSync = this.pendingCanvasTransformSync
      .catch(() => undefined)
      .then(() => this.syncWorkingImageTransformFromTarget(imageTarget));
  }

  private getActiveImageTarget(
    target: CanvasObjectLike | undefined,
  ): CanvasObjectLike | null {
    if (!target) return null;
    if (target?.data?.type !== "image-placement-image") return null;
    if (target?.data?.source !== "working") return null;
    if (typeof target?.data?.placementId !== "string") return null;
    return target;
  }

  private getTargetBoundsScene(target: CanvasObjectLike): FrameRect | null {
    if (!this.canvasService || !target) return null;
    const rawBounds =
      typeof target.getBoundingRect === "function"
        ? target.getBoundingRect()
        : {
            left: finiteNumber(target.left, 0),
            top: finiteNumber(target.top, 0),
            width:
              finiteNumber(target.width, 0) * finiteNumber(target.scaleX, 1),
            height:
              finiteNumber(target.height, 0) * finiteNumber(target.scaleY, 1),
          };
    return this.canvasService.toSceneRect({
      left: finiteNumber(rawBounds.left, 0),
      top: finiteNumber(rawBounds.top, 0),
      width: finiteNumber(rawBounds.width, 0),
      height: finiteNumber(rawBounds.height, 0),
    });
  }

  private computeMoveSnapMatches(
    bounds: FrameRect | null,
    frame: FrameRect,
  ): { x: SnapMatch | null; y: SnapMatch | null } {
    if (!bounds || frame.width <= 0 || frame.height <= 0) {
      return { x: null, y: null };
    }

    const result = computeDragInteraction({
      frame: bounds,
      proposedFrame: bounds,
      snapTargets: [
        {
          id: "frame",
          lines: [
            { id: "frame-left", axis: "x", kind: "edge", position: frame.left },
            {
              id: "frame-center-x",
              axis: "x",
              kind: "center",
              position: frame.left + frame.width / 2,
            },
            {
              id: "frame-right",
              axis: "x",
              kind: "edge",
              position: frame.left + frame.width,
            },
            { id: "frame-top", axis: "y", kind: "edge", position: frame.top },
            {
              id: "frame-center-y",
              axis: "y",
              kind: "center",
              position: frame.top + frame.height / 2,
            },
            {
              id: "frame-bottom",
              axis: "y",
              kind: "edge",
              position: frame.top + frame.height,
            },
          ],
        },
      ],
      options: {
        thresholdPx: IMAGE_MOVE_SNAP_THRESHOLD_PX,
        viewportScale: this.canvasService?.getSceneScale() ?? 1,
      },
    });
    return {
      x: this.toImageSnapMatch(
        result.matches.find((match) => match.axis === "x") ?? null,
      ),
      y: this.toImageSnapMatch(
        result.matches.find((match) => match.axis === "y") ?? null,
      ),
    };
  }

  private toImageSnapMatch(
    match: ReturnType<typeof computeDragInteraction>["matches"][number] | null,
  ): SnapMatch | null {
    if (!match) return null;
    return {
      axis: match.axis,
      lineId: match.targetLineId as SnapLineId,
      kind: match.kind,
      lineScene: match.position,
      deltaScene: match.delta,
    };
  }

  private areSnapMatchesEqual(
    a: SnapMatch | null,
    b: SnapMatch | null,
  ): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.axis === b.axis && a.lineId === b.lineId && a.kind === b.kind;
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
      this.publishImageSessionScenes();
      this.canvasService?.requestRenderAll();
    }
  }

  private clearSnapPreview() {
    const shouldClear = Boolean(this.activeSnapX) || Boolean(this.activeSnapY);
    this.activeSnapX = null;
    this.activeSnapY = null;
    if (shouldClear) {
      this.publishImageSessionScenes();
      this.canvasService?.requestRenderAll();
    }
  }

  private endMoveSnapInteraction() {
    this.movingPlacementId = null;
    this.clearSnapPreview();
  }

  private applyMoveSnapToTarget(target: CanvasObjectLike): {
    x: SnapMatch | null;
    y: SnapMatch | null;
  } {
    if (!this.canvasService) return { x: null, y: null };
    const placementId = target?.data?.placementId;
    const placement = this.getPlacementStates().find(
      (item) => item.id === placementId,
    );
    if (!placement) return { x: null, y: null };
    const matches = this.computeMoveSnapMatches(
      this.getTargetBoundsScene(target),
      placement.frame,
    );
    const deltaScreenX = this.canvasService.toScreenLength(
      matches.x?.deltaScene ?? 0,
    );
    const deltaScreenY = this.canvasService.toScreenLength(
      matches.y?.deltaScene ?? 0,
    );
    if (deltaScreenX || deltaScreenY) {
      target.set?.({
        left: finiteNumber(target.left, 0) + deltaScreenX,
        top: finiteNumber(target.top, 0) + deltaScreenY,
      });
      target.setCoords?.();
    }
    return matches;
  }

  private handleCanvasObjectMoving(target: CanvasObjectLike) {
    if (!this.canvasService) return;
    const placementId = target.data.placementId;
    const placement = this.getPlacementStates().find(
      (item) => item.id === placementId,
    );
    if (!placement) {
      this.endMoveSnapInteraction();
      return;
    }
    this.movingPlacementId = placementId;
    const matches = this.computeMoveSnapMatches(
      this.getTargetBoundsScene(target),
      placement.frame,
    );
    this.updateSnapMatchState(matches.x, matches.y);
  }

  private getWorkingImageTargetPlacementId(
    target: CanvasObjectLike | null | undefined,
  ): string | null {
    const placementId = target?.data?.placementId;
    if (
      typeof placementId !== "string" ||
      target?.data?.type !== "image-placement-image" ||
      target?.data?.source !== "working"
    ) {
      return null;
    }
    return placementId;
  }

  private async syncWorkingImageTransformFromTarget(target: CanvasObjectLike) {
    const placementId = this.getWorkingImageTargetPlacementId(target);
    const placement = placementId
      ? this.getPlacementStates().find((item) => item.id === placementId)
      : null;
    if (!placement || !this.canvasService || !placementId) return;
    const rawCenter =
      typeof target.getCenterPoint === "function"
        ? target.getCenterPoint()
        : { x: finiteNumber(target.left, 0), y: finiteNumber(target.top, 0) };
    const center = this.canvasService.toScenePoint({
      x: finiteNumber(rawCenter?.x, finiteNumber(target.left, 0)),
      y: finiteNumber(rawCenter?.y, finiteNumber(target.top, 0)),
    });
    const image = this.workingImages.get(placementId) || placement.image;
    const source = (image?.src
      ? this.sourceSizeCache.getSourceSize(image.src)
      : null) ?? {
      width: finiteNumber(target.width, 1),
      height: finiteNumber(target.height, 1),
    };
    const objectScaling =
      typeof target.getObjectScaling === "function"
        ? target.getObjectScaling()
        : null;
    const fitScale = resolveImageFitScale(
      placement.frame,
      source,
      placement.fit,
    ).x;
    const sceneScale = this.canvasService.getSceneScale();
    const objectScale =
      finiteNumber(objectScaling?.x, finiteNumber(target.scaleX, 1)) /
      Math.max(0.0001, sceneScale);
    const sessionId =
      this.sessionIdsByPlacementId.get(placementId) ||
      this.getFallbackImageSessionId(placementId);
    await this.setImageTransform(
      { placementId, sessionId },
      {
        left:
          (center.x - placement.frame.left) /
          Math.max(1, placement.frame.width),
        top:
          (center.y - placement.frame.top) /
          Math.max(1, placement.frame.height),
        scale: objectScale / Math.max(0.0001, fitScale),
        angle: finiteNumber(target.angle, 0),
      },
      { skipRender: true },
    );
  }

  private shouldRenderWorkingPlacement(placementId: string): boolean {
    return this.workingImages.has(placementId);
  }

  private buildImageSpec(
    placement: ImagePlacementState,
  ): RenderObjectSpec | null {
    const image = placement.image;
    if (!image?.src) return null;
    const source = this.sourceSizeCache.getSourceSize(image.src) || {
      width: placement.frame.width,
      height: placement.frame.height,
    };
    const geometry = resolveImageGeometry({
      source: { src: image.src, size: source },
      frame: placement.frame,
      fit: placement.fit,
      transform: {
        anchorX: image.left,
        anchorY: image.top,
        zoom: image.scale,
        rotation: image.angle,
        opacity: image.opacity,
      },
      clip: placement.frame,
    });
    const id = this.getWorkingImageNodeId(placement.id);
    const clipEffect = this.buildPlacementClipEffect(placement, id);
    return {
      id,
      subjectId: placement.id,
      type: "image",
      src: image.src,
      space: "scene",
      exportKeys: [id, placement.id],
      data: {
        id: placement.id,
        layerId: placement.layerId || this.imageLayerId,
        type: "image-placement-image",
        placementId: placement.id,
        source: "working",
        session: this.createImagePlacementSessionData(placement, {
          source: "image-placement-working",
        }),
      },
      props: {
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        height: geometry.height,
        originX: geometry.originX,
        originY: geometry.originY,
        scaleX: geometry.scaleX,
        scaleY: geometry.scaleY,
        angle: geometry.angle,
        opacity: geometry.opacity,
      },
      ...(clipEffect ? { effects: [clipEffect] } : {}),
    };
  }

  private buildPlacementClipEffect(
    placement: ImagePlacementState,
    objectId: string,
  ): RenderEffectSpec {
    const frame = placement.frame;
    const sourceId = `${objectId}.clip-source`;
    return {
      type: "clipPath",
      id: `${objectId}.clip`,
      coordinateMode: "absolute",
      source: {
        id: sourceId,
        type: "rect",
        space: "scene",
        data: {
          id: sourceId,
          type: "image-placement-clip",
          placementId: placement.id,
          effect: "clipPath",
        },
        props: {
          left: frame.left,
          top: frame.top,
          width: frame.width,
          height: frame.height,
          fill: "#000000",
          stroke: null,
          originX: "left",
          originY: "top",
          excludeFromExport: true,
          objectCaching: false,
        },
      },
    };
  }

  private buildSessionOverlayEntries(
    placement: ImagePlacementState,
    sessionId: string,
  ): Array<{ layerId: string; spec: RenderObjectSpec }> {
    if (!this.canvasService || !this.sceneLayoutService) return [];
    const requestedSurfaceId = this.resolveImageSessionSurfaceId(placement);
    const layout = this.sceneLayoutService.getLayout(
      requestedSurfaceId ?? undefined,
    );
    if (!layout) return [];
    const viewport = this.canvasService.getScreenViewportRect();
    const surfaceId = layout.surfaceId;
    const entries: Array<{ layerId: string; spec: RenderObjectSpec }> =
      buildImageSessionOverlaySpecs({
        layout,
        viewport,
        visual: {
          dashLength: 8,
          innerBackground: "rgba(0, 0, 0, 0)",
          outerBackground: "rgba(245, 245, 245, 0.72)",
          strokeColor: "rgba(80, 80, 80, 0.9)",
          strokeStyle: "dashed",
          strokeWidth: 1,
        },
      }).map((spec) => ({
        layerId: IMAGE_SESSION_CONTROLS_LAYER_ID,
        spec,
      }));

    const context = {
      placement,
      sessionId,
      surfaceId,
      layout,
      viewport,
    };
    Array.from(this.sessionOverlayProviders.values())
      .sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
      )
      .forEach((provider) => {
        const provided = provider.getOverlaySpecs(context);
        provided.forEach((entry) => {
          const normalized = this.normalizeSessionOverlayEntry(entry);
          if (normalized) entries.push(normalized);
        });
      });
    return entries;
  }

  private normalizeSessionOverlayEntry(
    entry: RenderObjectSpec | ImageSessionOverlayEntry,
  ): { layerId: string; spec: RenderObjectSpec } | null {
    if (!entry) return null;
    if ("spec" in entry) {
      return {
        layerId: this.resolveImageSessionOverlayLayerId(entry.layer),
        spec: entry.spec,
      };
    }
    return {
      layerId: IMAGE_SESSION_CONTROLS_LAYER_ID,
      spec: entry,
    };
  }

  private resolveImageSessionOverlayLayerId(
    layer: ImageSessionOverlayLayer | undefined,
  ): string {
    if (layer === "underlay") return IMAGE_SESSION_UNDERLAY_LAYER_ID;
    if (layer === "overlay") return IMAGE_SESSION_OVERLAY_LAYER_ID;
    return IMAGE_SESSION_CONTROLS_LAYER_ID;
  }

  private resolveImageSessionSurfaceId(
    placement?: ImagePlacementState,
  ): string | null {
    return (
      (placement ? this.resolvePlacementSurfaceId(placement) : null) ??
      this.surfaceFrameService?.listSurfaceIds()[0] ??
      null
    );
  }

  private getImageSessionSceneId(sessionId: string): string {
    const normalized = String(sessionId || "").trim() || IMAGE_SESSION_CHANNEL;
    return `${IMAGE_SESSION_SCENE_PREFIX}:${normalized}`;
  }

  private isImageSessionSceneId(sceneId: string): boolean {
    return String(sceneId || "").startsWith(`${IMAGE_SESSION_SCENE_PREFIX}:`);
  }

  private isSessionSceneChange(event: {
    scenes?: { added: string[]; updated: string[]; removed: string[] };
    sceneChanges?: Record<string, unknown>;
  }): boolean {
    const sceneIds = [
      ...(event.scenes?.added ?? []),
      ...(event.scenes?.updated ?? []),
      ...(event.scenes?.removed ?? []),
      ...Object.keys(event.sceneChanges ?? {}),
    ];
    return (
      sceneIds.length > 0 &&
      sceneIds.every(
        (id) =>
          this.isImageSessionSceneId(id) ||
          this.sceneService?.getSceneHandle(id)?.owner.type === "session",
      )
    );
  }

  private ensureImageSessionScene(
    placement: ImagePlacementState,
    sessionId: string,
    session: SessionHandle<
      ImagePlacementSessionDraft,
      ImagePlacementSessionResult
    >,
  ): SceneHandle | null {
    if (!this.sceneService) return null;
    const existing = this.sessionScenesBySessionId.get(sessionId);
    if (
      existing &&
      this.sceneService.getSceneHandle(existing.id) === existing
    ) {
      return existing;
    }
    this.sessionScenesBySessionId.delete(sessionId);
    const scene = this.sceneService.createScene({
      id: this.getImageSessionSceneId(sessionId),
      owner: { type: "session", sessionId },
      composition: this.createImageSessionComposition(placement),
    });
    session.own(scene);
    [
      [IMAGE_SESSION_UNDERLAY_LAYER_ID, 0],
      [IMAGE_SESSION_IMAGE_LAYER_ID, 1],
      [IMAGE_SESSION_OVERLAY_LAYER_ID, 2],
      [IMAGE_SESSION_CONTROLS_LAYER_ID, 3],
    ].forEach(([id, order]) =>
      scene.addLayer({ id: String(id), order: Number(order) }),
    );
    this.sessionScenesBySessionId.set(sessionId, scene);
    return scene;
  }

  private publishImageSessionScenes() {
    const activeSessionId = this.activeImageSessionId;
    const scene = activeSessionId
      ? this.sessionScenesBySessionId.get(activeSessionId)
      : undefined;
    if (
      !scene ||
      !activeSessionId ||
      this.sceneService?.getSceneHandle(scene.id) !== scene
    ) {
      return;
    }
    const wasPublishing = this.isPublishingImageSessionScenes;
    this.isPublishingImageSessionScenes = true;
    try {
      scene
        .selectElements()
        .forEach((element) => scene.removeElement(element.id));
      let elementOrder = 0;
      this.getPlacementStates()
        .filter((placement) => this.shouldRenderWorkingPlacement(placement.id))
        .forEach((placement) => {
          this.buildImageSessionSceneSpecs(placement, activeSessionId).forEach(
            ({ layerId, spec }) => {
              const element = this.renderSpecToSceneElement(
                spec,
                layerId,
                elementOrder++,
              );
              if (element) scene.addElement(element);
            },
          );
        });
    } finally {
      this.isPublishingImageSessionScenes = wasPublishing;
    }
  }

  private createImageSessionComposition(placement: ImagePlacementState) {
    const projectionEntries = (
      projectionPlacement: ImageSessionProjectionPlacement,
    ) =>
      (placement.sessionProjections ?? [])
        .filter((projection) => projection.placement === projectionPlacement)
        .map((projection) => ({
          source: "document" as const,
          interaction: "disabled" as const,
          filter: ({ node }: { node: RenderGraphNode }) =>
            this.matchesSessionProjectionSource(placement, node, projection),
        }));
    return {
      entries: [
        ...projectionEntries("below"),
        {
          source: "local" as const,
          layerIds: [IMAGE_SESSION_UNDERLAY_LAYER_ID],
        },
        { source: "local" as const, layerIds: [IMAGE_SESSION_IMAGE_LAYER_ID] },
        ...projectionEntries("above"),
        {
          source: "local" as const,
          layerIds: [IMAGE_SESSION_OVERLAY_LAYER_ID],
        },
        ...projectionEntries("controls"),
        {
          source: "local" as const,
          layerIds: [IMAGE_SESSION_CONTROLS_LAYER_ID],
        },
      ],
    };
  }

  private buildImageSessionSceneSpecs(
    placement: ImagePlacementState,
    sessionId: string,
  ): Array<{ layerId: string; spec: RenderObjectSpec }> {
    const specs: Array<{ layerId: string; spec: RenderObjectSpec }> = [];
    const imageSpec = this.buildImageSpec(placement);
    if (imageSpec) {
      specs.push({ layerId: IMAGE_SESSION_IMAGE_LAYER_ID, spec: imageSpec });
    }
    if (placement.id === this.activePlacementId) {
      specs.push(...this.buildSessionOverlayEntries(placement, sessionId));
      specs.push(...this.buildMoveSnapGuideSpecs(placement));
    }
    return specs;
  }

  private buildMoveSnapGuideSpecs(
    placement: ImagePlacementState,
  ): Array<{ layerId: string; spec: RenderObjectSpec }> {
    if (!this.canvasService || (!this.activeSnapX && !this.activeSnapY)) {
      return [];
    }
    const frame = this.canvasService.toScreenRect(placement.frame);
    const specs: Array<{ layerId: string; spec: RenderObjectSpec }> = [];
    const addGuide = (id: string, pathData: string) => {
      specs.push({
        layerId: IMAGE_SESSION_CONTROLS_LAYER_ID,
        spec: {
          id: `image-snap-guide:${placement.id}:${id}`,
          type: "path",
          space: "screen",
          data: {
            placementId: placement.id,
            source: "image-placement-snap-guide",
          },
          props: {
            pathData,
            originX: "left",
            originY: "top",
            fill: null,
            stroke: "#1677ff",
            strokeWidth: 1,
          },
        },
      });
    };
    if (this.activeSnapX) {
      const x = this.canvasService.toScreenPoint({
        x: this.activeSnapX.lineScene,
        y: placement.frame.top,
      }).x;
      addGuide("x", `M ${x} ${frame.top} L ${x} ${frame.top + frame.height}`);
    }
    if (this.activeSnapY) {
      const y = this.canvasService.toScreenPoint({
        x: placement.frame.left,
        y: this.activeSnapY.lineScene,
      }).y;
      addGuide("y", `M ${frame.left} ${y} L ${frame.left + frame.width} ${y}`);
    }
    return specs;
  }

  private matchesSessionProjectionSource(
    placement: ImagePlacementState,
    node: RenderGraphNode,
    projection: ImageSessionProjection,
  ): boolean {
    if (
      projection.surfaceScope !== "all" &&
      node.surfaceId !== this.getPlacementSurfaceId(placement)
    ) {
      return false;
    }
    const sourceTags = new Set(projection.sourceTags);
    const nodeTags = normalizeStringList(node.tags);
    return nodeTags.some((tag) => sourceTags.has(tag));
  }

  private getPlacementSurfaceId(placement: ImagePlacementState): string {
    return (
      String(placement.metadata?.documentSurfaceId || "").trim() ||
      IMAGE_UNSCOPED_SURFACE_ID
    );
  }

  private renderSpecToSceneElement(
    spec: RenderObjectSpec,
    layerId: string,
    order: number,
  ): SceneElementInput | null {
    const props = { ...(spec.props || {}) };
    const style = { ...props };
    [
      "visible",
      "left",
      "top",
      "scaleX",
      "scaleY",
      "angle",
      "originX",
      "originY",
      "width",
      "height",
      "pathData",
      "path",
      "text",
    ].forEach((key) => delete style[key]);
    const transform = {
      ...(Number.isFinite(props.left) ? { left: Number(props.left) } : {}),
      ...(Number.isFinite(props.top) ? { top: Number(props.top) } : {}),
      ...(Number.isFinite(props.scaleX)
        ? { scaleX: Number(props.scaleX) }
        : {}),
      ...(Number.isFinite(props.scaleY)
        ? { scaleY: Number(props.scaleY) }
        : {}),
      ...(Number.isFinite(props.angle) ? { angle: Number(props.angle) } : {}),
      ...(props.originX === "left" ||
      props.originX === "center" ||
      props.originX === "right"
        ? { originX: props.originX }
        : {}),
      ...(props.originY === "top" ||
      props.originY === "center" ||
      props.originY === "bottom"
        ? { originY: props.originY }
        : {}),
    };
    const data = {
      ...(spec.data || {}),
      layerId,
      renderSpace: spec.space || "scene",
      exportKeys: Array.from(
        new Set(
          [spec.id, spec.subjectId, ...(spec.exportKeys ?? [])]
            .map((id) => String(id || "").trim())
            .filter((id) => id.length > 0),
        ),
      ),
    };
    const common = {
      id: spec.id,
      layerId,
      order,
      visible: props.visible !== false,
      data,
      style,
      transform,
      interaction: this.resolveSceneElementInteraction(data),
      effects: spec.effects,
    };
    if (spec.type === "image") {
      if (!spec.src) return null;
      return {
        ...common,
        type: "image",
        src: spec.src,
        width: finitePositiveNumber(props.width) ?? undefined,
        height: finitePositiveNumber(props.height) ?? undefined,
      };
    }
    if (spec.type === "path") {
      const path = String(
        (props as any).pathData || (props as any).path || "",
      ).trim();
      if (!path) return null;
      return { ...common, type: "path", path };
    }
    if (spec.type === "rect") {
      return {
        ...common,
        type: "rect",
        width: finiteNumber(props.width, 1),
        height: finiteNumber(props.height, 1),
      };
    }
    return {
      ...common,
      type: "text",
      text: String((props as any).text ?? ""),
    };
  }

  private resolveSceneElementInteraction(
    data: Record<string, unknown>,
  ): InteractionSpec | undefined {
    if (data.type !== "image-placement-image" || data.source !== "working") {
      return undefined;
    }
    return {
      selection: { enabled: true },
      manipulation: {
        move: { enabled: true },
        resize: { enabled: true },
        rotate: { enabled: true },
      },
    };
  }

  private buildUploadSpecs(): RenderObjectSpec[] {
    return this.getPlacementStates()
      .filter((placement) => !placement.image?.src)
      .flatMap((placement): RenderObjectSpec[] => {
        const style = placement.placeholderStyle ?? {};
        const label = style.label ?? "+";
        const specs: RenderObjectSpec[] = [
          {
            id: `upload:${placement.id}`,
            subjectId: placement.id,
            type: "rect",
            space: "scene",
            data: {
              id: placement.id,
              layerId: this.imageLayerId,
              type: "image-placement-upload",
              placementId: placement.id,
              session: this.createImagePlacementSessionData(placement, {
                source: "image-placement-upload",
              }),
            },
            props: {
              left: placement.frame.left,
              top: placement.frame.top,
              width: placement.frame.width,
              height: placement.frame.height,
              originX: "left",
              originY: "top",
              fill: style.fill ?? "rgba(22, 119, 255, 0.08)",
              stroke: style.stroke ?? "#1677ff",
              strokeDashArray: style.strokeDashArray ?? [12, 8],
              strokeWidth: style.strokeWidth ?? 2,
            },
          },
        ];
        if (label) {
          specs.push({
            id: `upload-label:${placement.id}`,
            subjectId: placement.id,
            type: "text",
            space: "scene",
            data: {
              type: "image-placement-upload-label",
              placementId: placement.id,
              session: this.createImagePlacementSessionData(placement, {
                source: "image-placement-upload",
              }),
            },
            props: {
              left: placement.frame.left + placement.frame.width / 2,
              top: placement.frame.top + placement.frame.height / 2,
              originX: "center",
              originY: "center",
              text: label,
              fontSize:
                style.labelFontSize ??
                Math.max(
                  18,
                  Math.min(placement.frame.width, placement.frame.height) *
                    0.16,
                ),
              fill: style.labelFill ?? style.stroke ?? "#1677ff",
              ...(style.labelFontFamily
                ? { fontFamily: style.labelFontFamily }
                : {}),
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
    [
      ...this.getPlacementStates(),
      ...this.getCommittedPlacementStates(),
    ].forEach((placement) => {
      if (placement.image?.src) imageSources.add(placement.image.src);
    });
    await Promise.all(
      Array.from(imageSources).map((src) => this.ensureSourceSize(src)),
    );
    if (seq !== this.renderSeq) return;
    this.publishRuntimeRenderIntents();
    this.emitStateChange();
  }

  private publishRuntimeRenderIntents() {
    const renderIntentService = this.renderIntentService;
    if (!renderIntentService) return;
    this.publishImageSessionScenes();
    clearRenderIntentSource(renderIntentService, IMAGE_RUNTIME_RENDER_SCOPE);

    patchRenderObjectSpecs(renderIntentService, this.buildUploadSpecs(), {
      sourceId: IMAGE_RUNTIME_RENDER_SCOPE,
      layerId: this.overlayLayerId,
      stack: IMAGE_OVERLAY_STACK,
      layerOrder: 0,
      channel: "overlay",
    });
  }

  private getFallbackImageSessionId(placementId: string): string {
    return `${IMAGE_SESSION_CHANNEL}:${String(placementId || "").trim()}`;
  }

  private normalizeSessionKey(value: unknown, fallback: string): string {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized || this.getFallbackImageSessionId(fallback);
  }

  private getWorkingImageNodeId(placementId: string): string {
    return `session-image:${this.getFallbackImageSessionId(placementId)}`;
  }

  private upsertImageSessionDraft(
    placementId: string,
    image: ImagePlacementImageState | null,
    sessionId = this.sessionIdsByPlacementId.get(placementId) ||
      this.getFallbackImageSessionId(placementId),
  ) {
    const placement = this.getPlacementStates().find(
      (item) => item.id === placementId,
    );
    if (!placement || !this.sessionService) return;
    const draft: ImagePlacementSessionDraft = {
      placementId,
      image: cloneImageState(image),
    };
    this.suspendedDraftsBySessionId.set(sessionId, {
      placementId,
      image: cloneImageState(image),
    });
    this.sessionHandlesBySessionId.get(sessionId)?.updateDraft(draft);
  }

  private createImagePlacementSessionData(
    placement: ImagePlacementState,
    options: { source: string },
  ) {
    return {
      sessionId:
        this.sessionIdsByPlacementId.get(placement.id) ||
        this.getFallbackImageSessionId(placement.id),
      scope: {
        surfaceId: this.resolvePlacementSurfaceId(placement),
        subjectId: placement.id,
        channel: IMAGE_SESSION_CHANNEL,
      },
      source: options.source,
      mode: "edit",
      payload: {
        placementId: placement.id,
        fit: placement.fit,
      },
    };
  }

  private resolvePlacementSurfaceId(
    placement: ImagePlacementState,
  ): string | null {
    const metadata = isRecord(placement.metadata) ? placement.metadata : {};
    const subject = isRecord(metadata.subject) ? metadata.subject : {};
    const surfaceId =
      typeof metadata.documentSurfaceId === "string"
        ? metadata.documentSurfaceId
        : typeof subject.surfaceId === "string"
          ? subject.surfaceId
          : "";
    return surfaceId || null;
  }

  private getSurfaceFrameRect(): FrameRect {
    if (!this.canvasService) return { left: 0, top: 0, width: 1, height: 1 };
    const layout = this.sceneLayoutService?.getLayout();
    if (layout) {
      return this.canvasService.toSceneRect({
        left: layout.cutRect.left,
        top: layout.cutRect.top,
        width: layout.cutRect.width,
        height: layout.cutRect.height,
      });
    }
    return resolveSurfaceFrameRect(this.canvasService, this.sceneLayoutService);
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
    const size = readImageSourceSize(metadata);
    if (size) this.sourceSizeCache.rememberSourceSize(src, size);
  }

  private onSceneFrameChanged = () => {
    this.updateImages();
  };

  private attachLayoutSubscriptions() {
    const layoutService = this.sceneLayoutService;
    const surfaceFrameService = this.surfaceFrameService;
    if (!layoutService || !surfaceFrameService) return;
    const observed = new Set<string>();
    const observe = (surfaceId: string) => {
      if (!surfaceId || observed.has(surfaceId)) return;
      observed.add(surfaceId);
      this.subscriptions.add(
        layoutService.onLayoutChange(surfaceId, this.onSceneFrameChanged),
      );
    };
    surfaceFrameService.listSurfaceIds().forEach(observe);
    this.subscriptions.add(
      surfaceFrameService.onAnyFramesChange((event) =>
        observe(event.surfaceId),
      ),
    );
  }
}
