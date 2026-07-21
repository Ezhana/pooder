import {
  RENDER_INTENT_COMPILER_REGISTRY_SERVICE,
  RENDER_INTENT_SERVICE,
  SURFACE_FRAME_SERVICE,
  IMAGE_RESOURCE_SERVICE,
  IMAGE_GEOMETRY_DATA_KEY,
  resolveImageGeometry,
  mergeRenderIntentPatchEntries,
  type GeometryPoint,
  type GeometryRect,
  type ImageResourceResolution,
  type ImageResourceService,
  type RenderIntentCompilerRegistryService,
  type RenderIntentDiagnostic,
  type RenderIntentDraft,
  type RenderIntentPatch,
  type RenderIntentPatchEntry,
  type RenderIntentService,
  type Service,
  type ServiceIdentifier,
  type SurfaceFrameService,
} from "@pooder/core";
import {
  EffectSchemaRegistry,
  cloneEditorDocument,
  collectEditorDocumentCapabilityRequirements,
  findEditorDocumentObject,
  isGenericEditorEffect,
  normalizeEditorDocument,
  validateEditorDocument,
  validateEditorDocumentEffectSchemas,
  type EditorDocument,
  type EditorDocumentCapabilityCollectionOptions,
  type EditorDocumentDiagnostic,
  type EditorDocumentEffectCapabilityResolver,
  type EditorDocumentValidationOptions,
  type DocumentInteractionSpec,
  type EditorEffect,
  type EditorLayer,
  type EditorImageObject,
  type EditorImageResource,
  type EditorObject,
  type EditorObjectEffect,
  type EditorSurface,
  type ObjectSource,
} from "@pooder/document";

export interface ObjectSize {
  width: number;
  height: number;
}

export interface ObjectRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResolvedVisual {
  source: ObjectSource;
  pathData?: string;
  imageUrl?: string;
  text?: string;
  bounds?: GeometryRect;
  contentBounds?: GeometryRect;
  intrinsicSize?: ObjectSize;
  mimeType?: string;
}

export interface GeometryResolver {
  resolve(source: ObjectSource): ResolvedVisual | null;
  hitTest(source: ObjectSource, point: GeometryPoint): boolean;
}

export class DefaultGeometryResolver implements GeometryResolver {
  resolve(source: ObjectSource): ResolvedVisual | null {
    if (source.kind === "path") {
      const pathData = source.pathData.trim();
      if (!pathData) return null;
      const contentBounds =
        rectToBounds(source.sourceBounds) ??
        inferPathBounds(pathData) ??
        undefined;
      return {
        source,
        pathData,
        bounds: source.sourceSize
          ? sizeToBounds(source.sourceSize)
          : contentBounds,
        contentBounds,
        intrinsicSize: source.sourceSize,
      };
    }

    if (source.kind !== "shape") return null;
    const resolved = resolveShapeSource(source);
    return resolved ? { source, ...resolved } : null;
  }

  hitTest(source: ObjectSource, point: GeometryPoint): boolean {
    const visual = this.resolve(source);
    if (!visual?.bounds) return false;
    return containsPoint(visual.bounds, point);
  }
}

export class SourceResolver {
  constructor(
    private readonly geometryResolver: GeometryResolver = new DefaultGeometryResolver(),
  ) {}

  resolve(source: ObjectSource): ResolvedVisual | null {
    switch (source.kind) {
      case "image": {
        const resource = source.resource;
        if (!resource?.intrinsicSize) return null;
        const imageUrl =
          resource.kind === "data-url" ? resource.dataUrl : resource.url;
        return {
          source,
          imageUrl,
          mimeType:
            resource.kind === "blob-url" ? undefined : resource.mimeType,
          intrinsicSize: resource.intrinsicSize,
          bounds: sizeToBounds(resource.intrinsicSize),
        };
      }
      case "path":
      case "shape":
        return this.geometryResolver.resolve(source);
      case "text":
        return {
          source,
          text: source.text,
        };
      default:
        return null;
    }
  }
}

export function resolveObjectSource(
  source: ObjectSource,
): ResolvedVisual | null {
  return new SourceResolver().resolve(source);
}

export interface EditorDocumentRuntime {
  readonly config?: {
    export(): Record<string, unknown>;
    get<T = unknown>(key: string, defaultValue?: T): T;
    import(data: Record<string, unknown>): void;
    update(key: string, value: unknown): void;
  };
  readonly services: {
    get?<T extends Service>(identifier: ServiceIdentifier<T>): T | undefined;
    getOrThrow<T extends Service>(
      identifier: ServiceIdentifier<T>,
      errorMessage?: string,
    ): T;
  };
  readonly capabilities: {
    has(id: string): boolean;
    get<T = unknown>(id: string): T | undefined;
  };
}

