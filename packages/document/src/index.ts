export interface DocumentConstraintSpec {
  type: string;
  source?: DocumentGeometryRef;
  mode?: string;
  params?: Record<string, unknown>;
}

export interface DocumentGeometryRef {
  sourceId: string;
  geometryId: string;
  variant?: string;
}

export type DocumentRuntimeConditionRef =
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
      scope: DocumentSessionScope;
    }
  | {
      source: "workflowSession";
      field: "anyActive";
      scope?: DocumentSessionScope;
    }
  | {
      source: "renderLayer";
      layerId: string;
      field: "exists" | "objectCount" | "visibleObjectCount";
    };

export type DocumentRuntimeConditionExpr =
  | { op: "const"; value: boolean }
  | { op: "truthy"; ref: DocumentRuntimeConditionRef }
  | { op: "equals"; ref: DocumentRuntimeConditionRef; value: unknown }
  | {
      op: "in";
      ref: DocumentRuntimeConditionRef;
      values: readonly unknown[];
    }
  | {
      op: "compare";
      ref: DocumentRuntimeConditionRef;
      cmp: ">" | ">=" | "==" | "!=" | "<" | "<=";
      value: number;
    }
  | { op: "not"; expr: DocumentRuntimeConditionExpr }
  | { op: "all"; exprs: readonly DocumentRuntimeConditionExpr[] }
  | { op: "any"; exprs: readonly DocumentRuntimeConditionExpr[] };

export interface DocumentSessionScope {
  surfaceId?: string | null;
  subjectId?: string | null;
  channel?: string | null;
  groupId?: string | null;
}

export interface DocumentInteractionSessionIntent {
  channel: string;
  groupId: string;
  sessionId?: string;
  mode: "exclusive" | "cooperative" | "passive";
  scope: "subject" | "surface" | "editor";
  leavePolicy?: "block" | "commit" | "rollback";
}

export interface DocumentInteractionConstraintSpec {
  activeWhen?: DocumentRuntimeConditionExpr;
  spec: DocumentConstraintSpec;
}

export interface DocumentInteractionOperationSpec {
  enabled: boolean;
  constraints?: DocumentInteractionConstraintSpec[];
  action?: {
    commandId: string;
    payload?: Record<string, unknown>;
  };
}

export interface DocumentInteractionSpec {
  hitRegion?: { type: "frame" };
  enabledWhen?: DocumentRuntimeConditionExpr;
  selection?: { enabled: boolean };
  activation?: {
    enabled?: boolean;
    trigger?: "primary-pointer" | "double-click";
    action: {
      commandId: string;
      payload?: Record<string, unknown>;
    };
    session?: DocumentInteractionSessionIntent;
  };
  manipulation?: {
    move?: DocumentInteractionOperationSpec;
    resize?: DocumentInteractionOperationSpec;
    rotate?: DocumentInteractionOperationSpec;
  };
}

/** @deprecated Use DocumentConstraintSpec. */
export type ConstraintSpec = DocumentConstraintSpec;
/** @deprecated Use DocumentInteractionConstraintSpec. */
export type InteractionConstraintSpec = DocumentInteractionConstraintSpec;
/** @deprecated Use DocumentInteractionOperationSpec. */
export type InteractionOperationSpec = DocumentInteractionOperationSpec;
/** @deprecated Use DocumentInteractionSessionIntent. */
export type InteractionSessionIntent = DocumentInteractionSessionIntent;
/** @deprecated Use DocumentInteractionSpec. */
export type InteractionSpec = DocumentInteractionSpec;
/** @deprecated Use DocumentRuntimeConditionExpr. */
export type RuntimeConditionExpr = DocumentRuntimeConditionExpr;

export const EDITOR_DOCUMENT_VERSION = 7 as const;

export type EditorDocumentVersion = typeof EDITOR_DOCUMENT_VERSION;
export type EditorDocumentUnit = "px" | "mm" | "cm" | "in";
export type EditorDocumentRequirePolicy = "strict" | "warn" | "ignore";
export type EditorDocumentDiagnosticSeverity = "error" | "warning";
export type EditorEffectPhase =
  | "document"
  | "layout"
  | "render"
  | "interaction"
  | "export";
export type EditorEffectTarget =
  | "self"
  | { objectId: string }
  | { layerId: string }
  | { surfaceId: string };
export type EditorLayerRole =
  | "background"
  | "content"
  | "guide"
  | "overlay"
  | "production"
  | string;
export interface EditorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorSize {
  width: number;
  height: number;
}

export interface EditorTransform {
  left?: number;
  top?: number;
  scaleX?: number;
  scaleY?: number;
  angle?: number;
  originX?: "left" | "center" | "right";
  originY?: "top" | "center" | "bottom";
}

export interface EditorDocument {
  version: EditorDocumentVersion;
  config: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  surfaces: EditorSurface[];
  views?: EditorView[];
}

export interface EditorSurface {
  id: string;
  title?: string;
  size: {
    width: number;
    height: number;
    unit: EditorDocumentUnit;
  };
  frame?: {
    trim?: EditorRect;
    bleed?: EditorRect;
    safe?: EditorRect;
  };
  frames: EditorSurfaceFrames;
  layers: EditorLayer[];
  effects?: EditorEffect[];
  metadata?: Record<string, unknown>;
}

