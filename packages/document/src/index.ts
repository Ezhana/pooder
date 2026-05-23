export const EDITOR_DOCUMENT_VERSION = 3 as const;

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
  assets?: EditorAsset[];
  surfaces: EditorSurface[];
  views?: EditorView[];
}

export interface EditorAsset {
  id: string;
  type: "image" | string;
  src?: string;
  metadata?: Record<string, unknown>;
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
  layers: EditorLayer[];
  effects?: EditorEffect[];
  metadata?: Record<string, unknown>;
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

export interface EditorObjectInteraction {
  selectable?: boolean;
  evented?: boolean;
  locked?: boolean;
}

export interface EditorObjectConstraints {
  drag?: EditorObjectDragConstraint[];
}

export type EditorObjectDragConstraint =
  | {
      type: "rect";
      rect: EditorRect;
      mode?: "contain";
      target?: "frame" | "center";
    }
  | {
      type: "object";
      objectId: string;
      source?: "frame";
      mode?: "contain";
      target?: "frame" | "center";
    };

export interface EditorObjectBase {
  id: string;
  frame?: EditorRect;
  order?: number;
  visible?: boolean;
  locked?: boolean;
  tags?: string[];
  interaction?: EditorObjectInteraction;
  constraints?: EditorObjectConstraints;
  transform?: EditorTransform;
  style?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  effects?: EditorEffect[];
}

export interface EditorImageObject extends EditorObjectBase {
  type: "image";
  src?: string;
  width?: number;
  height?: number;
}

export interface EditorPathObject extends EditorObjectBase {
  type: "path";
  path: string;
}

export interface EditorRectObject extends EditorObjectBase {
  type: "rect";
  width: number;
  height: number;
}

export interface EditorTextObject extends EditorObjectBase {
  type: "text";
  text: string;
}

export type EditorObject =
  | EditorImageObject
  | EditorPathObject
  | EditorRectObject
  | EditorTextObject;

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

export interface EditorDocumentCapabilityCollectionOptions
  extends EditorDocumentValidationOptions {
  availableCapabilityIds?: Iterable<string>;
  includeIgnored?: boolean;
}

export type EditorDocumentEffectCapabilityResolver = (
  effect: EditorEffect,
) => string | undefined;

export type EditorDocumentValidatorDiagnostic =
  Omit<EditorDocumentDiagnostic, "path"> & { path?: string };

export interface EditorDocumentValidatorContext {
  document: EditorDocument;
  path: string;
  surface?: EditorSurface;
  layer?: EditorLayer;
  object?: EditorObject;
  effect?: EditorEffect;
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
const REQUIRED_CONFIG_FRAME_KEYS = [
  "scene.previewBounds",
  "scene.productionFrame",
  "scene.viewportFocusFrame",
] as const;

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
      value
        .map((item) => normalizeId(item))
        .filter((item) => item.length > 0),
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

function normalizeObjectInteraction(
  value: unknown,
): EditorObjectInteraction | undefined {
  if (!isRecord(value)) return undefined;
  const interaction: EditorObjectInteraction = {};
  if (typeof value.selectable === "boolean") {
    interaction.selectable = value.selectable;
  }
  if (typeof value.evented === "boolean") {
    interaction.evented = value.evented;
  }
  if (typeof value.locked === "boolean") {
    interaction.locked = value.locked;
  }
  return Object.keys(interaction).length ? interaction : undefined;
}

function normalizeObjectConstraints(
  value: unknown,
): EditorObjectConstraints | undefined {
  if (!isRecord(value)) return undefined;
  const drag = normalizeObjectDragConstraints(value.drag);
  return drag?.length ? { drag } : undefined;
}

function normalizeObjectDragConstraints(
  value: unknown,
): EditorObjectDragConstraint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const constraints = value
    .map(normalizeObjectDragConstraint)
    .filter((item): item is EditorObjectDragConstraint => Boolean(item));
  return constraints.length ? constraints : undefined;
}

function normalizeObjectDragConstraint(
  value: unknown,
): EditorObjectDragConstraint | null {
  if (!isRecord(value)) return null;
  if (value.mode !== undefined && value.mode !== "contain") return null;
  if (
    value.target !== undefined &&
    value.target !== "frame" &&
    value.target !== "center"
  ) {
    return null;
  }
  const mode = value.mode === "contain" ? value.mode : undefined;
  const target =
    value.target === "frame" || value.target === "center"
      ? value.target
      : undefined;

  if (value.type === "rect") {
    const rect = normalizeRect(value.rect);
    if (!rect) return null;
    return {
      type: "rect",
      rect,
      ...(mode ? { mode } : {}),
      ...(target ? { target } : {}),
    };
  }

  if (value.type === "object") {
    const objectId = normalizeId(value.objectId);
    if (!objectId) return null;
    if (value.source !== undefined && value.source !== "frame") return null;
    return {
      type: "object",
      objectId,
      ...(value.source === "frame" ? { source: value.source } : {}),
      ...(mode ? { mode } : {}),
      ...(target ? { target } : {}),
    };
  }

  return null;
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

function normalizeObject(value: unknown, order: number): EditorObject | null {
  if (!isRecord(value)) return null;
  const id = normalizeId(value.id);
  const type = normalizeId(value.type);
  const base = {
    id,
    order:
      normalizeFiniteNumber(value.order) !== undefined
        ? normalizeFiniteNumber(value.order)
        : order,
    visible: typeof value.visible === "boolean" ? value.visible : true,
    locked: typeof value.locked === "boolean" ? value.locked : undefined,
    tags: normalizeIdList(value.tags),
    interaction: normalizeObjectInteraction(value.interaction),
    constraints: normalizeObjectConstraints(value.constraints),
    transform: normalizeTransform(value.transform),
    style: isRecord(value.style) ? cloneRecord(value.style) : undefined,
    metadata: isRecord(value.metadata) ? cloneRecord(value.metadata) : undefined,
    effects: normalizeEffects(value.effects),
    frame: normalizeRect(value.frame),
  };

  switch (type) {
    case "image": {
      const src = normalizeId(value.src);
      return {
        ...base,
        type,
        ...(src ? { src } : {}),
        ...(normalizePositiveNumber(value.width) !== undefined
          ? { width: normalizePositiveNumber(value.width) }
          : {}),
        ...(normalizePositiveNumber(value.height) !== undefined
          ? { height: normalizePositiveNumber(value.height) }
          : {}),
      };
    }
    case "path":
      return { ...base, type, path: typeof value.path === "string" ? value.path : "" };
    case "rect":
      return {
        ...base,
        type,
        width: normalizePositiveNumber(value.width) ?? 1,
        height: normalizePositiveNumber(value.height) ?? 1,
      };
    case "text":
      return { ...base, type, text: typeof value.text === "string" ? value.text : "" };
    default:
      return null;
  }
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
    metadata: isRecord(value.metadata) ? cloneRecord(value.metadata) : undefined,
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
    size: {
      width: normalizePositiveNumber(rawSize.width) ?? 1,
      height: normalizePositiveNumber(rawSize.height) ?? 1,
      unit: VALID_UNITS.has(String(rawSize.unit))
        ? (rawSize.unit as EditorDocumentUnit)
        : "px",
    },
    frame:
      frame && (frame.trim || frame.bleed || frame.safe) ? frame : undefined,
    layers,
    effects: normalizeEffects(value.effects),
    metadata: isRecord(value.metadata) ? cloneRecord(value.metadata) : undefined,
  };
}

function normalizeAsset(value: unknown): EditorAsset | null {
  if (!isRecord(value)) return null;
  const id = normalizeId(value.id);
  const type = normalizeId(value.type) || "image";
  const src = normalizeId(value.src);
  return {
    id,
    type,
    ...(src ? { src } : {}),
    ...(isRecord(value.metadata) ? { metadata: cloneRecord(value.metadata) } : {}),
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
    ...(isRecord(value.metadata) ? { metadata: cloneRecord(value.metadata) } : {}),
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
  const assets = Array.isArray(input.assets)
    ? input.assets
        .map(normalizeAsset)
        .filter((item): item is EditorAsset => Boolean(item))
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
    ...(isRecord(input.metadata) ? { metadata: cloneRecord(input.metadata) } : {}),
    ...(assets.length ? { assets } : {}),
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
  document: EditorDocument,
) {
  if (!isRecord(input.config)) {
    addDiagnostic(diagnostics, {
      severity: "error",
      code: "document-config-required",
      message: "EditorDocument config is required.",
      path: "config",
    });
    return;
  }

  REQUIRED_CONFIG_FRAME_KEYS.forEach((key) => {
    if (!normalizeSceneFrameMm(document.config[key])) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "document-config-frame-required",
        message: `EditorDocument config requires a valid "${key}" frame.`,
        path: `config.${key}`,
      });
    }
  });
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

