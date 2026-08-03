export * from "./effect-schema";

export type DocumentConstraintResolvePhase = "preview" | "commit";

export type DocumentConstraintApplicationMode = "evaluate" | "apply";

export type DocumentConstraintApplicationPolicy = Partial<
  Record<DocumentConstraintResolvePhase, DocumentConstraintApplicationMode>
>;

export interface DocumentConstraintSpec {
  type: string;
  source?: DocumentGeometryRef;
  mode?: string;
  params?: Record<string, unknown>;
  application?: DocumentConstraintApplicationPolicy;
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
  hitRegion?: { type: "frame"; space: "scene" };
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
export type EditorDocumentRequirePolicy = "strict" | "warn" | "ignore";
export type EditorDocumentDiagnosticSeverity = "error" | "warning";
export type EditorDocumentDiagnosticStage =
  | "document-schema"
  | "effect-schema"
  | "runtime-capability";
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

/** Persisted document-space rectangle. Values are always millimetres. */
export interface RectMm {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorSize {
  width: number;
  height: number;
}

export type AffineMatrix = [number, number, number, number, number, number];

export interface PointMm {
  x: number;
  y: number;
}

export interface EditorDocument {
  version: EditorDocumentVersion;
  assets: EditorAsset[];
  config: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  surfaces: EditorSurface[];
}

export interface EditorSurface {
  id: string;
  title?: string;
  geometry: {
    canvasBounds: RectMm;
    productionBounds: RectMm;
    exportBounds?: RectMm;
    safeBounds?: RectMm;
  };
  layers: EditorLayer[];
  effects?: EditorEffect[];
  metadata?: Record<string, unknown>;
}

export interface EditorLayer {
  id: string;
  role?: EditorLayerRole;
  visible?: boolean;
  locked?: boolean;
  tags?: string[];
  objects?: EditorObject[];
  effects?: EditorEffect[];
  metadata?: Record<string, unknown>;
}

export interface EditorObjectBase {
  id: string;
  placement: {
    localBounds: RectMm;
    localToParent: AffineMatrix;
    pivot: PointMm;
  };
  visible?: boolean;
  locked?: boolean;
  tags?: string[];
  style?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  interaction?: DocumentInteractionSpec;
  effects?: EditorObjectEffect[];
}

export type EditorAssetSource =
  | {
      kind: "url";
      url: string;
    }
  | {
      kind: "data-url";
      dataUrl: string;
    };

export interface EditorImageAsset {
  id: string;
  type: "image";
  source: EditorAssetSource;
  mimeType?: string;
  intrinsicSize?: EditorSize;
}

export type EditorAsset = EditorImageAsset;

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
    assetId: string;
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
      assetId?: string;
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
  source: { kind: "image"; assetId?: string };
  appearance: EditorImagePlacement;
  slot?: EditorImageSlotSpec;
  children?: never;
}

export interface EditorPrimitiveObject extends EditorObjectBase {
  source: Exclude<ObjectSource, { kind: "image" }>;
  children?: never;
  appearance?: never;
  slot?: never;
}

export type EditorVisualObject = EditorImageObject | EditorPrimitiveObject;

export interface EditorCompositeObject extends EditorObjectBase {
  children: EditorObject[];
  source?: never;
  appearance?: never;
  slot?: never;
}

export type EditorObject = EditorVisualObject | EditorCompositeObject;

export function isEditorCompositeObject(
  object: EditorObject,
): object is EditorCompositeObject {
  return "children" in object;
}

export function isEditorVisualObject(
  object: EditorObject,
): object is EditorVisualObject {
  return "source" in object;
}

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
  stage?: EditorDocumentDiagnosticStage;
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
  parentObject?: EditorCompositeObject;
  depth: number;
  path: string;
}

export type EditorDocumentObjectVisitor = (
  context: EditorDocumentObjectVisitContext,
) => void;

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