export interface ApplyEditorDocumentOptions {
  effectSchemaRegistry?: EffectSchemaRegistry;
  resolveEffectCapabilityId?: EditorDocumentEffectCapabilityResolver;
  validators?: EditorDocumentValidationOptions["validators"];
  afterApply?: (
    runtime: EditorDocumentRuntime,
    document: EditorDocument,
  ) => Promise<void> | void;
}

export interface ApplyEditorDocumentResult {
  ok: boolean;
  document: EditorDocument;
  diagnostics: EditorDocumentDiagnostic[];
  views: NonNullable<EditorDocument["views"]>;
  appliedSurfaceIds: string[];
}

export interface EditorDocumentController {
  apply(value: unknown): Promise<ApplyEditorDocumentResult>;
  export(): EditorDocument | null;
  updateObject(
    objectId: string,
    update: (current: Readonly<EditorObject>) => EditorObject,
  ): Promise<DocumentUpdateResult>;
}

export type DocumentUpdateResult =
  | { ok: true; document: EditorDocument }
  | { ok: false; reason: "object-not-found" }
  | {
      ok: false;
      reason: "validation-failed";
      diagnostics: EditorDocumentDiagnostic[];
    };

interface EffectContext {
  surface: EditorSurface;
  layer?: EditorLayer;
  object?: EditorObject;
}

interface EffectEntry {
  effect: EditorEffect;
  context: EffectContext;
  path: string;
}

const EFFECT_PHASE_ORDER = {
  document: 0,
  layout: 1,
  render: 2,
  interaction: 3,
  export: 4,
} as const;

export async function applyEditorDocument(
  runtime: EditorDocumentRuntime,
  value: unknown,
  options: ApplyEditorDocumentOptions = {},
): Promise<ApplyEditorDocumentResult> {
  return applyEditorDocumentInternal(runtime, value, options, "replace");
}

async function applyEditorDocumentInternal(
  runtime: EditorDocumentRuntime,
  value: unknown,
  options: ApplyEditorDocumentOptions,
  renderIntentMode: "replace" | "update",
): Promise<ApplyEditorDocumentResult> {
  const validationOptions = toValidationOptions(options);
  const collectionOptions = toCollectionOptions(options);
  const document = normalizeEditorDocument(value);
  const documentSchemaDiagnostics = validateEditorDocument(
    value,
    validationOptions,
  );
  if (hasErrors(documentSchemaDiagnostics)) {
    return createResult(false, document, documentSchemaDiagnostics, []);
  }
  const effectSchemaDiagnostics = validateEditorDocumentEffectSchemas(
    value,
    options.effectSchemaRegistry ?? new EffectSchemaRegistry(),
  );
  const diagnostics = [
    ...documentSchemaDiagnostics,
    ...effectSchemaDiagnostics,
  ];
  if (hasErrors(effectSchemaDiagnostics)) {
    return createResult(false, document, diagnostics, []);
  }

  const capabilityResult = collectEditorDocumentCapabilityRequirements(
    document,
    {
      ...collectionOptions,
      availableCapabilityIds: collectAvailableCapabilityIds(
        runtime,
        document,
        collectionOptions,
      ),
    },
  );
  const allDiagnostics = [...diagnostics, ...capabilityResult.diagnostics];
  if (hasErrors(allDiagnostics)) {
    return createResult(false, document, allDiagnostics, []);
  }

  if (!runtime.config) {
    return createResult(
      false,
      document,
      [
        ...allDiagnostics,
        {
          severity: "error",
          stage: "runtime-capability",
          code: "runtime-config-required",
          message:
            "ConfigurationService runtime facade is required to apply an EditorDocument.",
          path: "config",
        },
      ],
      [],
    );
  }
  runtime.config.import(document.config);
  runtime.services
    .getOrThrow<SurfaceFrameService>(
      SURFACE_FRAME_SERVICE,
      "SurfaceFrameService is required to apply an EditorDocument.",
    )
    .importFrames(
      Object.fromEntries(
        document.surfaces.map((surface) => [surface.id, surface.frames]),
      ),
    );

  const renderIntentService = runtime.services.getOrThrow<RenderIntentService>(
    RENDER_INTENT_SERVICE,
    "RenderIntentService is required to apply an EditorDocument.",
  );
  const compilerRegistry =
    runtime.services.getOrThrow<RenderIntentCompilerRegistryService>(
      RENDER_INTENT_COMPILER_REGISTRY_SERVICE,
      "RenderIntentCompilerRegistryService is required to apply an EditorDocument.",
    );
  const resolvedImages = await resolveDocumentImageResources(runtime, document);
  const intentDrafts = createBaseRenderIntentDrafts(document, resolvedImages);
  const effectEntries =
    collectEffectEntries(document).sort(compareEffectEntries);
  const patchEntries: RenderIntentPatchEntry[] = [];
  let patchSequence = 0;

  for (const entry of effectEntries) {
    if (entry.effect.require === "ignore") continue;
    const capabilityId = resolveEffectCapabilityId(entry.effect, options);
    if (!capabilityId || !runtime.capabilities.has(capabilityId)) continue;

    const patches = await compileRenderIntentPatches(
      compilerRegistry,
      document,
      capabilityId,
      entry,
      runtime,
      allDiagnostics,
    );
    patchEntries.push(
      ...patches.map((patch) => ({
        sourceId: `capability:${capabilityId}`,
        patch,
        priority: 0,
        phase: entry.effect.phase ?? "layout",
        sequence: patchSequence++,
        reason: entry.effect.type,
        debugLabel: entry.path,
      })),
    );
  }

  const mergeResult = mergeRenderIntentPatchEntries(intentDrafts, patchEntries);
  mergeResult.diagnostics.forEach((diagnostic) => {
    allDiagnostics.push(createRenderIntentDiagnostic(diagnostic));
  });

  if (hasErrors(allDiagnostics)) {
    return createResult(false, document, allDiagnostics, []);
  }

  if (renderIntentMode === "update") {
    renderIntentService.updateDocumentIntents(mergeResult.drafts);
  } else {
    renderIntentService.setDocumentIntents(mergeResult.drafts);
  }
  await options.afterApply?.(runtime, document);

  return createResult(
    true,
    document,
    allDiagnostics,
    collectAppliedSurfaceIds(mergeResult.drafts),
  );
}

