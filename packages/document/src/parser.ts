import type {
  AffineMatrix,
  DocumentConstraintApplicationMode,
  DocumentConstraintSpec,
  DocumentInteractionConstraintSpec,
  DocumentInteractionOperationSpec,
  DocumentInteractionSpec,
  EditorAsset,
  EditorAssetDataSource,
  EditorDocument,
  EditorDocumentDiagnostic,
  EditorDocumentValidationOptions,
  EditorGroupObject,
  EditorImageContentFit,
  EditorImageObject,
  EditorLeafObject,
  EditorObject,
  EditorObjectBehavior,
  EditorObjectEffect,
  EditorObjectTrait,
  EditorPaint,
  EditorPathContent,
  EditorShapeContent,
  EditorRect,
  EditorSurface,
  JsonValue,
  PointMm,
  RectMm,
} from "./index";
import {
  isEditorBuiltinObjectEffect,
  isEditorExtensionObjectEffect,
  isEditorLeafObject,
  visitEditorDocumentObjects,
} from "./index";

export class EditorDocumentParseError extends Error {
  constructor(readonly diagnostics: EditorDocumentDiagnostic[]) {
    super(diagnostics[0]?.message ?? "EditorDocument is invalid.");
    this.name = "EditorDocumentParseError";
  }
}

class ParseFailure extends Error {
  constructor(readonly diagnostic: EditorDocumentDiagnostic) {
    super(diagnostic.message);
  }
}

export function parseEditorDocument(value: unknown): EditorDocument {
  try {
    const input = record(value, "document");
    exact(input, ["version", "assets", "extensions", "surfaces"], "document");
    if (input.version !== 8) {
      fail(
        "document-version-invalid",
        "EditorDocument version must be exactly 8.",
        "version",
      );
    }
    const document: EditorDocument = {
      version: 8,
      assets: array(input.assets, "assets").map(parseAsset),
      extensions: parseExtensions(input.extensions),
      surfaces: array(input.surfaces, "surfaces").map(parseSurface),
    };
    const diagnostics = validateDocumentReferences(document);
    if (diagnostics.length) throw new EditorDocumentParseError(diagnostics);
    return document;
  } catch (error) {
    if (error instanceof EditorDocumentParseError) throw error;
    if (error instanceof ParseFailure) {
      throw new EditorDocumentParseError([error.diagnostic]);
    }
    throw error;
  }
}

export function validateEditorDocument(
  value: unknown,
  options: EditorDocumentValidationOptions = {},
): EditorDocumentDiagnostic[] {
  let document: EditorDocument;
  try {
    document = parseEditorDocument(value);
  } catch (error) {
    return error instanceof EditorDocumentParseError
      ? error.diagnostics
      : [
          diagnostic(
            "document-parse-failed",
            error instanceof Error
              ? error.message
              : "EditorDocument parsing failed.",
            "document",
          ),
        ];
  }
  const diagnostics: EditorDocumentDiagnostic[] = [];
  const runValidators = (
    context: Omit<
      Parameters<NonNullable<typeof options.validators>[number]>[0],
      "addDiagnostic"
    >,
  ) => {
    options.validators?.forEach((validator) =>
      validator({
        ...context,
        addDiagnostic: (item) =>
          diagnostics.push({ ...item, stage: "document-schema" }),
      }),
    );
  };
  document.surfaces.forEach((surface, surfaceIndex) => {
    const surfacePath = `surfaces[${surfaceIndex}]`;
    runValidators({ document, surface, path: surfacePath });
  });
  visitEditorDocumentObjects(document, ({ surface, object, path }) => {
    runValidators({ document, surface, object, path });
    if (!isEditorLeafObject(object)) return;
    object.effects?.forEach((effect, index) => {
      if (!isEditorExtensionObjectEffect(effect)) return;
      runValidators({
        document,
        surface,
        object,
        effect,
        path: `${path}.effects[${index}]`,
      });
    });
  });
  return diagnostics;
}