export interface EditorSceneFrameMm {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface EditorSurfaceFrames {
  previewBounds: EditorSceneFrameMm;
  productionFrame: EditorSceneFrameMm;
  exportFrame?: EditorSceneFrameMm;
  viewportFocusFrame: EditorSceneFrameMm;
}

export interface EditorView {
  id: string;
  title?: string;
  surfaceIds: string[];
  metadata?: Record<string, unknown>;
}

export interface EditorLayer {
  id: string;
  role?: EditorLayerRole;
  order?: number;
  visible?: boolean;
  locked?: boolean;
  tags?: string[];
  objects?: EditorObject[];
  effects?: EditorEffect[];
  metadata?: Record<string, unknown>;
}

export interface EditorObjectBase {
  id: string;
  frame?: EditorRect;
  order?: number;
  visible?: boolean;
  locked?: boolean;
  tags?: string[];
  transform?: EditorTransform;
  style?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  interaction?: DocumentInteractionSpec;
  effects?: EditorObjectEffect[];
}

export type EditorImageResource =
  | {
      kind: "url";
      url: string;
      mimeType?: string;
      intrinsicSize?: EditorSize;
    }
  | {
      kind: "data-url";
      dataUrl: string;
      mimeType?: string;
      intrinsicSize?: EditorSize;
    }
  | {
      kind: "blob-url";
      url: string;
      transient: true;
      intrinsicSize?: EditorSize;
    };

export interface EditorImagePlacement {
  fit: "cover" | "contain" | "stretch";
  anchorX: number;
  anchorY: number;
  zoom: number;
  rotation: number;
  opacity: number;
  clip: "frame" | "none";
}

export interface EditorImageSlotSpec {
  accepts?: string[];
  emptyPresentation?: {
    resource: EditorImageResource;
    fit: EditorImagePlacement["fit"];
  };
  sessionProjections?: Array<{
    placement: "underlay" | "overlay" | "controls";
    source: {
      objectIds?: string[];
      tags?: string[];
    };
    surfaceScope?: "same-surface" | "all";
  }>;
}

export type ObjectSource =
  | {
      kind: "image";
      resource?: EditorImageResource;
    }
  | {
      kind: "path";
      pathData: string;
      sourceBounds?: EditorRect;
      sourceSize?: EditorSize;
    }
  | {
      kind: "shape";
      shape: "rect" | "circle" | "ellipse" | "heart";
      params: Record<string, unknown>;
    }
  | {
      kind: "text";
      text: string;
    };

export interface EditorImageObject extends EditorObjectBase {
  frame: EditorRect;
  source: { kind: "image"; resource?: EditorImageResource };
  placement: EditorImagePlacement;
  slot?: EditorImageSlotSpec;
}

export interface EditorPrimitiveObject extends EditorObjectBase {
  source: Exclude<ObjectSource, { kind: "image" }>;
}

export type EditorObject = EditorImageObject | EditorPrimitiveObject;

export interface EditorEffect<TPayload = Record<string, unknown>> {
  id?: string;
  type: string;
  capabilityId?: string;
  require?: EditorDocumentRequirePolicy;
  order?: number;
  phase?: EditorEffectPhase;
  target?: EditorEffectTarget;
  payload?: TPayload;
  metadata?: Record<string, unknown>;
}

type EditorObjectEffectCommon = Partial<Omit<EditorEffect, "type">>;

export type EditorBuiltinObjectEffect =
  | (EditorObjectEffectCommon & {
      type: "clip-source";
      targetIds: string[];
    })
  | (EditorObjectEffectCommon & {
      type: "boolean";
      targetId: string;
      operation: "add" | "subtract" | "intersect" | "exclude";
      participation?: "preview" | "export" | "both";
    })
  | (EditorObjectEffectCommon & {
      type: "guide";
      role: "cut" | "bleed" | "safe-area";
      style?: Record<string, unknown>;
    });

export type EditorObjectEffect = EditorEffect | EditorBuiltinObjectEffect;

export interface EditorDocumentDiagnostic {
  severity: EditorDocumentDiagnosticSeverity;
  code: string;
  message: string;
  path: string;
  capabilityId?: string;
  effectType?: string;
}

export interface EditorDocumentValidationOptions {
  validators?: readonly EditorDocumentValidator[];
}

export interface EditorDocumentCapabilityCollectionOptions {
  resolveEffectCapabilityId?: EditorDocumentEffectCapabilityResolver;
  availableCapabilityIds?: Iterable<string>;
  includeIgnored?: boolean;
}

export type EditorDocumentEffectCapabilityResolver = (
  effect: EditorEffect,
) => string | undefined;

export type EditorDocumentValidatorDiagnostic = Omit<
  EditorDocumentDiagnostic,
  "path"
> & { path?: string };

export interface EditorDocumentValidatorContext {
  document: EditorDocument;
  path: string;
  surface?: EditorSurface;
  layer?: EditorLayer;
  object?: EditorObject;
  effect?: EditorObjectEffect;
  addDiagnostic(diagnostic: EditorDocumentValidatorDiagnostic): void;
}

export type EditorDocumentValidator = (
  context: EditorDocumentValidatorContext,
) => void;

export interface EditorDocumentCapabilityRequirement {
  capabilityId: string;
  effectType: string;
  require: EditorDocumentRequirePolicy;
  path: string;
  effectId?: string;
}

export interface EditorDocumentCapabilityCollectionResult {
  requirements: EditorDocumentCapabilityRequirement[];
  diagnostics: EditorDocumentDiagnostic[];
}

export interface EditorDocumentObjectVisitContext {
  document: EditorDocument;
  surface: EditorSurface;
  surfaceIndex: number;
  layer: EditorLayer;
  layerIndex: number;
  object: EditorObject;
  objectIndex: number;
  path: string;
}

export type EditorDocumentObjectVisitor = (
  context: EditorDocumentObjectVisitContext,
) => void;

const VALID_UNITS = new Set(["px", "mm", "cm", "in"]);
const VALID_REQUIRE_POLICIES = new Set(["strict", "warn", "ignore"]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneRecord<T extends Record<string, unknown> | undefined>(
  value: T,
): T {
  if (!value) return value;
  const normalized = normalizeSerializableValue(value);
  return (isRecord(normalized) ? normalized : {}) as T;
}

function normalizeSerializableValue(
  value: unknown,
  ancestors = new Set<unknown>(),
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value === undefined || typeof value !== "object") return undefined;
  if (ancestors.has(value)) return undefined;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map(
        (item) => normalizeSerializableValue(item, ancestors) ?? null,
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        const normalized = normalizeSerializableValue(item, ancestors);
        return normalized === undefined ? [] : [[key, normalized]];
      }),
    );
  } finally {
    ancestors.delete(value);
  }
}