export function createEditorDocumentController(
  runtime: EditorDocumentRuntime,
  options: ApplyEditorDocumentOptions = {},
): EditorDocumentController {
  let currentDocument: EditorDocument | null = null;

  return {
    async apply(value) {
      const result = await applyEditorDocument(runtime, value, options);
      if (result.ok) {
        currentDocument = cloneEditorDocument(result.document);
      }
      return result;
    },
    export() {
      return currentDocument ? cloneEditorDocument(currentDocument) : null;
    },
    async updateObject(objectId, update) {
      const id = normalizeObjectId(objectId);
      if (!id || !currentDocument)
        return { ok: false, reason: "object-not-found" };

      const nextDocument = cloneEditorDocument(currentDocument);
      nextDocument.config = runtime.config?.export() ?? nextDocument.config;
      const object = findEditorDocumentObject(nextDocument, id);
      if (!object) return { ok: false, reason: "object-not-found" };
      let updated: EditorObject;
      try {
        updated = update(cloneDocumentObject(object));
      } catch {
        return { ok: false, reason: "validation-failed", diagnostics: [] };
      }
      replaceSourceObject(nextDocument, id, cloneDocumentObject(updated));
      const result = await applyEditorDocumentInternal(
        runtime,
        nextDocument,
        options,
        "update",
      );
      if (!result.ok) {
        return {
          ok: false,
          reason: "validation-failed",
          diagnostics: result.diagnostics,
        };
      }

      currentDocument = cloneEditorDocument(result.document);
      return { ok: true, document: cloneEditorDocument(currentDocument) };
    },
  };
}

function toValidationOptions(
  options: ApplyEditorDocumentOptions,
): EditorDocumentValidationOptions {
  return {
    validators: options.validators,
  };
}

function toCollectionOptions(
  options: ApplyEditorDocumentOptions,
): EditorDocumentCapabilityCollectionOptions {
  return {
    resolveEffectCapabilityId: (effect) =>
      options.resolveEffectCapabilityId?.(effect) ||
      options.effectSchemaRegistry?.resolveCapabilityId(effect.type),
  };
}

function resolveEffectCapabilityId(
  effect: EditorEffect,
  options: ApplyEditorDocumentOptions,
): string | undefined {
  return (
    effect.capabilityId ||
    options.resolveEffectCapabilityId?.(effect) ||
    options.effectSchemaRegistry?.resolveCapabilityId(effect.type)
  );
}