function parseAsset(value: unknown, index: number): EditorAsset {
  const path = `assets[${index}]`;
  const input = record(value, path);
  exact(input, ["id", "type", "source", "mimeType", "intrinsicSize"], path);
  if (input.type !== "image") {
    fail("asset-type-invalid", 'Asset type must be "image".', `${path}.type`);
  }
  return {
    id: identifier(input.id, `${path}.id`),
    type: "image",
    source: parseAssetSource(input.source, `${path}.source`),
    ...(input.mimeType === undefined
      ? {}
      : { mimeType: identifier(input.mimeType, `${path}.mimeType`) }),
    ...(input.intrinsicSize === undefined
      ? {}
      : {
          intrinsicSize: parseSize(
            input.intrinsicSize,
            `${path}.intrinsicSize`,
          ),
        }),
  };
}

function parseAssetSource(value: unknown, path: string): EditorAssetDataSource {
  const input = record(value, path);
  if (input.kind === "url") {
    exact(input, ["kind", "url"], path);
    return { kind: "url", url: identifier(input.url, `${path}.url`) };
  }
  if (input.kind === "data-url") {
    exact(input, ["kind", "dataUrl"], path);
    return {
      kind: "data-url",
      dataUrl: identifier(input.dataUrl, `${path}.dataUrl`),
    };
  }
  fail(
    "asset-source-kind-invalid",
    "Asset source kind is invalid.",
    `${path}.kind`,
  );
}

function parseExtensions(value: unknown): Record<string, JsonValue> {
  const input = record(value, "extensions");
  return Object.fromEntries(
    Object.entries(input).map(([id, state]) => [
      identifier(id, `extensions.${id}`),
      json(state, `extensions.${id}`),
    ]),
  );
}

function parseSurface(value: unknown, index: number): EditorSurface {
  const path = `surfaces[${index}]`;
  const input = record(value, path);
  exact(input, ["id", "title", "geometry", "objects"], path);
  const geometry = record(input.geometry, `${path}.geometry`);
  exact(
    geometry,
    ["canvasBounds", "productionBounds", "exportBounds", "safeBounds"],
    `${path}.geometry`,
  );
  return {
    id: identifier(input.id, `${path}.id`),
    ...(input.title === undefined
      ? {}
      : { title: string(input.title, `${path}.title`) }),
    geometry: {
      canvasBounds: parseRect(
        geometry.canvasBounds,
        `${path}.geometry.canvasBounds`,
      ),
      productionBounds: parseRect(
        geometry.productionBounds,
        `${path}.geometry.productionBounds`,
      ),
      ...(geometry.exportBounds === undefined
        ? {}
        : {
            exportBounds: parseRect(
              geometry.exportBounds,
              `${path}.geometry.exportBounds`,
            ),
          }),
      ...(geometry.safeBounds === undefined
        ? {}
        : {
            safeBounds: parseRect(
              geometry.safeBounds,
              `${path}.geometry.safeBounds`,
            ),
          }),
    },
    objects: array(input.objects, `${path}.objects`).map(
      (object, objectIndex) =>
        parseObject(object, `${path}.objects[${objectIndex}]`),
    ),
  };
}