function normalizeAssetSource(value: unknown): EditorAssetSource | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "url") {
    const url = normalizeId(value.url);
    return url ? { kind: "url", url } : undefined;
  }
  if (value.kind === "data-url") {
    const dataUrl = normalizeId(value.dataUrl);
    return dataUrl ? { kind: "data-url", dataUrl } : undefined;
  }
  return undefined;
}

function normalizeAsset(value: unknown): EditorAsset | null {
  if (!isRecord(value) || value.type !== "image") return null;
  const id = normalizeId(value.id);
  const source = normalizeAssetSource(value.source);
  if (!id || !source) return null;
  const mimeType = normalizeId(value.mimeType);
  const intrinsicSize = normalizeSize(value.intrinsicSize);
  return {
    id,
    type: "image",
    source,
    ...(mimeType ? { mimeType } : {}),
    ...(intrinsicSize ? { intrinsicSize } : {}),
  };
}

function normalizeObjectSource(value: unknown): ObjectSource | null {
  if (!isRecord(value)) return null;
  if (value.kind === "image") {
    const assetId = normalizeId(value.assetId);
    return { kind: "image", ...(assetId ? { assetId } : {}) };
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
    anchorX: normalizeUnitCoordinate(placement.anchorX),
    anchorY: normalizeUnitCoordinate(placement.anchorY),
    zoom: normalizePositiveNumber(placement.zoom) ?? 1,
    rotation: normalizeFiniteNumber(placement.rotation) ?? 0,
    opacity: normalizeFiniteNumber(placement.opacity) ?? 1,
    clip: placement.clip === "none" ? "none" : "frame",
  };
}

function normalizeUnitCoordinate(value: unknown): number {
  return Math.min(1, Math.max(0, normalizeFiniteNumber(value) ?? 0.5));
}