function normalizeObjectId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cloneDocumentObject(object: EditorObject): EditorObject {
  return JSON.parse(JSON.stringify(object)) as EditorObject;
}

function replaceSourceObject(
  document: EditorDocument,
  objectId: string,
  next: EditorObject,
): void {
  for (const surface of document.surfaces) {
    for (const layer of surface.layers) {
      const index =
        layer.objects?.findIndex((object) => object.id === objectId) ?? -1;
      if (index >= 0 && layer.objects) {
        layer.objects[index] = next;
        return;
      }
    }
  }
}

function cloneObjectEffects(
  effects: EditorObjectEffect[] | undefined,
): EditorObjectEffect[] | undefined {
  return effects?.length
    ? (JSON.parse(JSON.stringify(effects)) as EditorObjectEffect[])
    : undefined;
}

function createScaledPathTransform(
  object: EditorObject,
  bounds:
    | { left: number; top: number; width: number; height: number }
    | undefined,
  contentBounds:
    | { left: number; top: number; width: number; height: number }
    | undefined,
) {
  const transform = { ...(object.transform ?? {}) };
  const frame = object.frame;
  if (!frame || !bounds || bounds.width <= 0 || bounds.height <= 0) {
    return transform;
  }

  const pathBounds = contentBounds ?? bounds;
  const sourceScaleX = frame.width / bounds.width;
  const sourceScaleY = frame.height / bounds.height;
  const baseScaleX = Number(transform.scaleX);
  const baseScaleY = Number(transform.scaleY);
  return {
    ...transform,
    left: Number.isFinite(Number(transform.left))
      ? transform.left
      : frame.x + (pathBounds.left - bounds.left) * sourceScaleX,
    top: Number.isFinite(Number(transform.top))
      ? transform.top
      : frame.y + (pathBounds.top - bounds.top) * sourceScaleY,
    scaleX: (Number.isFinite(baseScaleX) ? baseScaleX : 1) * sourceScaleX,
    scaleY: (Number.isFinite(baseScaleY) ? baseScaleY : 1) * sourceScaleY,
  };
}

function createResult(
  ok: boolean,
  document: EditorDocument,
  diagnostics: EditorDocumentDiagnostic[],
  appliedSurfaceIds: string[],
): ApplyEditorDocumentResult {
  return {
    ok,
    document,
    diagnostics,
    views: document.views ?? [],
    appliedSurfaceIds,
  };
}

function hasErrors(diagnostics: EditorDocumentDiagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error");
}

function collectAvailableCapabilityIds(
  runtime: EditorDocumentRuntime,
  document: EditorDocument,
  options: EditorDocumentCapabilityCollectionOptions,
): string[] {
  const result = collectEditorDocumentCapabilityRequirements(document, options);
  return Array.from(
    new Set(
      result.requirements
        .map((item) => item.capabilityId)
        .filter((id) => runtime.capabilities.has(id)),
    ),
  );
}

function createBaseRenderIntentDrafts(
  document: EditorDocument,
  resolvedImages: ReadonlyMap<string, ImageResourceResolution>,
): RenderIntentDraft[] {
  const drafts: RenderIntentDraft[] = [];
  document.surfaces.forEach((surface) => {
    surface.layers.forEach((layer) => {
      layer.objects?.forEach((object, index) => {
        const draft = createObjectRenderIntentDraft(
          surface,
          layer,
          object,
          index,
          resolvedImages.get(object.id),
        );
        if (draft) drafts.push(draft);
      });
    });
  });
  return drafts;
}

