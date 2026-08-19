import { EditorDocumentParseError, parseEditorDocument } from "./parser";

export * from "./effect-schema";
export * from "./asset-references";
export * from "./extension-schema";
export * from "./object-schema";
export * from "./parser";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type DocumentConstraintResolvePhase = "preview" | "commit";
export type DocumentConstraintApplicationMode = "evaluate" | "apply";
export type DocumentConstraintApplicationPolicy = Partial<
  Record<DocumentConstraintResolvePhase, DocumentConstraintApplicationMode>
>;

export interface DocumentGeometryRef {
  sourceId: string;
  geometryId: string;
  variant?: string;
}

export interface DocumentConstraintSpec {
  type: string;
  source?: DocumentGeometryRef;
  mode?: string;
  params?: Record<string, JsonValue>;
  application?: DocumentConstraintApplicationPolicy;
}

export interface DocumentInteractionConstraintSpec {
  spec: DocumentConstraintSpec;
}

export interface DocumentInteractionOperationSpec {
  enabled: boolean;
  constraints?: DocumentInteractionConstraintSpec[];
}

export interface DocumentInteractionSpec {
  selection?: { enabled: boolean };
  manipulation?: {
    move?: DocumentInteractionOperationSpec;
    resize?: DocumentInteractionOperationSpec;
    rotate?: DocumentInteractionOperationSpec;
  };
}

export const EDITOR_DOCUMENT_VERSION = 8 as const;
export type EditorDocumentVersion = typeof EDITOR_DOCUMENT_VERSION;
export type EditorDocumentDiagnosticSeverity = "error" | "warning";
export type EditorDocumentDiagnosticStage =
  | "document-schema"
  | "effect-schema"
  | "extension-schema"
  | "runtime-capability";
export interface EditorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RectMm extends EditorRect {}