function cloneSerializableValue(
  value: unknown,
  ancestors = new Set<unknown>(),
): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new TypeError("EditorDocument contains a non-finite number.");
  }
  if (typeof value !== "object") {
    throw new TypeError("EditorDocument contains a non-serializable value.");
  }
  if (ancestors.has(value)) {
    throw new TypeError("EditorDocument contains a circular reference.");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => cloneSerializableValue(item, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("EditorDocument contains a non-plain object.");
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        cloneSerializableValue(item, ancestors),
      ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = Array.from(
    new Set(
      value.map((item) => normalizeId(item)).filter((item) => item.length > 0),
    ),
  );
  return values.length ? values : undefined;
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizePositiveNumber(value: unknown): number | undefined {
  const parsed = normalizeFiniteNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function normalizeRect(value: unknown): EditorRect | undefined {
  if (!isRecord(value)) return undefined;
  const x = normalizeFiniteNumber(value.x);
  const y = normalizeFiniteNumber(value.y);
  const width = normalizePositiveNumber(value.width);
  const height = normalizePositiveNumber(value.height);
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return undefined;
  }
  return { x, y, width, height };
}

function normalizeSize(value: unknown): EditorSize | undefined {
  if (!isRecord(value)) return undefined;
  const width = normalizePositiveNumber(value.width);
  const height = normalizePositiveNumber(value.height);
  return width !== undefined && height !== undefined
    ? { width, height }
    : undefined;
}

function normalizeImageResource(
  value: unknown,
): EditorImageResource | undefined {
  if (!isRecord(value)) return undefined;
  const intrinsicSize = normalizeSize(value.intrinsicSize);
  const mimeType = normalizeId(value.mimeType);
  if (value.kind === "url") {
    const url = normalizeId(value.url);
    return url
      ? {
          kind: "url",
          url,
          ...(mimeType ? { mimeType } : {}),
          ...(intrinsicSize ? { intrinsicSize } : {}),
        }
      : undefined;
  }
  if (value.kind === "data-url") {
    const dataUrl = normalizeId(value.dataUrl);
    return dataUrl
      ? {
          kind: "data-url",
          dataUrl,
          ...(mimeType ? { mimeType } : {}),
          ...(intrinsicSize ? { intrinsicSize } : {}),
        }
      : undefined;
  }
  if (value.kind === "blob-url") {
    const url = normalizeId(value.url);
    return url
      ? {
          kind: "blob-url",
          url,
          transient: true,
          ...(intrinsicSize ? { intrinsicSize } : {}),
        }
      : undefined;
  }
  return undefined;
}

function normalizeObjectSource(value: unknown): ObjectSource | null {
  if (!isRecord(value)) return null;
  if (value.kind === "image") {
    const resource = normalizeImageResource(value.resource);
    return { kind: "image", ...(resource ? { resource } : {}) };
  }
  switch (value.kind) {
    case "path": {
      const pathData =
        typeof value.pathData === "string" ? value.pathData.trim() : "";
      if (!pathData) return null;
      const sourceBounds = normalizeRect(value.sourceBounds);
      const sourceSize = normalizeSize(value.sourceSize);
      return {
        kind: "path",
        pathData,
        ...(sourceBounds ? { sourceBounds } : {}),
        ...(sourceSize ? { sourceSize } : {}),
      };
    }
    case "shape": {
      if (
        value.shape !== "rect" &&
        value.shape !== "circle" &&
        value.shape !== "ellipse" &&
        value.shape !== "heart"
      ) {
        return null;
      }
      return {
        kind: "shape",
        shape: value.shape,
        params: isRecord(value.params) ? cloneRecord(value.params) : {},
      };
    }
    case "text": {
      return {
        kind: "text",
        text: typeof value.text === "string" ? value.text : "",
      };
    }
    default:
      return null;
  }
}

function normalizeImagePlacement(value: unknown): EditorImagePlacement {
  const placement = isRecord(value) ? value : {};
  return {
    fit:
      placement.fit === "contain" || placement.fit === "stretch"
        ? placement.fit
        : "cover",
    anchorX: normalizeFiniteNumber(placement.anchorX) ?? 0.5,
    anchorY: normalizeFiniteNumber(placement.anchorY) ?? 0.5,
    zoom: normalizePositiveNumber(placement.zoom) ?? 1,
    rotation: normalizeFiniteNumber(placement.rotation) ?? 0,
    opacity: normalizeFiniteNumber(placement.opacity) ?? 1,
    clip: placement.clip === "none" ? "none" : "frame",
  };
}

function normalizeImageSlot(value: unknown): EditorImageSlotSpec | undefined {
  if (!isRecord(value)) return undefined;
  const accepts = normalizeIdList(value.accepts);
  const empty = isRecord(value.emptyPresentation)
    ? value.emptyPresentation
    : undefined;
  const emptyResource = normalizeImageResource(empty?.resource);
  const sessionProjections = Array.isArray(value.sessionProjections)
    ? value.sessionProjections.flatMap((item) => {
        if (!isRecord(item) || !isRecord(item.source)) return [];
        if (
          item.placement !== "underlay" &&
          item.placement !== "overlay" &&
          item.placement !== "controls"
        )
          return [];
        const objectIds = normalizeIdList(item.source.objectIds);
        const tags = normalizeIdList(item.source.tags);
        if (!objectIds && !tags) return [];
        return [
          {
            placement: item.placement as "underlay" | "overlay" | "controls",
            source: {
              ...(objectIds ? { objectIds } : {}),
              ...(tags ? { tags } : {}),
            },
            surfaceScope:
              item.surfaceScope === "all"
                ? ("all" as const)
                : ("same-surface" as const),
          },
        ];
      })
    : undefined;
  return {
    ...(accepts ? { accepts } : {}),
    ...(emptyResource
      ? {
          emptyPresentation: {
            resource: emptyResource,
            fit:
              empty?.fit === "contain" || empty?.fit === "stretch"
                ? empty.fit
                : "cover",
          },
        }
      : {}),
    ...(sessionProjections?.length ? { sessionProjections } : {}),
  };
}

function normalizeSceneFrameMm(
  value: unknown,
): { xMm: number; yMm: number; widthMm: number; heightMm: number } | undefined {
  if (!isRecord(value)) return undefined;
  const xMm = normalizeFiniteNumber(value.xMm);
  const yMm = normalizeFiniteNumber(value.yMm);
  const widthMm = normalizePositiveNumber(value.widthMm);
  const heightMm = normalizePositiveNumber(value.heightMm);
  if (
    xMm === undefined ||
    yMm === undefined ||
    widthMm === undefined ||
    heightMm === undefined
  ) {
    return undefined;
  }
  return { xMm, yMm, widthMm, heightMm };
}

function createDefaultSurfaceFrames(size: {
  width: number;
  height: number;
}): EditorSurfaceFrames {
  const previewBounds = {
    xMm: 0,
    yMm: 0,
    widthMm: size.width,
    heightMm: size.height,
  };
  return {
    previewBounds,
    productionFrame: { ...previewBounds },
    viewportFocusFrame: { ...previewBounds },
  };
}

function normalizeSurfaceFrames(
  value: unknown,
  fallback: EditorSurfaceFrames,
): EditorSurfaceFrames {
  const raw = isRecord(value) ? value : {};
  const previewBounds =
    normalizeSceneFrameMm(raw.previewBounds) ?? fallback.previewBounds;
  const productionFrame =
    normalizeSceneFrameMm(raw.productionFrame) ?? previewBounds;
  const viewportFocusFrame =
    normalizeSceneFrameMm(raw.viewportFocusFrame) ?? productionFrame;
  const exportFrame = normalizeSceneFrameMm(raw.exportFrame);
  return {
    previewBounds,
    productionFrame,
    ...(exportFrame ? { exportFrame } : {}),
    viewportFocusFrame,
  };
}

function normalizeTransform(value: unknown): EditorTransform | undefined {
  if (!isRecord(value)) return undefined;
  const transform: EditorTransform = {};
  const numericKeys = ["left", "top", "scaleX", "scaleY", "angle"] as const;
  numericKeys.forEach((key) => {
    const parsed = normalizeFiniteNumber(value[key]);
    if (parsed !== undefined) transform[key] = parsed;
  });
  if (
    value.originX === "left" ||
    value.originX === "center" ||
    value.originX === "right"
  ) {
    transform.originX = value.originX;
  }
  if (
    value.originY === "top" ||
    value.originY === "center" ||
    value.originY === "bottom"
  ) {
    transform.originY = value.originY;
  }
  return Object.keys(transform).length ? transform : undefined;
}

function normalizeRuntimeCondition(
  value: unknown,
): RuntimeConditionExpr | undefined {
  if (!isRecord(value)) return undefined;
  if (value.op === "const" && typeof value.value === "boolean") {
    return { op: "const", value: value.value };
  }
  if (value.op === "not") {
    const expr = normalizeRuntimeCondition(value.expr);
    return expr ? { op: "not", expr } : undefined;
  }
  if (value.op === "all" || value.op === "any") {
    if (!Array.isArray(value.exprs)) return undefined;
    const exprs = value.exprs.map(normalizeRuntimeCondition);
    if (exprs.some((expr) => !expr)) return undefined;
    return { op: value.op, exprs: exprs as RuntimeConditionExpr[] };
  }

  const ref = normalizeRuntimeConditionRef(value.ref);
  if (!ref) return undefined;
  if (value.op === "truthy") return { op: "truthy", ref };
  if (value.op === "equals") {
    const normalized = normalizeSerializableValue(value.value);
    return normalized === undefined
      ? undefined
      : { op: "equals", ref, value: normalized };
  }
  if (value.op === "in" && Array.isArray(value.values)) {
    return {
      op: "in",
      ref,
      values: value.values.map(
        (item) => normalizeSerializableValue(item) ?? null,
      ),
    };
  }
  if (
    value.op === "compare" &&
    (value.cmp === ">" ||
      value.cmp === ">=" ||
      value.cmp === "==" ||
      value.cmp === "!=" ||
      value.cmp === "<" ||
      value.cmp === "<=")
  ) {
    const normalized = normalizeFiniteNumber(value.value);
    return normalized === undefined
      ? undefined
      : { op: "compare", ref, cmp: value.cmp, value: normalized };
  }
  return undefined;
}

function normalizeRuntimeConditionRef(
  value: unknown,
): DocumentRuntimeConditionRef | undefined {
  if (!isRecord(value)) return undefined;
  if (value.source === "activeToolId") return { source: "activeToolId" };
  if (value.source === "context") {
    const key = normalizeId(value.key);
    return key ? { source: "context", key } : undefined;
  }
  if (value.source === "renderLayer") {
    const layerId = normalizeId(value.layerId);
    if (
      !layerId ||
      (value.field !== "exists" &&
        value.field !== "objectCount" &&
        value.field !== "visibleObjectCount")
    ) {
      return undefined;
    }
    return { source: "renderLayer", layerId, field: value.field };
  }
  if (value.source !== "workflowSession") return undefined;
  if (value.field === "active" || value.field === "focused") {
    const sessionId = normalizeId(value.sessionId);
    return sessionId
      ? { source: "workflowSession", field: value.field, sessionId }
      : undefined;
  }
  if (value.field === "scopeActive") {
    const scope = normalizeSessionScope(value.scope);
    return scope
      ? { source: "workflowSession", field: "scopeActive", scope }
      : undefined;
  }
  if (value.field === "anyActive") {
    const scope = normalizeSessionScope(value.scope);
    return {
      source: "workflowSession",
      field: "anyActive",
      ...(scope ? { scope } : {}),
    };
  }
  return undefined;
}

function normalizeSessionScope(
  value: unknown,
): DocumentSessionScope | undefined {
  if (!isRecord(value)) return undefined;
  const scope: DocumentSessionScope = {};
  (["surfaceId", "subjectId", "channel", "groupId"] as const).forEach((key) => {
    if (value[key] === null) scope[key] = null;
    else {
      const normalized = normalizeId(value[key]);
      if (normalized) scope[key] = normalized;
    }
  });
  return Object.keys(scope).length ? scope : undefined;
}

function normalizeGeometryRef(value: unknown): DocumentGeometryRef | undefined {
  if (!isRecord(value)) return undefined;
  const sourceId = normalizeId(value.sourceId);
  const geometryId = normalizeId(value.geometryId);
  const variant = normalizeId(value.variant);
  if (!sourceId || !geometryId) return undefined;
  return {
    sourceId,
    geometryId,
    ...(variant ? { variant } : {}),
  };
}

function normalizeInteractionConstraint(
  value: unknown,
): InteractionConstraintSpec | null {
  if (!isRecord(value)) return null;
  const rawSpec = isRecord(value.spec) ? value.spec : undefined;
  if (!rawSpec) return null;
  const type = normalizeId(rawSpec.type);
  if (!type) return null;
  const source = normalizeGeometryRef(rawSpec.source);
  return {
    ...(normalizeRuntimeCondition(value.activeWhen)
      ? { activeWhen: normalizeRuntimeCondition(value.activeWhen) }
      : {}),
    spec: {
      type,
      ...(source ? { source } : {}),
      ...(typeof rawSpec.mode === "string" ? { mode: rawSpec.mode } : {}),
      ...(isRecord(rawSpec.params)
        ? { params: cloneRecord(rawSpec.params) }
        : {}),
    },
  };
}

function normalizeInteractionConstraints(
  value: unknown,
): InteractionConstraintSpec[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const constraints = value
    .map((item) => normalizeInteractionConstraint(item))
    .filter((item): item is InteractionConstraintSpec => Boolean(item));
  return constraints.length ? constraints : undefined;
}

function normalizeInteractionOperation(
  value: unknown,
): InteractionOperationSpec | undefined {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return undefined;
  const constraints = normalizeInteractionConstraints(value.constraints);
  const rawAction = isRecord(value.action) ? value.action : undefined;
  const commandId = normalizeId(rawAction?.commandId);
  return {
    enabled: value.enabled,
    ...(constraints ? { constraints } : {}),
    ...(commandId
      ? {
          action: {
            commandId,
            ...(isRecord(rawAction?.payload)
              ? { payload: cloneRecord(rawAction.payload) }
              : {}),
          },
        }
      : {}),
  };
}

function normalizeInteractionSession(
  value: unknown,
): InteractionSessionIntent | undefined {
  if (!isRecord(value)) return undefined;
  const channel = normalizeId(value.channel);
  const groupId = normalizeId(value.groupId);
  const sessionId = normalizeId(value.sessionId);
  if (
    !channel ||
    !groupId ||
    (value.mode !== "exclusive" &&
      value.mode !== "cooperative" &&
      value.mode !== "passive") ||
    (value.scope !== "subject" &&
      value.scope !== "surface" &&
      value.scope !== "editor")
  ) {
    return undefined;
  }
  return {
    channel,
    groupId,
    ...(sessionId ? { sessionId } : {}),
    mode: value.mode,
    scope: value.scope,
    ...(value.leavePolicy === "block" ||
    value.leavePolicy === "commit" ||
    value.leavePolicy === "rollback"
      ? { leavePolicy: value.leavePolicy }
      : {}),
  };
}

function normalizeObjectInteraction(
  value: unknown,
): InteractionSpec | undefined {
  if (!isRecord(value)) return undefined;
  const interaction: InteractionSpec = {};
  if (isRecord(value.hitRegion) && value.hitRegion.type === "frame") {
    interaction.hitRegion = { type: "frame" };
  }
  const enabledWhen = normalizeRuntimeCondition(value.enabledWhen);
  if (enabledWhen) interaction.enabledWhen = enabledWhen;

  if (
    isRecord(value.selection) &&
    typeof value.selection.enabled === "boolean"
  ) {
    interaction.selection = { enabled: value.selection.enabled };
  }

  if (isRecord(value.activation) && isRecord(value.activation.action)) {
    const commandId = normalizeId(value.activation.action.commandId);
    if (commandId) {
      const session = normalizeInteractionSession(value.activation.session);
      interaction.activation = {
        ...(typeof value.activation.enabled === "boolean"
          ? { enabled: value.activation.enabled }
          : {}),
        ...(value.activation.trigger === "primary-pointer" ||
        value.activation.trigger === "double-click"
          ? { trigger: value.activation.trigger }
          : {}),
        action: {
          commandId,
          ...(isRecord(value.activation.action.payload)
            ? { payload: cloneRecord(value.activation.action.payload) }
            : {}),
        },
        ...(session ? { session } : {}),
      };
    }
  }

  if (isRecord(value.manipulation)) {
    const move = normalizeInteractionOperation(value.manipulation.move);
    const resize = normalizeInteractionOperation(value.manipulation.resize);
    const rotate = normalizeInteractionOperation(value.manipulation.rotate);
    if (move || resize || rotate) {
      interaction.manipulation = {
        ...(move ? { move } : {}),
        ...(resize ? { resize } : {}),
        ...(rotate ? { rotate } : {}),
      };
    }
  }

  return Object.keys(interaction).length ? interaction : undefined;
}

function normalizeEffectTarget(value: unknown): EditorEffectTarget | undefined {
  if (value === undefined || value === "self") return "self";
  if (!isRecord(value)) return undefined;
  const objectId = normalizeId(value.objectId);
  if (objectId) return { objectId };
  const layerId = normalizeId(value.layerId);
  if (layerId) return { layerId };
  const surfaceId = normalizeId(value.surfaceId);
  if (surfaceId) return { surfaceId };
  return undefined;
}

function normalizeEffect(value: unknown): EditorEffect | null {
  if (!isRecord(value)) return null;
  const type = normalizeId(value.type);
  const capabilityId = normalizeId(value.capabilityId);
  const effect: EditorEffect = {
    type,
    require: VALID_REQUIRE_POLICIES.has(String(value.require))
      ? (value.require as EditorDocumentRequirePolicy)
      : "strict",
  };
  const id = normalizeId(value.id);
  const order = normalizeFiniteNumber(value.order);
  const target = normalizeEffectTarget(value.target);
  if (id) effect.id = id;
  if (capabilityId) effect.capabilityId = capabilityId;
  if (order !== undefined) effect.order = order;
  if (
    value.phase === "document" ||
    value.phase === "layout" ||
    value.phase === "render" ||
    value.phase === "interaction" ||
    value.phase === "export"
  ) {
    effect.phase = value.phase;
  }
  if (target) effect.target = target;
  if (isRecord(value.payload)) effect.payload = cloneRecord(value.payload);
  if (isRecord(value.metadata)) effect.metadata = cloneRecord(value.metadata);
  return effect;
}

function normalizeEffects(value: unknown): EditorEffect[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const effects = value
    .map((item) => normalizeEffect(item))
    .filter((item): item is EditorEffect => Boolean(item));
  return effects.length ? effects : undefined;
}

function normalizeObjectEffect(value: unknown): EditorObjectEffect | null {
  if (!isRecord(value)) return null;
  const type = normalizeId(value.type);

  if (type === "clip-source") {
    const targetIds = normalizeIdList(value.targetIds);
    return targetIds ? { type, targetIds } : null;
  }

  if (type === "boolean") {
    const targetId = normalizeId(value.targetId);
    const operation = normalizeId(value.operation);
    if (
      !targetId ||
      !["add", "subtract", "intersect", "exclude"].includes(operation)
    ) {
      return null;
    }

    const participation = normalizeId(value.participation);
    return {
      type,
      targetId,
      operation: operation as "add" | "subtract" | "intersect" | "exclude",
      ...(participation === "preview" ||
      participation === "export" ||
      participation === "both"
        ? { participation }
        : {}),
    };
  }

  if (type === "guide") {
    const role = normalizeId(value.role);
    if (role !== "cut" && role !== "bleed" && role !== "safe-area") {
      return null;
    }

    return {
      type,
      role,
      ...(isRecord(value.style) ? { style: cloneRecord(value.style) } : {}),
    };
  }

  return normalizeEffect(value);
}

function normalizeObjectEffects(
  value: unknown,
): EditorObjectEffect[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const effects = value
    .map((item) => normalizeObjectEffect(item))
    .filter((item): item is EditorObjectEffect => Boolean(item));
  return effects.length ? effects : undefined;
}

function normalizeObject(value: unknown, order: number): EditorObject | null {
  if (!isRecord(value)) return null;
  const id = normalizeId(value.id);
  const source = normalizeObjectSource(value.source);
  if (!source) return null;
  const interaction = normalizeObjectInteraction(value.interaction);
  const base = {
    id,
    order:
      normalizeFiniteNumber(value.order) !== undefined
        ? normalizeFiniteNumber(value.order)
        : order,
    visible: typeof value.visible === "boolean" ? value.visible : true,
    locked: typeof value.locked === "boolean" ? value.locked : undefined,
    tags: normalizeIdList(value.tags),
    transform: normalizeTransform(value.transform),
    style: isRecord(value.style) ? cloneRecord(value.style) : undefined,
    metadata: isRecord(value.metadata)
      ? cloneRecord(value.metadata)
      : undefined,
    ...(interaction ? { interaction } : {}),
    effects: normalizeObjectEffects(value.effects),
    frame: normalizeRect(value.frame),
  };
  if (source.kind === "image") {
    const frame = normalizeRect(value.frame);
    if (!frame) return null;
    return {
      ...base,
      frame,
      source,
      placement: normalizeImagePlacement(value.placement),
      ...(isRecord(value.slot)
        ? { slot: normalizeImageSlot(value.slot) ?? {} }
        : {}),
    };
  }
  return { ...base, source };
}

function normalizeLayer(value: unknown, order: number): EditorLayer | null {
  if (!isRecord(value)) return null;
  const objects = Array.isArray(value.objects)
    ? value.objects
        .map((item, index) => normalizeObject(item, index))
        .filter((item): item is EditorObject => Boolean(item))
    : undefined;

  return {
    id: normalizeId(value.id),
    role: typeof value.role === "string" ? value.role.trim() : undefined,
    order: normalizeFiniteNumber(value.order) ?? order,
    visible: typeof value.visible === "boolean" ? value.visible : true,
    locked: typeof value.locked === "boolean" ? value.locked : undefined,
    tags: normalizeIdList(value.tags),
    objects: objects?.length ? objects : undefined,
    effects: normalizeEffects(value.effects),
    metadata: isRecord(value.metadata)
      ? cloneRecord(value.metadata)
      : undefined,
  };
}

function normalizeSurface(value: unknown): EditorSurface | null {
  if (!isRecord(value)) return null;
  const rawSize = isRecord(value.size) ? value.size : {};
  const layers = Array.isArray(value.layers)
    ? value.layers
        .map((item, index) => normalizeLayer(item, index))
        .filter((item): item is EditorLayer => Boolean(item))
    : [];
  const size = {
    width: normalizePositiveNumber(rawSize.width) ?? 1,
    height: normalizePositiveNumber(rawSize.height) ?? 1,
    unit: VALID_UNITS.has(String(rawSize.unit))
      ? (rawSize.unit as EditorDocumentUnit)
      : "px",
  };
  const frame = isRecord(value.frame)
    ? {
        trim: normalizeRect(value.frame.trim),
        bleed: normalizeRect(value.frame.bleed),
        safe: normalizeRect(value.frame.safe),
      }
    : undefined;

  return {
    id: normalizeId(value.id),
    title: typeof value.title === "string" ? value.title : undefined,
    size,
    frame:
      frame && (frame.trim || frame.bleed || frame.safe) ? frame : undefined,
    frames: normalizeSurfaceFrames(
      value.frames,
      createDefaultSurfaceFrames(size),
    ),
    layers,
    effects: normalizeEffects(value.effects),
    metadata: isRecord(value.metadata)
      ? cloneRecord(value.metadata)
      : undefined,
  };
}

function normalizeView(value: unknown): EditorView | null {
  if (!isRecord(value)) return null;
  const surfaceIds = Array.isArray(value.surfaceIds)
    ? value.surfaceIds.map(normalizeId).filter(Boolean)
    : [];
  return {
    id: normalizeId(value.id),
    title: typeof value.title === "string" ? value.title : undefined,
    surfaceIds,
    ...(isRecord(value.metadata)
      ? { metadata: cloneRecord(value.metadata) }
      : {}),
  };
}

export function normalizeEditorDocument(value: unknown): EditorDocument {
  const input = isRecord(value) ? value : {};
  const config = isRecord(input.config) ? cloneRecord(input.config) : {};
  const surfaces = Array.isArray(input.surfaces)
    ? input.surfaces
        .map(normalizeSurface)
        .filter((item): item is EditorSurface => Boolean(item))
    : [];
  const explicitViews = Array.isArray(input.views)
    ? input.views
        .map(normalizeView)
        .filter((item): item is EditorView => Boolean(item))
    : [];
  const views = explicitViews.length
    ? explicitViews
    : surfaces.map((surface) => ({
        id: surface.id,
        title: surface.title,
        surfaceIds: [surface.id],
      }));

  return {
    version: EDITOR_DOCUMENT_VERSION,
    config,
    ...(isRecord(input.metadata)
      ? { metadata: cloneRecord(input.metadata) }
      : {}),
    surfaces,
    ...(views.length ? { views } : {}),
  };
}

/** Creates a fully detached copy without relying on browser or runtime APIs. */
export function cloneEditorDocument(document: EditorDocument): EditorDocument {
  return cloneSerializableValue(document) as EditorDocument;
}

/**
 * Visits every persisted editor object in document order.
 *
 * The context keeps hierarchy and path information together so callers do not
 * need to repeat the surface/layer/object recursion themselves.
 */
export function visitEditorDocumentObjects(
  document: EditorDocument,
  visitor: EditorDocumentObjectVisitor,
): void {
  document.surfaces.forEach((surface, surfaceIndex) => {
    surface.layers.forEach((layer, layerIndex) => {
      layer.objects?.forEach((object, objectIndex) => {
        visitor({
          document,
          surface,
          surfaceIndex,
          layer,
          layerIndex,
          object,
          objectIndex,
          path: `surfaces[${surfaceIndex}].layers[${layerIndex}].objects[${objectIndex}]`,
        });
      });
    });
  });
}

export function getEditorDocumentObjects(
  document: EditorDocument,
): EditorObject[] {
  const objects: EditorObject[] = [];
  visitEditorDocumentObjects(document, ({ object }) => objects.push(object));
  return objects;
}

export function findEditorDocumentObject(
  document: EditorDocument,
  objectId: string,
): EditorObject | undefined {
  let match: EditorObject | undefined;
  visitEditorDocumentObjects(document, ({ object }) => {
    if (!match && object.id === objectId) match = object;
  });
  return match;
}

function addDiagnostic(
  diagnostics: EditorDocumentDiagnostic[],
  diagnostic: EditorDocumentDiagnostic,
) {
  diagnostics.push(diagnostic);
}

function validateUniqueId(
  diagnostics: EditorDocumentDiagnostic[],
  seen: Set<string>,
  id: string,
  path: string,
  label: string,
) {
  if (!id) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: `${label}-id-required`,
      message: `${label} id is required.`,
      path,
    });
    return;
  }
  if (seen.has(id)) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: `${label}-id-duplicate`,
      message: `${label} id "${id}" is duplicated.`,
      path,
    });
  }
  seen.add(id);
}