function createObjectRenderIntentDraft(
  surface: EditorSurface,
  layer: EditorLayer,
  object: EditorObject,
  index: number,
  imageResolution?: ImageResourceResolution,
): RenderIntentDraft | null {
  if (!object.frame) return null;
  const objectOrder = object.order ?? index;
  const layerOrder = layer.order ?? 0;
  const locked = object.locked === true || layer.locked === true;
  const interaction = createObjectInteractionAspect(object);
  const objectEffects = cloneObjectEffects(object.effects);
  const outputMaskKeys = normalizeOutputMaskKeys(
    object.metadata?.outputMaskKeys ?? object.metadata?.outputMaskKey,
  );
  const tags = normalizeTags(layer.tags, object.tags);
  const base = {
    id: object.id,
    subject: {
      kind: "object" as const,
      surfaceId: surface.id,
      layerId: layer.id,
      objectId: object.id,
      objectType: object.source.kind,
    },
    placement: {
      frame: object.frame,
      transform: normalizeRenderIntentTransform(object),
      width: object.frame.width,
      height: object.frame.height,
    },
    ordering: {
      layerId: layer.id,
      layerOrder,
      objectOrder,
      channel: "normal" as const,
      subOrder: 0,
      stack: resolveLayerStack(layer),
    },
    export: {
      visible: (layer.visible ?? true) && (object.visible ?? true),
      tags,
    },
    ...(interaction ? { interaction } : {}),
    props: {
      ...(object.style ?? {}),
      ...(object.transform ?? {}),
    },
    data: {
      id: object.id,
      layerId: layer.id,
      documentSurfaceId: surface.id,
      documentObjectSourceKind: object.source.kind,
      documentLayerRole: layer.role,
      ...(objectEffects ? { documentObjectEffects: objectEffects } : {}),
      ...(typeof locked === "boolean" ? { locked } : {}),
      ...(outputMaskKeys.length ? { outputMaskKeys } : {}),
    },
  } satisfies Omit<RenderIntentDraft, "visual">;

  if (object.source.kind === "image") {
    return createImageRenderIntentDraft(
      base,
      object as EditorImageObject,
      imageResolution,
      resolveEditorImageClipFrame(surface, object as EditorImageObject),
    );
  }
  const visual = resolveObjectSource(object.source);
  if (!visual) return null;
  if (visual.imageUrl) {
    return {
      ...base,
      visual: {
        type: "image",
        src: visual.imageUrl,
      },
      props: {
        ...base.props,
        source: object.source,
      },
    };
  }
  if (visual.pathData) {
    return {
      ...base,
      placement: {
        ...base.placement,
        transform: createScaledPathTransform(
          object,
          visual.bounds,
          visual.contentBounds,
        ),
      },
      visual: { type: "path" },
      props: {
        ...base.props,
        path: visual.pathData,
        pathData: visual.pathData,
        source: object.source,
      },
    };
  }
  if (visual.text !== undefined) {
    return {
      ...base,
      visual: { type: "text" },
      props: { ...base.props, text: visual.text, source: object.source },
    };
  }
  return null;
}

function createImageRenderIntentDraft(
  base: Omit<RenderIntentDraft, "visual">,
  object: EditorImageObject,
  resolution?: ImageResourceResolution,
  clipFrame?: { left: number; top: number; width: number; height: number },
): RenderIntentDraft {
  const resource = object.source.resource;
  const resolved = resolution?.ok
    ? resolution
    : resource?.intrinsicSize
      ? {
          ok: true as const,
          src: resource.kind === "data-url" ? resource.dataUrl : resource.url,
          width: resource.intrinsicSize.width,
          height: resource.intrinsicSize.height,
        }
      : undefined;
  const presentationResource = object.slot?.emptyPresentation?.resource;
  const presentation =
    !resource && presentationResource?.intrinsicSize
      ? {
          src:
            presentationResource.kind === "data-url"
              ? presentationResource.dataUrl
              : presentationResource.url,
          width: presentationResource.intrinsicSize.width,
          height: presentationResource.intrinsicSize.height,
          fit: object.slot?.emptyPresentation?.fit ?? "cover",
        }
      : undefined;
  const image = resolved ?? presentation;
  const fit = resolved
    ? object.placement.fit
    : (presentation?.fit ?? object.placement.fit);
  const geometryDescriptor = image
    ? {
        source: {
          src: image.src,
          size: { width: image.width, height: image.height },
        },
        frame: {
          left: object.frame.x,
          top: object.frame.y,
          width: object.frame.width,
          height: object.frame.height,
        },
        fit,
        transform: object.placement,
        ...(object.placement.clip === "frame" && clipFrame
          ? { clip: clipFrame }
          : {}),
      }
    : undefined;
  const geometry = geometryDescriptor
    ? resolveImageGeometry(geometryDescriptor)
    : undefined;
  return {
    ...base,
    visual: { type: "image", ...(image ? { src: image.src } : {}) },
    export: { ...base.export },
    effects: geometry?.clip
      ? [
          ...(base.effects ?? []),
          createEditorImageClipEffect(object.id, geometry.clip),
        ]
      : base.effects,
    placement: {
      ...base.placement,
      ...(geometry
        ? {
            width: geometry.width,
            height: geometry.height,
            transform: {
              left: geometry.left,
              top: geometry.top,
              scaleX: geometry.scaleX,
              scaleY: geometry.scaleY,
              angle: geometry.angle,
              originX: geometry.originX,
              originY: geometry.originY,
            },
          }
        : {}),
    },
    props: {
      ...base.props,
      source: object.source,
      opacity: geometry?.opacity ?? object.placement.opacity,
      ...(geometry?.clip ? { clip: geometry.clip } : {}),
      ...(presentation ? { excludeFromExport: true } : {}),
    },
    data: {
      ...base.data,
      emptyImageSlot: !resource,
      presentationOnly: Boolean(presentation),
      ...(resolved && geometryDescriptor
        ? { [IMAGE_GEOMETRY_DATA_KEY]: geometryDescriptor }
        : {}),
    },
  };
}

