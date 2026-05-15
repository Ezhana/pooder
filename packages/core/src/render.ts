import type { Service } from "./service";
import type { Unit } from "./coordinate";
import type { DielineShape, DielineShapeStyle } from "./dieline-shape";

export type RenderObjectType = "rect" | "image" | "path" | "text";

export type RenderProps = Record<string, any>;
export type RenderCoordinateSpace = "scene" | "screen";
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
  space?: RenderCoordinateSpace;
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
  props: RenderProps;
  data?: Record<string, any>;
  src?: string;
  space?: RenderCoordinateSpace;
  exportKeys?: readonly string[];
  layout?: RenderObjectLayoutSpec;
  visibility?: VisibilityExpr;
}

export interface RenderPatternSpec {
  type: "pattern";
  kind: "diagonalHatch";
  color: string;
  size?: number;
  repetition?: "repeat";
}

export type LayerObjectCountComparator = ">" | ">=" | "==" | "<" | "<=";

export type VisibilityExpr =
  | { op: "const"; value: boolean }
  | { op: "contextTruthy"; key: string }
  | { op: "contextEquals"; key: string; value: unknown }
  | { op: "workflowSessionActive"; workflowId: string }
  | { op: "anyWorkflowSessionActive" }
  | { op: "activeToolIn"; ids: string[] }
  | { op: "sessionActive"; toolId: string }
  | { op: "anySessionActive" }
  | { op: "layerExists"; layerId: string }
  | {
      op: "layerObjectCount";
      layerId: string;
      cmp: LayerObjectCountComparator;
      value: number;
    }
  | { op: "not"; expr: VisibilityExpr }
  | { op: "all"; exprs: VisibilityExpr[] }
  | { op: "any"; exprs: VisibilityExpr[] };

export interface RenderClipPathEffectSpec {
  type: "clipPath";
  id?: string;
  visibility?: VisibilityExpr;
  source: RenderObjectSpec;
  targetLayerIds?: string[];
  targetSubjectIds?: string[];
}

export type RenderEffectSpec = RenderClipPathEffectSpec;

export interface VisibilityLayerState {
  exists: boolean;
  objectCount: number;
  visibleObjectCount?: number;
}

export interface VisibilityEvalContext {
  activeToolId?: string | null;
  contextValues?: Map<string, unknown> | Record<string, unknown>;
  isSessionActive?: (toolId: string) => boolean;
  hasAnyActiveSession?: () => boolean;
  isWorkflowSessionActive?: (workflowId: string) => boolean;
  hasAnyActiveWorkflowSession?: () => boolean;
  layers?: Map<string, VisibilityLayerState>;
  getLayerState?: (layerId: string) => VisibilityLayerState | undefined;
  getContextValue?: (key: string) => unknown;
}

