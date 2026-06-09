import {
  CANVAS_SERVICE,
  CAPABILITY_REGISTRY_SERVICE,
  CONFIGURATION_SERVICE,
  ExtensionContext,
  ExtensionContributions,
  ExtensionDefinition,
  RENDER_INTENT_SERVICE,
  SCENE_SERVICE,
  SCENE_EXPORT_SERVICE,
  SCENE_LAYOUT_SERVICE,
  SURFACE_FRAME_SERVICE,
  SESSION_SERVICE,
  computeDragInteraction,
  evaluateRuntimeCondition,
  type CanvasService,
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
  type SceneExportService,
  type SceneLayoutService,
  type SurfaceFrameService,
  type SceneService,
  type SessionArtifact,
  type SessionService,
  type RuntimeConditionExpr,
} from "@pooder/core";
import type {
  EditorDocument,
  EditorEffect,
  EditorImageObject,
  EditorLayer,
  EditorObjectEffect,
  EditorSurface,
} from "@pooder/document/kit";
import {
  createSourceSizeCache,
  getCoverScale as getCoverScaleFromRect,
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
const IMAGE_MOVE_SNAP_THRESHOLD_PX = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEditorEffect(effect: EditorObjectEffect): effect is EditorEffect {
  if (
    effect.type === "constraint" &&
    "targetId" in effect &&
    "strategy" in effect
  ) {
    return false;
  }

  return !(
    effect.type === "clip-source" ||
    effect.type === "boolean" ||
    effect.type === "interactive" ||
    effect.type === "guide"
  );
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function finitePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeFrameImageScale(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed < 0 ? -1 : 1;
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
      const opacity = finiteNumber(item.opacity, Number.NaN);
      return {
        id: id || `projection-${index + 1}`,
        placement: normalizeSessionProjectionPlacement(item.placement),
        sourceTags,
        surfaceScope: normalizeSessionProjectionSurfaceScope(item.surfaceScope),
        ...(Number.isFinite(opacity)
          ? { opacity: Math.max(0, Math.min(1, opacity)) }
          : {}),
        ...(typeof item.interactive === "boolean"
          ? { interactive: item.interactive }
          : {}),
        ...(typeof item.hideSource === "boolean"
          ? { hideSource: item.hideSource }
          : {}),
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
    requiresServices: [CANVAS_SERVICE, RENDER_INTENT_SERVICE],
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
  private readonly beginSessionOnCanvasInteraction: boolean;
  private readonly sourceSizeCache = createSourceSizeCache((src) =>
    this.loadImageSize(src),
  );
  private workingImages = new Map<string, ImagePlacementImageState | null>();
  private workingImageDraftsBySessionId = new Map<
    string,
    ImagePlacementImageState | null
  >();
  private retainedWorkingImageBaselines = new Map<
    string,
    ImagePlacementImageState | null
  >();
  private activeWorkingPlacementConditionKeys = new Set<string>();
  private pendingUploadPlacementIds = new Set<string>();
  private sessionIdsByPlacementId = new Map<string, string>();
  private sessionSceneIdsBySessionId = new Map<string, string>();
  private generatedCommittedExportObjectUrls = new Set<string>();
  private activePlacementId: string | null = null;
  private activeImageSessionId: string | null = null;
  private sessionNotice: ImagePlacementSessionNotice | null = null;
  private isPublishingImageSessionScenes = false;
  private renderSeq = 0;
  private activeSnapX: SnapMatch | null = null;
  private activeSnapY: SnapMatch | null = null;
  private movingPlacementId: string | null = null;
  private hasRenderedSnapGuides = false;
  private canvasMouseUpHandler?: (event?: any) => void;
  private canvasObjectMovingHandler?: (event?: any) => void;
  private canvasBeforeRenderHandler?: (event?: any) => void;
  private canvasAfterRenderHandler?: (event?: any) => void;
  private pendingCanvasSessionPlacementId: string | null = null;
  private pendingCanvasSessionTarget: any = null;
  private pendingCanvasSessionTimer: ReturnType<
    typeof globalThis.setTimeout
  > | null = null;
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
    this.beginSessionOnCanvasInteraction =
      options.beginSessionOnCanvasInteraction !== false;
  }

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService =
      context.services.getOrThrow<CanvasService>(CANVAS_SERVICE);
    this.renderIntentService = context.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    this.sceneService = context.services.get<SceneService>(SCENE_SERVICE);
    this.sceneLayoutService =
      context.services.get<SceneLayoutService>(SCENE_LAYOUT_SERVICE);
    this.surfaceFrameService = context.services.get<SurfaceFrameService>(
      SURFACE_FRAME_SERVICE,
    );
    this.exportService =
      context.services.get<SceneExportService>(SCENE_EXPORT_SERVICE);
    this.sessionService = context.services.get<SessionService>(SESSION_SERVICE);

    this.sceneSubscription?.dispose();
    this.sceneSubscription = this.sceneService?.onDidChange((event) => {
      if (
        this.isPublishingImageSessionScenes ||
        this.isImageSessionSceneChange(event)
      ) {
        return;
      }
      this.updateImages();
    });
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
      "object:modified",
      this.onObjectModified,
    );
    this.subscriptions.on(context.eventBus, "mouse:down", this.onMouseDown);
    this.attachLayoutSubscriptions();
    this.bindCanvasInteractionHandlers();
    this.updateImages();
  }

  deactivate() {
    this.subscriptions.disposeAll();
    this.sceneSubscription?.dispose();
    this.sceneSubscription = undefined;
    clearRenderIntentSource(
      this.renderIntentService,
      IMAGE_RUNTIME_RENDER_SCOPE,
    );
    this.clearPendingCanvasSession();
    this.workingImages.clear();
    this.workingImageDraftsBySessionId.clear();
    this.retainedWorkingImageBaselines.clear();
    this.sessionOverlayProviders.clear();
    this.clearAllSessionScenes();
    this.sessionIdsByPlacementId.clear();
    this.sessionSceneIdsBySessionId.clear();
    this.activePlacementId = null;
    this.activeImageSessionId = null;
    this.clearWorkingPlacementConditionContext();
    this.sourceSizeCache.clear();
    this.revokeAllGeneratedCommittedExportObjectUrls();
    this.endMoveSnapInteraction();
    this.unbindCanvasInteractionHandlers();
    this.canvasService?.requestRenderAll();
    this.canvasService = undefined;
    this.renderIntentService = undefined;
    this.sceneService = undefined;
    this.sceneLayoutService = undefined;
    this.surfaceFrameService = undefined;
    this.exportService = undefined;
    this.sessionService = undefined;
    this.context = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createImagePlacementCapabilityDefinition(
          this.getImagePlacementFacade(),
          {
            beginSessionOnCanvasInteraction:
              this.beginSessionOnCanvasInteraction,
            capabilityId: this.capabilityId,
            layers: {
              imageLayerId: this.imageLayerId,
              overlayLayerId: this.overlayLayerId,
            },
          },
        ),
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
      interaction: {
        imagePlacement: {
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
        },
        enabled: true,
      },
      data: {
        id: object.id,
        layerId: resolved.layer.id,
        placementId: object.id,
        sessionKey,
        commitTarget,
        source: committed ? "committed" : "target",
        type: committed ? "image-placement-image" : "image-placement-target",
      },
    };
  }

  private resolveDocumentObjectCommitTarget(
    object: EditorImageObject,
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
    object: EditorImageObject;
  } | null {
    for (const surface of document.surfaces) {
      for (const layer of surface.layers) {
        const object = layer.objects?.find((item) => item.id === objectId);
        if (object?.type === "image") {
          return { surface, layer, object };
        }
      }
    }
    return null;
  }

  private resolveDocumentImageState(
    _document: EditorDocument,
    object: EditorImageObject,
  ): ImagePlacementImageState | undefined {
    const placementMetadata = isRecord(object.metadata?.imagePlacement)
      ? object.metadata.imagePlacement
      : undefined;
    const source = isRecord(placementMetadata?.source)
      ? placementMetadata.source
      : undefined;
    const src =
      typeof source?.src === "string" && source.src ? source.src : object.src;
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
    object: EditorImageObject,
  ): ImagePlacementImageState | undefined {
    const metadata = isRecord(object.metadata?.imagePlacement)
      ? object.metadata.imagePlacement
      : {};
    return readMetadataDerivedImage(metadata);
  }

  private getImagePlacementFacade(): ImagePlacementCapabilityApi {
    return {
      applyOperation: (input, operation) =>
        this.applyImageOperation(input, operation),
      clearImage: (input) => this.clearImage(input),
      commitSession: (input) => this.completeSession(input),
      exportPlacementImage: (options) => this.exportPlacementImage(options),
      focusPlacement: (placementId, options) =>
        this.focusPlacement(placementId, options),
      getViewState: () => this.getViewState(),
      openSession: (input) => this.beginSession(input),
      rollbackSession: async (input) => {
        this.resetSession(input);
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
      validatePlacement: (placementId) => this.validateSession(placementId),
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
          ...(node.visual?.src
            ? {
                image: {
                  src: node.visual.src,
                  ...(node.visual.metadata
                    ? { metadata: node.visual.metadata }
                    : {}),
                },
              }
            : {}),
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
    this.context?.eventBus.emit("image:state:change", this.getViewState());
  }

  private setSessionNotice(notice: ImagePlacementSessionNotice | null) {
    if (this.sessionNotice === notice) return;
    this.sessionNotice = notice;
    this.context?.eventBus.emit("image:session:notice", notice);
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
    this.workingImageDraftsBySessionId.set(sessionId, cloneImageState(image));
  }

  private async beginSession(input: ImagePlacementSessionInput | string) {
    const { placementId, sessionId } = this.normalizeSessionInput(input);
    const placement = this.getPlacementElement(placementId);
    if (!placement) return { ok: false, reason: "placement-not-found" };
    this.clearPendingCanvasSession(placementId);
    const previousSessionId = this.sessionIdsByPlacementId.get(placementId);
    if (
      this.activePlacementId === placementId &&
      previousSessionId === sessionId &&
      this.workingImages.has(placementId)
    ) {
      this.sessionIdsByPlacementId.set(placementId, sessionId);
      this.activeImageSessionId = sessionId;
      this.ensureImageSessionScene(placementId, sessionId);
      this.emitStateChange();
      return { ok: true };
    }
    this.activePlacementId = placementId;
    this.activeImageSessionId = sessionId;
    this.sessionIdsByPlacementId.set(placementId, sessionId);
    this.ensureImageSessionScene(placementId, sessionId);
    this.patchCommittedImageConditionsForPlacements();
    if (this.workingImageDraftsBySessionId.has(sessionId)) {
      this.workingImages.set(
        placementId,
        cloneImageState(this.workingImageDraftsBySessionId.get(sessionId)),
      );
    } else if (
      !this.workingImages.has(placementId) ||
      previousSessionId !== sessionId
    ) {
      this.setWorkingImageDraft(
        placementId,
        sessionId,
        createEditableWorkingImage(this.getCommittedImage(placement)),
      );
    }
    this.upsertImageSessionDraft(
      placementId,
      this.workingImages.get(placementId) ?? null,
      sessionId,
    );
    this.sessionService?.focusSession(sessionId);
    this.syncWorkingPlacementConditionContext();
    this.setSessionNotice(null);
    await this.updateImagesAsync();
    return { ok: true };
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
    if (!this.workingImages.has(placementId)) {
      await this.beginSession({ placementId, sessionId });
    }
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
    if (!this.workingImages.has(placementId)) {
      await this.beginSession({ placementId, sessionId });
    }
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
      operation,
      area,
    });
    return await this.setImageTransform({ placementId, sessionId }, updates);
  }

  private async clearImage(input: ImagePlacementSessionInput | string) {
    const { placementId, sessionId } = this.normalizeSessionInput(input);
    const placement = this.getPlacementElement(placementId);
    if (!placement) return { ok: false, reason: "placement-not-found" };
    this.setWorkingImageDraft(placementId, sessionId, null);
    this.upsertImageSessionDraft(placementId, null, sessionId);
    this.syncWorkingPlacementConditionContext();
    this.updateImages();
    this.emitStateChange();
    return { ok: true };
  }

  private resetSession(input?: ImagePlacementSessionInput | string) {
    const { placementId, sessionId } = this.getActiveSessionInput(input);
    this.clearPendingCanvasSession(placementId);
    this.resolveSessionTargetIds(placementId).forEach((id) => {
      const targetSessionId =
        id === placementId
          ? sessionId
          : this.sessionIdsByPlacementId.get(id) ||
            this.getFallbackImageSessionId(id);
      void this.sessionService?.cancelSession(targetSessionId, {
        placementId: id,
      });
      this.removeImageSessionScene(targetSessionId);
      this.sessionIdsByPlacementId.delete(id);
      this.workingImageDraftsBySessionId.delete(targetSessionId);
    });
    if (placementId) {
      this.restoreOrDeleteWorkingImage(placementId);
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
    this.updateImages();
  }

  private async validateSession(input?: ImagePlacementSessionInput | string) {
    const { placementId } = this.getActiveSessionInput(input);
    const policy = this.getPlacementPolicy();
    const targetIds = this.resolveSessionTargetIds(placementId);
    await this.syncWorkingImageTransformsFromCanvas(targetIds);
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
    if (
      targetIds.length > 0 &&
      targetIds.every(
        (id) => this.workingImages.has(id) && !this.workingImages.get(id)?.src,
      )
    ) {
      const commitResult = await this.commitWorkingImagesAsCropped(targetIds);
      if (!commitResult.ok) return commitResult;
      await this.finishCommittedSessions(placementId, sessionId, targetIds);
      await this.updateImagesAsync();
      this.emitStateChange();
      return { ok: true };
    }
    const validation = await this.validateSession({ placementId, sessionId });
    if ("ok" in validation && validation.ok === true) {
      const commitResult = await this.commitWorkingImagesAsCropped(targetIds);
      if (!commitResult.ok) return commitResult;
      await this.finishCommittedSessions(placementId, sessionId, targetIds);
      await this.updateImagesAsync();
      this.emitStateChange();
      return { ok: true };
    }
    return validation;
  }

  private async finishCommittedSessions(
    placementId: string,
    sessionId: string,
    targetIds: readonly string[],
  ): Promise<void> {
    if (!placementId || this.activePlacementId === placementId) {
      this.activePlacementId = null;
      this.activeImageSessionId = null;
    }
    await Promise.all(
      targetIds.map(async (id) => {
        const targetSessionId =
          id === placementId
            ? sessionId
            : this.sessionIdsByPlacementId.get(id) ||
              this.getFallbackImageSessionId(id);
        await this.sessionService?.commitSession(targetSessionId);
        this.removeImageSessionScene(targetSessionId);
        this.sessionIdsByPlacementId.delete(id);
        this.workingImageDraftsBySessionId.delete(targetSessionId);
      }),
    );
    this.sessionService?.focusSession(null);
    this.syncWorkingPlacementConditionContext();
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

      const croppedSrc = croppedImage.url
        ? await normalizeCommittedExportUrl(croppedImage.url)
        : image.src;
      this.rememberGeneratedCommittedExportObjectUrl(
        croppedImage.url,
        croppedSrc,
      );
      const sourceSrc = readMetadataSourceSrc(image.metadata) || image.src;
      const sourceTransform = resolveImageTransformSnapshot(image);
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
              : "legacy",
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
        interaction: {
          imagePlacement: {
            ...placementData,
            image: image ?? undefined,
          },
          ...(image
            ? {
                enabled: true,
              }
            : {}),
        },
        ...(image
          ? {
              data: {
                placementId,
                source: "committed",
                type: "image-placement-image",
              },
            }
          : {}),
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
    this.recordImageSessionCommitArtifacts(placementId, image);
    this.workingImages.delete(placementId);
    this.workingImageDraftsBySessionId.delete(
      this.sessionIdsByPlacementId.get(placementId) ||
        this.getFallbackImageSessionId(placementId),
    );
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
    const frame = getPlacementFrame(placement);
    const committedTransform = image
      ? createCommittedImagePlacementTransform(frame, image.metadata)
      : undefined;
    this.renderIntentService.patchIntent(IMAGE_RENDER_SCOPE, {
      id: placementId,
      subject: {
        kind: "object",
        surfaceId:
          typeof placement.metadata?.documentSurfaceId === "string"
            ? placement.metadata.documentSurfaceId
            : "legacy",
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
      interaction: {
        imagePlacement: {
          ...placementData,
          image: image ?? undefined,
        },
        ...(image
          ? {
              enabled: true,
            }
          : {}),
      },
      ...(image
        ? {
            data: {
              placementId,
              source: "committed",
              type: "image-placement-image",
            },
          }
        : {}),
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

  private onSelectionChanged = (event: any) => {
    const selected = Array.isArray(event?.selected)
      ? event.selected[0]
      : event?.target;
    this.beginSessionFromCanvasTarget(selected);
  };

  private onMouseDown = (event: any) => {
    this.beginSessionFromCanvasTarget(event?.target);
  };

  private getCanvasTargetPlacementId(target: any): string {
    const data = isRecord(target?.data) ? target.data : {};
    const session = isRecord(data.session) ? data.session : {};
    const payload = isRecord(session.payload) ? session.payload : {};
    const imagePlacement = isRecord(data.imagePlacement)
      ? data.imagePlacement
      : {};
    const type = typeof data.type === "string" ? data.type.trim() : "";
    const placementId =
      typeof data.placementId === "string"
        ? data.placementId
        : typeof payload.placementId === "string"
          ? payload.placementId
          : typeof imagePlacement.placementId === "string"
            ? imagePlacement.placementId
            : type.startsWith("image-placement-") &&
                typeof data.subjectId === "string"
              ? data.subjectId
              : "";
    return placementId.trim();
  }

  private beginSessionFromCanvasTarget(target: any) {
    const selected = target;
    const placementId = this.getCanvasTargetPlacementId(selected);
    if (!placementId) {
      return;
    }
    if (
      this.activePlacementId === placementId &&
      this.workingImages.has(placementId)
    ) {
      this.emitStateChange();
      return;
    }
    this.activePlacementId = placementId;
    this.activeImageSessionId = null;
    this.emitStateChange();
    this.emitCanvasSessionOpen(placementId, selected);
  }

  private scheduleCanvasSession(placementId: string, target?: any) {
    this.pendingCanvasSessionPlacementId = placementId;
    this.pendingCanvasSessionTarget = target ?? null;
    if (this.pendingCanvasSessionTimer !== null) return;

    this.pendingCanvasSessionTimer = globalThis.setTimeout(() => {
      const nextPlacementId = this.pendingCanvasSessionPlacementId;
      const nextTarget = this.pendingCanvasSessionTarget;
      this.pendingCanvasSessionPlacementId = null;
      this.pendingCanvasSessionTarget = null;
      this.pendingCanvasSessionTimer = null;

      if (!nextPlacementId) return;
      if (
        this.activePlacementId === nextPlacementId &&
        this.workingImages.has(nextPlacementId)
      ) {
        this.emitStateChange();
        this.emitCanvasSessionOpen(nextPlacementId, nextTarget);
        return;
      }

      void this.beginSession(nextPlacementId).then((result) => {
        if (result.ok) {
          this.emitCanvasSessionOpen(nextPlacementId, nextTarget);
        }
      });
    }, 0);
  }

  private emitCanvasSessionOpen(placementId: string, target?: any) {
    const placement = this.getPlacementStates().find(
      (item) => item.id === placementId,
    );
    if (!placement) {
      return;
    }
    this.context?.eventBus.emit("image:session:open", {
      sessionId: placement.sessionKey,
      sessionKey: placement.sessionKey,
      placementId,
      source: "canvas",
      scope: {
        surfaceId: this.resolvePlacementSurfaceId(placement),
        subjectId: placement.id,
        channel: IMAGE_SESSION_CHANNEL,
      },
      targetData: isRecord(target?.data) ? { ...target.data } : {},
    });
  }

  private clearPendingCanvasSession(placementId?: string) {
    if (placementId && this.pendingCanvasSessionPlacementId !== placementId)
      return;
    if (this.pendingCanvasSessionTimer !== null) {
      globalThis.clearTimeout(this.pendingCanvasSessionTimer);
    }
    this.pendingCanvasSessionPlacementId = null;
    this.pendingCanvasSessionTarget = null;
    this.pendingCanvasSessionTimer = null;
  }

  private onSelectionCleared = () => {
    const pendingPlacementId = this.pendingCanvasSessionPlacementId;
    this.clearPendingCanvasSession();
    if (
      pendingPlacementId &&
      this.activePlacementId === pendingPlacementId &&
      !this.workingImages.has(pendingPlacementId)
    ) {
      this.activePlacementId = null;
    }
    this.endMoveSnapInteraction();
    this.emitStateChange();
  };

  private bindCanvasInteractionHandlers() {
    if (!this.canvasService || this.canvasObjectMovingHandler) return;
    this.canvasMouseUpHandler = (event: any) => {
      const target = this.getActiveImageTarget(event?.target);
      if (
        target &&
        typeof target?.data?.placementId === "string" &&
        target.data.placementId === this.movingPlacementId
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
    this.canvasService.onCanvasEvent(
      "object:moving",
      this.canvasObjectMovingHandler,
    );
    this.canvasService.onCanvasEvent(
      "before:render",
      this.canvasBeforeRenderHandler,
    );
    this.canvasService.onCanvasEvent(
      "after:render",
      this.canvasAfterRenderHandler,
    );
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
    if (!target) return null;
    if (target?.data?.type !== "image-placement-image") return null;
    if (target?.data?.source !== "working") return null;
    if (typeof target?.data?.placementId !== "string") return null;
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
      this.canvasService?.requestRenderAll();
    }
  }

  private clearSnapPreview() {
    const shouldClear =
      this.hasRenderedSnapGuides ||
      Boolean(this.activeSnapX) ||
      Boolean(this.activeSnapY);
    this.activeSnapX = null;
    this.activeSnapY = null;
    this.hasRenderedSnapGuides = false;
    if (shouldClear) {
      this.canvasService?.clearTopContext();
      this.canvasService?.requestRenderAll();
    }
  }

  private endMoveSnapInteraction() {
    this.movingPlacementId = null;
    this.clearSnapPreview();
  }

  private applyMoveSnapToTarget(target: any): {
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

  private handleCanvasObjectMoving(event: any) {
    const target = this.getActiveImageTarget(event?.target);
    if (!target || !this.canvasService) return;
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
    const guidePlacementId = this.movingPlacementId || this.activePlacementId;
    const placement = guidePlacementId
      ? this.getPlacementStates().find((item) => item.id === guidePlacementId)
      : null;
    if (!placement) return;
    const frame = placement.frame;
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
    const placementId = this.getWorkingImageTargetPlacementId(target);
    if (!placementId) return;
    if (this.movingPlacementId === placementId) {
      this.applyMoveSnapToTarget(target);
    }
    this.endMoveSnapInteraction();
    void this.syncWorkingImageTransformFromTarget(target);
  };

  private async syncWorkingImageTransformsFromCanvas(
    placementIds: readonly string[],
  ) {
    for (const placementId of placementIds) {
      const target = this.getWorkingImageCanvasTarget(placementId);
      if (target) {
        await this.syncWorkingImageTransformFromTarget(target);
      }
    }
  }

  private getWorkingImageCanvasTarget(placementId: string): any | null {
    const normalizedPlacementId = String(placementId || "").trim();
    if (
      !normalizedPlacementId ||
      !this.workingImages.has(normalizedPlacementId)
    )
      return null;
    const layerId = `image.session.image`;
    const target =
      this.canvasService?.selectOneObject({
        ids: [this.getWorkingImageNodeId(normalizedPlacementId)],
        layerIds: [layerId],
      }) || this.canvasService?.getActiveObject();
    return this.getWorkingImageTargetPlacementId(target) ===
      normalizedPlacementId
      ? target
      : null;
  }

  private getWorkingImageTargetPlacementId(target: any): string | null {
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

  private async syncWorkingImageTransformFromTarget(target: any) {
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
    const source: SourceSize = {
      width: finiteNumber(target.width, 1),
      height: finiteNumber(target.height, 1),
    };
    const image = this.workingImages.get(placementId) || placement.image;
    if (image?.src) {
      this.sourceSizeCache.rememberSourceSize(image.src, source);
    }
    const objectScaling =
      typeof target.getObjectScaling === "function"
        ? target.getObjectScaling()
        : null;
    const coverScale = getCoverScaleFromRect(placement.frame, source);
    const sceneScale = this.canvasService.getSceneScale();
    const objectScale =
      finiteNumber(objectScaling?.x, finiteNumber(target.scaleX, 1)) /
      Math.max(0.0001, sceneScale);
    await this.setImageTransform(
      placementId,
      {
        left:
          (center.x - placement.frame.left) /
          Math.max(1, placement.frame.width),
        top:
          (center.y - placement.frame.top) /
          Math.max(1, placement.frame.height),
        scale: objectScale / Math.max(0.0001, coverScale),
        angle: finiteNumber(target.angle, 0),
      },
      { skipRender: true },
    );
  }

  private buildWorkingImageSpecs(): RenderObjectSpec[] {
    return this.getPlacementStates()
      .filter(
        (placement) =>
          this.shouldRenderWorkingImagePlacement(placement.id) &&
          placement.image?.src,
      )
      .map((placement) => this.buildImageSpec(placement, { committed: false }))
      .filter((spec): spec is RenderObjectSpec => Boolean(spec));
  }

  private shouldRenderWorkingPlacement(placementId: string): boolean {
    return this.workingImages.has(placementId);
  }

  private shouldRenderWorkingImagePlacement(placementId: string): boolean {
    return this.workingImages.has(placementId);
  }

  private buildImageSpec(
    placement: ImagePlacementState,
    options: { committed: boolean },
  ): RenderObjectSpec | null {
    const image = placement.image;
    if (!image?.src) return null;
    const source = this.sourceSizeCache.getSourceSize(image.src) || {
      width: placement.frame.width,
      height: placement.frame.height,
    };
    const scale =
      getCoverScaleFromRect(placement.frame, source) *
      Math.max(0.05, image.scale ?? 1);
    const stretchScale = Math.max(0.05, image.scale ?? 1);
    const id = options.committed
      ? `image:${placement.id}`
      : this.getWorkingImageNodeId(placement.id);
    const clipEffect = this.buildPlacementClipEffect(placement, id);
    const stretchProps =
      placement.fit === "stretch"
        ? {
            width: placement.frame.width,
            height: placement.frame.height,
            scaleX: stretchScale,
            scaleY: stretchScale,
          }
        : {
            scaleX: scale,
            scaleY: scale,
          };
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
        source: options.committed ? "committed" : "working",
        session: this.createImagePlacementSessionData(placement, {
          source: options.committed
            ? "image-placement-committed"
            : "image-placement-working",
        }),
      },
      props: {
        left:
          placement.frame.left + (image.left ?? 0.5) * placement.frame.width,
        top: placement.frame.top + (image.top ?? 0.5) * placement.frame.height,
        originX: "center",
        originY: "center",
        ...stretchProps,
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
          selectable: false,
          evented: false,
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

  private isImageSessionSceneChange(event: {
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
      sceneIds.every((id) => this.isImageSessionSceneId(id))
    );
  }

  private ensureImageSessionScene(
    placementId: string,
    sessionId: string,
  ): string | null {
    if (!this.sceneService) return null;
    const sceneId = this.getImageSessionSceneId(sessionId);
    if (!this.sceneService.getScene(sceneId)) {
      const wasPublishing = this.isPublishingImageSessionScenes;
      this.isPublishingImageSessionScenes = true;
      try {
        this.sceneService.ensureScene({
          id: sceneId,
          order: IMAGE_OVERLAY_STACK,
          renderable: true,
          transient: true,
          visible: true,
          metadata: {
            channel: IMAGE_SESSION_CHANNEL,
            placementId,
            sessionId,
            source: this.id,
          },
        });
      } finally {
        this.isPublishingImageSessionScenes = wasPublishing;
      }
    }
    this.sessionSceneIdsBySessionId.set(sessionId, sceneId);
    return sceneId;
  }

  private removeImageSessionScene(sessionId: string) {
    const sceneId = this.sessionSceneIdsBySessionId.get(sessionId);
    if (!sceneId) return;
    if (this.sceneService?.getScene(sceneId)) {
      const wasPublishing = this.isPublishingImageSessionScenes;
      this.isPublishingImageSessionScenes = true;
      try {
        this.sceneService.removeScene(sceneId);
      } finally {
        this.isPublishingImageSessionScenes = wasPublishing;
      }
    }
    this.sessionSceneIdsBySessionId.delete(sessionId);
  }

  private clearAllSessionScenes() {
    Array.from(this.sessionSceneIdsBySessionId.values()).forEach((sceneId) => {
      if (this.sceneService?.getScene(sceneId)) {
        this.sceneService.removeScene(sceneId);
      }
    });
  }

  private publishImageSessionScenes() {
    if (!this.sceneService) return;
    const wasPublishing = this.isPublishingImageSessionScenes;
    this.isPublishingImageSessionScenes = true;
    try {
      this.sceneService.transaction(() => {
        const renderedSceneIds = new Set<string>();
        this.getPlacementStates()
          .filter((placement) =>
            this.shouldRenderWorkingPlacement(placement.id),
          )
          .forEach((placement) => {
            const sessionId =
              this.sessionIdsByPlacementId.get(placement.id) ||
              this.getFallbackImageSessionId(placement.id);
            const sceneId = this.ensureImageSessionScene(
              placement.id,
              sessionId,
            );
            if (!sceneId) return;
            renderedSceneIds.add(sceneId);
            this.sceneService!.clearScene(sceneId);
            this.addImageSessionSceneLayers(sceneId);
            this.buildImageSessionSceneSpecs(placement, sessionId).forEach(
              ({ layerId, spec }, index) => {
                const element = this.renderSpecToSceneElement(
                  spec,
                  layerId,
                  index,
                );
                if (element)
                  this.sceneService!.addElement(element, { sceneId });
              },
            );
          });

        Array.from(this.sessionSceneIdsBySessionId.entries()).forEach(
          ([sessionId, sceneId]) => {
            if (!renderedSceneIds.has(sceneId)) {
              if (this.sceneService?.getScene(sceneId)) {
                this.sceneService.removeScene(sceneId);
              }
              this.sessionSceneIdsBySessionId.delete(sessionId);
            }
          },
        );
      });
    } finally {
      this.isPublishingImageSessionScenes = wasPublishing;
    }
  }

  private addImageSessionSceneLayers(sceneId: string) {
    [
      [IMAGE_SESSION_UNDERLAY_LAYER_ID, 0],
      [IMAGE_SESSION_IMAGE_LAYER_ID, 1],
      [IMAGE_SESSION_OVERLAY_LAYER_ID, 2],
      [IMAGE_SESSION_CONTROLS_LAYER_ID, 3],
    ].forEach(([id, order]) => {
      this.sceneService!.addLayer(
        { id: String(id), order: Number(order) },
        { sceneId },
      );
    });
  }

  private buildImageSessionSceneSpecs(
    placement: ImagePlacementState,
    sessionId: string,
  ): Array<{ layerId: string; spec: RenderObjectSpec }> {
    const specs: Array<{ layerId: string; spec: RenderObjectSpec }> = [];
    specs.push(
      ...this.buildSessionProjectionSceneSpecs(
        placement,
        "below",
        IMAGE_SESSION_UNDERLAY_LAYER_ID,
      ),
    );
    const imageSpec = this.buildImageSpec(placement, { committed: false });
    if (imageSpec) {
      specs.push({ layerId: IMAGE_SESSION_IMAGE_LAYER_ID, spec: imageSpec });
    }
    specs.push(
      ...this.buildSessionProjectionSceneSpecs(
        placement,
        "above",
        IMAGE_SESSION_OVERLAY_LAYER_ID,
      ),
    );
    if (placement.id === this.activePlacementId) {
      specs.push(
        ...this.buildSessionProjectionSceneSpecs(
          placement,
          "controls",
          IMAGE_SESSION_CONTROLS_LAYER_ID,
        ),
      );
      specs.push(...this.buildSessionOverlayEntries(placement, sessionId));
    }
    return specs;
  }

  private buildSessionProjectionSceneSpecs(
    placement: ImagePlacementState,
    projectionPlacement: ImageSessionProjectionPlacement,
    layerId: string,
  ): Array<{ layerId: string; spec: RenderObjectSpec }> {
    const projections = (placement.sessionProjections ?? []).filter(
      (projection) => projection.placement === projectionPlacement,
    );
    if (!projections.length) return [];
    const sourceNodes = this.getProjectionSourceNodes();
    return projections.flatMap((projection) =>
      sourceNodes
        .filter((node) =>
          this.matchesSessionProjectionSource(placement, node, projection),
        )
        .map((node, index) => {
          const spec = this.graphNodeToSessionProjectionSpec(
            placement,
            projection,
            node,
            index,
          );
          return spec ? { layerId, spec } : null;
        })
        .filter((item): item is { layerId: string; spec: RenderObjectSpec } =>
          Boolean(item),
        ),
    );
  }

  private getProjectionSourceNodes(): RenderGraphNode[] {
    const graph = this.renderIntentService?.getGraph();
    if (!graph) return [];
    return graph.layers.flatMap((layer) => layer.nodes);
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
      String(placement.metadata?.documentSurfaceId || "").trim() || "legacy"
    );
  }

  private graphNodeToSessionProjectionSpec(
    placement: ImagePlacementState,
    projection: ImageSessionProjection,
    node: RenderGraphNode,
    index: number,
  ): RenderObjectSpec | null {
    if (node.type === "image" && !node.visual?.src) return null;
    const opacity = Number(projection.opacity);
    const sourceOpacity = Number(node.props.opacity);
    const resolvedOpacity = Number.isFinite(opacity)
      ? Math.max(0, Math.min(1, opacity)) *
        (Number.isFinite(sourceOpacity) ? sourceOpacity : 1)
      : node.props.opacity;
    return {
      id: `projection:${placement.id}:${projection.id}:${node.id}:${index}`,
      subjectId: node.subjectId,
      type: node.type,
      ...(node.visual?.src ? { src: node.visual.src } : {}),
      space: node.coordinateSpace,
      data: {
        ...node.data,
        placementId: placement.id,
        projectionId: projection.id,
        projectionSourceNodeId: node.id,
        projectionSourceSubjectId: node.subjectId,
        source: "projection",
        type: "session-projection",
      },
      props: {
        ...node.props,
        ...this.resolveGraphNodePlacementProps(node),
        ...(resolvedOpacity !== undefined ? { opacity: resolvedOpacity } : {}),
        visible: this.isSessionProjectionSourceVisible(node),
        selectable: projection.interactive === true,
        evented: projection.interactive === true,
        hasControls: projection.interactive === true,
        hasBorders: projection.interactive === true,
      },
      effects: node.effects,
    };
  }

  private isSessionProjectionSourceVisible(node: RenderGraphNode): boolean {
    if (node.visible === false) return false;
    const conditionContext =
      this.renderIntentService?.createRuntimeConditionContext({
        isSessionActive: (sessionId: string) =>
          this.sessionService?.isSessionActive(sessionId) ?? false,
        isSessionScopeActive: (scope) =>
          this.sessionService?.hasActiveSession({ scope }) ?? false,
        isSessionFocused: (sessionId: string) =>
          this.sessionService?.getFocusedSessionId() === sessionId,
        hasAnyActiveSession: (scope) =>
          this.sessionService?.hasActiveSession({ scope }) ?? false,
      });
    return evaluateRuntimeCondition(node.visibleWhen, conditionContext ?? {});
  }

  private resolveGraphNodePlacementProps(
    node: RenderGraphNode,
  ): Record<string, unknown> {
    const frame = node.frame;
    const transform = node.transform ?? {};
    const hasTransformLeft = Number.isFinite(transform.left);
    const hasTransformTop = Number.isFinite(transform.top);

    if (node.type === "image" && frame) {
      return {
        ...transform,
        left: hasTransformLeft ? transform.left : frame.x + frame.width / 2,
        top: hasTransformTop ? transform.top : frame.y + frame.height / 2,
        originX: hasTransformLeft ? transform.originX : "center",
        originY: hasTransformTop ? transform.originY : "center",
        width: frame.width,
        height: frame.height,
        scaleX: normalizeFrameImageScale(transform.scaleX),
        scaleY: normalizeFrameImageScale(transform.scaleY),
      };
    }

    return {
      ...transform,
      ...(frame
        ? {
            left: hasTransformLeft ? transform.left : frame.x,
            top: hasTransformTop ? transform.top : frame.y,
            width: frame.width,
            height: frame.height,
            originX: hasTransformLeft ? transform.originX : "left",
            originY: hasTransformTop ? transform.originY : "top",
          }
        : {}),
    };
  }

  private renderSpecToSceneElement(
    spec: RenderObjectSpec,
    layerId: string,
    order: number,
  ): SceneElementInput | null {
    const props = { ...(spec.props || {}) };
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
      style: props,
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
    const existing = this.sessionService.getSession(sessionId);
    if (existing?.status === "active") {
      this.sessionService.updateSession(sessionId, { draft, dirty: true });
      return;
    }
    this.sessionService.createSession({
      sessionId,
      scope: {
        surfaceId: this.resolvePlacementSurfaceId(placement),
        subjectId: placement.id,
        channel: IMAGE_SESSION_CHANNEL,
      },
      draft,
      leavePolicy: "block",
    });
  }

  private recordImageSessionCommitArtifacts(
    placementId: string,
    image: ImagePlacementImageState | null,
  ) {
    if (!this.sessionService) return;
    const sessionId =
      this.sessionIdsByPlacementId.get(placementId) ||
      this.getFallbackImageSessionId(placementId);
    if (!this.sessionService.getSession(sessionId)) return;
    const artifacts: SessionArtifact[] = [
      {
        artifactId: `${sessionId}:image`,
        role: "committed-image",
        data: cloneImageState(image),
      },
    ];
    if (image?.metadata?.transform) {
      artifacts.push({
        artifactId: `${sessionId}:source-transform`,
        role: "source-transform",
        data: image.metadata.transform,
      });
    }
    if (image?.metadata?.derived) {
      artifacts.push({
        artifactId: `${sessionId}:derived`,
        role: "derived-image",
        data: image.metadata.derived,
      });
    }
    this.sessionService.updateSession(sessionId, {
      artifacts,
      dirty: false,
    });
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
