import type Disposable from "./disposable";
import type { Service } from "./service";
import type { Unit } from "./coordinate";
import type {
  AffinePlacement,
  CoordinatePoint,
  CoordinateRect,
  CoordinateSpace,
  Matrix2D,
} from "./coordinate";
import type { DielineShape, DielineShapeStyle } from "./dieline-shape";
import type { SessionScope } from "./workflow-session";
import type { GeometryRef } from "./geometry-source";

export type RenderObjectType = "rect" | "image" | "path" | "text";

export type RenderProps = Record<string, any>;
export type RenderCoordinateSpace = CoordinateSpace;
export type RenderViewportCoordinateSpace = Extract<
  CoordinateSpace,
  "scene" | "screen"
>;
export type RenderLayoutLength = number | string;
export type RenderLayoutAlign = "start" | "center" | "end";
export type RenderLayoutReference =
  | "sceneViewport"
  | "screenViewport"
  | "custom";

export interface RenderLayoutInsets {
  top?: RenderLayoutLength;
  right?: RenderLayoutLength;
  bottom?: RenderLayoutLength;
  left?: RenderLayoutLength;
}

export interface RenderLayoutRect {
  left: number;
  top: number;
  width: number;
  height: number;
  space: RenderViewportCoordinateSpace;
}

export interface RenderObjectLayoutSpec {
  reference?: RenderLayoutReference;
  referenceRect?: RenderLayoutRect;
  inset?: RenderLayoutLength | RenderLayoutInsets;
  alignX?: RenderLayoutAlign;
  alignY?: RenderLayoutAlign;
  offsetX?: RenderLayoutLength;
  offsetY?: RenderLayoutLength;
  width?: RenderLayoutLength;
  height?: RenderLayoutLength;
}

export interface RenderObjectSpec {
  id: string;
  subjectId?: string;
  type: RenderObjectType;
  /** Logical container geometry, excluding visual fit and placement. */
  containerGeometryRef?: GeometryRef;
  /** Final visual geometry used by interactive preview renderers. */
  previewGeometryRef?: GeometryRef;
  /** Final visual geometry used by export renderers. */
  exportGeometryRef?: GeometryRef;
  props: RenderProps;
  data?: Record<string, any>;
  src?: string;
  space?: RenderCoordinateSpace;
  placement?: AffinePlacement;
  exportKeys?: readonly string[];
  layout?: RenderObjectLayoutSpec;
  effects?: RenderEffectSpec[];
  visibleWhen?: RuntimeConditionExpr;
}

/** Identifies the declarative render sources whose backend projection is stale. */
export type RenderInvalidation =
  /** Reproject every target; this is an authoritative interaction barrier. */
  | { type: "full" }
  /** Reconcile a root/composition transition without discarding stable targets. */
  | { type: "composition" }
  | { type: "render-intents"; intentIds: readonly string[] }
  | { type: "scene"; sceneId: string }
  | {
      type: "scene-elements";
      sceneId: string;
      elementIds: readonly string[];
    };

/** Stable provenance used to match a backend target to an invalidation. */
export type RenderObjectOrigin =
  | { type: "render-intent"; intentId: string }
  | { type: "scene-element"; sceneId: string; elementId: string };

/** Determines whether declarative state or a live interaction owns a transform. */
export type RenderObjectOwnership =
  | { type: "declarative" }
  | {
      type: "interaction";
      interactionId: string;
      phase: "active" | "committing";
    };

export interface RenderLayerSpec {
  id: string;
  order: number;
  visible: boolean;
  effects?: RenderEffectSpec[];
  objects: RenderObjectSpec[];
}

export interface RenderPatternSpec {
  type: "pattern";
  kind: "diagonalHatch";
  color: string;
  size?: number;
  repetition?: "repeat";
}

export type RuntimeConditionComparator = ">" | ">=" | "==" | "!=" | "<" | "<=";

