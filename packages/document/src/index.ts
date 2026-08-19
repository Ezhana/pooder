import { DocumentParseError, parseDocument } from "./parser";

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

export const POODER_DOCUMENT_VERSION = 8 as const;
export type PooderDocumentVersion = typeof POODER_DOCUMENT_VERSION;
export type DocumentDiagnosticSeverity = "error" | "warning";
export type DocumentDiagnosticStage =
  | "document-schema"
  | "effect-schema"
  | "extension-schema"
  | "runtime-capability";
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RectMm extends Rect {}

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

export interface Size {
  width: number;
  height: number;
}

export type AffineMatrix = [number, number, number, number, number, number];

export interface PointMm {
  x: number;
  y: number;
}

export interface DocumentExtension {
  /** Extension ids this document needs. Authored by the BFF; never inferred. */
  required: string[];
  /** Persisted extension-owned state, keyed by those ids. */
  states: Record<string, JsonValue>;
}

export interface PooderDocument {
  version: PooderDocumentVersion;
  assets: Asset[];
  extension: DocumentExtension;
  surfaces: Surface[];
}

export interface Surface {
  id: string;
  title?: string;
  /** Scene world in millimetres. Root `localToScene` origin. */
  bounds: RectMm;
  /** Content inset from `bounds`. Omitted or all zeroes means content == bounds. */
  insets?: BoxInsetsMm;
  /** Draw order is array order plus depth-first traversal; index 0 is bottom. */
  objects: PooderObject[];
}

export function surfaceInsets(
  surface: Pick<Surface, "insets">,
): BoxInsetsMm {
  return surface.insets ?? ZERO_BOX_INSETS_MM;
}

export function surfaceContentRect(
  surface: Pick<Surface, "bounds" | "insets">,
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
  surface: Pick<Surface, "bounds" | "insets">,
): RectMm {
  const content = surfaceContentRect(surface);
  if (!(content.width > 0 && content.height > 0)) {
    throw new Error("Surface content rect must have positive width and height.");
  }
  return content;
}

/** Facts shared by every node in the document object tree. */
export interface NodeBase {
  id: string;
  tags: string[];
  /** Visibility is inherited with logical AND from every ancestor. */
  visible: boolean;
  /** Locking applies only to this node and is not inherited. */
  locked: boolean;
  /** Object-local to parent-local coordinates. */
  localToParent: AffineMatrix;
  traits?: ObjectTrait[];
  behaviors?: ObjectBehavior[];
  interaction?: DocumentInteractionSpec;
}

/** Fields owned only by pixel-producing leaf nodes. */
export interface LeafBase extends NodeBase {
  /** The declared rectangle content is placed into. x/y are geometry, not placement. */
  localFrame: RectMm;
  /** Editing anchor in object-local space; it is not a transform. */
  localPivot?: PointMm;
  /** Per-object opacity in [0, 1]. Defaults to 1 and is not inherited. */
  opacity?: number;
  effects?: ObjectEffect[];
}

export type AssetDataSource =
  | { kind: "url"; url: string }
  | { kind: "data-url"; dataUrl: string };

/** A document-level reference to an entry in PooderDocument.assets. */
export type AssetSource = {
  kind: "asset";
  assetId: string;
};

/** Inline object content. The object type determines the content schema. */
export interface InlineSource<TContent = unknown> {
  kind: "inline";
  content: TContent;
}

export interface ImageAsset {
  id: string;
  type: "image";
  source: AssetDataSource;
  mimeType?: string;
  intrinsicSize?: Size;
}

export type Asset = ImageAsset;

export interface AssetReferenceBinding {
  source: AssetSource;
  expectedType: Asset["type"];
  path: string;
  replace(source: AssetSource): void;
}

export interface ImageContentFit {
  fit: "cover" | "contain" | "stretch";
  anchorX: number;
  anchorY: number;
  zoom: number;
  rotation: number;
  /** Whether content that overflows the frame is cropped to it. */
  clip: "frame" | "none";
}

export interface Paint {
  fill?: string | null;
  stroke?: string | null;
  strokeWidthMm?: number;
  dashMm?: number[];
}

export interface ImageSlotBehaviorConfig {
  accepts?: string[];
  placeholderSource: AssetSource;
}

export interface ObjectSelector {
  ids?: readonly string[];
  tags?: readonly string[];
  tagMatch?: "all" | "any";
  surfaceIds?: readonly string[];
}

export interface PathContent {
  pathData: string;
  sourceBounds?: Rect;
  sourceSize?: Size;
}

export type ShapeContent =
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

export interface ImageObject extends LeafBase {
  type: "image";
  source: AssetSource | null;
  contentFit: ImageContentFit;
}

export interface PathObject extends LeafBase {
  type: "path";
  source: InlineSource<PathContent>;
  paint?: Paint;
}

export interface ShapeObject extends LeafBase {
  type: "shape";
  source: InlineSource<ShapeContent>;
  paint?: Paint;
}

export type LeafObject =
  | ImageObject
  | PathObject
  | ShapeObject;

/** Structural transform node. It does not produce pixels. */
export interface GroupObject extends NodeBase {
  type: "group";
  children: PooderObject[];
}

export type PooderObject = LeafObject | GroupObject;

