import {
  RENDER_INTENT_COMPILER_REGISTRY_SERVICE,
  RENDER_INTENT_SERVICE,
  GEOMETRY_SOURCE_SERVICE,
  CONSTRAINT_RESOLVER_SERVICE,
  SURFACE_FRAME_SERVICE,
  SESSION_SERVICE,
  INTERACTION_SERVICE,
  IMAGE_RESOURCE_SERVICE,
  IMAGE_GEOMETRY_DATA_KEY,
  coordinateMatrix,
  coordinateRect,
  createAffinePlacement,
  createLocalToSceneMatrix,
  invertCoordinateMatrix,
  multiplyCoordinateMatrices,
  resolveImageGeometry,
  transformCoordinateRect,
  mergeRenderIntentPatchEntries,
  createServiceToken,
  type GeometryPoint,
  type GeometryRect,
  type GeometryRef,
  type GeometrySnapshot,
  type GeometrySource,
  type GeometrySourceService,
  type ConstraintResolverService,
  type AffinePlacement,
  type Disposable,
  type ImageResourceResolution,
  type ImageResourceService,
  type InteractionManipulationCommitEvent,
  type InteractionService,
  type RenderIntentCompilerRegistryService,
  type RenderIntentDiagnostic,
  type RenderIntentDraft,
  type RenderIntentPatch,
  type RenderIntentPatchEntry,
  type RenderIntentService,
  type Service,
  type ServiceContext,
  type ServiceIdentifier,
  type SceneTransformPatch,
  type SessionHandle,
  type SessionScope,
  type SessionValidationResult,
  type SessionService,
  type SurfaceFrameService,
} from "@pooder/core";
import {
  EffectSchemaRegistry,
  cloneEditorDocument,
  collectEditorDocumentCapabilityRequirements,
  findEditorDocumentObject,
  isEditorBuiltinObjectEffect,
  isEditorCompositeObject,
  isEditorVisualObject,
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
  type EditorBuiltinObjectEffect,
  type EditorCompositeObject,
  type EditorImageObject,
  type EditorImageResource,
  type EditorObject,
  type EditorObjectEffect,
  type EditorSurface,
  type EditorTransform,
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
    register?<T extends Service>(
      service: T,
      identifier?: ServiceIdentifier<T>,
    ): boolean;
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

export type EditorDocumentSource = "committed" | "working";

export type EditorDocumentMutationCallback = (
  document: EditorDocument,
) => EditorDocument | void | Promise<EditorDocument | void>;

export type EditorDocumentMutationFailureReason =
  | "document-not-found"
  | "draft-inactive"
  | "layer-not-found"
  | "object-not-found"
  | "mutation-failed"
  | "validation-failed";

export type EditorDocumentMutationResult =
  | { ok: true; document: EditorDocument }
  | {
      ok: false;
      reason: EditorDocumentMutationFailureReason;
      diagnostics: EditorDocumentDiagnostic[];
    };

export interface EditorDocumentChangeEvent {
  type: "replace" | "mutate" | "commit" | "rollback";
  committed: EditorDocument | null;
  working: EditorDocument | null;
  draftId?: string;
}

export interface DocumentDraftOptions {
  source?: EditorDocumentSource;
}

export interface DocumentDraft {
  readonly id: string;
  export(): EditorDocument | null;
  mutate(
    callback: EditorDocumentMutationCallback,
  ): Promise<EditorDocumentMutationResult>;
  commit(): Promise<EditorDocumentMutationResult>;
  rollback(): Promise<EditorDocumentMutationResult>;
}

export type EditorDocumentSessionDerive<TDraft> = (
  draft: Readonly<TDraft>,
  /** Fresh clone of the committed document captured when the session opened. */
  document: EditorDocument,
) => EditorDocument | void | Promise<EditorDocument | void>;

export interface OpenEditorDocumentSessionInput<TDraft> {
  /** Stable application id. Generated when omitted. */
  sessionId?: string;
  /** Logical transaction scope. Document sessions with the same scope conflict. */
  scope?: Omit<SessionScope, "channel" | "groupId"> & {
    channel?: string | null;
  };
  initialDraft: TDraft;
  derive: EditorDocumentSessionDerive<TDraft>;
  validate?(
    draft: Readonly<TDraft>,
    working: EditorDocument,
  ):
    | boolean
    | SessionValidationResult
    | Promise<boolean | SessionValidationResult>;
  /** Same-scope policy. Defaults to `reject`. Document transactions are single-writer. */
  concurrency?: "reject" | "replace";
}

export interface EditorDocumentSession<TDraft> {
  readonly id: string;
  readonly scope: SessionScope;
  readonly draft: TDraft;
  update(
    update: TDraft | ((draft: TDraft) => TDraft),
  ): Promise<EditorDocumentMutationResult>;
  validate(): Promise<SessionValidationResult>;
  commit(): Promise<EditorDocumentMutationResult>;
  rollback(): Promise<EditorDocumentMutationResult>;
}

export interface EditorDocumentObjectInsertOptions {
  index?: number;
}

export interface EditorDocumentManipulationCommit {
  subjectId: string;
  sceneTransformPatch: SceneTransformPatch;
  /** Scene-space fallback for matrix decomposition during resize/rotate. */
  frame?: { left: number; top: number; width: number; height: number };
  rotation?: number;
  parentMatrix?: EditorDocumentMatrix;
}

export type EditorDocumentMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface EditorDocumentService extends Service {
  apply(document: unknown): Promise<ApplyEditorDocumentResult>;
  export(source?: EditorDocumentSource): EditorDocument | null;
  mutate(
    callback: EditorDocumentMutationCallback,
  ): Promise<EditorDocumentMutationResult>;
  beginDraft(options?: DocumentDraftOptions): Promise<DocumentDraft>;
  openSession<TDraft>(
    input: OpenEditorDocumentSessionInput<TDraft>,
  ): Promise<EditorDocumentSession<TDraft>>;
  getSession<TDraft = unknown>(
    sessionId: string,
  ): EditorDocumentSession<TDraft> | undefined;
  onDidChange(listener: (event: EditorDocumentChangeEvent) => void): Disposable;
  insertObject(
    surfaceId: string,
    layerId: string,
    object: EditorObject,
    options?: EditorDocumentObjectInsertOptions,
  ): Promise<EditorDocumentMutationResult>;
  updateObject(
    objectId: string,
    update: (current: Readonly<EditorObject>) => EditorObject,
  ): Promise<EditorDocumentMutationResult>;
  removeObject(objectId: string): Promise<EditorDocumentMutationResult>;
  validateObjectConstraints(
    objectId: string,
    source?: EditorDocumentSource,
  ): SessionValidationResult;
  commitManipulation(
    manipulation: EditorDocumentManipulationCommit,
  ): Promise<EditorDocumentMutationResult>;
}

export const EDITOR_DOCUMENT_SERVICE =
  createServiceToken<EditorDocumentService>("EditorDocumentService");

/** @deprecated Use EditorDocumentService. */
export type EditorDocumentController = Pick<
  EditorDocumentService,
  "apply" | "export" | "updateObject"
>;

/** @deprecated Use EditorDocumentMutationResult. */
export type DocumentUpdateResult = EditorDocumentMutationResult;

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
  onDocumentPrepared?: (document: EditorDocument) => void,
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
  onDocumentPrepared?.(document);
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

export class DefaultEditorDocumentService implements EditorDocumentService {
  private committedDocument: EditorDocument | null = null;
  private workingDocument: EditorDocument | null = null;
  private applyingDocument: EditorDocument | null = null;
  private activeDraftId: string | null = null;
  private activeDraftSnapshot: EditorDocument | null = null;
  private draftSequence = 0;
  private readonly listeners = new Set<
    (event: EditorDocumentChangeEvent) => void
  >();
  private operationQueue: Promise<void> = Promise.resolve();
  private manipulationSubscription?: { dispose(): void };
  private sessionSubscription?: { dispose(): void };
  private documentGeometrySubscription?: { dispose(): void };
  private readonly documentSessions = new Map<
    string,
    EditorDocumentSession<unknown>
  >();
  private sessionSequence = 0;

  constructor(
    private readonly runtime: EditorDocumentRuntime,
    private readonly options: ApplyEditorDocumentOptions = {},
  ) {}

  init(context: ServiceContext): void {
    const geometrySource = context.get<GeometrySourceService>(
      GEOMETRY_SOURCE_SERVICE,
    );
    this.documentGeometrySubscription = geometrySource?.registerSource(
      createDocumentObjectGeometrySource(
        () =>
          this.applyingDocument ??
          this.workingDocument ??
          this.committedDocument,
        geometrySource,
      ),
    );
    const interactionService =
      context.get<InteractionService>(INTERACTION_SERVICE);
    this.manipulationSubscription = interactionService?.onDidCommitManipulation(
      (event) => {
        void this.writeManipulationToDocument(event);
      },
    );
    this.sessionSubscription = context
      .get<SessionService>(SESSION_SERVICE)
      ?.onDidTerminate((event) => {
        this.documentSessions.delete(event.descriptor.sessionId);
      });
  }

  dispose(): void {
    this.documentGeometrySubscription?.dispose();
    this.documentGeometrySubscription = undefined;
    this.manipulationSubscription?.dispose();
    this.manipulationSubscription = undefined;
    this.sessionSubscription?.dispose();
    this.sessionSubscription = undefined;
    this.documentSessions.clear();
    this.listeners.clear();
  }

  async apply(value: unknown): Promise<ApplyEditorDocumentResult> {
    return this.enqueue(async () => {
      const result = await this.applyDocumentToRuntime(value, "replace");
      if (result.ok) {
        this.committedDocument = cloneEditorDocument(result.document);
        this.workingDocument = cloneEditorDocument(result.document);
        this.activeDraftId = null;
        this.activeDraftSnapshot = null;
        this.emit("replace");
      }
      return result;
    });
  }

  export(source: EditorDocumentSource = "committed"): EditorDocument | null {
    const document =
      source === "working" ? this.workingDocument : this.committedDocument;
    return document ? cloneEditorDocument(document) : null;
  }

  async mutate(
    callback: EditorDocumentMutationCallback,
  ): Promise<EditorDocumentMutationResult> {
    return this.enqueue(() =>
      this.mutateWorking(callback, this.activeDraftId ?? undefined),
    );
  }

  async beginDraft(options: DocumentDraftOptions = {}): Promise<DocumentDraft> {
    return this.enqueue(async () => {
      if (this.activeDraftId) {
        throw new Error(
          `Document draft "${this.activeDraftId}" is already active.`,
        );
      }
      const source = this.export(options.source ?? "committed");
      if (!source) throw new Error("Cannot begin a draft without a document.");
      const draftId = `document-draft-${++this.draftSequence}`;
      this.activeDraftId = draftId;
      this.activeDraftSnapshot = cloneEditorDocument(source);
      this.workingDocument = cloneEditorDocument(source);
      return {
        id: draftId,
        export: () =>
          this.activeDraftId === draftId ? this.export("working") : null,
        mutate: (callback) =>
          this.enqueue(() => this.mutateDraft(draftId, callback)),
        commit: () => this.enqueue(() => this.commitDraft(draftId)),
        rollback: () => this.enqueue(() => this.rollbackDraft(draftId)),
      };
    });
  }

  async openSession<TDraft>(
    input: OpenEditorDocumentSessionInput<TDraft>,
  ): Promise<EditorDocumentSession<TDraft>> {
    const sessionId =
      normalizeObjectId(input.sessionId) ||
      `document-session-${++this.sessionSequence}`;
    const existing = this.documentSessions.get(sessionId);
    if (existing) return existing as EditorDocumentSession<TDraft>;

    const sessionService = this.runtime.services.getOrThrow<SessionService>(
      SESSION_SERVICE,
      "SessionService is required to open an editor document session.",
    );
    const sessionSnapshot = this.export("committed");
    if (!sessionSnapshot) {
      throw new Error(
        "Cannot open an editor document session without a document.",
      );
    }
    const scope: SessionScope = {
      surfaceId: input.scope?.surfaceId ?? null,
      subjectId: input.scope?.subjectId ?? null,
      channel: input.scope?.channel ?? "document",
      groupId: "editor-document",
    };
    let documentDraft: DocumentDraft | undefined;
    let rollbackResult: EditorDocumentMutationResult | undefined;

    const handle = await sessionService.open<
      TDraft,
      EditorDocumentMutationResult
    >({
      descriptor: {
        sessionId,
        ownerId: "editor-document-service",
        scope,
        interactionMode: "exclusive",
        leavePolicy: "block",
      },
      initialDraft: cloneSessionDraft(input.initialDraft),
      concurrency: input.concurrency ?? "reject",
      lifecycle: {
        begin: async (context) => {
          documentDraft = await this.beginDraft();
          const result = await documentDraft.mutate(() =>
            input.derive(
              context.getDraft(),
              cloneEditorDocument(sessionSnapshot),
            ),
          );
          if (!result.ok) {
            await documentDraft.rollback();
            throw new EditorDocumentSessionMutationError(result);
          }
        },
        validate: async (context) => {
          const working = this.export("working");
          if (!working) return { ok: false, detail: "document-not-found" };
          return input.validate?.(context.getDraft(), working) ?? true;
        },
        commit: async () => {
          const result = await requireDocumentDraft(documentDraft).commit();
          if (!result.ok) throw new EditorDocumentSessionMutationError(result);
          return result;
        },
        rollback: async () => {
          rollbackResult = await requireDocumentDraft(documentDraft).rollback();
          if (!rollbackResult.ok) {
            throw new EditorDocumentSessionMutationError(rollbackResult);
          }
        },
        cancel: async () => {
          rollbackResult = await requireDocumentDraft(documentDraft).rollback();
          if (!rollbackResult.ok) {
            throw new EditorDocumentSessionMutationError(rollbackResult);
          }
        },
      },
    });
    handle.setDirty(true);

    const session = this.createDocumentSession(
      handle,
      input,
      sessionSnapshot,
      () => requireDocumentDraft(documentDraft),
      () => rollbackResult,
    );
    this.documentSessions.set(
      sessionId,
      session as EditorDocumentSession<unknown>,
    );
    return session;
  }

  getSession<TDraft = unknown>(
    sessionId: string,
  ): EditorDocumentSession<TDraft> | undefined {
    return this.documentSessions.get(normalizeObjectId(sessionId)) as
      | EditorDocumentSession<TDraft>
      | undefined;
  }

  onDidChange(
    listener: (event: EditorDocumentChangeEvent) => void,
  ): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  insertObject(
    surfaceId: string,
    layerId: string,
    object: EditorObject,
    options: EditorDocumentObjectInsertOptions = {},
  ): Promise<EditorDocumentMutationResult> {
    let found = false;
    return this.mutate((document) => {
      for (const surface of document.surfaces) {
        if (surface.id !== surfaceId) continue;
        const layer = surface.layers.find((item) => item.id === layerId);
        if (!layer) break;
        const objects = layer.objects ?? (layer.objects = []);
        const index = Number.isInteger(options.index)
          ? Math.max(0, Math.min(options.index as number, objects.length))
          : objects.length;
        objects.splice(index, 0, cloneDocumentObject(object));
        found = true;
        return;
      }
      if (!found) throw new DocumentMutationError("layer-not-found");
    });
  }

  updateObject(
    objectId: string,
    update: (current: Readonly<EditorObject>) => EditorObject,
  ): Promise<EditorDocumentMutationResult> {
    const id = normalizeObjectId(objectId);
    if (!id) return Promise.resolve(mutationFailure("object-not-found"));
    return this.mutate((document) => {
      const object = findEditorDocumentObject(document, id);
      if (!object) throw new DocumentMutationError("object-not-found");
      const updated = update(cloneDocumentObject(object));
      replaceSourceObject(document, id, cloneDocumentObject(updated));
    });
  }

  removeObject(objectId: string): Promise<EditorDocumentMutationResult> {
    const id = normalizeObjectId(objectId);
    if (!id) return Promise.resolve(mutationFailure("object-not-found"));
    return this.mutate((document) => {
      if (!removeSourceObject(document, id)) {
        throw new DocumentMutationError("object-not-found");
      }
    });
  }

  validateObjectConstraints(
    objectId: string,
    source: EditorDocumentSource = "working",
  ): SessionValidationResult {
    const document = this.export(source);
    const object = document
      ? findEditorDocumentObject(document, normalizeObjectId(objectId))
      : undefined;
    if (!object) return { ok: false, detail: "object-not-found" };
    const constraints =
      object.interaction?.manipulation?.move?.constraints?.map(
        (constraint) => constraint.spec,
      ) ?? [];
    if (!constraints.length) return { ok: true };
    const geometrySource = this.runtime.services.get?.<GeometrySourceService>(
      GEOMETRY_SOURCE_SERVICE,
    );
    const resolver = this.runtime.services.get?.<ConstraintResolverService>(
      CONSTRAINT_RESOLVER_SERVICE,
    );
    const bounds = geometrySource?.getBounds(
      {
        sourceId: DOCUMENT_OBJECT_GEOMETRY_SOURCE_ID,
        geometryId: object.id,
        purpose: "preview",
      },
      "scene",
    ).value;
    if (!resolver || !bounds) {
      return { ok: false, detail: "constraint-runtime-unavailable" };
    }
    const resolved = resolver.resolve({
      transform: { frame: bounds },
      constraints,
      coordinateSpace: "scene",
      geometrySource,
      phase: "commit",
    });
    return resolved.result.changed
      ? {
          ok: false,
          detail: {
            code: "object-constraints-unsatisfied",
            objectId: object.id,
            diagnostics: resolved.result.diagnostics,
          },
        }
      : { ok: true };
  }

  commitManipulation(
    manipulation: EditorDocumentManipulationCommit,
  ): Promise<EditorDocumentMutationResult> {
    if (manipulation.sceneTransformPatch.type === "translate") {
      const localDelta = sceneDeltaToLocalDelta(
        manipulation.sceneTransformPatch.delta,
        manipulation.parentMatrix,
      );
      return this.updateObject(manipulation.subjectId, (object) =>
        translateDocumentObject(object, localDelta),
      );
    }
    const localFrame = manipulation.frame
      ? sceneFrameToLocalFrame(manipulation.frame, manipulation.parentMatrix)
      : undefined;
    return this.updateObject(manipulation.subjectId, (object) => ({
      ...object,
      ...(localFrame
        ? {
            frame: {
              x: localFrame.left,
              y: localFrame.top,
              width: localFrame.width,
              height: localFrame.height,
            },
          }
        : {}),
      ...(manipulation.rotation === undefined
        ? {}
        : {
            transform: {
              ...(object.transform ?? {}),
              angle: manipulation.rotation,
            },
          }),
    }));
  }

  private async mutateDraft(
    draftId: string,
    callback: EditorDocumentMutationCallback,
  ): Promise<EditorDocumentMutationResult> {
    if (this.activeDraftId !== draftId)
      return mutationFailure("draft-inactive");
    return this.mutateWorking(callback, draftId);
  }

  private async mutateWorking(
    callback: EditorDocumentMutationCallback,
    draftId?: string,
  ): Promise<EditorDocumentMutationResult> {
    if (!this.workingDocument) return mutationFailure("document-not-found");
    const candidate = cloneEditorDocument(this.workingDocument);
    candidate.config = this.runtime.config?.export() ?? candidate.config;
    let returned: EditorDocument | void;
    try {
      returned = await callback(candidate);
    } catch (error) {
      return error instanceof DocumentMutationError
        ? mutationFailure(error.reason)
        : mutationFailure("mutation-failed");
    }
    const next = returned ? cloneEditorDocument(returned) : candidate;
    const result = await this.applyDocumentToRuntime(next, "update");
    if (!result.ok) {
      await this.applyDocumentToRuntime(this.workingDocument, "update");
      return mutationFailure("validation-failed", result.diagnostics);
    }
    this.workingDocument = cloneEditorDocument(result.document);
    if (draftId) {
      this.emit("mutate", draftId);
    } else {
      this.committedDocument = cloneEditorDocument(result.document);
      this.emit("commit");
    }
    return { ok: true, document: cloneEditorDocument(result.document) };
  }

  private async commitDraft(
    draftId: string,
  ): Promise<EditorDocumentMutationResult> {
    if (this.activeDraftId !== draftId || !this.workingDocument) {
      return mutationFailure("draft-inactive");
    }
    this.committedDocument = cloneEditorDocument(this.workingDocument);
    this.activeDraftId = null;
    this.activeDraftSnapshot = null;
    this.emit("commit", draftId);
    return { ok: true, document: cloneEditorDocument(this.committedDocument) };
  }

  private async rollbackDraft(
    draftId: string,
  ): Promise<EditorDocumentMutationResult> {
    if (this.activeDraftId !== draftId || !this.activeDraftSnapshot) {
      return mutationFailure("draft-inactive");
    }
    const snapshot = cloneEditorDocument(this.activeDraftSnapshot);
    const result = await this.applyDocumentToRuntime(snapshot, "update");
    if (!result.ok) {
      return mutationFailure("validation-failed", result.diagnostics);
    }
    this.workingDocument = cloneEditorDocument(snapshot);
    this.activeDraftId = null;
    this.activeDraftSnapshot = null;
    this.emit("rollback", draftId);
    return { ok: true, document: cloneEditorDocument(snapshot) };
  }

  private async writeManipulationToDocument(
    event: InteractionManipulationCommitEvent,
  ): Promise<void> {
    const subjectId = normalizeObjectId(event.subject.subjectId);
    const sceneTransformPatch = event.result.documentPatch;
    if (!subjectId || !sceneTransformPatch) return;
    const parentMatrix = normalizeDocumentMatrix(
      event.input.metadata?.parentSceneMatrix,
    );
    await this.commitManipulation({
      subjectId,
      sceneTransformPatch,
      ...(event.result.result.frame
        ? { frame: event.result.result.frame }
        : {}),
      ...(typeof event.result.result.rotation === "number"
        ? { rotation: event.result.result.rotation }
        : {}),
      ...(parentMatrix ? { parentMatrix } : {}),
    });
  }

  private createDocumentSession<TDraft>(
    handle: SessionHandle<TDraft, EditorDocumentMutationResult>,
    input: OpenEditorDocumentSessionInput<TDraft>,
    sessionSnapshot: EditorDocument,
    getDocumentDraft: () => DocumentDraft,
    getRollbackResult: () => EditorDocumentMutationResult | undefined,
  ): EditorDocumentSession<TDraft> {
    const service = this;
    return {
      get id() {
        return handle.descriptor.sessionId;
      },
      get scope() {
        return handle.descriptor.scope;
      },
      get draft() {
        return handle.getDraft();
      },
      async update(update) {
        const current = handle.getDraft();
        const next =
          typeof update === "function"
            ? (update as (draft: TDraft) => TDraft)(current)
            : update;
        const candidate = cloneSessionDraft(next);
        const result = await getDocumentDraft().mutate(() =>
          input.derive(candidate, cloneEditorDocument(sessionSnapshot)),
        );
        if (result.ok) handle.updateDraft(candidate);
        return result;
      },
      validate: () => handle.validate(),
      async commit() {
        const result = await handle.commit();
        if (!result.ok) {
          return mutationFailure(
            "validation-failed",
            validationDetailToDiagnostics(result.validation.detail),
          );
        }
        service.documentSessions.delete(handle.descriptor.sessionId);
        return result.result;
      },
      async rollback() {
        await handle.rollback();
        service.documentSessions.delete(handle.descriptor.sessionId);
        return getRollbackResult() ?? mutationFailure("draft-inactive");
      },
    };
  }

  private emit(type: EditorDocumentChangeEvent["type"], draftId?: string) {
    const event: EditorDocumentChangeEvent = {
      type,
      committed: this.export("committed"),
      working: this.export("working"),
      ...(draftId ? { draftId } : {}),
    };
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error("EditorDocumentService change listener failed.", error);
      }
    });
  }

  private async applyDocumentToRuntime(
    value: unknown,
    mode: "replace" | "update",
  ): Promise<ApplyEditorDocumentResult> {
    try {
      return await applyEditorDocumentInternal(
        this.runtime,
        value,
        this.options,
        mode,
        (document) => {
          this.applyingDocument = document;
        },
      );
    } finally {
      this.applyingDocument = null;
    }
  }

  private enqueue<TResult>(
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function translateDocumentObject(
  object: EditorObject,
  delta: { x: number; y: number },
): EditorObject {
  const frame = object.frame;
  if (!frame) return object;
  const transform = object.transform;
  return {
    ...object,
    frame: { ...frame, x: frame.x + delta.x, y: frame.y + delta.y },
    ...(Number.isFinite(transform?.left) || Number.isFinite(transform?.top)
      ? {
          transform: {
            ...(transform ?? {}),
            ...(Number.isFinite(transform?.left)
              ? { left: Number(transform?.left) + delta.x }
              : {}),
            ...(Number.isFinite(transform?.top)
              ? { top: Number(transform?.top) + delta.y }
              : {}),
          },
        }
      : {}),
  };
}

function sceneDeltaToLocalDelta(
  delta: { x: number; y: number },
  parentMatrix?: EditorDocumentMatrix,
): { x: number; y: number } {
  if (!parentMatrix) return { x: delta.x, y: delta.y };
  const inverse = invertDocumentMatrix(parentMatrix);
  if (!inverse) return { x: delta.x, y: delta.y };
  return {
    x: inverse[0] * delta.x + inverse[2] * delta.y,
    y: inverse[1] * delta.x + inverse[3] * delta.y,
  };
}

export function registerEditorDocumentService(
  runtime: EditorDocumentRuntime,
  options: ApplyEditorDocumentOptions = {},
): EditorDocumentService {
  const existing = runtime.services.get?.(EDITOR_DOCUMENT_SERVICE);
  if (existing) return existing;
  if (!runtime.services.register) {
    throw new Error(
      "Runtime service registration is required for EditorDocumentService.",
    );
  }
  const service = new DefaultEditorDocumentService(runtime, options);
  if (!runtime.services.register(service, EDITOR_DOCUMENT_SERVICE)) {
    throw new Error("Failed to register EditorDocumentService.");
  }
  return service;
}

/** @deprecated Use registerEditorDocumentService and EDITOR_DOCUMENT_SERVICE. */
export function createEditorDocumentController(
  runtime: EditorDocumentRuntime,
  options: ApplyEditorDocumentOptions = {},
): EditorDocumentService {
  return registerEditorDocumentService(runtime, options);
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
  const replaceIn = (objects: EditorObject[] | undefined): boolean => {
    if (!objects) return false;
    for (let index = 0; index < objects.length; index += 1) {
      const object = objects[index]!;
      if (object.id === objectId) {
        objects[index] = next;
        return true;
      }
      if (isEditorCompositeObject(object) && replaceIn(object.children)) {
        return true;
      }
    }
    return false;
  };
  for (const surface of document.surfaces) {
    for (const layer of surface.layers) {
      if (replaceIn(layer.objects)) return;
    }
  }
}

function removeSourceObject(
  document: EditorDocument,
  objectId: string,
): boolean {
  const removeFrom = (objects: EditorObject[] | undefined): boolean => {
    if (!objects) return false;
    for (let index = 0; index < objects.length; index += 1) {
      const object = objects[index]!;
      if (object.id === objectId) {
        objects.splice(index, 1);
        return true;
      }
      if (isEditorCompositeObject(object) && removeFrom(object.children)) {
        return true;
      }
    }
    return false;
  };
  for (const surface of document.surfaces) {
    for (const layer of surface.layers) {
      if (removeFrom(layer.objects)) {
        if (layer.objects && !layer.objects.length) delete layer.objects;
        return true;
      }
    }
  }
  return false;
}

class DocumentMutationError extends Error {
  constructor(readonly reason: EditorDocumentMutationFailureReason) {
    super(reason);
  }
}

class EditorDocumentSessionMutationError extends Error {
  constructor(readonly result: EditorDocumentMutationResult) {
    super(result.ok ? "document-session-mutation-failed" : result.reason);
  }
}

function requireDocumentDraft(draft: DocumentDraft | undefined): DocumentDraft {
  if (!draft) throw new Error("Editor document session draft is unavailable.");
  return draft;
}

function cloneSessionDraft<T>(draft: T): T {
  if (draft === undefined || draft === null) return draft;
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(draft);
  }
  return JSON.parse(JSON.stringify(draft)) as T;
}