function resolveEffectCapabilityId(
  effect: EditorEffect,
  options: EditorDocumentCapabilityCollectionOptions,
): string | undefined {
  return effect.capabilityId || options.resolveEffectCapabilityId?.(effect);
}

export function isEditorBuiltinObjectEffect(
  effect: EditorObjectEffect,
): effect is EditorBuiltinObjectEffect {
  return (
    effect.type === "clip-source" ||
    effect.type === "boolean" ||
    effect.type === "guide"
  );
}

export function isGenericEditorEffect(
  effect: EditorObjectEffect,
): effect is EditorEffect {
  return !isEditorBuiltinObjectEffect(effect);
}

function validateEffect(
  diagnostics: EditorDocumentDiagnostic[],
  effect: EditorEffect,
  path: string,
) {
  if (!effect.type) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: "effect-type-required",
      message: "Effect type is required.",
      path,
    });
  }
}

function validateDocumentConfig(
  diagnostics: EditorDocumentDiagnostic[],
  input: Record<string, unknown>,
) {
  if (!isRecord(input.config)) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: "document-config-required",
      message: "EditorDocument config is required.",
      path: "config",
    });
  }
}

function validateEffects(
  diagnostics: EditorDocumentDiagnostic[],
  effects: EditorEffect[] | undefined,
  path: string,
) {
  effects?.forEach((effect, index) =>
    validateEffect(diagnostics, effect, `${path}.effects[${index}]`),
  );
}

