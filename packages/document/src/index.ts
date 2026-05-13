export const EDITOR_DOCUMENT_VERSION = 2 as const;

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
  exportable?: boolean;
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
  exportable?: boolean;
  transform?: EditorTransform;
  style?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  effects?: EditorEffect[];
}

export interface EditorImageObject extends EditorObjectBase {
  type: "image";
  assetId?: string;
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
}

export interface EditorDocumentCapabilityCollectionOptions
  extends EditorDocumentValidationOptions {
  availableCapabilityIds?: Iterable<string>;
  includeIgnored?: boolean;
}

export type EditorDocumentEffectCapabilityResolver = (
  effect: EditorEffect,
) => string | undefined;

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
    exportable:
      typeof value.exportable === "boolean" ? value.exportable : undefined,
    transform: normalizeTransform(value.transform),
    style: isRecord(value.style) ? cloneRecord(value.style) : undefined,
    metadata: isRecord(value.metadata) ? cloneRecord(value.metadata) : undefined,
    effects: normalizeEffects(value.effects),
    frame: normalizeRect(value.frame),
  };

  switch (type) {
    case "image": {
      const assetId = normalizeId(value.assetId);
      const src = normalizeId(value.src);
      return {
        ...base,
        type,
        ...(assetId ? { assetId } : {}),
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
    exportable:
      typeof value.exportable === "boolean" ? value.exportable : true,
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
  const assetIds = new Set<string>();
  const surfaceIds = new Set<string>();
  const layerIds = new Set<string>();
  const objectIds = new Set<string>();
  const viewIds = new Set<string>();

  document.assets?.forEach((asset, index) => {
    validateUniqueId(diagnostics, assetIds, asset.id, `assets[${index}].id`, "asset");
    if (asset.type === "image" && !asset.src) {
      addDiagnostic(diagnostics, {
        severity: "error",
        code: "asset-image-src-required",
        message: `Image asset "${asset.id}" requires src.`,
        path: `assets[${index}].src`,
      });
    }
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
        if (
          object.type === "image" &&
          object.assetId &&
          !assetIds.has(object.assetId)
        ) {
          addDiagnostic(diagnostics, {
            severity: "error",
            code: "object-asset-missing",
            message: `Image object "${object.id}" references missing asset "${object.assetId}".`,
            path: `${objectPath}.assetId`,
          });
        }
        const hasImagePlacementEffect = object.effects?.some(
          (effect) => effect.type === "image-placement",
        );
        if (
          object.type === "image" &&
          !object.assetId &&
          !object.src &&
          !hasImagePlacementEffect
        ) {
          addDiagnostic(diagnostics, {
            severity: "error",
            code: "image-source-required",
            message: `Image object "${object.id}" requires assetId or src.`,
            path: objectPath,
          });
        }
        validateEffects(diagnostics, object.effects, objectPath, options);
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