function parseObject(value: unknown, path: string): EditorObject {
  const input = record(value, path);
  const nodeFields = [
    "type",
    "id",
    "tags",
    "visible",
    "locked",
    "localToParent",
    "traits",
    "behaviors",
    "interaction",
  ];
  const base = {
    id: identifier(input.id, `${path}.id`),
    tags: parseTags(input.tags, `${path}.tags`),
    visible: boolean(input.visible, `${path}.visible`),
    locked: boolean(input.locked, `${path}.locked`),
    localToParent: parseAffineMatrix(
      input.localToParent,
      `${path}.localToParent`,
    ),
    ...(input.traits === undefined
      ? {}
      : {
          traits: array(input.traits, `${path}.traits`).map((trait, index) =>
            parseTrait(trait, `${path}.traits[${index}]`),
          ),
        }),
    ...(input.behaviors === undefined
      ? {}
      : {
          behaviors: array(input.behaviors, `${path}.behaviors`).map(
            (behavior, index) =>
              parseBehavior(behavior, `${path}.behaviors[${index}]`),
          ),
        }),
    ...(input.interaction === undefined
      ? {}
      : {
          interaction: parseInteraction(
            input.interaction,
            `${path}.interaction`,
          ),
        }),
  };
  if (input.type === "group") {
    exact(input, [...nodeFields, "children"], path);
    return {
      ...base,
      type: "group",
      children: array(input.children, `${path}.children`).map((child, index) =>
        parseObject(child, `${path}.children[${index}]`),
      ),
    } satisfies EditorGroupObject;
  }
  const leafFields = [
    ...nodeFields,
    "localFrame",
    "localPivot",
    "opacity",
    "effects",
  ];
  const leaf = {
    ...base,
    localFrame: parseRect(input.localFrame, `${path}.localFrame`),
    ...(input.localPivot === undefined
      ? {}
      : { localPivot: parsePoint(input.localPivot, `${path}.localPivot`) }),
    ...(input.opacity === undefined
      ? {}
      : { opacity: unitInterval(input.opacity, `${path}.opacity`) }),
    ...(input.effects === undefined
      ? {}
      : {
          effects: array(input.effects, `${path}.effects`).map(
            (effect, index) => parseEffect(effect, `${path}.effects[${index}]`),
          ),
        }),
  };
  if (input.type === "image") {
    exact(input, [...leafFields, "source", "contentFit"], path);
    return {
      ...leaf,
      type: "image",
      source: parseImageObjectSource(input.source, `${path}.source`),
      contentFit: parseImageContentFit(input.contentFit, `${path}.contentFit`),
    } satisfies EditorImageObject;
  }
  if (input.type !== "path" && input.type !== "shape") {
    fail("object-type-invalid", "Object type is invalid.", `${path}.type`);
  }
  exact(input, [...leafFields, "source", "paint"], path);
  return {
    ...leaf,
    type: input.type,
    source: parseInlineObjectSource(input.type, input.source, `${path}.source`),
    ...(input.paint === undefined
      ? {}
      : {
          paint: parsePaint(input.paint, `${path}.paint`),
        }),
  } as EditorLeafObject;
}

function parseAffineMatrix(value: unknown, path: string): AffineMatrix {
  const matrix = array(value, path);
  if (matrix.length !== 6) {
    fail(
      "affine-matrix-invalid",
      "Affine matrix must contain 6 numbers.",
      path,
    );
  }
  return matrix.map((entry, index) =>
    finite(entry, `${path}[${index}]`),
  ) as AffineMatrix;
}

function parseImageObjectSource(
  value: unknown,
  path: string,
): EditorImageObject["source"] {
  if (value === null) return null;
  const input = record(value, path);
  if (input.kind === "asset") {
    exact(input, ["kind", "assetId"], path);
    return {
      kind: "asset",
      assetId: identifier(input.assetId, `${path}.assetId`),
    };
  }
  fail(
    "object-source-kind-invalid",
    "Image source must be an asset reference or null.",
    path,
  );
}

