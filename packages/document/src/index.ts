export const EDITOR_DOCUMENT_VERSION = 5 as const;

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

export interface EditorInteractionConstraint {
  activeWhen?: Record<string, unknown>;
  spec: Record<string, unknown>;
}

export interface EditorInteractionActivation {
  enabled?: boolean;
  trigger?: "primary-pointer" | "double-click";
  action: {
    command: string;
    payload?: Record<string, unknown>;
  };
  session?: {
    channel: string;
    groupId: string;
    sessionId?: string;
    mode: "exclusive" | "cooperative" | "passive";
    scope: "subject" | "surface" | "editor";
    leavePolicy?: "block" | "commit" | "rollback";
  };
}

export interface EditorObjectInteraction {
  enabledWhen?: Record<string, unknown>;
  activation?: EditorInteractionActivation;
  transform?: {
    enabled?: boolean;
  };
  drag?: {
    enabled?: boolean;
    constraints?: EditorInteractionConstraint[];
  };
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
  interaction?: EditorObjectInteraction;
  effects?: EditorObjectEffect[];
}

export type ObjectSource =
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

export interface EditorObject extends EditorObjectBase {
  source: ObjectSource;
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
  code: string;
  message: string;
  path: string;
  capabilityId?: string;
  effectType?: string;
}

export interface EditorDocumentValidationOptions {
  resolveEffectCapabilityId?: EditorDocumentEffectCapabilityResolver;
  validators?: readonly EditorDocumentValidator[];
}

export interface EditorDocumentCapabilityCollectionOptions extends EditorDocumentValidationOptions {
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

const VALID_UNITS = new Set(["px", "mm", "cm", "in"]);
const VALID_REQUIRE_POLICIES = new Set(["strict", "warn", "ignore"]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneRecord<T extends Record<string, unknown> | undefined>(
  value: T,
): T {
  if (!value) return value;
  return { ...value } as T;
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

function normalizeObjectSource(value: unknown): ObjectSource | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "url": {
      const url = normalizeId(value.url);
      if (!url) return null;
      return {
        kind: "url",
        url,
        ...(typeof value.mimeType === "string" && value.mimeType.trim()
          ? { mimeType: value.mimeType.trim() }
          : {}),
        ...(normalizeSize(value.intrinsicSize)
          ? { intrinsicSize: normalizeSize(value.intrinsicSize) }
          : {}),
      };
    }
    case "data-url": {
      const dataUrl = normalizeId(value.dataUrl);
      if (!dataUrl) return null;
      return {
        kind: "data-url",
        dataUrl,
        ...(typeof value.mimeType === "string" && value.mimeType.trim()
          ? { mimeType: value.mimeType.trim() }
          : {}),
        ...(normalizeSize(value.intrinsicSize)
          ? { intrinsicSize: normalizeSize(value.intrinsicSize) }
          : {}),
      };
    }
    case "blob-url": {
      const url = normalizeId(value.url);
      if (!url) return null;
      return {
        kind: "blob-url",
        url,
        transient: true,
        ...(normalizeSize(value.intrinsicSize)
          ? { intrinsicSize: normalizeSize(value.intrinsicSize) }
          : {}),
      };
    }
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
): Record<string, unknown> | undefined {
  return isRecord(value) ? cloneRecord(value) : undefined;
}

function normalizeInteractionConstraint(
  value: unknown,
): EditorInteractionConstraint | null {
  if (!isRecord(value)) return null;
  const rawSpec = isRecord(value.spec) ? value.spec : value;
  const type = normalizeId(rawSpec.type);
  if (!type) return null;
  return {
    ...(normalizeRuntimeCondition(value.activeWhen)
      ? { activeWhen: normalizeRuntimeCondition(value.activeWhen) }
      : {}),
    spec: {
      ...cloneRecord(rawSpec),
      type,
    },
  };
}

function normalizeInteractionConstraints(
  value: unknown,
): EditorInteractionConstraint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const constraints = value
    .map((item) => normalizeInteractionConstraint(item))
    .filter((item): item is EditorInteractionConstraint => Boolean(item));
  return constraints.length ? constraints : undefined;
}

function normalizeObjectInteraction(
  value: unknown,
): EditorObjectInteraction | undefined {
  if (!isRecord(value)) return undefined;
  const interaction: EditorObjectInteraction = {};
  const enabledWhen = normalizeRuntimeCondition(value.enabledWhen);
  if (enabledWhen) interaction.enabledWhen = enabledWhen;

  if (isRecord(value.activation) && isRecord(value.activation.action)) {
    const command = normalizeId(value.activation.action.command);
    if (command) {
      const rawSession = isRecord(value.activation.session)
        ? value.activation.session
        : undefined;
      const channel = normalizeId(rawSession?.channel);
      const groupId = normalizeId(rawSession?.groupId);
      const sessionId = normalizeId(rawSession?.sessionId);
      const mode = normalizeId(rawSession?.mode);
      const scope = normalizeId(rawSession?.scope);
      const leavePolicy = normalizeId(rawSession?.leavePolicy);
      interaction.activation = {
        enabled: value.activation.enabled !== false,
        trigger:
          value.activation.trigger === "double-click"
            ? "double-click"
            : "primary-pointer",
        action: {
          command,
          ...(isRecord(value.activation.action.payload)
            ? { payload: cloneRecord(value.activation.action.payload) }
            : {}),
        },
        ...(rawSession &&
        channel &&
        groupId &&
        ["exclusive", "cooperative", "passive"].includes(mode) &&
        ["subject", "surface", "editor"].includes(scope)
          ? {
              session: {
                channel,
                groupId,
                ...(sessionId ? { sessionId } : {}),
                mode: mode as "exclusive" | "cooperative" | "passive",
                scope: scope as "subject" | "surface" | "editor",
                ...(["block", "commit", "rollback"].includes(leavePolicy)
                  ? {
                      leavePolicy: leavePolicy as
                        | "block"
                        | "commit"
                        | "rollback",
                    }
                  : {}),
              },
            }
          : {}),
      };
    }
  }

  if (isRecord(value.transform)) {
    interaction.transform = {
      enabled: value.transform.enabled === true,
    };
  }

  if (isRecord(value.drag)) {
    const constraints = normalizeInteractionConstraints(value.drag.constraints);
    interaction.drag = {
      enabled: value.drag.enabled === true,
      ...(constraints ? { constraints } : {}),
    };
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
  options: EditorDocumentValidationOptions,
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
  options: EditorDocumentValidationOptions,
) {
  if (!effect.type) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: "effect-type-required",
      message: "Effect type is required.",
      path,
    });
  }
  if (!resolveEffectCapabilityId(effect, options)) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: "effect-capability-required",
      message: `Effect "${effect.type || "(unknown)"}" requires a capabilityId.`,
      path,
      effectType: effect.type,
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
  options: EditorDocumentValidationOptions,
) {
  effects?.forEach((effect, index) =>
    validateEffect(diagnostics, effect, `${path}.effects[${index}]`, options),
  );
}

function validateObjectEffects(
  diagnostics: EditorDocumentDiagnostic[],
  effects: EditorObjectEffect[] | undefined,
  path: string,
  options: EditorDocumentValidationOptions,
) {
  effects?.forEach((effect, index) => {
    if (isGenericEditorEffect(effect)) {
      validateEffect(diagnostics, effect, `${path}.effects[${index}]`, options);
    }
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
    validateEffects(diagnostics, surface.effects, surfacePath, options);
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
      validateEffects(diagnostics, layer.effects, layerPath, options);
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
        validateObjectEffects(diagnostics, object.effects, objectPath, options);
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