export type RuntimeConditionRef =
  | { source: "context"; key: string }
  | { source: "activeToolId" }
  | {
      source: "workflowSession";
      field: "active" | "focused";
      sessionId: string;
    }
  | {
      source: "workflowSession";
      field: "scopeActive";
      scope: Partial<SessionScope>;
    }
  | {
      source: "workflowSession";
      field: "anyActive";
      scope?: Partial<SessionScope>;
    }
  | {
      source: "renderLayer";
      layerId: string;
      field: "exists" | "objectCount" | "visibleObjectCount";
    };

export type RuntimeConditionExpr =
  | { op: "const"; value: boolean }
  | { op: "truthy"; ref: RuntimeConditionRef }
  | { op: "equals"; ref: RuntimeConditionRef; value: unknown }
  | { op: "in"; ref: RuntimeConditionRef; values: readonly unknown[] }
  | {
      op: "compare";
      ref: RuntimeConditionRef;
      cmp: RuntimeConditionComparator;
      value: number;
    }
  | { op: "not"; expr: RuntimeConditionExpr }
  | { op: "all"; exprs: readonly RuntimeConditionExpr[] }
  | { op: "any"; exprs: readonly RuntimeConditionExpr[] };

type RenderClipPathEffectBase = {
  type: "clipPath";
  id?: string;
  activeWhen?: RuntimeConditionExpr;
  /** Authoritative geometry used by interactive renderers. */
  previewGeometryRef?: GeometryRef;
  /** Authoritative geometry used by export renderers. */
  exportGeometryRef?: GeometryRef;
};

export type RenderClipPathEffectSpec =
  | (RenderClipPathEffectBase & {
      coordinateMode: "absolute";
      source: RenderObjectSpec & { space: CoordinateSpace };
    })
  | (RenderClipPathEffectBase & {
      coordinateMode: "object";
      source: Omit<RenderObjectSpec, "space"> & { space: "object-local" };
    });

export type RenderEffectSpec = RenderClipPathEffectSpec;

export interface RenderEffectDefinition {
  type: RenderEffectSpec["type"] | string;
  capabilityId?: string;
  metadata?: Record<string, unknown>;
}

export interface RenderEffectRendererContext<
  TTarget = unknown,
  TServices = unknown,
> {
  target: TTarget;
  spec: RenderObjectSpec;
  effect: RenderEffectSpec;
  services?: TServices;
}

export interface RenderEffectRendererContribution<
  TTarget = unknown,
  TServices = unknown,
> {
  effectType: RenderEffectSpec["type"] | string;
  backend?: string;
  render(
    context: RenderEffectRendererContext<TTarget, TServices>,
  ): void | Promise<void>;
}

export interface RegisteredRenderEffectDefinition extends RenderEffectDefinition {
  extensionId: string;
}

export interface RegisteredRenderEffectRenderer extends RenderEffectRendererContribution {
  extensionId: string;
}

class RenderEffectRegistryDisposable implements Disposable {
  private disposed = false;

  constructor(private readonly disposeFn: () => void) {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeFn();
  }
}

export class RenderEffectRegistryService implements Service {
  private readonly definitions: RegisteredRenderEffectDefinition[] = [];
  private readonly renderers: RegisteredRenderEffectRenderer[] = [];

  registerDefinition(
    extensionId: string,
    definition: RenderEffectDefinition,
  ): Disposable {
    const type = String(definition.type || "").trim();
    if (!type) {
      throw new Error("Render effect definition requires type.");
    }
    const registered: RegisteredRenderEffectDefinition = {
      ...definition,
      type,
      extensionId,
    };
    this.definitions.push(registered);
    return new RenderEffectRegistryDisposable(() => {
      const index = this.definitions.indexOf(registered);
      if (index >= 0) this.definitions.splice(index, 1);
    });
  }