function validationDetailToDiagnostics(
  detail: unknown,
): EditorDocumentDiagnostic[] {
  if (!Array.isArray(detail)) return [];
  return detail.filter(
    (entry): entry is EditorDocumentDiagnostic =>
      typeof entry === "object" &&
      entry !== null &&
      "severity" in entry &&
      "message" in entry,
  );
}

function mutationFailure(
  reason: EditorDocumentMutationFailureReason,
  diagnostics: EditorDocumentDiagnostic[] = [],
): EditorDocumentMutationResult {
  return { ok: false, reason, diagnostics };
}

export function sceneFrameToLocalFrame(
  frame: { left: number; top: number; width: number; height: number },
  parentMatrix?: EditorDocumentMatrix,
): { left: number; top: number; width: number; height: number } {
  if (!parentMatrix) return { ...frame };
  const inverse = invertDocumentMatrix(parentMatrix);
  if (!inverse) return { ...frame };
  const corners = [
    transformDocumentPoint(inverse, frame.left, frame.top),
    transformDocumentPoint(inverse, frame.left + frame.width, frame.top),
    transformDocumentPoint(inverse, frame.left, frame.top + frame.height),
    transformDocumentPoint(
      inverse,
      frame.left + frame.width,
      frame.top + frame.height,
    ),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    left,
    top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

function normalizeDocumentMatrix(
  value: unknown,
): EditorDocumentMatrix | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 6 ||
    value.some((item) => !Number.isFinite(item))
  ) {
    return undefined;
  }
  return value as unknown as EditorDocumentMatrix;
}