function validateObjectEffects(
  diagnostics: EditorDocumentDiagnostic[],
  effects: EditorObjectEffect[] | undefined,
  path: string,
) {
  effects?.forEach((effect, index) => {
    if (isGenericEditorEffect(effect)) {
      validateEffect(diagnostics, effect, `${path}.effects[${index}]`);
    }
  });
}

function validateObjectInteraction(
  diagnostics: EditorDocumentDiagnostic[],
  value: unknown,
  path: string,
) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: "interaction-invalid",
      message: "Object interaction must be an object.",
      path,
    });
    return;
  }

  const allowedFields = new Set([
    "hitRegion",
    "enabledWhen",
    "selection",
    "activation",
    "manipulation",
  ]);
  Object.keys(value).forEach((field) => {
    if (allowedFields.has(field)) return;
    addDiagnostic(diagnostics, {
      severity: "error",
      code: "interaction-field-invalid",
      message: `Interaction field "${field}" is not supported in EditorDocument v6.`,
      path: `${path}.${field}`,
    });
  });

  if (
    value.hitRegion !== undefined &&
    (!isRecord(value.hitRegion) || value.hitRegion.type !== "frame")
  ) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: "interaction-hit-region-invalid",
      message: 'Interaction hitRegion must be { type: "frame" }.',
      path: `${path}.hitRegion`,
    });
  }

  if (
    value.selection !== undefined &&
    (!isRecord(value.selection) || typeof value.selection.enabled !== "boolean")
  ) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: "interaction-selection-invalid",
      message: "Interaction selection requires a boolean enabled field.",
      path: `${path}.selection`,
    });
  }

  if (
    value.enabledWhen !== undefined &&
    !normalizeRuntimeCondition(value.enabledWhen)
  ) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: "interaction-condition-invalid",
      message: "Interaction enabledWhen is not a valid condition expression.",
      path: `${path}.enabledWhen`,
    });
  }

  if (value.activation !== undefined) {
    const activation = isRecord(value.activation)
      ? value.activation
      : undefined;
    const action = isRecord(activation?.action) ? activation.action : undefined;
    if (!activation || !action || !normalizeId(action.commandId)) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "interaction-activation-invalid",
        message: "Interaction activation requires action.commandId.",
        path: `${path}.activation.action.commandId`,
      });
    }
    if (action && Object.prototype.hasOwnProperty.call(action, "command")) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "interaction-action-command-legacy",
        message:
          "Interaction action.command is not supported; use action.commandId.",
        path: `${path}.activation.action.command`,
      });
    }
  }

  if (value.manipulation === undefined) return;
  if (!isRecord(value.manipulation)) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: "interaction-manipulation-invalid",
      message: "Interaction manipulation must be an object.",
      path: `${path}.manipulation`,
    });
    return;
  }
  Object.entries(value.manipulation).forEach(([kind, operation]) => {
    const operationPath = `${path}.manipulation.${kind}`;
    if (kind !== "move" && kind !== "resize" && kind !== "rotate") {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "interaction-operation-invalid",
        message: `Interaction manipulation operation "${kind}" is not supported.`,
        path: operationPath,
      });
      return;
    }
    if (!isRecord(operation) || typeof operation.enabled !== "boolean") {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "interaction-operation-enabled-required",
        message: `Interaction ${kind} requires a boolean enabled field.`,
        path: `${operationPath}.enabled`,
      });
      return;
    }
    if (operation.constraints === undefined) return;
    if (!Array.isArray(operation.constraints)) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "interaction-constraints-invalid",
        message: `Interaction ${kind} constraints must be an array.`,
        path: `${operationPath}.constraints`,
      });
      return;
    }
    operation.constraints.forEach((constraint, constraintIndex) => {
      const constraintPath = `${operationPath}.constraints[${constraintIndex}]`;
      const spec =
        isRecord(constraint) && isRecord(constraint.spec)
          ? constraint.spec
          : undefined;
      if (!spec || !normalizeId(spec.type)) {
        addDiagnostic(diagnostics, {
          severity: "error",
          code: "interaction-constraint-invalid",
          message: "Interaction constraint requires spec.type.",
          path: `${constraintPath}.spec`,
        });
      }
      if (
        isRecord(constraint) &&
        constraint.activeWhen !== undefined &&
        !normalizeRuntimeCondition(constraint.activeWhen)
      ) {
        addDiagnostic(diagnostics, {
          severity: "error",
          code: "interaction-condition-invalid",
          message: "Constraint activeWhen is not a valid condition expression.",
          path: `${constraintPath}.activeWhen`,
        });
      }
    });
  });
}