function resolveEditorImageClipFrame(
  surface: EditorSurface,
  object: EditorImageObject,
) {
  const objectFrame = {
    left: object.frame.x,
    top: object.frame.y,
    width: object.frame.width,
    height: object.frame.height,
  };
  const production = surface.frames.productionFrame;
  if (!object.slot) return objectFrame;
  const left = Math.max(objectFrame.left, production.xMm);
  const top = Math.max(objectFrame.top, production.yMm);
  const right = Math.min(
    objectFrame.left + objectFrame.width,
    production.xMm + production.widthMm,
  );
  const bottom = Math.min(
    objectFrame.top + objectFrame.height,
    production.yMm + production.heightMm,
  );
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top }
    : objectFrame;
}

function createEditorImageClipEffect(
  objectId: string,
  frame: { left: number; top: number; width: number; height: number },
) {
  return {
    type: "clipPath" as const,
    id: `document-image:${objectId}:clip`,
    coordinateMode: "absolute" as const,
    source: {
      id: `document-image:${objectId}:clip-source`,
      type: "rect" as const,
      space: "scene" as const,
      data: { type: "document-image-clip", objectId },
      props: {
        left: frame.left,
        top: frame.top,
        width: frame.width,
        height: frame.height,
        originX: "left",
        originY: "top",
        fill: "#000000",
        stroke: null,
      },
    },
  };
}

async function resolveDocumentImageResources(
  runtime: EditorDocumentRuntime,
  document: EditorDocument,
): Promise<Map<string, ImageResourceResolution>> {
  const service = runtime.services.get?.<ImageResourceService>(
    IMAGE_RESOURCE_SERVICE,
  );
  const entries: Array<Promise<readonly [string, ImageResourceResolution]>> =
    [];
  document.surfaces.forEach((surface) =>
    surface.layers.forEach((layer) =>
      layer.objects?.forEach((object) => {
        if (
          object.source.kind !== "image" ||
          !object.source.resource ||
          !service
        )
          return;
        entries.push(
          service
            .resolve(object.source.resource)
            .then((result) => [object.id, result] as const),
        );
      }),
    ),
  );
  return new Map(await Promise.all(entries));
}

function normalizeRenderIntentTransform(object: EditorObject) {
  return {
    ...(object.transform ?? {}),
    left: object.transform?.left ?? object.frame?.x ?? 0,
    top: object.transform?.top ?? object.frame?.y ?? 0,
    originX: object.transform?.originX ?? "left",
    originY: object.transform?.originY ?? "top",
  };
}

function resolveLayerStack(layer: EditorLayer): number {
  if (layer.role === "guide") return 900;
  return layer.role === "overlay" ? 780 : 0;
}

async function compileRenderIntentPatches(
  compilerRegistry: RenderIntentCompilerRegistryService,
  document: EditorDocument,
  capabilityId: string,
  entry: EffectEntry,
  runtime: EditorDocumentRuntime,
  diagnostics: EditorDocumentDiagnostic[],
): Promise<RenderIntentPatch[]> {
  const target = resolveRenderIntentTarget(
    entry.effect,
    entry.context,
    document,
  );
  if (!target) {
    diagnostics.push(
      createDiagnostic(
        entry,
        severityForEffect(entry.effect),
        "effect-target-missing",
        `Effect "${entry.effect.type}" could not resolve a render intent target.`,
        capabilityId,
      ),
    );
    return [];
  }

  const compilers = compilerRegistry.getCompilers({
    capabilityId,
    effectType: entry.effect.type,
  });
  if (compilers.length === 0) {
    diagnostics.push(
      createDiagnostic(
        entry,
        severityForEffect(entry.effect),
        "compiler-missing",
        `Capability "${capabilityId}" has no RenderIntent compiler for effect "${entry.effect.type}".`,
        capabilityId,
      ),
    );
    return [];
  }

  const patches: RenderIntentPatch[] = [];
  for (const compiler of compilers) {
    try {
      const compiled = await compiler.compile({
        document,
        effect: entry.effect,
        services: runtime.services as any,
        target,
      });
      patches.push(...normalizeRenderIntentPatches(compiled));
    } catch (error) {
      diagnostics.push(
        createDiagnostic(
          entry,
          severityForEffect(entry.effect),
          "effect-compile-failed",
          `RenderIntent compiler failed for effect "${entry.effect.type}": ${getErrorMessage(error)}`,
          capabilityId,
        ),
      );
    }
  }
  return patches;
}