function invertDocumentMatrix(
  matrix: EditorDocumentMatrix,
): EditorDocumentMatrix | undefined {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    return undefined;
  }
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}

function transformDocumentPoint(
  matrix: EditorDocumentMatrix,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}

function cloneObjectEffects(
  effects: EditorObjectEffect[] | undefined,
): EditorObjectEffect[] | undefined {
  return effects?.length
    ? (JSON.parse(JSON.stringify(effects)) as EditorObjectEffect[])
    : undefined;
}

function createPathAffinePlacement(
  framePlacement: AffinePlacement,
  bounds:
    | { left: number; top: number; width: number; height: number }
    | undefined,
  contentBounds:
    | { left: number; top: number; width: number; height: number }
    | undefined,
): AffinePlacement {
  const frame = framePlacement.localBounds;
  if (!frame || !bounds || bounds.width <= 0 || bounds.height <= 0) {
    return framePlacement;
  }

  const pathBounds = contentBounds ?? bounds;
  const sourceScaleX = frame.width / bounds.width;
  const sourceScaleY = frame.height / bounds.height;
  const pathToFrame = coordinateMatrix("object-local", "object-local", [
    sourceScaleX,
    0,
    0,
    sourceScaleY,
    -bounds.left * sourceScaleX,
    -bounds.top * sourceScaleY,
  ]);
  return createAffinePlacement({
    localBounds: pathBounds,
    localToScene: multiplyCoordinateMatrices(
      framePlacement.localToScene,
      pathToFrame,
    ),
    pivot: {
      x: bounds.left + framePlacement.pivot.x / sourceScaleX,
      y: bounds.top + framePlacement.pivot.y / sourceScaleY,
    },
  });
}