export interface ExtensionObjectEffect<TPayload = JsonValue> {
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

export type ObjectEffect =
  | CoreGeometryEffect
  | ExtensionObjectEffect;

export type CoreObjectTrait =
  | { type: "core.guide" }
  | { type: "core.output-mask"; keys: string[] };

export interface ExtensionObjectTrait<TPayload = JsonValue> {
  type: string;
  payload?: TPayload;
}

export type ObjectTrait = CoreObjectTrait | ExtensionObjectTrait;

export interface ObjectBehavior<TConfig = JsonValue> {
  type: string;
  config?: TConfig;
}

export interface DocumentDiagnostic {
  severity: DocumentDiagnosticSeverity;
  stage?: DocumentDiagnosticStage;
  code: string;
  message: string;
  path: string;
  capabilityId?: string;
  effectType?: string;
}

export type DocumentValidatorDiagnostic = Omit<
  DocumentDiagnostic,
  "stage"
>;

export interface DocumentValidatorContext {
  document: PooderDocument;
  path: string;
  surface?: Surface;
  object?: PooderObject;
  effect?: ExtensionObjectEffect;
  addDiagnostic(diagnostic: DocumentValidatorDiagnostic): void;
}

export type DocumentValidator = (
  context: DocumentValidatorContext,
) => void;

export interface DocumentValidationOptions {
  validators?: readonly DocumentValidator[];
}

export type DocumentEffectCapabilityResolver = (
  effect: ExtensionObjectEffect,
) => string | undefined;

export interface DocumentCapabilityCollectionOptions {
  availableCapabilityIds?: Iterable<string>;
  resolveEffectCapabilityId?: DocumentEffectCapabilityResolver;
}

export interface DocumentCapabilityRequirement {
  capabilityId: string;
  effectType: string;
  path: string;
}

export interface DocumentCapabilityCollectionResult {
  requirements: DocumentCapabilityRequirement[];
  diagnostics: DocumentDiagnostic[];
}

export interface DocumentObjectVisitContext {
  document: PooderDocument;
  surface: Surface;
  surfaceIndex: number;
  object: PooderObject;
  objectIndex: number;
  parentObject?: GroupObject;
  path: string;
}

export type DocumentObjectVisitor = (
  context: DocumentObjectVisitContext,
) => void;

export function isGroupObject(
  object: PooderObject,
): object is GroupObject {
  return object.type === "group";
}

export function isLeafObject(
  object: PooderObject,
): object is LeafObject {
  return object.type !== "group";
}

export function isBuiltinObjectEffect(
  effect: ObjectEffect,
): effect is CoreGeometryEffect {
  return (
    effect.type === "core.geometry.clip" ||
    effect.type === "core.geometry.boolean"
  );
}

export function isExtensionObjectEffect(
  effect: ObjectEffect,
): effect is ExtensionObjectEffect {
  return !isBuiltinObjectEffect(effect);
}

export function cloneDocument(document: PooderDocument): PooderDocument {
  return JSON.parse(JSON.stringify(document)) as PooderDocument;
}

export function visitDocumentObjects(
  document: PooderDocument,
  visitor: DocumentObjectVisitor,
): void {
  document.surfaces.forEach((surface, surfaceIndex) => {
    const visit = (
      objects: PooderObject[],
      basePath: string,
      parentObject?: GroupObject,
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
        if (isGroupObject(object)) {
          visit(object.children, `${path}.children`, object);
        }
      });
    };
    visit(surface.objects, `surfaces[${surfaceIndex}].objects`);
  });
}

export function getDocumentObjects(
  document: PooderDocument,
): PooderObject[] {
  const objects: PooderObject[] = [];
  visitDocumentObjects(document, ({ object }) => objects.push(object));
  return objects;
}

export function findDocumentObject(
  document: PooderDocument,
  objectId: string,
): PooderObject | undefined {
  let result: PooderObject | undefined;
  visitDocumentObjects(document, ({ object }) => {
    if (!result && object.id === objectId) result = object;
  });
  return result;
}

export function matchesObjectSelector(
  object: PooderObject,
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

export function selectDocumentObjects(
  document: PooderDocument,
  selector: ObjectSelector = {},
): PooderObject[] {
  const surfaceIds = normalizeSelectorValues(selector.surfaceIds);
  const objects: PooderObject[] = [];
  visitDocumentObjects(document, ({ object, surface }) => {
    if (surfaceIds && !surfaceIds.has(surface.id)) return;
    if (matchesObjectSelector(object, selector)) objects.push(object);
  });
  return objects;
}

export function selectOneDocumentObject(
  document: PooderDocument,
  selector: ObjectSelector,
): PooderObject | undefined {
  const objects = selectDocumentObjects(document, selector);
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

export function collectDocumentExtensionRequirements(
  document: PooderDocument,
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

export function collectDocumentCapabilityRequirements(
  value: unknown,
  options: DocumentCapabilityCollectionOptions = {},
): DocumentCapabilityCollectionResult {
  let document: PooderDocument;
  try {
    document = parseDocument(value);
  } catch (error) {
    return {
      requirements: [],
      diagnostics:
        error instanceof DocumentParseError ? error.diagnostics : [],
    };
  }
  const requirements: DocumentCapabilityRequirement[] = [];
  const diagnostics: DocumentDiagnostic[] = [];
  const available = options.availableCapabilityIds
    ? new Set(options.availableCapabilityIds)
    : undefined;
  visitDocumentObjects(document, ({ object, path }) => {
    if (!isLeafObject(object)) return;
    object.effects?.forEach((effect, index) => {
      if (!isExtensionObjectEffect(effect)) return;
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