function parseInlineObjectSource(
  type: "path" | "shape",
  value: unknown,
  path: string,
): EditorLeafObject["source"] {
  const input = record(value, path);
  exact(input, ["kind", "content"], path);
  if (input.kind !== "inline") {
    fail(
      "object-source-kind-invalid",
      'Primitive source kind must be "inline".',
      `${path}.kind`,
    );
  }
  const content = record(input.content, `${path}.content`);
  if (type === "path") {
    exact(
      content,
      ["pathData", "sourceBounds", "sourceSize"],
      `${path}.content`,
    );
    const parsed: EditorPathContent = {
      pathData: identifier(content.pathData, `${path}.content.pathData`),
      ...(content.sourceBounds === undefined
        ? {}
        : {
            sourceBounds: parseRect(
              content.sourceBounds,
              `${path}.content.sourceBounds`,
            ),
          }),
      ...(content.sourceSize === undefined
        ? {}
        : {
            sourceSize: parseSize(
              content.sourceSize,
              `${path}.content.sourceSize`,
            ),
          }),
    };
    return { kind: "inline", content: parsed };
  }
  if (type === "shape") {
    exact(content, ["shape", "params"], `${path}.content`);
    if (
      !["rect", "circle", "ellipse", "heart"].includes(content.shape as string)
    ) {
      fail(
        "shape-kind-invalid",
        "Shape kind is invalid.",
        `${path}.content.shape`,
      );
    }
    const shape = content.shape as EditorShapeContent["shape"];
    const paramsPath = `${path}.content.params`;
    const params = record(content.params, paramsPath);
    const parseOptionalNumber = (key: string) =>
      params[key] === undefined
        ? {}
        : { [key]: finite(params[key], `${paramsPath}.${key}`) };
    const parsed = (() => {
      if (shape === "rect" || shape === "heart") {
        exact(params, ["width", "height"], paramsPath);
        return {
          shape,
          params: {
            ...parseOptionalNumber("width"),
            ...parseOptionalNumber("height"),
          },
        };
      }
      if (shape === "circle") {
        exact(params, ["radius"], paramsPath);
        return {
          shape,
          params: { ...parseOptionalNumber("radius") },
        };
      }
      exact(params, ["rx", "ry", "width", "height"], paramsPath);
      return {
        shape: "ellipse" as const,
        params: {
          ...parseOptionalNumber("rx"),
          ...parseOptionalNumber("ry"),
          ...parseOptionalNumber("width"),
          ...parseOptionalNumber("height"),
        },
      };
    })() as EditorShapeContent;
    return { kind: "inline", content: parsed };
  }
  fail("object-type-invalid", "Object type is invalid.", `${path}.type`);
}

function parseImageContentFit(
  value: unknown,
  path: string,
): EditorImageContentFit {
  const input = record(value, path);
  exact(input, ["fit", "anchorX", "anchorY", "zoom", "rotation", "clip"], path);
  if (!["cover", "contain", "stretch"].includes(input.fit as string)) {
    fail("image-fit-invalid", "Image fit is invalid.", `${path}.fit`);
  }
  return {
    fit: input.fit as EditorImageContentFit["fit"],
    anchorX: unitInterval(input.anchorX, `${path}.anchorX`),
    anchorY: unitInterval(input.anchorY, `${path}.anchorY`),
    zoom: positive(input.zoom, `${path}.zoom`),
    rotation: finite(input.rotation, `${path}.rotation`),
    clip: parseClip(input.clip, `${path}.clip`),
  };
}

function parsePaint(value: unknown, path: string): EditorPaint {
  const input = record(value, path);
  exact(input, ["fill", "stroke", "strokeWidthMm", "dashMm"], path);
  const color = (entry: unknown, entryPath: string) =>
    entry === null ? null : string(entry, entryPath);
  return {
    ...(input.fill === undefined
      ? {}
      : { fill: color(input.fill, `${path}.fill`) }),
    ...(input.stroke === undefined
      ? {}
      : { stroke: color(input.stroke, `${path}.stroke`) }),
    ...(input.strokeWidthMm === undefined
      ? {}
      : {
          strokeWidthMm: finite(input.strokeWidthMm, `${path}.strokeWidthMm`),
        }),
    ...(input.dashMm === undefined
      ? {}
      : {
          dashMm: array(input.dashMm, `${path}.dashMm`).map((entry, index) =>
            finite(entry, `${path}.dashMm[${index}]`),
          ),
        }),
  };
}

function parseTrait(value: unknown, path: string): EditorObjectTrait {
  const input = record(value, path);
  const type = identifier(input.type, `${path}.type`);
  if (type === "core.guide") {
    exact(input, ["type"], path);
    return { type };
  }
  if (type === "core.output-mask") {
    exact(input, ["type", "keys"], path);
    return { type, keys: identifiers(input.keys, `${path}.keys`) };
  }
  exact(input, ["type", "payload"], path);
  return {
    type,
    ...(input.payload === undefined
      ? {}
      : { payload: json(input.payload, `${path}.payload`) }),
  };
}