function createFrameAffinePlacement(
  object: EditorObject,
  parentLocalToScene = coordinateMatrix(
    "parent-local",
    "scene",
    [1, 0, 0, 1, 0, 0],
  ),
): AffinePlacement {
  const frame = object.frame ?? { x: 0, y: 0, width: 0, height: 0 };
  const transform = object.transform ?? {};
  const pivot = {
    x: frame.width * originFactorX(transform.originX),
    y: frame.height * originFactorY(transform.originY),
  };
  return createAffinePlacement({
    localBounds: {
      left: 0,
      top: 0,
      width: frame.width,
      height: frame.height,
    },
    pivot,
    localToScene: multiplyCoordinateMatrices(
      parentLocalToScene,
      coordinateMatrix(
        "object-local",
        "parent-local",
        createLocalToSceneMatrix({
          position: {
            x: finiteOr(transform.left, frame.x + pivot.x),
            y: finiteOr(transform.top, frame.y + pivot.y),
          },
          pivot,
          scaleX: finiteOr(transform.scaleX, 1),
          scaleY: finiteOr(transform.scaleY, 1),
          rotation: finiteOr(transform.angle, 0),
          skewX: finiteOr(transform.skewX, 0),
          skewY: finiteOr(transform.skewY, 0),
        }).values,
      ),
    ),
  });
}