function runValidators(
  diagnostics: EditorDocumentDiagnostic[],
  validators: readonly EditorDocumentValidator[] | undefined,
  context: Omit<EditorDocumentValidatorContext, "addDiagnostic">,
) {
  validators?.forEach((validator) => {
    validator({
      ...context,
      addDiagnostic: (diagnostic) =>
        addDiagnostic(diagnostics, {
          ...diagnostic,
          path: diagnostic.path ?? context.path,
        }),
    });
  });
}

function validateV7ImageObjects(
  diagnostics: EditorDocumentDiagnostic[],
  input: Record<string, unknown>,
) {
  const surfaces = Array.isArray(input.surfaces) ? input.surfaces : [];
  surfaces.forEach((surface, surfaceIndex) => {
    const layers =
      isRecord(surface) && Array.isArray(surface.layers) ? surface.layers : [];
    layers.forEach((layer, layerIndex) => {
      const objects =
        isRecord(layer) && Array.isArray(layer.objects) ? layer.objects : [];
      objects.forEach((object, objectIndex) => {
        if (!isRecord(object)) return;
        const path = `surfaces[${surfaceIndex}].layers[${layerIndex}].objects[${objectIndex}]`;
        const source = isRecord(object.source) ? object.source : undefined;
        if (!source) return;
        if (
          source.kind === "url" ||
          source.kind === "data-url" ||
          source.kind === "blob-url"
        ) {
          addDiagnostic(diagnostics, {
            severity: "error",
            code: "image-source-legacy",
            message:
              'Top-level image resources are not supported in EditorDocument v7; use source.kind "image".',
            path: `${path}.source.kind`,
          });
          return;
        }
        if (source.kind !== "image") return;
        if (
          source.resource !== undefined &&
          !normalizeImageResource(source.resource)
        ) {
          addDiagnostic(diagnostics, {
            severity: "error",
            code: "image-resource-invalid",
            message: "Image resource is invalid.",
            path: `${path}.source.resource`,
          });
        }
        const placement = isRecord(object.placement)
          ? object.placement
          : undefined;
        const required = [
          "fit",
          "anchorX",
          "anchorY",
          "zoom",
          "rotation",
          "opacity",
          "clip",
        ];
        const missing = required.filter(
          (key) => !placement || placement[key] === undefined,
        );
        if (missing.length) {
          addDiagnostic(diagnostics, {
            severity: "error",
            code: "image-placement-incomplete",
            message: `Image placement requires ${missing.join(", ")}.`,
            path: `${path}.placement`,
          });
        }
        if (object.slot !== undefined && !isRecord(object.slot)) {
          addDiagnostic(diagnostics, {
            severity: "error",
            code: "image-slot-invalid",
            message: "Image slot must be an object.",
            path: `${path}.slot`,
          });
        }
      });
    });
  });
}