function parseEffect(value: unknown, path: string): EditorObjectEffect {
  const input = record(value, path);
  const type = identifier(input.type, `${path}.type`);
  if (type === "core.geometry.clip") {
    exact(input, ["type", "sourceObjectId", "participation"], path);
    return {
      type,
      sourceObjectId: identifier(
        input.sourceObjectId,
        `${path}.sourceObjectId`,
      ),
      ...parseParticipation(input.participation, `${path}.participation`),
    };
  }
  if (type === "core.geometry.boolean") {
    exact(
      input,
      ["type", "operandObjectId", "operation", "participation"],
      path,
    );
    if (
      !["add", "subtract", "intersect", "exclude"].includes(
        input.operation as string,
      )
    ) {
      fail(
        "boolean-operation-invalid",
        "Boolean operation is invalid.",
        `${path}.operation`,
      );
    }
    return {
      type,
      operandObjectId: identifier(
        input.operandObjectId,
        `${path}.operandObjectId`,
      ),
      operation: input.operation as
        | "add"
        | "subtract"
        | "intersect"
        | "exclude",
      ...parseParticipation(input.participation, `${path}.participation`),
    };
  }
  exact(input, ["type", "payload"], path);
  return {
    type,
    ...(input.payload === undefined
      ? {}
      : { payload: json(input.payload, `${path}.payload`) }),
  };
}

function parseParticipation(value: unknown, path: string) {
  if (value === undefined) return {};
  if (value !== "preview" && value !== "export" && value !== "both") {
    fail(
      "effect-participation-invalid",
      "Effect participation is invalid.",
      path,
    );
  }
  return { participation: value } as const;
}

function parseBehavior(value: unknown, path: string): EditorObjectBehavior {
  const input = record(value, path);
  exact(input, ["type", "config"], path);
  return {
    type: identifier(input.type, `${path}.type`),
    ...(input.config === undefined
      ? {}
      : { config: json(input.config, `${path}.config`) }),
  };
}

function parseInteraction(
  value: unknown,
  path: string,
): DocumentInteractionSpec {
  const input = record(value, path);
  exact(input, ["selection", "manipulation"], path);
  const interaction: DocumentInteractionSpec = {};
  if (input.selection !== undefined) {
    const selection = record(input.selection, `${path}.selection`);
    exact(selection, ["enabled"], `${path}.selection`);
    interaction.selection = {
      enabled: boolean(selection.enabled, `${path}.selection.enabled`),
    };
  }
  if (input.manipulation !== undefined) {
    const manipulation = record(input.manipulation, `${path}.manipulation`);
    exact(manipulation, ["move", "resize", "rotate"], `${path}.manipulation`);
    interaction.manipulation = Object.fromEntries(
      (["move", "resize", "rotate"] as const).flatMap((operation) =>
        manipulation[operation] === undefined
          ? []
          : [
              [
                operation,
                parseInteractionOperation(
                  manipulation[operation],
                  `${path}.manipulation.${operation}`,
                ),
              ],
            ],
      ),
    );
  }
  return interaction;
}

function parseInteractionOperation(
  value: unknown,
  path: string,
): DocumentInteractionOperationSpec {
  const input = record(value, path);
  exact(input, ["enabled", "constraints"], path);
  return {
    enabled: boolean(input.enabled, `${path}.enabled`),
    ...(input.constraints === undefined
      ? {}
      : {
          constraints: array(input.constraints, `${path}.constraints`).map(
            (constraint, index) =>
              parseInteractionConstraint(
                constraint,
                `${path}.constraints[${index}]`,
              ),
          ),
        }),
  };
}

function parseInteractionConstraint(
  value: unknown,
  path: string,
): DocumentInteractionConstraintSpec {
  const input = record(value, path);
  exact(input, ["spec"], path);
  return { spec: parseConstraint(input.spec, `${path}.spec`) };
}