export const DOCUMENT_OBJECT_GEOMETRY_SOURCE_ID = "document-object";

export function createDocumentObjectGeometrySource(
  getDocument: () => EditorDocument | null,
  geometryService: GeometrySourceService,
): GeometrySource {
  const findPlacement = (
    objectId: string,
  ): { object: EditorObject; placement: AffinePlacement } | undefined => {
    const document = getDocument();
    if (!document) return undefined;
    let match: { object: EditorObject; placement: AffinePlacement } | undefined;
    const visit = (
      objects: EditorObject[] | undefined,
      parentLocalToScene = coordinateMatrix(
        "parent-local",
        "scene",
        [1, 0, 0, 1, 0, 0],
      ),
    ) => {
      objects?.some((object) => {
        const placement = createFrameAffinePlacement(
          object,
          parentLocalToScene,
        );
        if (object.id === objectId) {
          match = { object, placement };
          return true;
        }
        if (isEditorCompositeObject(object)) {
          visit(
            object.children,
            coordinateMatrix(
              "parent-local",
              "scene",
              placement.localToScene.values,
            ),
          );
        }
        return Boolean(match);
      });
    };
    document.surfaces.some((surface) =>
      surface.layers.some((layer) => {
        visit(layer.objects);
        return Boolean(match);
      }),
    );
    return match;
  };

  const rawSnapshot = (ref: GeometryRef): GeometrySnapshot | null => {
    const resolved = findPlacement(ref.geometryId);
    if (!resolved) return null;
    const { object, placement } = resolved;
    if (isEditorCompositeObject(object)) {
      const bounds = transformCoordinateRect(
        placement.localToScene,
        placement.localBounds,
      );
      return {
        kind: "compound",
        ref,
        space: "scene",
        bounds,
        localToScene: coordinateMatrix("scene", "scene", [1, 0, 0, 1, 0, 0]),
        children: object.children.map((child) => ({
          sourceId: DOCUMENT_OBJECT_GEOMETRY_SOURCE_ID,
          geometryId: child.id,
          ...(ref.purpose ? { purpose: ref.purpose } : {}),
        })),
        metadata: { objectId: object.id, composite: true },
      };
    }
    const usesFrameGeometry =
      object.source.kind === "image" || object.source.kind === "text";
    const visual = usesFrameGeometry
      ? ({ source: object.source } satisfies ResolvedVisual)
      : resolveObjectSource(object.source);
    if (!visual) return null;
    const visualPlacement = visual.pathData
      ? createPathAffinePlacement(
          placement,
          visual.bounds,
          visual.contentBounds,
        )
      : placement;
    const bounds = visualPlacement.localBounds;
    if (visual.pathData) {
      return {
        kind: "path",
        ref,
        format: "svg-path",
        pathData: visual.pathData,
        space: "object-local",
        bounds,
        localToScene: visualPlacement.localToScene,
        metadata: { objectId: object.id, sourceKind: object.source.kind },
      };
    }
    return {
      kind: "rect",
      ref,
      space: "object-local",
      bounds,
      rect: bounds,
      localToScene: visualPlacement.localToScene,
      metadata: { objectId: object.id, sourceKind: object.source.kind },
    };
  };

  const booleanOperands = (targetId: string, purpose: "preview" | "export") => {
    const document = getDocument();
    if (!document) return [];
    const operands: Array<{
      objectId: string;
      operation: "add" | "subtract" | "intersect" | "exclude";
      order: number;
      sequence: number;
    }> = [];
    let sequence = 0;
    visitDocumentVisualObjects(document, (object) => {
      object.effects?.forEach((effect) => {
        if (
          !isEditorBuiltinObjectEffect(effect) ||
          effect.type !== "boolean" ||
          effect.targetId !== targetId
        )
          return;
        const participation = effect.participation ?? "both";
        if (participation !== "both" && participation !== purpose) return;
        operands.push({
          objectId: object.id,
          operation: effect.operation,
          order: effect.order ?? 0,
          sequence: sequence++,
        });
      });
    });
    return operands.sort(
      (left, right) =>
        left.order - right.order || left.sequence - right.sequence,
    );
  };

  return {
    sourceId: DOCUMENT_OBJECT_GEOMETRY_SOURCE_ID,
    getSnapshot(ref) {
      const purpose = ref.purpose ?? "preview";
      if (ref.variant === "base") return rawSnapshot(ref);
      const operands = booleanOperands(ref.geometryId, purpose);
      const explicitStep = /^boolean:(\d+)$/.exec(ref.variant ?? "");
      const step = explicitStep ? Number(explicitStep[1]) : operands.length;
      if (step <= 0) return rawSnapshot({ ...ref, variant: "base" });
      const operand = operands[step - 1];
      if (!operand) return null;
      const result = geometryService.boolean({
        refs: [
          {
            sourceId: DOCUMENT_OBJECT_GEOMETRY_SOURCE_ID,
            geometryId: ref.geometryId,
            purpose,
            variant: step === 1 ? "base" : `boolean:${step - 1}`,
          },
          {
            sourceId: DOCUMENT_OBJECT_GEOMETRY_SOURCE_ID,
            geometryId: operand.objectId,
            purpose,
          },
        ],
        operator: operand.operation === "add" ? "union" : operand.operation,
        resultRef: {
          sourceId: DOCUMENT_OBJECT_GEOMETRY_SOURCE_ID,
          geometryId: ref.geometryId,
          purpose,
          variant: `boolean:${step}`,
        },
      });
      return result.value;
    },
    listGeometries() {
      const document = getDocument();
      if (!document) return [];
      return getDocumentObjectDescriptors(document);
    },
  };
}