export function validateEditorDocument(
  value: unknown,
  options: EditorDocumentValidationOptions = {},
): EditorDocumentDiagnostic[] {
  const diagnostics: EditorDocumentDiagnostic[] = [];
  const input = isRecord(value) ? value : {};
  if (input.version !== EDITOR_DOCUMENT_VERSION) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: "document-version-invalid",
      message: `EditorDocument version must be ${EDITOR_DOCUMENT_VERSION}.`,
      path: "version",
    });
  }

  const document = normalizeEditorDocument(value);
  const surfaceIds = new Set<string>();
  const layerIds = new Set<string>();
  const objectIds = new Set<string>();
  const viewIds = new Set<string>();

  validateDocumentConfig(diagnostics, input);
  validateV7ImageObjects(diagnostics, input);

  runValidators(diagnostics, options.validators, {
    document,
    path: "",
  });

  if (!document.surfaces.length) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: "surfaces-required",
      message: "EditorDocument requires at least one surface.",
      path: "surfaces",
    });
  }

  document.surfaces.forEach((surface, surfaceIndex) => {
    const surfacePath = `surfaces[${surfaceIndex}]`;
    validateUniqueId(
      diagnostics,
      surfaceIds,
      surface.id,
      `${surfacePath}.id`,
      "surface",
    );
    if (surface.size.width <= 0 || surface.size.height <= 0) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "surface-size-invalid",
        message: `Surface "${surface.id}" size must be positive.`,
        path: `${surfacePath}.size`,
      });
    }
    if (!isRecord((input.surfaces as unknown[])?.[surfaceIndex])) {
      return;
    }
    const rawSurface = (input.surfaces as unknown[])[surfaceIndex];
    const rawFrames = isRecord(rawSurface) ? rawSurface.frames : undefined;
    if (!isRecord(rawFrames)) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "surface-frames-required",
        message: `Surface "${surface.id}" requires frames.`,
        path: `${surfacePath}.frames`,
      });
    }
    (
      ["previewBounds", "productionFrame", "viewportFocusFrame"] as const
    ).forEach((key) => {
      if (
        !normalizeSceneFrameMm(isRecord(rawFrames) ? rawFrames[key] : undefined)
      ) {
        addDiagnostic(diagnostics, {
          severity: "error",
          code: "surface-frame-required",
          message: `Surface "${surface.id}" requires a valid "${key}" frame.`,
          path: `${surfacePath}.frames.${key}`,
        });
      }
    });
    validateEffects(diagnostics, surface.effects, surfacePath);
    runValidators(diagnostics, options.validators, {
      document,
      path: surfacePath,
      surface,
    });
    surface.effects?.forEach((effect, effectIndex) =>
      runValidators(diagnostics, options.validators, {
        document,
        path: `${surfacePath}.effects[${effectIndex}]`,
        surface,
        effect,
      }),
    );

    surface.layers.forEach((layer, layerIndex) => {
      const layerPath = `${surfacePath}.layers[${layerIndex}]`;
      validateUniqueId(
        diagnostics,
        layerIds,
        layer.id,
        `${layerPath}.id`,
        "layer",
      );
      validateEffects(diagnostics, layer.effects, layerPath);
      runValidators(diagnostics, options.validators, {
        document,
        path: layerPath,
        surface,
        layer,
      });
      layer.effects?.forEach((effect, effectIndex) =>
        runValidators(diagnostics, options.validators, {
          document,
          path: `${layerPath}.effects[${effectIndex}]`,
          surface,
          layer,
          effect,
        }),
      );
      layer.objects?.forEach((object, objectIndex) => {
        const objectPath = `${layerPath}.objects[${objectIndex}]`;
        const rawLayer = Array.isArray(
          (rawSurface as Record<string, unknown>).layers,
        )
          ? ((rawSurface as Record<string, unknown>).layers as unknown[])[
              layerIndex
            ]
          : undefined;
        const rawObject =
          isRecord(rawLayer) && Array.isArray(rawLayer.objects)
            ? rawLayer.objects[objectIndex]
            : undefined;
        validateUniqueId(
          diagnostics,
          objectIds,
          object.id,
          `${objectPath}.id`,
          "object",
        );
        if (!object.frame) {
          addDiagnostic(diagnostics, {
            severity: "error",
            code: "object-frame-required",
            message: `Object "${object.id}" requires frame.`,
            path: `${objectPath}.frame`,
          });
        }
        validateObjectInteraction(
          diagnostics,
          isRecord(rawObject) ? rawObject.interaction : undefined,
          `${objectPath}.interaction`,
        );
        validateObjectEffects(diagnostics, object.effects, objectPath);
        runValidators(diagnostics, options.validators, {
          document,
          path: objectPath,
          surface,
          layer,
          object,
        });
        object.effects?.forEach((effect, effectIndex) =>
          runValidators(diagnostics, options.validators, {
            document,
            path: `${objectPath}.effects[${effectIndex}]`,
            surface,
            layer,
            object,
            effect,
          }),
        );
      });
    });
  });

  document.views?.forEach((view, viewIndex) => {
    const viewPath = `views[${viewIndex}]`;
    validateUniqueId(diagnostics, viewIds, view.id, `${viewPath}.id`, "view");
    if (!view.surfaceIds.length) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "view-surfaces-required",
        message: `View "${view.id}" requires at least one surfaceId.`,
        path: `${viewPath}.surfaceIds`,
      });
    }
    view.surfaceIds.forEach((surfaceId, surfaceIdIndex) => {
      if (!surfaceIds.has(surfaceId)) {
        addDiagnostic(diagnostics, {
          severity: "error",
          code: "view-surface-missing",
          message: `View "${view.id}" references missing surface "${surfaceId}".`,
          path: `${viewPath}.surfaceIds[${surfaceIdIndex}]`,
        });
      }
    });
  });

  return diagnostics;
}