function readVisibilityContextValue(
  context: VisibilityEvalContext,
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

function readVisibilityLayerState(
  context: VisibilityEvalContext,
  layerId: string,
): VisibilityLayerState | undefined {
  if (context.getLayerState) {
    return context.getLayerState(layerId);
  }
  return context.layers?.get(layerId);
}

export function evaluateVisibilityExpr(
  expr: VisibilityExpr | undefined,
  context: VisibilityEvalContext,
): boolean {
  if (!expr) return true;

  switch (expr.op) {
    case "const":
      return Boolean(expr.value);
    case "contextTruthy":
      return Boolean(readVisibilityContextValue(context, expr.key));
    case "contextEquals":
      return Object.is(readVisibilityContextValue(context, expr.key), expr.value);
    case "activeToolIn":
      return Boolean(
        context.activeToolId && expr.ids.includes(context.activeToolId),
      );
    case "sessionActive":
      return Boolean(context.isSessionActive?.(expr.toolId));
    case "anySessionActive":
      return Boolean(context.hasAnyActiveSession?.());
    case "workflowSessionActive":
      return Boolean(context.isWorkflowSessionActive?.(expr.workflowId));
    case "anyWorkflowSessionActive":
      return Boolean(context.hasAnyActiveWorkflowSession?.());
    case "layerExists":
      return Boolean(readVisibilityLayerState(context, expr.layerId)?.exists);
    case "layerObjectCount": {
      const count =
        readVisibilityLayerState(context, expr.layerId)?.objectCount ?? 0;
      switch (expr.cmp) {
        case ">":
          return count > expr.value;
        case ">=":
          return count >= expr.value;
        case "==":
          return count === expr.value;
        case "<":
          return count < expr.value;
        case "<=":
          return count <= expr.value;
        default:
          return false;
      }
    }
    case "not":
      return !evaluateVisibilityExpr(expr.expr, context);
    case "all":
      return expr.exprs.every((item) => evaluateVisibilityExpr(item, context));
    case "any":
      return expr.exprs.some((item) => evaluateVisibilityExpr(item, context));
    default:
      return true;
  }
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
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

export interface CanvasObjectQuery {
  layerId?: string;
  id?: string;
  type?: string;
  includeHidden?: boolean;
  predicate?: (object: CanvasObjectLike) => boolean;
}

export interface CanvasService extends Service {
  requestRenderAll(): void;
  resize(width: number, height: number): void;
  getViewportSize(): CanvasSize;
  updateViewportLayout(options: {
    containerWidth: number;
    containerHeight: number;
    padding: number;
    widthMm: number;
    heightMm: number;
    offsetX?: number;
    offsetY?: number;
  }): CanvasViewportLayout | null;
  getObjects(query?: CanvasObjectQuery): CanvasObjectLike[];
  getObject(id: string, layerId?: string): CanvasObjectLike | undefined;
  getActiveObject(): CanvasObjectLike | undefined;
  setActiveObject(object: CanvasObjectLike): boolean;
  discardActiveObject(): boolean;
  setViewportMirror(enabled: boolean): void;
  onCanvasEvent(event: string, handler: (...args: any[]) => void): void;
  offCanvasEvent(event: string, handler: (...args: any[]) => void): void;
  getTopContext(): CanvasRenderingContext2D | undefined;
  clearTopContext(): void;
  getSceneScale(): number;
  getSceneOffset(): CanvasPoint;
  toScreenPoint(point: CanvasPoint): CanvasPoint;
  toScenePoint(point: CanvasPoint): CanvasPoint;
  toScreenLength(value: number): number;
  toSceneLength(value: number): number;
  toScreenRect(rect: CanvasRect): CanvasRect;
  toSceneRect(rect: CanvasRect): CanvasRect;
  getSceneViewportRect(): CanvasRect;
  getScreenViewportRect(): CanvasRect;
  loadImageSize(src: string): Promise<CanvasSize | null>;
}

export type SceneExportFormat = "png" | "jpeg";
export type SceneExportFrame = "cut" | "trim" | "bleed";

export type SceneExportCrop =
  | { type: "sceneRect"; rect: CanvasRect }
  | { type: "elementBounds"; elementIds?: readonly string[] }
  | { type: "frame"; frame: SceneExportFrame };

export interface SceneExportOptions {
  format?: SceneExportFormat;
  multiplier?: number;
  sourceLayerIds?: readonly string[];
  sourceElementIds?: readonly string[];
  crop?: SceneExportCrop;
  includeHidden?: boolean;
}

export interface SceneExportResult {
  url: string;
  width: number;
  height: number;
  format: SceneExportFormat;
  multiplier: number;
  sourceLayerIds: string[];
  sourceElementIds: string[];
  crop: CanvasRect;
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
  surfaceWidthMm: number;
  surfaceHeightMm: number;
  sceneFrames: SurfaceSceneFrames;
  constraintMode: SizeConstraintMode;
  aspectRatio: number;
  cutMode: CutMode;
  cutMarginMm: number;
  viewPadding: number | string;
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
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
  trimRect: SceneRect;
  cutRect: SceneRect;
  bleedRect: SceneRect;
  trimWidthMm: number;
  trimHeightMm: number;
  cutWidthMm: number;
  cutHeightMm: number;
  cutMode: CutMode;
  cutMarginMm: number;
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
  getLayout(forceRefresh?: boolean): SceneLayoutSnapshot | null;
  getGeometry(forceRefresh?: boolean): SceneGeometrySnapshot | null;
}