function getDocumentObjectDescriptors(document: EditorDocument) {
  const descriptors: Array<{
    ref: GeometryRef;
    kind: GeometrySnapshot["kind"];
    space: "object-local" | "scene";
    metadata: Record<string, unknown>;
  }> = [];
  document.surfaces.forEach((surface) =>
    surface.layers.forEach((layer) => {
      const visit = (objects: EditorObject[] | undefined) =>
        objects?.forEach((object) => {
          descriptors.push({
            ref: {
              sourceId: DOCUMENT_OBJECT_GEOMETRY_SOURCE_ID,
              geometryId: object.id,
            },
            kind: isEditorCompositeObject(object)
              ? "compound"
              : object.source.kind === "image" || object.source.kind === "text"
                ? "rect"
                : "path",
            space: isEditorCompositeObject(object) ? "scene" : "object-local",
            metadata: {
              objectId: object.id,
              surfaceId: surface.id,
              layerId: layer.id,
            },
          });
          if (isEditorCompositeObject(object)) visit(object.children);
        });
      visit(layer.objects);
    }),
  );
  return descriptors;
}

function originFactorX(value: EditorTransform["originX"]): number {
  return value === "right" ? 1 : value === "center" ? 0.5 : 0;
}

function originFactorY(value: EditorTransform["originY"]): number {
  return value === "bottom" ? 1 : value === "center" ? 0.5 : 0;
}