function normalizeImageSlot(value: unknown): EditorImageSlotSpec | undefined {
  if (!isRecord(value)) return undefined;
  const accepts = normalizeIdList(value.accepts);
  const empty = isRecord(value.emptyPresentation)
    ? value.emptyPresentation
    : undefined;
  const emptyAssetId = normalizeId(empty?.assetId);
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
    ...(emptyAssetId
      ? {
          emptyPresentation: {
            assetId: emptyAssetId,
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

function normalizeSurfaceGeometry(value: unknown): EditorSurface["geometry"] {
  const raw = isRecord(value) ? value : {};
  const canvasBounds = normalizeRect(raw.canvasBounds) ?? {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  };
  const productionBounds = normalizeRect(raw.productionBounds) ?? canvasBounds;
  const exportBounds = normalizeRect(raw.exportBounds);
  const safeBounds = normalizeRect(raw.safeBounds);
  return {
    canvasBounds,
    productionBounds,
    ...(exportBounds ? { exportBounds } : {}),
    ...(safeBounds ? { safeBounds } : {}),
  };
}

function normalizeObjectPlacement(
  value: unknown,
): EditorObjectBase["placement"] {
  const raw = isRecord(value) ? value : {};
  const localBounds = normalizeRect(raw.localBounds) ?? {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  };
  const matrixValues = Array.isArray(raw.localToParent)
    ? raw.localToParent.map(normalizeFiniteNumber)
    : [];
  const localToParent: AffineMatrix =
    matrixValues.length === 6 &&
    matrixValues.every((entry) => entry !== undefined)
      ? (matrixValues as AffineMatrix)
      : [1, 0, 0, 1, 0, 0];
  const rawPivot = isRecord(raw.pivot) ? raw.pivot : {};
  const pivot = {
    x: normalizeFiniteNumber(rawPivot.x) ?? 0,
    y: normalizeFiniteNumber(rawPivot.y) ?? 0,
  };
  return { localBounds, localToParent, pivot };
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
  const application = normalizeConstraintApplication(rawSpec.application);
  return {
    ...(normalizeRuntimeCondition(value.activeWhen)
      ? { activeWhen: normalizeRuntimeCondition(value.activeWhen) }
      : {}),
    spec: {
      type,
      ...(source ? { source } : {}),
      ...(typeof rawSpec.mode === "string" ? { mode: rawSpec.mode } : {}),
      ...(application ? { application } : {}),
      ...(isRecord(rawSpec.params)
        ? { params: cloneRecord(rawSpec.params) }
        : {}),
    },
  };
}

function normalizeConstraintApplication(
  value: unknown,
): DocumentConstraintApplicationPolicy | undefined {
  if (!isRecord(value)) return undefined;
  const preview = normalizeConstraintApplicationMode(value.preview);
  const commit = normalizeConstraintApplicationMode(value.commit);
  if (!preview && !commit) return undefined;
  return {
    ...(preview ? { preview } : {}),
    ...(commit ? { commit } : {}),
  };
}

function normalizeConstraintApplicationMode(
  value: unknown,
): DocumentConstraintApplicationMode | undefined {
  return value === "evaluate" || value === "apply" ? value : undefined;
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
    interaction.hitRegion = { type: "frame", space: "scene" };
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
  const common = normalizeObjectEffectCommon(value);

  if (type === "clip-source") {
    const targetIds = normalizeIdList(value.targetIds);
    return targetIds ? { ...common, type, targetIds } : null;
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
      ...common,
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
      ...common,
      type,
      role,
      ...(isRecord(value.style) ? { style: cloneRecord(value.style) } : {}),
    };
  }

  return normalizeEffect(value);
}

function normalizeObjectEffectCommon(
  value: Record<string, unknown>,
): EditorObjectEffectCommon {
  const common: EditorObjectEffectCommon = {};
  const id = normalizeId(value.id);
  const order = normalizeFiniteNumber(value.order);
  if (id) common.id = id;
  if (order !== undefined) common.order = order;
  if (isRecord(value.metadata)) common.metadata = cloneRecord(value.metadata);
  return common;
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

function normalizeObject(value: unknown): EditorObject | null {
  if (!isRecord(value)) return null;
  const id = normalizeId(value.id);
  const interaction = normalizeObjectInteraction(value.interaction);
  const base = {
    id,
    placement: normalizeObjectPlacement(value.placement),
    visible: typeof value.visible === "boolean" ? value.visible : true,
    locked: typeof value.locked === "boolean" ? value.locked : undefined,
    tags: normalizeIdList(value.tags),
    style: isRecord(value.style) ? cloneRecord(value.style) : undefined,
    metadata: isRecord(value.metadata)
      ? cloneRecord(value.metadata)
      : undefined,
    ...(interaction ? { interaction } : {}),
    effects: normalizeObjectEffects(value.effects),
  };
  if (Array.isArray(value.children) && value.source === undefined) {
    return {
      ...base,
      children: value.children
        .map((child) => normalizeObject(child))
        .filter((child): child is EditorObject => Boolean(child)),
    };
  }
  const source = normalizeObjectSource(value.source);
  if (!source) return null;
  if (source.kind === "image") {
    return {
      ...base,
      source,
      appearance: normalizeImagePlacement(value.appearance),
      ...(isRecord(value.slot)
        ? { slot: normalizeImageSlot(value.slot) ?? {} }
        : {}),
    };
  }
  return { ...base, source };
}

function normalizeLayer(value: unknown): EditorLayer | null {
  if (!isRecord(value)) return null;
  const objects = Array.isArray(value.objects)
    ? value.objects
        .map((item) => normalizeObject(item))
        .filter((item): item is EditorObject => Boolean(item))
    : undefined;

  return {
    id: normalizeId(value.id),
    role: typeof value.role === "string" ? value.role.trim() : undefined,
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
  const layers = Array.isArray(value.layers)
    ? value.layers
        .map((item) => normalizeLayer(item))
        .filter((item): item is EditorLayer => Boolean(item))
    : [];
  return {
    id: normalizeId(value.id),
    title: typeof value.title === "string" ? value.title : undefined,
    geometry: normalizeSurfaceGeometry(value.geometry),
    layers,
    effects: normalizeEffects(value.effects),
    metadata: isRecord(value.metadata)
      ? cloneRecord(value.metadata)
      : undefined,
  };
}

export function normalizeEditorDocument(value: unknown): EditorDocument {
  const input = isRecord(value) ? value : {};
  const assets = Array.isArray(input.assets)
    ? input.assets
        .map(normalizeAsset)
        .filter((asset): asset is EditorAsset => Boolean(asset))
    : [];
  const config = isRecord(input.config) ? cloneRecord(input.config) : {};
  const surfaces = Array.isArray(input.surfaces)
    ? input.surfaces
        .map(normalizeSurface)
        .filter((item): item is EditorSurface => Boolean(item))
    : [];
  return {
    version: EDITOR_DOCUMENT_VERSION,
    assets,
    config,
    ...(isRecord(input.metadata)
      ? { metadata: cloneRecord(input.metadata) }
      : {}),
    surfaces,
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
  const visitObjects = (
    objects: EditorObject[] | undefined,
    context: Omit<
      EditorDocumentObjectVisitContext,
      "object" | "objectIndex" | "parentObject" | "depth" | "path"
    >,
    path: string,
    parentObject: EditorCompositeObject | undefined,
    depth: number,
  ) => {
    objects?.forEach((object, objectIndex) => {
      const objectPath = `${path}[${objectIndex}]`;
      visitor({
        ...context,
        object,
        objectIndex,
        ...(parentObject ? { parentObject } : {}),
        depth,
        path: objectPath,
      });
      if (isEditorCompositeObject(object)) {
        visitObjects(
          object.children,
          context,
          `${objectPath}.children`,
          object,
          depth + 1,
        );
      }
    });
  };
  document.surfaces.forEach((surface, surfaceIndex) => {
    surface.layers.forEach((layer, layerIndex) => {
      visitObjects(
        layer.objects,
        { document, surface, surfaceIndex, layer, layerIndex },
        `surfaces[${surfaceIndex}].layers[${layerIndex}].objects`,
        undefined,
        0,
      );
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

function validateRawEffectEnvelopes(
  diagnostics: EditorDocumentDiagnostic[],
  input: Record<string, unknown>,
) {
  const validateObjects = (objects: unknown, path: string) => {
    if (!Array.isArray(objects)) return;
    objects.forEach((object, objectIndex) => {
      if (!isRecord(object)) return;
      const objectPath = `${path}[${objectIndex}]`;
      validateRawEffectArray(diagnostics, object.effects, objectPath);
      const hasSource = object.source !== undefined;
      const hasChildren = object.children !== undefined;
      if (hasSource === hasChildren) {
        addDiagnostic(diagnostics, {
          severity: "error",
          code: "object-structure-invalid",
          message:
            "An EditorObject must contain exactly one of source or children.",
          path: objectPath,
        });
      }
      if (hasChildren && !Array.isArray(object.children)) {
        addDiagnostic(diagnostics, {
          severity: "error",
          code: "composite-children-invalid",
          message: "Composite children must be an array.",
          path: `${objectPath}.children`,
        });
      } else {
        validateObjects(object.children, `${objectPath}.children`);
      }
    });
  };
  const surfaces = Array.isArray(input.surfaces) ? input.surfaces : [];
  surfaces.forEach((surface, surfaceIndex) => {
    if (!isRecord(surface)) return;
    const surfacePath = `surfaces[${surfaceIndex}]`;
    validateRawEffectArray(diagnostics, surface.effects, surfacePath);
    const layers = Array.isArray(surface.layers) ? surface.layers : [];
    layers.forEach((layer, layerIndex) => {
      if (!isRecord(layer)) return;
      const layerPath = `${surfacePath}.layers[${layerIndex}]`;
      validateRawEffectArray(diagnostics, layer.effects, layerPath);
      validateObjects(layer.objects, `${layerPath}.objects`);
    });
  });
}

function validateObjectReferences(
  diagnostics: EditorDocumentDiagnostic[],
  document: EditorDocument,
): void {
  const objects = new Map<string, EditorObject>();
  const paths = new Map<string, string>();
  visitEditorDocumentObjects(document, ({ object, path }) => {
    objects.set(object.id, object);
    paths.set(object.id, path);
  });
  const dependencies = new Map<string, Set<string>>();
  const assetIds = new Set(document.assets.map((asset) => asset.id));
  const addDependency = (
    sourceId: string,
    targetId: string,
    effectPath: string,
  ) => {
    if (!objects.has(targetId)) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "object-effect-target-missing",
        message: `Object "${sourceId}" references missing object "${targetId}".`,
        path: effectPath,
      });
      return;
    }
    const targets = dependencies.get(sourceId) ?? new Set<string>();
    targets.add(targetId);
    dependencies.set(sourceId, targets);
  };
  visitEditorDocumentObjects(document, ({ object, path }) => {
    if (
      isEditorVisualObject(object) &&
      object.source.kind === "image" &&
      object.source.assetId &&
      !assetIds.has(object.source.assetId)
    ) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "image-asset-missing",
        message: `Image object "${object.id}" references missing asset "${object.source.assetId}".`,
        path: `${path}.source.assetId`,
      });
    }
    object.effects?.forEach((effect, effectIndex) => {
      const effectPath = `${path}.effects[${effectIndex}]`;
      if (isEditorBuiltinObjectEffect(effect) && effect.type === "boolean") {
        addDependency(object.id, effect.targetId, `${effectPath}.targetId`);
      } else if (
        isEditorBuiltinObjectEffect(effect) &&
        effect.type === "clip-source"
      ) {
        effect.targetIds.forEach((targetId: string, targetIndex: number) =>
          addDependency(
            object.id,
            targetId,
            `${effectPath}.targetIds[${targetIndex}]`,
          ),
        );
      } else if (
        isGenericEditorEffect(effect) &&
        typeof effect.target === "object" &&
        effect.target &&
        "objectId" in effect.target
      ) {
        addDependency(
          object.id,
          effect.target.objectId,
          `${effectPath}.target.objectId`,
        );
      }
    });
  });

  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (objectId: string) => {
    if (active.has(objectId)) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "object-effect-dependency-cycle",
        message: `Object effect dependency cycle includes "${objectId}".`,
        path: paths.get(objectId) ?? "surfaces",
      });
      return;
    }
    if (visited.has(objectId)) return;
    active.add(objectId);
    dependencies.get(objectId)?.forEach(visit);
    active.delete(objectId);
    visited.add(objectId);
  };
  objects.forEach((_object, objectId) => visit(objectId));
}

function validateRawEffectArray(
  diagnostics: EditorDocumentDiagnostic[],
  value: unknown,
  ownerPath: string,
) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: "effects-invalid",
      message: "Effects must be an array.",
      path: `${ownerPath}.effects`,
    });
    return;
  }
  value.forEach((effect, effectIndex) => {
    const path = `${ownerPath}.effects[${effectIndex}]`;
    if (!isRecord(effect)) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "effect-invalid",
        message: "Effect must be an object.",
        path,
      });
      return;
    }
    if (!normalizeId(effect.type)) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "effect-type-required",
        message: "Effect type is required.",
        path: `${path}.type`,
      });
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
      message: `Interaction field "${field}" is not supported in EditorDocument v7.`,
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
      if (spec?.application !== undefined) {
        const applicationPath = `${constraintPath}.spec.application`;
        if (!isRecord(spec.application)) {
          addDiagnostic(diagnostics, {
            severity: "error",
            code: "interaction-constraint-application-invalid",
            message: "Constraint application must be an object.",
            path: applicationPath,
          });
        } else {
          Object.entries(spec.application).forEach(([phase, mode]) => {
            if (phase !== "preview" && phase !== "commit") {
              addDiagnostic(diagnostics, {
                severity: "error",
                code: "interaction-constraint-application-phase-invalid",
                message: `Constraint application phase "${phase}" is not supported.`,
                path: `${applicationPath}.${phase}`,
              });
              return;
            }
            if (!normalizeConstraintApplicationMode(mode)) {
              addDiagnostic(diagnostics, {
                severity: "error",
                code: "interaction-constraint-application-mode-invalid",
                message: `Constraint application mode for "${phase}" must be "evaluate" or "apply".`,
                path: `${applicationPath}.${phase}`,
              });
            }
          });
        }
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
  const validateObjects = (objects: unknown, objectsPath: string) => {
    if (!Array.isArray(objects)) return;
    objects.forEach((object, objectIndex) => {
      if (!isRecord(object)) return;
      const path = `${objectsPath}[${objectIndex}]`;
      const source = isRecord(object.source) ? object.source : undefined;
      if (source) {
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
        } else if (source.kind === "image") {
          if (source.assetId !== undefined && !normalizeId(source.assetId)) {
            addDiagnostic(diagnostics, {
              severity: "error",
              code: "image-asset-id-invalid",
              message: "Image assetId must be a non-empty string.",
              path: `${path}.source.assetId`,
            });
          }
          const appearance = isRecord(object.appearance)
            ? object.appearance
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
            (key) => !appearance || appearance[key] === undefined,
          );
          if (missing.length) {
            addDiagnostic(diagnostics, {
              severity: "error",
              code: "image-appearance-incomplete",
              message: `Image appearance requires ${missing.join(", ")}.`,
              path: `${path}.appearance`,
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
        }
      }
      validateObjects(object.children, `${path}.children`);
    });
  };
  const surfaces = Array.isArray(input.surfaces) ? input.surfaces : [];
  surfaces.forEach((surface, surfaceIndex) => {
    const layers =
      isRecord(surface) && Array.isArray(surface.layers) ? surface.layers : [];
    layers.forEach((layer, layerIndex) => {
      validateObjects(
        isRecord(layer) ? layer.objects : undefined,
        `surfaces[${surfaceIndex}].layers[${layerIndex}].objects`,
      );
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
  const assetIds = new Set<string>();

  validateDocumentConfig(diagnostics, input);
  validateV7ImageObjects(diagnostics, input);
  validateRawEffectEnvelopes(diagnostics, input);

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

  document.assets.forEach((asset, assetIndex) => {
    validateUniqueId(
      diagnostics,
      assetIds,
      asset.id,
      `assets[${assetIndex}].id`,
      "asset",
    );
  });

  document.surfaces.forEach((surface, surfaceIndex) => {
    const surfacePath = `surfaces[${surfaceIndex}]`;
    validateUniqueId(
      diagnostics,
      surfaceIds,
      surface.id,
      `${surfacePath}.id`,
      "surface",
    );
    if (
      surface.geometry.canvasBounds.width <= 0 ||
      surface.geometry.canvasBounds.height <= 0
    ) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "surface-canvas-bounds-invalid",
        message: `Surface "${surface.id}" canvas bounds must be positive.`,
        path: `${surfacePath}.geometry.canvasBounds`,
      });
    }
    if (!isRecord((input.surfaces as unknown[])?.[surfaceIndex])) {
      return;
    }
    const rawSurface = (input.surfaces as unknown[])[surfaceIndex];
    const rawGeometry = isRecord(rawSurface) ? rawSurface.geometry : undefined;
    if (!isRecord(rawGeometry)) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "surface-geometry-required",
        message: `Surface "${surface.id}" requires millimetre geometry.`,
        path: `${surfacePath}.geometry`,
      });
    }
    (["canvasBounds", "productionBounds"] as const).forEach((key) => {
      if (
        !normalizeRect(isRecord(rawGeometry) ? rawGeometry[key] : undefined)
      ) {
        addDiagnostic(diagnostics, {
          severity: "error",
          code: "surface-bound-required",
          message: `Surface "${surface.id}" requires valid "${key}" millimetre bounds.`,
          path: `${surfacePath}.geometry.${key}`,
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
      const rawLayer = Array.isArray(
        (rawSurface as Record<string, unknown>).layers,
      )
        ? ((rawSurface as Record<string, unknown>).layers as unknown[])[
            layerIndex
          ]
        : undefined;
      const validateObjects = (
        objects: EditorObject[] | undefined,
        rawObjects: unknown,
        objectsPath: string,
        parentObject?: EditorCompositeObject,
      ) => {
        objects?.forEach((object, objectIndex) => {
          const objectPath = `${objectsPath}[${objectIndex}]`;
          const rawObject = Array.isArray(rawObjects)
            ? rawObjects[objectIndex]
            : undefined;
          validateUniqueId(
            diagnostics,
            objectIds,
            object.id,
            `${objectPath}.id`,
            "object",
          );
          if (
            !isRecord(rawObject) ||
            !isRecord(rawObject.placement) ||
            !normalizeRect(rawObject.placement.localBounds) ||
            !Array.isArray(rawObject.placement.localToParent) ||
            rawObject.placement.localToParent.length !== 6 ||
            rawObject.placement.localToParent.some(
              (entry) => normalizeFiniteNumber(entry) === undefined,
            ) ||
            !isRecord(rawObject.placement.pivot) ||
            normalizeFiniteNumber(rawObject.placement.pivot.x) === undefined ||
            normalizeFiniteNumber(rawObject.placement.pivot.y) === undefined
          ) {
            addDiagnostic(diagnostics, {
              severity: "error",
              code: "object-placement-required",
              message: `Object "${object.id}" requires valid affine placement.`,
              path: `${objectPath}.placement`,
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
          if (isEditorCompositeObject(object)) {
            validateObjects(
              object.children,
              isRecord(rawObject) ? rawObject.children : undefined,
              `${objectPath}.children`,
              object,
            );
          } else if (parentObject && object.interaction) {
            addDiagnostic(diagnostics, {
              severity: "error",
              code: "composite-child-interaction-invalid",
              message: `Composite child "${object.id}" must not define interaction; interaction belongs to composite "${parentObject.id}".`,
              path: `${objectPath}.interaction`,
            });
          }
        });
      };
      validateObjects(
        layer.objects,
        isRecord(rawLayer) ? rawLayer.objects : undefined,
        `${layerPath}.objects`,
      );
    });
  });
  validateObjectReferences(diagnostics, document);

  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    stage: "document-schema",
  }));
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
      const collectObjectEffects = (
        objects: EditorObject[] | undefined,
        objectsPath: string,
      ) =>
        objects?.forEach((object, objectIndex) => {
          const objectPath = `${objectsPath}[${objectIndex}]`;
          object.effects?.forEach((effect, effectIndex) => {
            if (isGenericEditorEffect(effect)) {
              visit(effect, `${objectPath}.effects[${effectIndex}]`);
            }
          });
          if (isEditorCompositeObject(object)) {
            collectObjectEffects(object.children, `${objectPath}.children`);
          }
        });
      collectObjectEffects(layer.objects, `${layerPath}.objects`);
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

  return {
    requirements,
    diagnostics: diagnostics.map((diagnostic) => ({
      ...diagnostic,
      stage: "runtime-capability",
    })),
  };
}

export const checkEditorDocumentRuntimeCapabilities =
  collectEditorDocumentCapabilityRequirements;