function normalizeRenderIntentPatches(
  value: RenderIntentPatch[] | RenderIntentPatch | void,
): RenderIntentPatch[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function collectEffectEntries(document: EditorDocument): EffectEntry[] {
  const entries: EffectEntry[] = [];
  document.surfaces.forEach((surface, surfaceIndex) => {
    surface.effects?.forEach((effect, effectIndex) =>
      entries.push({
        effect,
        context: { surface },
        path: `/surfaces/${surfaceIndex}/effects/${effectIndex}`,
      }),
    );
    surface.layers.forEach((layer, layerIndex) => {
      layer.effects?.forEach((effect, effectIndex) =>
        entries.push({
          effect,
          context: { surface, layer },
          path: `/surfaces/${surfaceIndex}/layers/${layerIndex}/effects/${effectIndex}`,
        }),
      );
      layer.objects?.forEach((object, objectIndex) => {
        object.effects?.forEach((effect, effectIndex) => {
          if (isGenericEditorEffect(effect)) {
            entries.push({
              effect,
              context: { surface, layer, object },
              path:
                `/surfaces/${surfaceIndex}/layers/${layerIndex}` +
                `/objects/${objectIndex}/effects/${effectIndex}`,
            });
          }
        });
      });
    });
  });
  return entries;
}

function createObjectInteractionAspect(
  object: EditorObject,
): DocumentInteractionSpec | undefined {
  return object.interaction;
}

function compareEffectEntries(a: EffectEntry, b: EffectEntry) {
  const phaseDelta =
    (EFFECT_PHASE_ORDER[a.effect.phase ?? "layout"] ?? 1) -
    (EFFECT_PHASE_ORDER[b.effect.phase ?? "layout"] ?? 1);
  return phaseDelta || (a.effect.order ?? 0) - (b.effect.order ?? 0);
}

function resolveRenderIntentTarget(
  effect: EditorEffect,
  context: EffectContext,
  document: EditorDocument,
): RenderIntentDraft["subject"] | null {
  const target = effect.target ?? "self";
  if (target === "self") {
    if (context.object && context.layer) {
      return {
        kind: "object",
        surfaceId: context.surface.id,
        layerId: context.layer.id,
        objectId: context.object.id,
        objectType: context.object.source.kind,
      };
    }
    if (context.layer) {
      return {
        kind: "layer",
        surfaceId: context.surface.id,
        layerId: context.layer.id,
      };
    }
    return { kind: "surface", surfaceId: context.surface.id };
  }

  if ("objectId" in target) {
    const resolved = findObjectContext(document, target.objectId);
    return resolved
      ? {
          kind: "object",
          surfaceId: resolved.surface.id,
          layerId: resolved.layer.id,
          objectId: resolved.object.id,
          objectType: resolved.object.source.kind,
        }
      : null;
  }
  if ("layerId" in target) {
    const resolved = findLayerContext(document, target.layerId);
    return resolved
      ? {
          kind: "layer",
          surfaceId: resolved.surface.id,
          layerId: resolved.layer.id,
        }
      : null;
  }
  if ("surfaceId" in target) {
    return document.surfaces.some((surface) => surface.id === target.surfaceId)
      ? { kind: "surface", surfaceId: target.surfaceId }
      : null;
  }
  return null;
}

function findLayerContext(document: EditorDocument, layerId: string) {
  for (const surface of document.surfaces) {
    const layer = surface.layers.find((item) => item.id === layerId);
    if (layer) return { surface, layer };
  }
  return null;
}

function findObjectContext(document: EditorDocument, objectId: string) {
  for (const surface of document.surfaces) {
    for (const layer of surface.layers) {
      const object = layer.objects?.find((item) => item.id === objectId);
      if (object) return { surface, layer, object };
    }
  }
  return null;
}

function severityForEffect(
  effect: EditorEffect,
): EditorDocumentDiagnostic["severity"] {
  return effect.require === "warn" ? "warning" : "error";
}

function createDiagnostic(
  entry: EffectEntry,
  severity: EditorDocumentDiagnostic["severity"],
  code: string,
  message: string,
  capabilityId?: string,
): EditorDocumentDiagnostic {
  return {
    severity,
    code,
    message,
    path: entry.path,
    capabilityId,
    effectType: entry.effect.type,
  };
}

function createRenderIntentDiagnostic(
  diagnostic: RenderIntentDiagnostic,
): EditorDocumentDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.debugLabel ?? "renderIntent",
    capabilityId: diagnostic.sourceId?.startsWith("capability:")
      ? diagnostic.sourceId.slice("capability:".length)
      : undefined,
    effectType: diagnostic.reason,
  };
}