function finiteOr(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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
      const visit = (
        objects: EditorObject[] | undefined,
        parentLocalToScene = coordinateMatrix(
          "parent-local",
          "scene",
          [1, 0, 0, 1, 0, 0],
        ),
        compositeId?: string,
      ) => {
        objects?.forEach((object, index) => {
          const framePlacement = createFrameAffinePlacement(
            object,
            parentLocalToScene,
          );
          if (isEditorCompositeObject(object)) {
            if (object.interaction && object.frame) {
              drafts.push(
                createCompositeInteractionProxyDraft(
                  surface,
                  layer,
                  object,
                  index,
                  framePlacement,
                ),
              );
            }
            visit(
              object.children,
              coordinateMatrix(
                "parent-local",
                "scene",
                framePlacement.localToScene.values,
              ),
              object.id,
            );
            return;
          }
          const draft = createObjectRenderIntentDraft(
            surface,
            layer,
            object,
            index,
            resolvedImages.get(object.id),
            framePlacement,
            compositeId,
          );
          if (draft) drafts.push(draft);
        });
      };
      visit(layer.objects);
    });
  });
  const draftsById = new Map(drafts.map((draft) => [draft.id, draft]));
  visitDocumentVisualObjects(document, (object) => {
    object.effects?.forEach((effect, effectIndex) => {
      if (!isEditorBuiltinObjectEffect(effect) || effect.type !== "clip-source")
        return;
      effect.targetIds.forEach((targetId: string) => {
        const target = draftsById.get(targetId);
        if (!target) return;
        target.effects = [
          ...(target.effects ?? []),
          {
            type: "clipPath",
            id: effect.id ?? `document-object:${object.id}:clip:${effectIndex}`,
            coordinateMode: "absolute",
            previewGeometryRef: {
              sourceId: "document-object",
              geometryId: object.id,
              purpose: "preview",
            },
            exportGeometryRef: {
              sourceId: "document-object",
              geometryId: object.id,
              purpose: "export",
            },
            source: {
              id: `document-object:${object.id}:clip-placeholder`,
              type: "path",
              space: "scene",
              props: {},
            },
          },
        ];
      });
    });
  });
  return drafts;
}

function visitDocumentVisualObjects(
  document: EditorDocument,
  visitor: (object: Exclude<EditorObject, EditorCompositeObject>) => void,
): void {
  const visit = (objects: EditorObject[] | undefined) =>
    objects?.forEach((object) => {
      if (isEditorCompositeObject(object)) visit(object.children);
      else visitor(object);
    });
  document.surfaces.forEach((surface) =>
    surface.layers.forEach((layer) => visit(layer.objects)),
  );
}

function createCompositeInteractionProxyDraft(
  surface: EditorSurface,
  layer: EditorLayer,
  object: EditorCompositeObject,
  index: number,
  placement: AffinePlacement,
): RenderIntentDraft {
  const memberNodeIds: string[] = [];
  const collectMembers = (children: EditorObject[]) =>
    children.forEach((child) => {
      if (isEditorCompositeObject(child)) collectMembers(child.children);
      else memberNodeIds.push(child.id);
    });
  collectMembers(object.children);
  return {
    id: `${object.id}:interaction-proxy`,
    subject: {
      kind: "object",
      surfaceId: surface.id,
      layerId: layer.id,
      objectId: object.id,
      objectType: "composite",
    },
    visual: { type: "rect" },
    placement,
    interaction: object.interaction,
    export: { visible: true, tags: object.tags },
    ordering: {
      layerId: layer.id,
      layerOrder: layer.order ?? 0,
      objectOrder: object.order ?? index,
      channel: "overlay",
      subOrder: 1,
      stack: resolveLayerStack(layer),
    },
    props: {
      fill: "rgba(0,0,0,0)",
      stroke: null,
      excludeFromExport: true,
    },
    data: {
      id: object.id,
      compositeProxy: true,
      compositeMemberNodeIds: memberNodeIds,
      documentObjectPlacement: placement,
      documentSurfaceId: surface.id,
      layerId: layer.id,
    },
  };
}

