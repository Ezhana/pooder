import { EditorDocumentParseError, parseEditorDocument } from "./parser";

export * from "./effect-schema";
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

export const EDITOR_DOCUMENT_VERSION = 7 as const;
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
  extensions: Record<string, JsonValue>;
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
}

export interface EditorLayer {
  id: string;
  visible: boolean;
  locked: boolean;
  objects: EditorObject[];
}

export interface EditorObjectBase {
  id: string;
  tags: string[];
  visible: boolean;
  locked: boolean;
  placement: {
    localBounds: RectMm;
    localToParent: AffineMatrix;
    pivot: PointMm;
  };
  traits?: EditorObjectTrait[];
  effects?: EditorObjectEffect[];
  behaviors?: EditorObjectBehavior[];
  interaction?: DocumentInteractionSpec;
}

export type EditorAssetSource =
  | { kind: "url"; url: string }
  | { kind: "data-url"; dataUrl: string };

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

export interface EditorPrimitiveAppearance {
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
  opacity?: number;
  dash?: number[];
}

export interface EditorImageSlotBehaviorConfig {
  accepts?: string[];
  placeholderSelector: ObjectSelector;
}

export interface ObjectSelector {
  ids?: readonly string[];
  tags?: readonly string[];
  tagMatch?: "all" | "any";
}

export type ObjectSource =
  | { kind: "image"; assetId?: string }
  | {
      kind: "path";
      pathData: string;
      sourceBounds?: EditorRect;
      sourceSize?: EditorSize;
    }
  | {
      kind: "shape";
      shape: "rect" | "circle" | "ellipse" | "heart";
      params: Record<string, JsonValue>;
    }
  | { kind: "text"; text: string };

export interface EditorImageObject extends EditorObjectBase {
  source: Extract<ObjectSource, { kind: "image" }>;
  appearance: EditorImagePlacement;
  children?: never;
}

export interface EditorPrimitiveObject extends EditorObjectBase {
  source: Exclude<ObjectSource, { kind: "image" }>;
  appearance?: EditorPrimitiveAppearance;
  children?: never;
}

export type EditorVisualObject = EditorImageObject | EditorPrimitiveObject;

export interface EditorCompositeObject extends EditorObjectBase {
  children: EditorObject[];
  source?: never;
  appearance?: never;
}

export type EditorObject = EditorVisualObject | EditorCompositeObject;

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
  | { type: "core.placeholder" }
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
  layer?: EditorLayer;
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
  layer: EditorLayer;
  layerIndex: number;
  object: EditorObject;
  objectIndex: number;
  parentObject?: EditorCompositeObject;
  path: string;
}

export type EditorDocumentObjectVisitor = (
  context: EditorDocumentObjectVisitContext,
) => void;

export function isEditorCompositeObject(
  object: EditorObject,
): object is EditorCompositeObject {
  return Array.isArray(object.children);
}

export function isEditorVisualObject(
  object: EditorObject,
): object is EditorVisualObject {
  return "source" in object;
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
    surface.layers.forEach((layer, layerIndex) => {
      const visit = (
        objects: EditorObject[],
        basePath: string,
        parentObject?: EditorCompositeObject,
      ) => {
        objects.forEach((object, objectIndex) => {
          const path = `${basePath}[${objectIndex}]`;
          visitor({
            document,
            surface,
            surfaceIndex,
            layer,
            layerIndex,
            object,
            objectIndex,
            ...(parentObject ? { parentObject } : {}),
            path,
          });
          if (isEditorCompositeObject(object)) {
            visit(object.children, `${path}.children`, object);
          }
        });
      };
      visit(
        layer.objects,
        `surfaces[${surfaceIndex}].layers[${layerIndex}].objects`,
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
  return getEditorDocumentObjects(document).filter((object) =>
    matchesObjectSelector(object, selector),
  );
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