  registerRenderer(
    extensionId: string,
    renderer: RenderEffectRendererContribution,
  ): Disposable {
    const effectType = String(renderer.effectType || "").trim();
    if (!effectType) {
      throw new Error("Render effect renderer requires effectType.");
    }
    const registered: RegisteredRenderEffectRenderer = {
      ...renderer,
      effectType,
      extensionId,
    };
    this.renderers.push(registered);
    return new RenderEffectRegistryDisposable(() => {
      const index = this.renderers.indexOf(registered);
      if (index >= 0) this.renderers.splice(index, 1);
    });
  }

  getRenderers(query: {
    effectType: string;
    backend?: string;
  }): RegisteredRenderEffectRenderer[] {
    const effectType = String(query.effectType || "").trim();
    const backend = String(query.backend || "").trim();
    return this.renderers.filter((renderer) => {
      if (renderer.effectType !== effectType) return false;
      if (backend && renderer.backend && renderer.backend !== backend)
        return false;
      return true;
    });
  }

  listDefinitions(): RegisteredRenderEffectDefinition[] {
    return this.definitions.slice();
  }

  listRenderers(): RegisteredRenderEffectRenderer[] {
    return this.renderers.slice();
  }

  dispose() {
    this.definitions.length = 0;
    this.renderers.length = 0;
  }
}

export interface RuntimeConditionLayerState {
  exists: boolean;
  objectCount: number;
  visibleObjectCount?: number;
}

export interface RuntimeConditionEvalContext {
  activeToolId?: string | null;
  contextValues?: Map<string, unknown> | Record<string, unknown>;
  isSessionActive?: (sessionId: string) => boolean;
  isSessionScopeActive?: (scope: Partial<SessionScope>) => boolean;
  isSessionFocused?: (sessionId: string) => boolean;
  hasAnyActiveSession?: (scope?: Partial<SessionScope>) => boolean;
  layers?: Map<string, RuntimeConditionLayerState>;
  getLayerState?: (layerId: string) => RuntimeConditionLayerState | undefined;
  getContextValue?: (key: string) => unknown;
}

function readRuntimeConditionContextValue(
  context: RuntimeConditionEvalContext,
  key: string,
): unknown {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return undefined;
  if (context.getContextValue) {
    return context.getContextValue(normalizedKey);
  }
  const values = context.contextValues;
  if (!values) return undefined;
  if (values instanceof Map) {
    return values.get(normalizedKey);
  }
  return Object.prototype.hasOwnProperty.call(values, normalizedKey)
    ? values[normalizedKey]
    : undefined;
}

function readRuntimeConditionLayerState(
  context: RuntimeConditionEvalContext,
  layerId: string,
): RuntimeConditionLayerState | undefined {
  if (context.getLayerState) {
    return context.getLayerState(layerId);
  }
  return context.layers?.get(layerId);
}

function readRuntimeConditionRefValue(
  ref: RuntimeConditionRef,
  context: RuntimeConditionEvalContext,
): unknown {
  switch (ref.source) {
    case "context":
      return readRuntimeConditionContextValue(context, ref.key);
    case "activeToolId":
      return context.activeToolId ?? undefined;
    case "workflowSession":
      switch (ref.field) {
        case "active":
          return context.isSessionActive?.(ref.sessionId) ?? false;
        case "focused":
          return context.isSessionFocused?.(ref.sessionId) ?? false;
        case "scopeActive":
          return context.isSessionScopeActive?.(ref.scope) ?? false;
        case "anyActive":
          return context.hasAnyActiveSession?.(ref.scope) ?? false;
        default:
          return undefined;
      }
    case "renderLayer": {
      const layer = readRuntimeConditionLayerState(context, ref.layerId);
      if (ref.field === "exists") return layer?.exists ?? false;
      if (ref.field === "objectCount") return layer?.objectCount;
      return layer?.visibleObjectCount;
    }
    default:
      return undefined;
  }
}

function compareRuntimeConditionValue(
  actual: unknown,
  cmp: RuntimeConditionComparator,
  expected: number,
): boolean {
  if (typeof actual !== "number" || !Number.isFinite(actual)) return false;
  switch (cmp) {
    case ">":
      return actual > expected;
    case ">=":
      return actual >= expected;
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case "<":
      return actual < expected;
    case "<=":
      return actual <= expected;
    default:
      return false;
  }
}