function createObjectRenderIntentDraft(
  surface: EditorSurface,
  layer: EditorLayer,
  object: EditorObject,
  index: number,
  imageResolution?: ImageResourceResolution,
  framePlacement: AffinePlacement = createFrameAffinePlacement(object),
  compositeId?: string,
): RenderIntentDraft | null {
  if (!object.frame || !isEditorVisualObject(object)) return null;
  const objectOrder = object.order ?? index;
  const layerOrder = layer.order ?? 0;
  const locked = object.locked === true || layer.locked === true;
  const interaction = createObjectInteractionAspect(object);
  const objectEffects = cloneObjectEffects(object.effects);
  const guideEffects =
    object.effects?.filter(
      (
        effect,
      ): effect is Extract<EditorBuiltinObjectEffect, { type: "guide" }> =>
        isEditorBuiltinObjectEffect(effect) && effect.type === "guide",
    ) ?? [];
  const outputMaskKeys = normalizeOutputMaskKeys(
    object.metadata?.outputMaskKeys ?? object.metadata?.outputMaskKey,
  );
  const tags = normalizeTags(
    layer.tags,
    object.tags,
    guideEffects.flatMap((effect) =>
      effect.type === "guide" ? [effect.role, `guide:${effect.role}`] : [],
    ),
  );
  const base = {
    id: object.id,
    subject: {
      kind: "object" as const,
      surfaceId: surface.id,
      layerId: layer.id,
      objectId: object.id,
      objectType: object.source.kind,
    },
    placement: framePlacement,
    previewGeometryRef: {
      sourceId: "document-object",
      geometryId: object.id,
      purpose: "preview" as const,
    },
    exportGeometryRef: {
      sourceId: "document-object",
      geometryId: object.id,
      purpose: "export" as const,
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
      ...guideEffects.reduce(
        (style, effect) =>
          effect.type === "guide" ? { ...style, ...effect.style } : style,
        {} as Record<string, unknown>,
      ),
    },
    data: {
      id: object.id,
      layerId: layer.id,
      documentSurfaceId: surface.id,
      documentObjectSourceKind: object.source.kind,
      documentLayerRole: layer.role,
      documentObjectPlacement: framePlacement,
      ...(compositeId ? { compositeId } : {}),
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
      resolveEditorImageClipFrame(
        surface,
        object as EditorImageObject,
        framePlacement,
      ),
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
      placement: createPathAffinePlacement(
        framePlacement,
        visual.bounds,
        visual.contentBounds,
      ),
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
  clipFrame?: import("@pooder/core").CoordinateRect<"object-local">,
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
        frame: coordinateRect("object-local", {
          left: 0,
          top: 0,
          width: object.frame.width,
          height: object.frame.height,
        }),
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
          createEditorImageClipEffect(
            object.id,
            geometry.clip,
            base.placement!,
          ),
        ]
      : base.effects,
    placement: geometry
      ? createAffinePlacement({
          localBounds: geometry.imageLocalBounds,
          pivot: {
            x:
              geometry.imageLocalBounds.left +
              geometry.imageLocalBounds.width / 2,
            y:
              geometry.imageLocalBounds.top +
              geometry.imageLocalBounds.height / 2,
          },
          localToScene: multiplyCoordinateMatrices(
            base.placement!.localToScene,
            geometry.imageLocalToObjectLocal,
          ),
        })
      : base.placement,
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
  objectPlacement: AffinePlacement,
) {
  const objectFrame = objectPlacement.localBounds;
  const production = surface.frames.productionFrame;
  if (!object.slot) return objectFrame;
  const productionInObject = transformCoordinateRect(
    invertCoordinateMatrix(objectPlacement.localToScene),
    coordinateRect("scene", {
      left: production.xMm,
      top: production.yMm,
      width: production.widthMm,
      height: production.heightMm,
    }),
  );
  const left = Math.max(objectFrame.left, productionInObject.left);
  const top = Math.max(objectFrame.top, productionInObject.top);
  const right = Math.min(
    objectFrame.left + objectFrame.width,
    productionInObject.left + productionInObject.width,
  );
  const bottom = Math.min(
    objectFrame.top + objectFrame.height,
    productionInObject.top + productionInObject.height,
  );
  return right > left && bottom > top
    ? coordinateRect("object-local", {
        left,
        top,
        width: right - left,
        height: bottom - top,
      })
    : objectFrame;
}

function createEditorImageClipEffect(
  objectId: string,
  frame: import("@pooder/core").CoordinateRect<"object-local">,
  objectPlacement: AffinePlacement,
) {
  return {
    type: "clipPath" as const,
    id: `document-image:${objectId}:clip`,
    coordinateMode: "absolute" as const,
    source: {
      id: `document-image:${objectId}:clip-source`,
      type: "rect" as const,
      space: "scene" as const,
      placement: createAffinePlacement({
        localBounds: frame,
        localToScene: objectPlacement.localToScene,
        pivot: {
          x: frame.left + frame.width / 2,
          y: frame.top + frame.height / 2,
        },
      }),
      data: { type: "document-image-clip", objectId },
      props: {
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
  const collect = (objects: EditorObject[] | undefined) =>
    objects?.forEach((object) => {
      if (isEditorCompositeObject(object)) {
        collect(object.children);
        return;
      }
      if (object.source.kind !== "image" || !object.source.resource || !service)
        return;
      entries.push(
        service
          .resolve(object.source.resource)
          .then((result) => [object.id, result] as const),
      );
    });
  document.surfaces.forEach((surface) =>
    surface.layers.forEach((layer) => collect(layer.objects)),
  );
  return new Map(await Promise.all(entries));
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
      const collectObjectEntries = (
        objects: EditorObject[] | undefined,
        objectsPath: string,
      ) =>
        objects?.forEach((object, objectIndex) => {
          const objectPath = `${objectsPath}/${objectIndex}`;
          object.effects?.forEach((effect, effectIndex) => {
            if (isGenericEditorEffect(effect)) {
              entries.push({
                effect,
                context: { surface, layer, object },
                path: `${objectPath}/effects/${effectIndex}`,
              });
            }
          });
          if (isEditorCompositeObject(object)) {
            collectObjectEntries(object.children, `${objectPath}/children`);
          }
        });
      collectObjectEntries(
        layer.objects,
        `/surfaces/${surfaceIndex}/layers/${layerIndex}/objects`,
      );
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
        objectType: isEditorCompositeObject(context.object)
          ? "composite"
          : context.object.source.kind,
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
          objectType: isEditorCompositeObject(resolved.object)
            ? "composite"
            : resolved.object.source.kind,
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
      const object = findEditorDocumentObject(
        {
          ...document,
          surfaces: [{ ...surface, layers: [layer] }],
        },
        objectId,
      );
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