function collectObjectIds(document: EditorDocument): Set<string> {
  const ids = new Set<string>();
  document.surfaces.forEach((surface) => {
    surface.layers.forEach((layer) => {
      layer.objects?.forEach((object) => {
        if (object.id) ids.add(object.id);
      });
    });
  });
  return ids;
}

function validateObjectDragConstraints(
  diagnostics: EditorDocumentDiagnostic[],
  object: EditorObject,
  path: string,
  objectIds: ReadonlySet<string>,
) {
  object.constraints?.drag?.forEach((constraint, index) => {
    if (constraint.type !== "object") return;
    const constraintPath = `${path}.constraints.drag[${index}].objectId`;
    if (constraint.objectId === object.id) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "object-drag-constraint-self-reference",
        message: `Object "${object.id}" cannot constrain dragging to itself.`,
        path: constraintPath,
      });
      return;
    }
    if (!objectIds.has(constraint.objectId)) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "object-drag-constraint-object-missing",
        message:
          `Object "${object.id}" references missing drag constraint object ` +
          `"${constraint.objectId}".`,
        path: constraintPath,
      });
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
  const assetIdentifiers = new Set<string>();
  const surfaceIds = new Set<string>();
  const layerIds = new Set<string>();
  const objectIds = new Set<string>();
  const allObjectIds = collectObjectIds(document);
  const viewIds = new Set<string>();

  validateDocumentConfig(diagnostics, input, document);

  runValidators(diagnostics, options.validators, {
    document,
    path: "",
  });

  document.assets?.forEach((asset, index) => {
    validateUniqueId(
      diagnostics,
      assetIdentifiers,
      asset.id,
      `assets[${index}].id`,
      "asset",
    );
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
        validateObjectDragConstraints(
          diagnostics,
          object,
          objectPath,
          allObjectIds,
        );
        validateEffects(diagnostics, object.effects, objectPath, options);
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
        object.effects?.forEach((effect, effectIndex) =>
          visit(effect, `${objectPath}.effects[${effectIndex}]`),
        );
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