function parseConstraint(value: unknown, path: string): DocumentConstraintSpec {
  const input = record(value, path);
  exact(input, ["type", "source", "mode", "params", "application"], path);
  return {
    type: identifier(input.type, `${path}.type`),
    ...(input.source === undefined
      ? {}
      : { source: parseGeometryRef(input.source, `${path}.source`) }),
    ...(input.mode === undefined
      ? {}
      : { mode: string(input.mode, `${path}.mode`) }),
    ...(input.params === undefined
      ? {}
      : { params: jsonRecord(input.params, `${path}.params`) }),
    ...(input.application === undefined
      ? {}
      : {
          application: parseConstraintApplication(
            input.application,
            `${path}.application`,
          ),
        }),
  };
}

function parseGeometryRef(value: unknown, path: string) {
  const input = record(value, path);
  exact(input, ["sourceId", "geometryId", "variant"], path);
  return {
    sourceId: identifier(input.sourceId, `${path}.sourceId`),
    geometryId: identifier(input.geometryId, `${path}.geometryId`),
    ...(input.variant === undefined
      ? {}
      : { variant: identifier(input.variant, `${path}.variant`) }),
  };
}

function parseConstraintApplication(value: unknown, path: string) {
  const input = record(value, path);
  exact(input, ["preview", "commit"], path);
  const mode = (entry: unknown, entryPath: string) => {
    if (entry !== "evaluate" && entry !== "apply") {
      fail(
        "constraint-application-invalid",
        "Constraint application mode is invalid.",
        entryPath,
      );
    }
    return entry as DocumentConstraintApplicationMode;
  };
  return {
    ...(input.preview === undefined
      ? {}
      : { preview: mode(input.preview, `${path}.preview`) }),
    ...(input.commit === undefined
      ? {}
      : { commit: mode(input.commit, `${path}.commit`) }),
  };
}

function validateDocumentReferences(
  document: EditorDocument,
): EditorDocumentDiagnostic[] {
  const diagnostics: EditorDocumentDiagnostic[] = [];
  const allIds = new Map<string, string>();
  const addId = (id: string, path: string) => {
    const previous = allIds.get(id);
    if (previous) {
      diagnostics.push(
        diagnostic(
          "document-id-duplicate",
          `ID "${id}" is already used at "${previous}".`,
          path,
        ),
      );
    } else allIds.set(id, path);
  };
  document.assets.forEach((asset, index) =>
    addId(asset.id, `assets[${index}].id`),
  );
  document.surfaces.forEach((surface, surfaceIndex) => {
    addId(surface.id, `surfaces[${surfaceIndex}].id`);
  });
  const objects = new Map<
    string,
    { object: EditorObject; surfaceId: string; path: string }
  >();
  visitEditorDocumentObjects(document, ({ object, surface, path }) => {
    addId(object.id, `${path}.id`);
    objects.set(object.id, { object, surfaceId: surface.id, path });
  });
  const assetIds = new Set(document.assets.map((asset) => asset.id));
  const dependencies = new Map<string, Set<string>>();
  visitEditorDocumentObjects(document, ({ object, surface, path }) => {
    const imageSource = object.type === "image" ? object.source : null;
    if (imageSource && !assetIds.has(imageSource.assetId)) {
      diagnostics.push(
        diagnostic(
          "image-asset-missing",
          `Image asset "${imageSource.assetId}" does not exist.`,
          `${path}.source.assetId`,
        ),
      );
    }
    if (!isEditorLeafObject(object)) return;
    object.effects?.forEach((effect, index) => {
      if (!isEditorBuiltinObjectEffect(effect)) return;
      const isClip = effect.type === "core.geometry.clip";
      const field = isClip ? "sourceObjectId" : "operandObjectId";
      const targetId = isClip ? effect.sourceObjectId : effect.operandObjectId;
      const target = objects.get(targetId);
      const effectPath = `${path}.effects[${index}].${field}`;
      if (!target) {
        diagnostics.push(
          diagnostic(
            "object-effect-target-missing",
            `Object "${object.id}" references missing object "${targetId}".`,
            effectPath,
          ),
        );
        return;
      }
      if (target.surfaceId !== surface.id) {
        diagnostics.push(
          diagnostic(
            "object-effect-cross-surface",
            `Object "${object.id}" references another surface.`,
            effectPath,
          ),
        );
        return;
      }
      const targets = dependencies.get(object.id) ?? new Set<string>();
      targets.add(targetId);
      dependencies.set(object.id, targets);
    });
  });
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) {
      diagnostics.push(
        diagnostic(
          "object-effect-dependency-cycle",
          `Object effect dependency cycle includes "${id}".`,
          objects.get(id)?.path ?? "surfaces",
        ),
      );
      return;
    }
    if (visited.has(id)) return;
    active.add(id);
    dependencies.get(id)?.forEach(visit);
    active.delete(id);
    visited.add(id);
  };
  objects.forEach((_value, id) => visit(id));
  return diagnostics;
}