function collectAppliedSurfaceIds(
  drafts: readonly RenderIntentDraft[],
): string[] {
  return Array.from(
    new Set(
      drafts
        .map((draft) => draft.subject.surfaceId)
        .filter((surfaceId) => surfaceId.length > 0),
    ),
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeOutputMaskKeys(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function normalizeTags(...values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : []))
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function resolveShapeSource(
  source: Extract<ObjectSource, { kind: "shape" }>,
): Omit<ResolvedVisual, "source"> | null {
  switch (source.shape) {
    case "rect": {
      const width = positiveNumber(source.params.width, 1);
      const height = positiveNumber(source.params.height, 1);
      return {
        pathData: `M0 0H${width}V${height}H0Z`,
        bounds: { left: 0, top: 0, width, height },
        intrinsicSize: { width, height },
      };
    }
    case "circle": {
      const radius = positiveNumber(source.params.radius, 1);
      return {
        pathData: circlePath(radius, radius, radius),
        bounds: { left: 0, top: 0, width: radius * 2, height: radius * 2 },
        intrinsicSize: { width: radius * 2, height: radius * 2 },
      };
    }
    case "ellipse": {
      const rx = positiveNumber(
        source.params.rx,
        positiveNumber(source.params.width, 2) / 2,
      );
      const ry = positiveNumber(
        source.params.ry,
        positiveNumber(source.params.height, 2) / 2,
      );
      return {
        pathData: ellipsePath(rx, ry, rx, ry),
        bounds: { left: 0, top: 0, width: rx * 2, height: ry * 2 },
        intrinsicSize: { width: rx * 2, height: ry * 2 },
      };
    }
    case "heart": {
      const width = positiveNumber(source.params.width, 100);
      const height = positiveNumber(source.params.height, 90);
      return {
        pathData: heartPath(width, height),
        bounds: { left: 0, top: 0, width, height },
        intrinsicSize: { width, height },
      };
    }
    default:
      return null;
  }
}

function circlePath(cx: number, cy: number, radius: number): string {
  return [
    `M${cx} ${cy - radius}`,
    `A${radius} ${radius} 0 1 1 ${cx} ${cy + radius}`,
    `A${radius} ${radius} 0 1 1 ${cx} ${cy - radius}`,
    "Z",
  ].join("");
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return [
    `M${cx} ${cy - ry}`,
    `A${rx} ${ry} 0 1 1 ${cx} ${cy + ry}`,
    `A${rx} ${ry} 0 1 1 ${cx} ${cy - ry}`,
    "Z",
  ].join("");
}

function heartPath(width: number, height: number): string {
  return [
    `M${width / 2} ${height}`,
    `C${width * 0.1} ${height * 0.65} 0 ${height * 0.35} ${width * 0.2} ${height * 0.15}`,
    `C${width * 0.35} 0 ${width / 2} ${height * 0.15} ${width / 2} ${height * 0.3}`,
    `C${width / 2} ${height * 0.15} ${width * 0.65} 0 ${width * 0.8} ${height * 0.15}`,
    `C${width} ${height * 0.35} ${width * 0.9} ${height * 0.65} ${width / 2} ${height}`,
    "Z",
  ].join("");
}

function inferPathBounds(pathData: string): GeometryRect | null {
  const numbers =
    pathData.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  const points: GeometryPoint[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    const x = numbers[index];
    const y = numbers[index + 1];
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    left,
    top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

function sizeToBounds(size: ObjectSize): GeometryRect {
  return {
    left: 0,
    top: 0,
    width: positiveNumber(size.width, 1),
    height: positiveNumber(size.height, 1),
  };
}

function rectToBounds(rect: ObjectRect | undefined): GeometryRect | null {
  if (!rect) return null;
  const left = Number(rect.x);
  const top = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { left, top, width, height };
}

function containsPoint(bounds: GeometryRect, point: GeometryPoint): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.left + bounds.width &&
    point.y >= bounds.top &&
    point.y <= bounds.top + bounds.height
  );
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