export interface BoxInsetsMm {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const ZERO_BOX_INSETS_MM: BoxInsetsMm = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

export interface EditorSize {
  width: number;
  height: number;
}

export type AffineMatrix = [number, number, number, number, number, number];

export interface PointMm {
  x: number;
  y: number;
}

export interface EditorDocumentExtension {
  /** Extension ids this document needs. Authored by the BFF; never inferred. */
  required: string[];
  /** Persisted extension-owned state, keyed by those ids. */
  states: Record<string, JsonValue>;
}

export interface EditorDocument {
  version: EditorDocumentVersion;
  assets: EditorAsset[];
  extension: EditorDocumentExtension;
  surfaces: EditorSurface[];
}

export interface EditorSurface {
  id: string;
  title?: string;
  /** Scene world in millimetres. Root `localToScene` origin. */
  bounds: RectMm;
  /** Content inset from `bounds`. Omitted or all zeroes means content == bounds. */
  insets?: BoxInsetsMm;
  /** Draw order is array order plus depth-first traversal; index 0 is bottom. */
  objects: EditorObject[];
}

export function surfaceInsets(
  surface: Pick<EditorSurface, "insets">,
): BoxInsetsMm {
  return surface.insets ?? ZERO_BOX_INSETS_MM;
}

export function surfaceContentRect(
  surface: Pick<EditorSurface, "bounds" | "insets">,
): RectMm {
  const insets = surfaceInsets(surface);
  return {
    x: surface.bounds.x + insets.left,
    y: surface.bounds.y + insets.top,
    width: surface.bounds.width - insets.left - insets.right,
    height: surface.bounds.height - insets.top - insets.bottom,
  };
}

export function surfaceContentRectOrThrow(
  surface: Pick<EditorSurface, "bounds" | "insets">,
): RectMm {
  const content = surfaceContentRect(surface);
  if (!(content.width > 0 && content.height > 0)) {
    throw new Error("Surface content rect must have positive width and height.");
  }
  return content;
}

/** Facts shared by every node in the document object tree. */
export interface EditorNodeBase {
  id: string;
  tags: string[];
  /** Visibility is inherited with logical AND from every ancestor. */
  visible: boolean;
  /** Locking applies only to this node and is not inherited. */
  locked: boolean;
  /** Object-local to parent-local coordinates. */
  localToParent: AffineMatrix;
  traits?: EditorObjectTrait[];
  behaviors?: EditorObjectBehavior[];
  interaction?: DocumentInteractionSpec;
}

/** Fields owned only by pixel-producing leaf nodes. */
export interface EditorLeafBase extends EditorNodeBase {
  /** The declared rectangle content is placed into. x/y are geometry, not placement. */
  localFrame: RectMm;
  /** Editing anchor in object-local space; it is not a transform. */
  localPivot?: PointMm;
  /** Per-object opacity in [0, 1]. Defaults to 1 and is not inherited. */
  opacity?: number;
  effects?: EditorObjectEffect[];
}

export type EditorAssetDataSource =
  | { kind: "url"; url: string }
  | { kind: "data-url"; dataUrl: string };

/** A document-level reference to an entry in EditorDocument.assets. */
export type AssetSource = {
  kind: "asset";
  assetId: string;
};

/** Inline object content. The object type determines the content schema. */
export interface InlineSource<TContent = unknown> {
  kind: "inline";
  content: TContent;
}

export interface EditorImageAsset {
  id: string;
  type: "image";
  source: EditorAssetDataSource;
  mimeType?: string;
  intrinsicSize?: EditorSize;
}

export type EditorAsset = EditorImageAsset;

export interface EditorAssetReferenceBinding {
  source: AssetSource;
  expectedType: EditorAsset["type"];
  path: string;
  replace(source: AssetSource): void;
}

export interface EditorImageContentFit {
  fit: "cover" | "contain" | "stretch";
  anchorX: number;
  anchorY: number;
  zoom: number;
  rotation: number;
  /** Whether content that overflows the frame is cropped to it. */
  clip: "frame" | "none";
}

export interface EditorPaint {
  fill?: string | null;
  stroke?: string | null;
  strokeWidthMm?: number;
  dashMm?: number[];
}

export interface EditorImageSlotBehaviorConfig {
  accepts?: string[];
  placeholderSource: AssetSource;
}

export interface ObjectSelector {
  ids?: readonly string[];
  tags?: readonly string[];
  tagMatch?: "all" | "any";
  surfaceIds?: readonly string[];
}

export interface EditorPathContent {
  pathData: string;
  sourceBounds?: EditorRect;
  sourceSize?: EditorSize;
}

export type EditorShapeContent =
  | {
      shape: "rect";
      params: { width?: number; height?: number };
    }
  | {
      shape: "circle";
      params: { radius?: number };
    }
  | {
      shape: "ellipse";
      params: { rx?: number; ry?: number; width?: number; height?: number };
    }
  | {
      shape: "heart";
      params: { width?: number; height?: number };
    };

export type ObjectSource = AssetSource | InlineSource | null;

export interface EditorImageObject extends EditorLeafBase {
  type: "image";
  source: AssetSource | null;
  contentFit: EditorImageContentFit;
}

export interface EditorPathObject extends EditorLeafBase {
  type: "path";
  source: InlineSource<EditorPathContent>;
  paint?: EditorPaint;
}

export interface EditorShapeObject extends EditorLeafBase {
  type: "shape";
  source: InlineSource<EditorShapeContent>;
  paint?: EditorPaint;
}

export type EditorLeafObject =
  | EditorImageObject
  | EditorPathObject
  | EditorShapeObject;

/** Structural transform node. It does not produce pixels. */
export interface EditorGroupObject extends EditorNodeBase {
  type: "group";
  children: EditorObject[];
}

export type EditorObject = EditorLeafObject | EditorGroupObject;

export interface EditorExtensionObjectEffect<TPayload = JsonValue> {
  type: string;
  payload?: TPayload;
}

export type CoreGeometryEffect =
  | {
      type: "core.geometry.clip";
      sourceObjectId: string;
      participation?: "preview" | "export" | "both";
    }
  | {
      type: "core.geometry.boolean";
      operandObjectId: string;
      operation: "add" | "subtract" | "intersect" | "exclude";
      participation?: "preview" | "export" | "both";
    };

export type EditorObjectEffect =
  | CoreGeometryEffect
  | EditorExtensionObjectEffect;

export type CoreObjectTrait =
  | { type: "core.guide" }
  | { type: "core.output-mask"; keys: string[] };

export interface EditorExtensionObjectTrait<TPayload = JsonValue> {
  type: string;
  payload?: TPayload;
}

export type EditorObjectTrait = CoreObjectTrait | EditorExtensionObjectTrait;

export interface EditorObjectBehavior<TConfig = JsonValue> {
  type: string;
  config?: TConfig;
}

export interface EditorDocumentDiagnostic {
  severity: EditorDocumentDiagnosticSeverity;
  stage?: EditorDocumentDiagnosticStage;
  code: string;
  message: string;
  path: string;
  capabilityId?: string;
  effectType?: string;
}

export type EditorDocumentValidatorDiagnostic = Omit<
  EditorDocumentDiagnostic,
  "stage"
>;

export interface EditorDocumentValidatorContext {
  document: EditorDocument;
  path: string;
  surface?: EditorSurface;
  object?: EditorObject;
  effect?: EditorExtensionObjectEffect;
  addDiagnostic(diagnostic: EditorDocumentValidatorDiagnostic): void;
}

export type EditorDocumentValidator = (
  context: EditorDocumentValidatorContext,
) => void;

export interface EditorDocumentValidationOptions {
  validators?: readonly EditorDocumentValidator[];
}

export type EditorDocumentEffectCapabilityResolver = (
  effect: EditorExtensionObjectEffect,
) => string | undefined;

export interface EditorDocumentCapabilityCollectionOptions {
  availableCapabilityIds?: Iterable<string>;
  resolveEffectCapabilityId?: EditorDocumentEffectCapabilityResolver;
}

export interface EditorDocumentCapabilityRequirement {
  capabilityId: string;
  effectType: string;
  path: string;
}

export interface EditorDocumentCapabilityCollectionResult {
  requirements: EditorDocumentCapabilityRequirement[];
  diagnostics: EditorDocumentDiagnostic[];
}

export interface EditorDocumentObjectVisitContext {
  document: EditorDocument;
  surface: EditorSurface;
  surfaceIndex: number;
  object: EditorObject;
  objectIndex: number;
  parentObject?: EditorGroupObject;
  path: string;
}

export type EditorDocumentObjectVisitor = (
  context: EditorDocumentObjectVisitContext,
) => void;

export function isEditorGroupObject(
  object: EditorObject,
): object is EditorGroupObject {
  return object.type === "group";
}

export function isEditorLeafObject(
  object: EditorObject,
): object is EditorLeafObject {
  return object.type !== "group";
}

export function isEditorBuiltinObjectEffect(
  effect: EditorObjectEffect,
): effect is CoreGeometryEffect {
  return (
    effect.type === "core.geometry.clip" ||
    effect.type === "core.geometry.boolean"
  );
}

export function isEditorExtensionObjectEffect(
  effect: EditorObjectEffect,
): effect is EditorExtensionObjectEffect {
  return !isEditorBuiltinObjectEffect(effect);
}

export function cloneEditorDocument(document: EditorDocument): EditorDocument {
  return JSON.parse(JSON.stringify(document)) as EditorDocument;
}

export function visitEditorDocumentObjects(
  document: EditorDocument,
  visitor: EditorDocumentObjectVisitor,
): void {
  document.surfaces.forEach((surface, surfaceIndex) => {
    const visit = (
      objects: EditorObject[],
      basePath: string,
      parentObject?: EditorGroupObject,
    ) => {
      objects.forEach((object, objectIndex) => {
        const path = `${basePath}[${objectIndex}]`;
        visitor({
          document,
          surface,
          surfaceIndex,
          object,
          objectIndex,
          ...(parentObject ? { parentObject } : {}),
          path,
        });
        if (isEditorGroupObject(object)) {
          visit(object.children, `${path}.children`, object);
        }
      });
    };
    visit(surface.objects, `surfaces[${surfaceIndex}].objects`);
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
  let result: EditorObject | undefined;
  visitEditorDocumentObjects(document, ({ object }) => {
    if (!result && object.id === objectId) result = object;
  });
  return result;
}

export function matchesObjectSelector(
  object: EditorObject,
  selector: ObjectSelector,
): boolean {
  const ids = normalizeSelectorValues(selector.ids);
  if (ids && !ids.has(object.id)) return false;
  const tags = normalizeSelectorValues(selector.tags);
  if (!tags) return true;
  const objectTags = new Set(object.tags);
  return selector.tagMatch === "any"
    ? Array.from(tags).some((tag) => objectTags.has(tag))
    : Array.from(tags).every((tag) => objectTags.has(tag));
}

export function selectEditorDocumentObjects(
  document: EditorDocument,
  selector: ObjectSelector = {},
): EditorObject[] {
  const surfaceIds = normalizeSelectorValues(selector.surfaceIds);
  const objects: EditorObject[] = [];
  visitEditorDocumentObjects(document, ({ object, surface }) => {
    if (surfaceIds && !surfaceIds.has(surface.id)) return;
    if (matchesObjectSelector(object, selector)) objects.push(object);
  });
  return objects;
}

export function selectOneEditorDocumentObject(
  document: EditorDocument,
  selector: ObjectSelector,
): EditorObject | undefined {
  const objects = selectEditorDocumentObjects(document, selector);
  if (objects.length > 1) throw new Error("document-object-selector-ambiguous");
  return objects[0];
}

function normalizeSelectorValues(
  values: readonly string[] | undefined,
): Set<string> | undefined {
  if (!values?.length) return undefined;
  const normalized = new Set(
    values.map((value) => value.trim()).filter((value) => value.length > 0),
  );
  return normalized.size ? normalized : undefined;
}

export function collectEditorDocumentExtensionRequirements(
  document: EditorDocument,
): string[] {
  return uniqueRequirementIds(document.extension.required);
}

function uniqueRequirementIds(values: readonly string[] | undefined): string[] {
  const requirements = new Set<string>();
  values?.forEach((id) => {
    const normalized = String(id || "").trim();
    if (normalized) requirements.add(normalized);
  });
  return Array.from(requirements);
}

export function collectEditorDocumentCapabilityRequirements(
  value: unknown,
  options: EditorDocumentCapabilityCollectionOptions = {},
): EditorDocumentCapabilityCollectionResult {
  let document: EditorDocument;
  try {
    document = parseEditorDocument(value);
  } catch (error) {
    return {
      requirements: [],
      diagnostics:
        error instanceof EditorDocumentParseError ? error.diagnostics : [],
    };
  }
  const requirements: EditorDocumentCapabilityRequirement[] = [];
  const diagnostics: EditorDocumentDiagnostic[] = [];
  const available = options.availableCapabilityIds
    ? new Set(options.availableCapabilityIds)
    : undefined;
  visitEditorDocumentObjects(document, ({ object, path }) => {
    if (!isEditorLeafObject(object)) return;
    object.effects?.forEach((effect, index) => {
      if (!isEditorExtensionObjectEffect(effect)) return;
      const effectPath = `${path}.effects[${index}]`;
      const capabilityId = options.resolveEffectCapabilityId?.(effect);
      if (!capabilityId) {
        diagnostics.push({
          severity: "error",
          stage: "runtime-capability",
          code: "effect-capability-required",
          message: `Effect "${effect.type}" has no registered capability.`,
          path: effectPath,
          effectType: effect.type,
        });
        return;
      }
      requirements.push({
        capabilityId,
        effectType: effect.type,
        path: effectPath,
      });
      if (available && !available.has(capabilityId)) {
        diagnostics.push({
          severity: "error",
          stage: "runtime-capability",
          code: "capability-required",
          message: `Capability "${capabilityId}" is required by effect "${effect.type}".`,
          path: effectPath,
          capabilityId,
          effectType: effect.type,
        });
      }
    });
  });
  return { requirements, diagnostics };
}