function collectEffects(
  document: EditorDocument,
  visit: (effect: EditorEffect, path: string) => void,
) {
  document.surfaces.forEach((surface, surfaceIndex) => {
    const surfacePath = `surfaces[${surfaceIndex}]`;
    surface.effects?.forEach((effect, effectIndex) =>
      visit(effect, `${surfacePath}.effects[${effectIndex}]`),
    );
    surface.layers.forEach((layer, layerIndex) => {
      const layerPath = `${surfacePath}.layers[${layerIndex}]`;
      layer.effects?.forEach((effect, effectIndex) =>
        visit(effect, `${layerPath}.effects[${effectIndex}]`),
      );
      layer.objects?.forEach((object, objectIndex) => {
        const objectPath = `${layerPath}.objects[${objectIndex}]`;
        object.effects?.forEach((effect, effectIndex) => {
          if (isGenericEditorEffect(effect)) {
            visit(effect, `${objectPath}.effects[${effectIndex}]`);
          }
        });
      });
    });
  });
}

export function collectEditorDocumentCapabilityRequirements(
  value: unknown,
  options: EditorDocumentCapabilityCollectionOptions = {},
): EditorDocumentCapabilityCollectionResult {
  const document = normalizeEditorDocument(value);
  const diagnostics: EditorDocumentDiagnostic[] = [];
  const requirements: EditorDocumentCapabilityRequirement[] = [];
  const available =
    options.availableCapabilityIds === undefined
      ? undefined
      : new Set(Array.from(options.availableCapabilityIds));

  collectEffects(document, (effect, path) => {
    const capabilityId = resolveEffectCapabilityId(effect, options);
    const require = effect.require ?? "strict";
    if (!capabilityId) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "effect-capability-required",
        message: `Effect "${effect.type || "(unknown)"}" requires a capabilityId.`,
        path,
        effectType: effect.type,
      });
      return;
    }

    if (require !== "ignore" || options.includeIgnored) {
      requirements.push({
        capabilityId,
        effectType: effect.type,
        require,
        path,
        ...(effect.id ? { effectId: effect.id } : {}),
      });
    }

    if (available && !available.has(capabilityId)) {
      if (require === "strict") {
        addDiagnostic(diagnostics, {
          severity: "error",
          code: "capability-required",
          message: `Capability "${capabilityId}" is required by effect "${effect.type}".`,
          path,
          capabilityId,
          effectType: effect.type,
        });
      } else if (require === "warn") {
        addDiagnostic(diagnostics, {
          severity: "warning",
          code: "capability-optional-missing",
          message: `Optional capability "${capabilityId}" is missing for effect "${effect.type}".`,
          path,
          capabilityId,
          effectType: effect.type,
        });
      }
    }
  });

  return { requirements, diagnostics };
}