function parseRect(value: unknown, path: string): RectMm {
  const input = record(value, path);
  exact(input, ["x", "y", "width", "height"], path);
  return {
    x: finite(input.x, `${path}.x`),
    y: finite(input.y, `${path}.y`),
    width: finite(input.width, `${path}.width`),
    height: finite(input.height, `${path}.height`),
  };
}

function parsePoint(value: unknown, path: string): PointMm {
  const input = record(value, path);
  exact(input, ["x", "y"], path);
  return { x: finite(input.x, `${path}.x`), y: finite(input.y, `${path}.y`) };
}

function parseSize(value: unknown, path: string) {
  const input = record(value, path);
  exact(input, ["width", "height"], path);
  return {
    width: finite(input.width, `${path}.width`),
    height: finite(input.height, `${path}.height`),
  };
}

function identifiers(value: unknown, path: string): string[] {
  return array(value, path).map((entry, index) =>
    identifier(entry, `${path}[${index}]`),
  );
}

function parseTags(value: unknown, path: string): string[] {
  const result = identifiers(value, path);
  const invalidIndex = result.findIndex((tag) => !tag.includes(":"));
  if (invalidIndex >= 0) {
    fail(
      "object-tag-namespace-required",
      "Object tags must use a namespace followed by a colon.",
      `${path}[${invalidIndex}]`,
    );
  }
  return result;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("object-required", "Expected an object.", path);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail("array-required", "Expected an array.", path);
  return value;
}

function identifier(value: unknown, path: string): string {
  const result = string(value, path);
  if (!result || result !== result.trim()) {
    fail(
      "identifier-invalid",
      "Expected a non-empty, already-trimmed string.",
      path,
    );
  }
  return result;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string")
    fail("string-required", "Expected a string.", path);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean")
    fail("boolean-required", "Expected a boolean.", path);
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("finite-number-required", "Expected a finite number.", path);
  }
  return value;
}

function positive(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result <= 0) {
    fail("positive-number-required", "Expected a number greater than 0.", path);
  }
  return result;
}

function unitInterval(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result < 0 || result > 1) {
    fail("unit-interval-required", "Expected a number in [0, 1].", path);
  }
  return result;
}

function parseClip(value: unknown, path: string): "frame" | "none" {
  if (value !== "frame" && value !== "none") {
    fail("image-clip-invalid", "Image clip is invalid.", path);
  }
  return value;
}

function jsonRecord(value: unknown, path: string): Record<string, JsonValue> {
  const parsed = json(value, path);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("json-object-required", "Expected a JSON object.", path);
  }
  return parsed as Record<string, JsonValue>;
}

function json(value: unknown, path: string): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") return finite(value, path);
  if (Array.isArray(value))
    return value.map((entry, index) => json(entry, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        json(entry, `${path}.${key}`),
      ]),
    );
  }
  fail("json-value-invalid", "Expected a JSON value.", path);
}

function exact(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) {
    fail(
      "unknown-field",
      `Field "${unknown}" is not allowed in EditorDocument v8.`,
      `${path}.${unknown}`,
    );
  }
}

function fail(code: string, message: string, path: string): never {
  throw new ParseFailure(diagnostic(code, message, path));
}

function diagnostic(
  code: string,
  message: string,
  path: string,
): EditorDocumentDiagnostic {
  return { severity: "error", stage: "document-schema", code, message, path };
}