export function evaluateRuntimeCondition(
  expr: RuntimeConditionExpr | undefined,
  context: RuntimeConditionEvalContext,
): boolean {
  if (!expr) return true;

  switch (expr.op) {
    case "const":
      return Boolean(expr.value);
    case "truthy":
      return Boolean(readRuntimeConditionRefValue(expr.ref, context));
    case "equals":
      return Object.is(
        readRuntimeConditionRefValue(expr.ref, context),
        expr.value,
      );
    case "in":
      return expr.values.some((value) =>
        Object.is(readRuntimeConditionRefValue(expr.ref, context), value),
      );
    case "compare":
      return compareRuntimeConditionValue(
        readRuntimeConditionRefValue(expr.ref, context),
        expr.cmp,
        expr.value,
      );
    case "not":
      return !evaluateRuntimeCondition(expr.expr, context);
    case "all":
      return expr.exprs.every((item) =>
        evaluateRuntimeCondition(item, context),
      );
    case "any":
      return expr.exprs.some((item) => evaluateRuntimeCondition(item, context));
    default:
      return true;
  }
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasViewportLayout {
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface CanvasObjectLike {
  [key: string]: any;
}

export interface CanvasSelectionEvent {
  readonly kind: "created" | "updated" | "cleared";
  readonly target?: CanvasObjectLike;
}

export interface CanvasObjectChangeEvent {
  readonly kind: "added" | "modified" | "removed";
  readonly target?: CanvasObjectLike;
}

export interface CanvasPointerEvent {
  readonly kind: "down" | "double-click";
  readonly target?: CanvasObjectLike;
}

export interface CanvasTransformEvent {
  readonly kind: "move" | "resize" | "rotate" | "commit";
  readonly target?: CanvasObjectLike;
}

export interface CanvasServiceEventMap {
  resized: CanvasSize;
  selection: CanvasSelectionEvent;
  objectChange: CanvasObjectChangeEvent;
  pointer: CanvasPointerEvent;
  transform: CanvasTransformEvent;
}

export interface CanvasObjectSelector {
  ids?: readonly string[];
  layerIds?: readonly string[];
  subjectIds?: readonly string[];
  renderIntentIds?: readonly string[];
  types?: readonly string[];
  tags?: readonly string[];
  visible?: boolean;
  data?: Record<string, unknown>;
}

export interface CanvasService extends Service {
  on<TKey extends keyof CanvasServiceEventMap>(
    type: TKey,
    listener: (event: CanvasServiceEventMap[TKey]) => void,
  ): { dispose(): void };
  requestRenderAll(): void;
  resize(width: number, height: number): void;
  getViewportSize(): CanvasSize;
  setViewportLayout(layout: CanvasViewportLayout): void;
  selectObjects(selector?: CanvasObjectSelector): CanvasObjectLike[];
  selectOneObject(selector: CanvasObjectSelector): CanvasObjectLike | undefined;
  getActiveObject(): CanvasObjectLike | undefined;
  setActiveObject(object: CanvasObjectLike): boolean;
  discardActiveObject(): boolean;
  /** @internal Legacy backend event adapter. */
  onCanvasEvent(event: string, handler: (...args: any[]) => void): void;
  /** @internal Legacy backend event adapter. */
  offCanvasEvent(event: string, handler: (...args: any[]) => void): void;
  getTopContext(): CanvasRenderingContext2D | undefined;
  clearTopContext(): void;
  getSceneScale(): number;
  toScreenPoint(point: CoordinatePoint<"scene">): CoordinatePoint<"screen">;
  toScenePoint(point: CoordinatePoint<"screen">): CoordinatePoint<"scene">;
  toScreenMatrix<TFrom extends CoordinateSpace>(
    matrix: Matrix2D<TFrom, "scene">,
  ): Matrix2D<TFrom, "screen">;
  toSceneMatrix<TFrom extends CoordinateSpace>(
    matrix: Matrix2D<TFrom, "screen">,
  ): Matrix2D<TFrom, "scene">;
  toScreenLength(value: number): number;
  toSceneLength(value: number): number;
  toScreenRect(rect: CoordinateRect<"scene">): CoordinateRect<"screen">;
  toSceneRect(rect: CoordinateRect<"screen">): CoordinateRect<"scene">;
  getSceneViewportRect(): CoordinateRect<"scene">;
  getScreenViewportRect(): CoordinateRect<"screen">;
  loadImageSize(src: string): Promise<CanvasSize | null>;
}

export type SceneExportFormat = "png" | "jpeg";
export type SceneExportFrame = "cut" | "trim" | "bleed";

export type SceneExportCrop =
  | { type: "sceneRect"; rect: CoordinateRect<"scene"> }
  | { type: "elementBounds"; elementIds?: readonly string[] }
  | { type: "frame"; frame: SceneExportFrame };

export type SceneExportOutputMaskMode = "alpha" | "outline" | "shape";

export interface SceneExportOutputMaskTransparentColor {
  red: number;
  green: number;
  blue: number;
  tolerance?: number;
}

export interface SceneExportOutputMask {
  sourceKey: string;
  mode?: SceneExportOutputMaskMode;
  transparentColor?: SceneExportOutputMaskTransparentColor;
}

export interface SceneExportSourceSelector {
  layerIds?: readonly string[];
  elementIds?: readonly string[];
  tags?: readonly string[];
  visible?: boolean;
}

export interface SceneExportSourceResult {
  layerIds: string[];
  elementIds: string[];
  tags: string[];
}

export interface SceneExportOptions {
  format?: SceneExportFormat;
  multiplier?: number;
  source?: SceneExportSourceSelector;
  crop?: SceneExportCrop;
  includeHidden?: boolean;
  preserveClipPaths?: boolean;
  outputMask?: SceneExportOutputMask;
}

export interface SceneExportResult {
  url: string;
  width: number;
  height: number;
  format: SceneExportFormat;
  multiplier: number;
  source: SceneExportSourceResult;
  crop: CoordinateRect<"scene">;
}

export interface SceneExportService extends Service {
  exportImage(options?: SceneExportOptions): Promise<SceneExportResult>;
}

export type SizeConstraintMode = "free" | "lockAspect" | "equal";
export type CutMode = "trim" | "outset" | "inset";

export interface SceneFrameMm {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface SurfaceSceneFrames {
  previewBounds: SceneFrameMm;
  productionFrame: SceneFrameMm;
  exportFrame?: SceneFrameMm;
  viewportFocusFrame?: SceneFrameMm;
}

export interface SizeState {
  unit: Unit;
  sceneFrames: SurfaceSceneFrames;
  constraintMode: SizeConstraintMode;
  aspectRatio: number;
  minMm: number;
  maxMm: number;
  stepMm: number;
}

export interface SceneRect {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface SceneLayoutSnapshot {
  surfaceId: string;
  revision: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  trimRect: SceneRect;
  cutRect: SceneRect;
  bleedRect: SceneRect;
}

export interface SceneGeometrySnapshot {
  shape: DielineShape;
  shapeStyle: DielineShapeStyle;
  unit: "px";
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  offset: number;
  scale: number;
  pathData?: string;
  customSourceWidthPx?: number;
  customSourceHeightPx?: number;
}

export interface SceneLayoutService extends Service {
  getLayout(surfaceId?: string): SceneLayoutSnapshot | null;
  recomputeLayout(surfaceId?: string): SceneLayoutSnapshot | null;
  invalidateLayout(surfaceId?: string): void;
  onLayoutChange(
    surfaceId: string,
    listener: (layout: SceneLayoutSnapshot | null) => void,
  ): Disposable;
}
