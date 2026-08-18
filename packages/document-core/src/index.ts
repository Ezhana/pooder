import {
  RENDER_INTENT_COMPILER_REGISTRY_SERVICE,
  RENDER_INTENT_SERVICE,
  GEOMETRY_SOURCE_SERVICE,
  CONSTRAINT_RESOLVER_SERVICE,
  SCENE_BOUNDS_SERVICE,
  SCENE_SERVICE,
  SESSION_SERVICE,
  INTERACTION_SERVICE,
  IMAGE_RESOURCE_SERVICE,
  IMAGE_GEOMETRY_DATA_KEY,
  coordinateMatrix,
  coordinateRect,
  createAffinePlacement,
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
  type ImageResourceDescriptor,
  type ImageResourceService,
  type InteractionManipulationCommitEvent,
  type InteractionSpec,
  type InteractionService,
  type RenderIntentCompilerRegistryService,
  type RenderIntentDiagnostic,
  type RenderIntentDraft,
  type RenderIntentPatch,
  type RenderIntentPatchEntry,
  type RenderIntentService,
  type PreparedRenderIntentDocumentPublication,
  type PreparedSceneBoundsPublication,
  type Service,
  type ServiceContext,
  type ServiceIdentifier,
  type SceneTransformPatch,
  type SessionHandle,
  type SessionScope,
  type SessionValidationResult,
  type SessionService,
  type SceneBoundsService,
  type SceneService,
  type SceneSnapshot,
} from "@pooder/core";
import {
  EffectSchemaRegistry,
  DocumentExtensionRegistry,
  cloneEditorDocument,
  createEditorDocumentAssetId,
  reclaimOrphanedEditorDocumentAssets,
  resolveEditorDocumentAsset,
  setEditorImageObjectSource,
  upsertEditorDocumentAsset,
  collectEditorDocumentCapabilityRequirements,
  findEditorDocumentObject,
  isEditorBuiltinObjectEffect,
  isEditorGroupObject,
  isEditorLeafObject,
  isEditorExtensionObjectEffect,
  parseEditorDocument,
  surfaceContentRect,
  selectEditorDocumentObjects,
  validateEditorDocument,
  validateEditorDocumentEffectSchemas,
  validateEditorDocumentExtensions,
  validateEditorDocumentObjectSchemas,
  validateEditorDocumentAssetReferences,
  type EditorDocument,
  type AffineMatrix,
  type EditorDocumentCapabilityCollectionOptions,
  type EditorDocumentDiagnostic,
  type EditorDocumentEffectCapabilityResolver,
  type EditorDocumentValidationOptions,
  type DocumentInteractionSpec,
  type EditorExtensionObjectEffect,
  type EditorGroupObject,
  type EditorImageObject,
  type EditorImageSlotBehaviorConfig,
  type EditorImageAsset,
  type EditorAssetDataSource,
  type EditorObject,
  type EditorObjectEffect,
  type EditorObjectTrait,
  type EditorSurface,
  type DocumentExtensionContribution,
  type ObjectSchemaContext,
  type ObjectSchemaRegistry,
  type ObjectBehaviorInteractionSpec,
  type ObjectSource,
  type EditorLeafObject,
  type EditorPathObject,
  type EditorShapeObject,
  type EditorShapeContent,
  type ObjectSelector,
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
  bounds?: GeometryRect;
  contentBounds?: GeometryRect;
  intrinsicSize?: ObjectSize;
  mimeType?: string;
}

export interface GeometryResolver {
  resolve(object: EditorPathObject | EditorShapeObject): ResolvedVisual | null;
  hitTest(
    object: EditorPathObject | EditorShapeObject,
    point: GeometryPoint,
  ): boolean;
}

export class DefaultGeometryResolver implements GeometryResolver {
  resolve(object: EditorPathObject | EditorShapeObject): ResolvedVisual | null {
    if (object.type === "path") {
      const source = object.source;
      const pathData = source.content.pathData.trim();
      if (!pathData) return null;
      const contentBounds =
        rectToBounds(source.content.sourceBounds) ??
        inferPathBounds(pathData) ??
        undefined;
      return {
        source,
        pathData,
        bounds: source.content.sourceSize
          ? sizeToBounds(source.content.sourceSize)
          : contentBounds,
        contentBounds,
        intrinsicSize: source.content.sourceSize,
      };
    }

    if (object.type !== "shape") return null;
    const source = object.source;
    const resolved = resolveShapeSource(source.content);
    return resolved ? { source, ...resolved } : null;
  }

  hitTest(
    object: EditorPathObject | EditorShapeObject,
    point: GeometryPoint,
  ): boolean {
    const visual = this.resolve(object);
    if (!visual?.bounds) return false;
    return containsPoint(visual.bounds, point);
  }
}

export class SourceResolver {
  constructor(
    private readonly geometryResolver: GeometryResolver = new DefaultGeometryResolver(),
  ) {}

  resolve(object: EditorLeafObject): ResolvedVisual | null {
    switch (object.type) {
      case "image":
        return null;
      case "path":
      case "shape":
        return this.geometryResolver.resolve(object);
      default:
        return null;
    }
  }
}

export function resolveObjectSource(
  object: EditorLeafObject,
): ResolvedVisual | null {
  return new SourceResolver().resolve(object);
}

export interface EditorDocumentRuntime {
  readonly extensions?: {
    listDocumentContributions(): unknown[];
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

export interface EditorDocumentPublication {
  /** Must be synchronous and non-throwing. All fallible work belongs in prepare. */
  publish(): void;
}

export interface EditorDocumentPublicationParticipant {
  prepare(context: {
    runtime: EditorDocumentRuntime;
    document: EditorDocument;
  }):
    | EditorDocumentPublication
    | void
    | Promise<EditorDocumentPublication | void>;
}

export interface ApplyEditorDocumentOptions {
  effectSchemaRegistry?: EffectSchemaRegistry;
  resolveEffectCapabilityId?: EditorDocumentEffectCapabilityResolver;
  validators?: EditorDocumentValidationOptions["validators"];
  publicationParticipants?: readonly EditorDocumentPublicationParticipant[];
  afterPublish?: (
    runtime: EditorDocumentRuntime,
    document: EditorDocument,
  ) => Promise<void> | void;
}

export interface ApplyEditorDocumentResult {
  ok: boolean;
  document: EditorDocument;
  diagnostics: EditorDocumentDiagnostic[];
  surfaces: EditorSurface[];
  appliedSurfaceIds: string[];
}

export type EditorDocumentSource = "committed" | "working";

export type EditorDocumentMutationCallback = (
  document: EditorDocument,
) => EditorDocument | void | Promise<EditorDocument | void>;

export type EditorDocumentMutationFailureReason =
  | "document-not-found"
  | "draft-inactive"
  | "parent-not-found"
  | "object-not-found"
  | "surface-not-found"
  | "selector-count-mismatch"
  | "object-type-mismatch"
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

export interface EditorDocumentSelectorMutationOptions {
  expectedCount?: number;
}

export interface EditorDocumentImageResourceUpdate {
  source?: EditorAssetDataSource | null;
  mimeType?: string;
  intrinsicSize?: EditorImageAsset["intrinsicSize"];
  visible?: boolean;
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

export type ActivateEditorSurfaceResult =
  | { ok: true; surfaceId: string }
  | {
      ok: false;
      reason: Extract<
        EditorDocumentMutationFailureReason,
        "document-not-found" | "surface-not-found"
      >;
    };

export interface EditorDocumentService extends Service {
  apply(document: unknown): Promise<ApplyEditorDocumentResult>;
  export(source?: EditorDocumentSource): EditorDocument | null;
  activateSurface(surfaceId: string): Promise<ActivateEditorSurfaceResult>;
  getActiveSurfaceId(): string | null;
  onActiveSurfaceChange(
    listener: (event: { surfaceId: string | null }) => void,
  ): Disposable;
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
    parentId: string | null,
    object: EditorObject,
    options?: EditorDocumentObjectInsertOptions,
  ): Promise<EditorDocumentMutationResult>;
  updateObject(
    objectId: string,
    update: (current: Readonly<EditorObject>) => EditorObject,
  ): Promise<EditorDocumentMutationResult>;
  removeObject(objectId: string): Promise<EditorDocumentMutationResult>;
  selectObjects(
    selector: ObjectSelector,
    source?: EditorDocumentSource,
  ): EditorObject[];
  selectOneObject(
    selector: ObjectSelector,
    source?: EditorDocumentSource,
  ): EditorObject | undefined;
  updateObjects(
    selector: ObjectSelector,
    update: (current: Readonly<EditorObject>) => EditorObject,
    options?: EditorDocumentSelectorMutationOptions,
  ): Promise<EditorDocumentMutationResult>;
  updateImageResources(
    selector: ObjectSelector,
    update: EditorDocumentImageResourceUpdate,
    options?: EditorDocumentSelectorMutationOptions,
  ): Promise<EditorDocumentMutationResult>;
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

interface EffectContext {
  surface: EditorSurface;
  object?: EditorObject;
}

interface EffectEntry {
  effect: EditorExtensionObjectEffect;
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

interface PreparedEditorDocumentApplication {
  result: ApplyEditorDocumentResult;
  sceneBoundsPublication: PreparedSceneBoundsPublication;
  renderIntentPublication: PreparedRenderIntentDocumentPublication;
  participantPublications: EditorDocumentPublication[];
  renderIntentService: RenderIntentService;
  sceneBoundsService: SceneBoundsService;
  sceneService: SceneService;
}

interface EditorDocumentPublicationBoundary {
  publishDocumentState?(document: EditorDocument): void;
  notifyDocumentPublished?(): void;
}

async function applyEditorDocumentInternal(
  runtime: EditorDocumentRuntime,
  value: unknown,
  options: ApplyEditorDocumentOptions,
  renderIntentMode: "replace" | "update",
  boundary: EditorDocumentPublicationBoundary = {},
): Promise<ApplyEditorDocumentResult> {
  let prepared: PreparedEditorDocumentApplication | ApplyEditorDocumentResult;
  try {
    prepared = await prepareEditorDocumentApplication(
      runtime,
      value,
      options,
      renderIntentMode,
    );
  } catch (error) {
    return createResult(
      false,
      createRejectedDocumentSnapshot(),
      [createPublicationDiagnostic("document-prepare-failed", error)],
      [],
    );
  }
  if (!("renderIntentPublication" in prepared)) return prepared;

  try {
    publishEditorDocumentApplication(runtime, prepared, boundary);
  } catch (error) {
    return createResult(
      false,
      prepared.result.document,
      [
        ...prepared.result.diagnostics,
        createPublicationDiagnostic("document-publication-rejected", error),
      ],
      [],
    );
  }

  try {
    await options.afterPublish?.(runtime, prepared.result.document);
  } catch (error) {
    console.error("EditorDocument afterPublish notification failed.", error);
  }
  return prepared.result;
}

async function prepareEditorDocumentApplication(
  runtime: EditorDocumentRuntime,
  value: unknown,
  options: ApplyEditorDocumentOptions,
  renderIntentMode: "replace" | "update",
): Promise<PreparedEditorDocumentApplication | ApplyEditorDocumentResult> {
  const validationOptions = toValidationOptions(options);
  const documentSchemaDiagnostics = validateEditorDocument(
    value,
    validationOptions,
  );
  if (hasErrors(documentSchemaDiagnostics)) {
    return createResult(
      false,
      createRejectedDocumentSnapshot(),
      documentSchemaDiagnostics,
      [],
    );
  }
  const document = parseEditorDocument(value);
  const extensionRegistry = createRuntimeDocumentExtensionRegistry(runtime);
  const effectSchemaRegistry = mergeEffectSchemaRegistries(
    extensionRegistry.createEffectSchemaRegistry(),
    options.effectSchemaRegistry,
  );
  const collectionOptions = toCollectionOptions(options, effectSchemaRegistry);
  const extensionDiagnostics = validateEditorDocumentExtensions(
    value,
    extensionRegistry,
  );
  if (hasErrors(extensionDiagnostics)) {
    return createResult(false, document, extensionDiagnostics, []);
  }
  const objectSchemaRegistry = extensionRegistry.createObjectSchemaRegistry();
  const objectSchemaDiagnostics = validateEditorDocumentObjectSchemas(
    document,
    objectSchemaRegistry,
  );
  if (hasErrors(objectSchemaDiagnostics)) {
    return createResult(false, document, objectSchemaDiagnostics, []);
  }
  const effectSchemaDiagnostics = validateEditorDocumentEffectSchemas(
    value,
    effectSchemaRegistry,
  );
  const assetReferenceDiagnostics = validateEditorDocumentAssetReferences(
    document,
    { extensionRegistry },
  );
  const diagnostics = [
    ...documentSchemaDiagnostics,
    ...extensionDiagnostics,
    ...objectSchemaDiagnostics,
    ...effectSchemaDiagnostics,
    ...assetReferenceDiagnostics,
  ];
  if (hasErrors([...effectSchemaDiagnostics, ...assetReferenceDiagnostics])) {
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

  const sceneBoundsService = runtime.services.getOrThrow<SceneBoundsService>(
    SCENE_BOUNDS_SERVICE,
    "SceneBoundsService is required to apply an EditorDocument.",
  );
  const sceneService = runtime.services.getOrThrow<SceneService>(
    SCENE_SERVICE,
    "SceneService is required to apply an EditorDocument.",
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
  const intentDrafts = createBaseRenderIntentDrafts(
    document,
    resolvedImages,
    objectSchemaRegistry,
  );
  const effectEntries = collectEffectEntries(document);
  const patchEntries: RenderIntentPatchEntry[] = [];
  let patchSequence = 0;

  for (const entry of effectEntries) {
    const capabilityId = resolveEffectCapabilityId(
      entry.effect,
      options,
      effectSchemaRegistry,
    );
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
        phase: effectSchemaRegistry.resolvePhase(entry.effect.type),
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

  const result = createResult(
    true,
    document,
    allDiagnostics,
    collectAppliedSurfaceIds(mergeResult.drafts),
  );
  const sceneBoundsPublication = sceneBoundsService.prepareImportBounds(
    Object.fromEntries(
      document.surfaces.map((surface) => [
        surface.id,
        surfaceToRuntimeBounds(surface),
      ]),
    ),
  );
  const renderIntentPublication = renderIntentService.prepareDocumentIntents(
    mergeResult.drafts,
    renderIntentMode,
  );
  const participantPublications: EditorDocumentPublication[] = [];
  for (const contribution of extensionRegistry.list()) {
    const state = document.extension.states[contribution.id];
    if (state === undefined || !contribution.preparePublication) continue;
    try {
      const publication = await contribution.preparePublication(state, {
        document,
        extensionId: contribution.id,
      });
      if (publication) participantPublications.push(publication);
    } catch (error) {
      return createResult(
        false,
        document,
        [
          ...allDiagnostics,
          createPublicationDiagnostic(
            "document-extension-publication-prepare-failed",
            error,
          ),
        ],
        [],
      );
    }
  }
  for (const participant of options.publicationParticipants ?? []) {
    try {
      const publication = await participant.prepare({ runtime, document });
      if (publication) participantPublications.push(publication);
    } catch (error) {
      return createResult(
        false,
        document,
        [
          ...allDiagnostics,
          createPublicationDiagnostic(
            "publication-participant-prepare-failed",
            error,
          ),
        ],
        [],
      );
    }
  }

  return {
    result,
    sceneBoundsPublication,
    renderIntentPublication,
    participantPublications,
    renderIntentService,
    sceneBoundsService,
    sceneService,
  };
}

function publishEditorDocumentApplication(
  _runtime: EditorDocumentRuntime,
  prepared: PreparedEditorDocumentApplication,
  boundary: EditorDocumentPublicationBoundary,
): void {
  prepared.sceneBoundsService.assertImportBoundsPublicationCurrent(
    prepared.sceneBoundsPublication,
  );
  prepared.renderIntentService.assertDocumentIntentsPublicationCurrent(
    prepared.renderIntentPublication,
  );
  reconcileDocumentScenes(
    prepared.sceneService,
    prepared.result.document.surfaces.map((surface) => surface.id),
  );
  boundary.publishDocumentState?.(prepared.result.document);
  prepared.sceneBoundsService.publishImportBounds(
    prepared.sceneBoundsPublication,
    { notify: false },
  );
  prepared.renderIntentService.publishDocumentIntents(
    prepared.renderIntentPublication,
    { notify: false },
  );
  prepared.participantPublications.forEach((publication) => {
    try {
      publication.publish();
    } catch (error) {
      console.error("EditorDocument publication participant failed.", error);
    }
  });
  notifyPublication("scene bounds", () =>
    prepared.sceneBoundsService.notifyImportBoundsPublished(
      prepared.sceneBoundsPublication,
    ),
  );
  notifyPublication("render intents", () =>
    prepared.renderIntentService.notifyDocumentIntentsPublished(
      prepared.renderIntentPublication,
    ),
  );
  boundary.notifyDocumentPublished?.();
}

function reconcileDocumentScenes(
  sceneService: SceneService,
  nextSceneIds: readonly string[],
): void {
  const activeDocumentSceneId = resolveDocumentSceneId(
    sceneService.getActiveRoot(),
  );
  const next = new Set(nextSceneIds);
  sceneService
    .listDocumentSceneIds()
    .filter((sceneId) => !next.has(sceneId))
    .forEach((sceneId) => sceneService.unregisterDocumentScene(sceneId));
  const registered = new Set(sceneService.listDocumentSceneIds());
  nextSceneIds.forEach((sceneId) => {
    if (!registered.has(sceneId)) sceneService.registerDocumentScene(sceneId);
  });
  const nextActiveSceneId =
    (activeDocumentSceneId && next.has(activeDocumentSceneId)
      ? activeDocumentSceneId
      : nextSceneIds[0]) ?? null;
  if (nextActiveSceneId) sceneService.setActiveRoot(nextActiveSceneId);
}

function notifyPublication(label: string, notify: () => void): void {
  try {
    notify();
  } catch (error) {
    console.error(`EditorDocument ${label} notification failed.`, error);
  }
}

export class DefaultEditorDocumentService implements EditorDocumentService {
  private committedDocument: EditorDocument | null = null;
  private workingDocument: EditorDocument | null = null;
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
        () => this.workingDocument ?? this.committedDocument,
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
      return this.applyDocumentToRuntime(value, "replace", {
        publishDocumentState: (document) => {
          this.committedDocument = cloneEditorDocument(document);
          this.workingDocument = cloneEditorDocument(document);
          this.activeDraftId = null;
          this.activeDraftSnapshot = null;
        },
        notifyDocumentPublished: () => this.emit("replace"),
      });
    });
  }

  export(source: EditorDocumentSource = "committed"): EditorDocument | null {
    const document =
      source === "working" ? this.workingDocument : this.committedDocument;
    return document ? cloneEditorDocument(document) : null;
  }

  async activateSurface(
    surfaceId: string,
  ): Promise<ActivateEditorSurfaceResult> {
    return this.enqueue(async () => this.activateSurfaceSync(surfaceId));
  }

  getActiveSurfaceId(): string | null {
    return resolveDocumentSceneId(
      this.getSceneService()?.getActiveRoot() ?? null,
    );
  }

  onActiveSurfaceChange(
    listener: (event: { surfaceId: string | null }) => void,
  ): Disposable {
    const service = this.getSceneService();
    if (!service) {
      return { dispose() {} };
    }
    return service.onRootChange((event) =>
      listener({ surfaceId: resolveDocumentSceneId(event.activeRoot) }),
    );
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
      sceneId: input.scope?.sceneId ?? null,
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
    parentId: string | null,
    object: EditorObject,
    options: EditorDocumentObjectInsertOptions = {},
  ): Promise<EditorDocumentMutationResult> {
    let found = false;
    return this.mutate((document) => {
      for (const surface of document.surfaces) {
        if (surface.id !== surfaceId) continue;
        const parent = parentId
          ? findGroupObject(surface.objects, parentId)
          : undefined;
        if (parentId && !parent) break;
        const objects = parent ? parent.children : surface.objects;
        const index = Number.isInteger(options.index)
          ? Math.max(0, Math.min(options.index as number, objects.length))
          : objects.length;
        objects.splice(index, 0, cloneDocumentObject(object));
        found = true;
        return;
      }
      if (!found) throw new DocumentMutationError("parent-not-found");
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

  selectObjects(
    selector: ObjectSelector,
    source: EditorDocumentSource = "working",
  ): EditorObject[] {
    const document = this.export(source);
    return document ? selectEditorDocumentObjects(document, selector) : [];
  }

  selectOneObject(
    selector: ObjectSelector,
    source: EditorDocumentSource = "working",
  ): EditorObject | undefined {
    const objects = this.selectObjects(selector, source);
    if (objects.length > 1)
      throw new Error("document-object-selector-ambiguous");
    return objects[0];
  }

  updateObjects(
    selector: ObjectSelector,
    update: (current: Readonly<EditorObject>) => EditorObject,
    options: EditorDocumentSelectorMutationOptions = {},
  ): Promise<EditorDocumentMutationResult> {
    if (!selector.ids?.length && !selector.tags?.length) {
      return Promise.resolve(mutationFailure("object-not-found"));
    }
    return this.mutate((document) => {
      const objects = selectEditorDocumentObjects(document, selector);
      assertSelectorCount(objects.length, options.expectedCount);
      if (!objects.length) throw new DocumentMutationError("object-not-found");
      objects.forEach((object) =>
        replaceSourceObject(
          document,
          object.id,
          cloneDocumentObject(update(cloneDocumentObject(object))),
        ),
      );
    });
  }

  updateImageResources(
    selector: ObjectSelector,
    update: EditorDocumentImageResourceUpdate,
    options: EditorDocumentSelectorMutationOptions = {},
  ): Promise<EditorDocumentMutationResult> {
    if (!selector.ids?.length && !selector.tags?.length) {
      return Promise.resolve(mutationFailure("object-not-found"));
    }
    return this.mutate((document) => {
      const objects = selectEditorDocumentObjects(document, selector);
      assertSelectorCount(objects.length, options.expectedCount);
      if (!objects.length) throw new DocumentMutationError("object-not-found");
      if (objects.some((object) => object.type !== "image")) {
        throw new DocumentMutationError("object-type-mismatch");
      }
      objects.forEach((object) => {
        if (object.type !== "image") return;
        if (update.visible !== undefined) object.visible = update.visible;
        if (update.source === undefined) return;
        if (update.source === null) {
          setEditorImageObjectSource(document, object.id, null);
          return;
        }
        const assetId = createEditorDocumentAssetId(
          document,
          `asset:${object.id}`,
        );
        setEditorImageObjectSource(document, object.id, {
          kind: "asset",
          assetId,
        });
        const asset: EditorImageAsset = {
          id: assetId,
          type: "image",
          source: { ...update.source },
          ...(update.mimeType ? { mimeType: update.mimeType } : {}),
          ...(update.intrinsicSize
            ? { intrinsicSize: { ...update.intrinsicSize } }
            : {}),
        };
        upsertEditorDocumentAsset(document, asset);
      });
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
    return this.updateObject(manipulation.subjectId, (object) => {
      const resized = localFrame
        ? resizeDocumentObject(object, localFrame)
        : object;
      return manipulation.rotation === undefined
        ? resized
        : {
            ...resized,
            localToParent: rotateObjectLocalToParent(
              resized.localToParent,
              manipulation.rotation,
            ),
          };
    });
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
    let returned: EditorDocument | void;
    try {
      returned = await callback(candidate);
    } catch (error) {
      return error instanceof DocumentMutationError
        ? mutationFailure(error.reason)
        : mutationFailure("mutation-failed");
    }
    const next = returned ? cloneEditorDocument(returned) : candidate;
    reclaimOrphanedEditorDocumentAssets(next, {
      extensionRegistry: createRuntimeDocumentExtensionRegistry(this.runtime),
    });
    const result = await this.applyDocumentToRuntime(next, "update", {
      publishDocumentState: (document) => {
        this.workingDocument = cloneEditorDocument(document);
        if (!draftId) {
          this.committedDocument = cloneEditorDocument(document);
        }
      },
      notifyDocumentPublished: () =>
        draftId ? this.emit("mutate", draftId) : this.emit("commit"),
    });
    if (!result.ok) {
      return mutationFailure("validation-failed", result.diagnostics);
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
    const result = await this.applyDocumentToRuntime(snapshot, "update", {
      publishDocumentState: (document) => {
        this.workingDocument = cloneEditorDocument(document);
        this.activeDraftId = null;
        this.activeDraftSnapshot = null;
      },
      notifyDocumentPublished: () => this.emit("rollback", draftId),
    });
    if (!result.ok) {
      return mutationFailure("validation-failed", result.diagnostics);
    }
    return { ok: true, document: cloneEditorDocument(snapshot) };
  }

  private async writeManipulationToDocument(
    event: InteractionManipulationCommitEvent,
  ): Promise<void> {
    const operation = event.input.spec.manipulation?.[event.kind];
    if (operation?.documentMutation === "action-owned") return;
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
    boundary: EditorDocumentPublicationBoundary,
  ): Promise<ApplyEditorDocumentResult> {
    return applyEditorDocumentInternal(
      this.runtime,
      value,
      this.options,
      mode,
      boundary,
    );
  }

  private activateSurfaceSync(surfaceId: string): ActivateEditorSurfaceResult {
    const document = this.workingDocument ?? this.committedDocument;
    if (!document) return { ok: false, reason: "document-not-found" };
    const normalized = String(surfaceId || "").trim();
    if (!document.surfaces.some((surface) => surface.id === normalized)) {
      return { ok: false, reason: "surface-not-found" };
    }
    this.getSceneService()?.setActiveRoot(normalized);
    return { ok: true, surfaceId: normalized };
  }

  private getSceneService(): SceneService | undefined {
    return this.runtime.services.get?.(SCENE_SERVICE);
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

function resolveDocumentSceneId(root: SceneSnapshot | null): string | null {
  if (!root) return null;
  if (root.owner.type === "document") return root.owner.documentSceneId;
  return (
    root.composition.entries.find((entry) => entry.source === "document-graph")
      ?.sceneId ?? null
  );
}

function translateDocumentObject(
  object: EditorObject,
  delta: { x: number; y: number },
): EditorObject {
  const [a, b, c, d, e, f] = object.localToParent;
  return {
    ...object,
    localToParent: [a, b, c, d, e + delta.x, f + delta.y],
  };
}

function resizeDocumentObject(
  object: EditorObject,
  frame: GeometryRect,
): EditorObject {
  if (isEditorLeafObject(object)) {
    const [a, b, c, d] = object.localToParent;
    return {
      ...object,
      localFrame: {
        ...object.localFrame,
        width: frame.width,
        height: frame.height,
      },
      localToParent: [a, b, c, d, frame.left, frame.top],
    };
  }
  const bounds = deriveGroupLocalBounds(object);
  if (bounds.width <= 0 || bounds.height <= 0) return object;
  const currentBounds = transformCoordinateRect(
    coordinateMatrix("object-local", "parent-local", object.localToParent),
    bounds,
  );
  const scaleX =
    currentBounds.width > 0 ? frame.width / currentBounds.width : 1;
  const scaleY =
    currentBounds.height > 0 ? frame.height / currentBounds.height : 1;
  const [a, b, c, d] = object.localToParent;
  const linear = coordinateMatrix("object-local", "parent-local", [
    a * scaleX,
    b * scaleY,
    c * scaleX,
    d * scaleY,
    0,
    0,
  ]);
  const linearBounds = transformCoordinateRect(linear, bounds);
  return {
    ...object,
    localToParent: [
      linear.values[0],
      linear.values[1],
      linear.values[2],
      linear.values[3],
      frame.left - linearBounds.left,
      frame.top - linearBounds.top,
    ],
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

function toValidationOptions(
  options: ApplyEditorDocumentOptions,
): EditorDocumentValidationOptions {
  return {
    validators: options.validators,
  };
}

function toCollectionOptions(
  options: ApplyEditorDocumentOptions,
  effectSchemaRegistry: EffectSchemaRegistry,
): EditorDocumentCapabilityCollectionOptions {
  return {
    resolveEffectCapabilityId: (effect) =>
      options.resolveEffectCapabilityId?.(effect) ||
      effectSchemaRegistry.resolveCapabilityId(effect.type),
  };
}

function resolveEffectCapabilityId(
  effect: EditorExtensionObjectEffect,
  options: ApplyEditorDocumentOptions,
  effectSchemaRegistry: EffectSchemaRegistry,
): string | undefined {
  return (
    options.resolveEffectCapabilityId?.(effect) ||
    effectSchemaRegistry.resolveCapabilityId(effect.type)
  );
}

function createRuntimeDocumentExtensionRegistry(
  runtime: EditorDocumentRuntime,
): DocumentExtensionRegistry {
  const contributions = runtime.extensions?.listDocumentContributions() ?? [];
  return new DocumentExtensionRegistry(
    contributions.filter(isDocumentExtensionContribution),
  );
}

function isDocumentExtensionContribution(
  value: unknown,
): value is DocumentExtensionContribution {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

function mergeEffectSchemaRegistries(
  primary: EffectSchemaRegistry,
  fallback?: EffectSchemaRegistry,
): EffectSchemaRegistry {
  const merged = new EffectSchemaRegistry(primary.list());
  for (const schema of fallback?.list() ?? []) {
    if (!merged.get(schema.effectType)) merged.register(schema);
  }
  return merged;
}

function normalizeObjectId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cloneDocumentObject(object: EditorObject): EditorObject {
  return JSON.parse(JSON.stringify(object)) as EditorObject;
}

function findGroupObject(
  objects: readonly EditorObject[],
  objectId: string,
): EditorGroupObject | undefined {
  for (const object of objects) {
    if (isEditorGroupObject(object)) {
      if (object.id === objectId) return object;
      const nested = findGroupObject(object.children, objectId);
      if (nested) return nested;
    }
  }
  return undefined;
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
      if (isEditorGroupObject(object) && replaceIn(object.children)) {
        return true;
      }
    }
    return false;
  };
  for (const surface of document.surfaces) {
    if (replaceIn(surface.objects)) return;
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
      if (isEditorGroupObject(object) && removeFrom(object.children)) {
        return true;
      }
    }
    return false;
  };
  for (const surface of document.surfaces) {
    if (removeFrom(surface.objects)) {
      return true;
    }
  }
  return false;
}

class DocumentMutationError extends Error {
  constructor(readonly reason: EditorDocumentMutationFailureReason) {
    super(reason);
  }
}

function assertSelectorCount(
  actual: number,
  expected: number | undefined,
): void {
  if (expected !== undefined && actual !== expected) {
    throw new DocumentMutationError("selector-count-mismatch");
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
  const localBounds = isEditorGroupObject(object)
    ? deriveGroupLocalBounds(object)
    : coordinateRect("object-local", {
        left: object.localFrame.x,
        top: object.localFrame.y,
        width: object.localFrame.width,
        height: object.localFrame.height,
      });
  const pivot = (isEditorLeafObject(object)
    ? object.localPivot
    : undefined) ?? {
    x: localBounds.left + localBounds.width / 2,
    y: localBounds.top + localBounds.height / 2,
  };
  return createAffinePlacement({
    localBounds,
    pivot,
    localToScene: multiplyCoordinateMatrices(
      parentLocalToScene,
      coordinateMatrix("object-local", "parent-local", object.localToParent),
    ),
  });
}

function deriveGroupLocalBounds(
  group: EditorGroupObject,
): import("@pooder/core").CoordinateRect<"object-local"> {
  let bounds: import("@pooder/core").CoordinateRect<"object-local"> | undefined;
  for (const child of group.children) {
    const childBounds = isEditorGroupObject(child)
      ? deriveGroupLocalBounds(child)
      : coordinateRect("object-local", {
          left: child.localFrame.x,
          top: child.localFrame.y,
          width: child.localFrame.width,
          height: child.localFrame.height,
        });
    const transformed = transformCoordinateRect(
      coordinateMatrix("object-local", "object-local", child.localToParent),
      childBounds,
    );
    if (!bounds) {
      bounds = transformed;
      continue;
    }
    const left = Math.min(bounds.left, transformed.left);
    const top = Math.min(bounds.top, transformed.top);
    const right = Math.max(
      bounds.left + bounds.width,
      transformed.left + transformed.width,
    );
    const bottom = Math.max(
      bounds.top + bounds.height,
      transformed.top + transformed.height,
    );
    bounds = coordinateRect("object-local", {
      left,
      top,
      width: right - left,
      height: bottom - top,
    });
  }
  return (
    bounds ??
    coordinateRect("object-local", { left: 0, top: 0, width: 0, height: 0 })
  );
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
        if (isEditorGroupObject(object)) {
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
    document.surfaces.some((surface) => {
      visit(
        surface.objects,
        coordinateMatrix("parent-local", "scene", [
          1,
          0,
          0,
          1,
          surface.bounds.x,
          surface.bounds.y,
        ]),
      );
      return Boolean(match);
    });
    return match;
  };

  const rawSnapshot = (ref: GeometryRef): GeometrySnapshot | null => {
    const resolved = findPlacement(ref.geometryId);
    if (!resolved) return null;
    const { object, placement } = resolved;
    if (isEditorGroupObject(object)) {
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
        metadata: { objectId: object.id, group: true },
      };
    }
    const usesFrameGeometry = object.type === "image";
    const visual = usesFrameGeometry
      ? ({ source: object.source } satisfies ResolvedVisual)
      : resolveObjectSource(object);
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
        metadata: { objectId: object.id, objectType: object.type },
      };
    }
    return {
      kind: "rect",
      ref,
      space: "object-local",
      bounds,
      rect: bounds,
      localToScene: visualPlacement.localToScene,
      metadata: { objectId: object.id, objectType: object.type },
    };
  };

  const booleanOperands = (targetId: string, purpose: "preview" | "export") => {
    const document = getDocument();
    if (!document) return [];
    const operands: Array<{
      objectId: string;
      operation: "add" | "subtract" | "intersect" | "exclude";
      sequence: number;
    }> = [];
    let sequence = 0;
    visitDocumentVisualObjects(document, (object) => {
      if (object.id !== targetId) return;
      object.effects?.forEach((effect) => {
        if (
          !isEditorBuiltinObjectEffect(effect) ||
          effect.type !== "core.geometry.boolean"
        )
          return;
        const participation = effect.participation ?? "both";
        if (participation !== "both" && participation !== purpose) return;
        operands.push({
          objectId: effect.operandObjectId,
          operation: effect.operation,
          sequence: sequence++,
        });
      });
    });
    return operands.sort((left, right) => left.sequence - right.sequence);
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
  document.surfaces.forEach((surface) => {
    const visit = (objects: EditorObject[] | undefined) =>
      objects?.forEach((object) => {
        descriptors.push({
          ref: {
            sourceId: DOCUMENT_OBJECT_GEOMETRY_SOURCE_ID,
            geometryId: object.id,
          },
          kind: isEditorGroupObject(object)
            ? "compound"
            : object.type === "image"
              ? "rect"
              : "path",
          space: isEditorGroupObject(object) ? "scene" : "object-local",
          metadata: {
            objectId: object.id,
            sceneId: surface.id,
          },
        });
        if (isEditorGroupObject(object)) visit(object.children);
      });
    visit(surface.objects);
  });
  return descriptors;
}

function rotateObjectLocalToParent(
  localToParent: EditorDocumentMatrix,
  rotationDegrees: number,
): AffineMatrix {
  const [a, b, c, d, e, f] = localToParent;
  const currentRotation = Math.atan2(b, a);
  const targetRotation = (rotationDegrees * Math.PI) / 180;
  const radians = targetRotation - currentRotation;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    cosine * a - sine * b,
    sine * a + cosine * b,
    cosine * c - sine * d,
    sine * c + cosine * d,
    e,
    f,
  ];
}

function createRejectedDocumentSnapshot(): EditorDocument {
  return {
    version: 8,
    assets: [],
    extension: { required: [], states: {} },
    surfaces: [],
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
    surfaces: document.surfaces,
    appliedSurfaceIds,
  };
}

function surfaceToRuntimeBounds(surface: EditorSurface) {
  return {
    bounds: { ...surface.bounds },
    ...(surface.insets ? { insets: { ...surface.insets } } : {}),
  };
}

function createPublicationDiagnostic(
  code: string,
  error: unknown,
): EditorDocumentDiagnostic {
  return {
    severity: "error",
    stage: "runtime-capability",
    code,
    message: error instanceof Error ? error.message : String(error),
    path: "runtime.publication",
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
  objectSchemaRegistry: ObjectSchemaRegistry,
): RenderIntentDraft[] {
  const drafts: RenderIntentDraft[] = [];
  document.surfaces.forEach((surface, surfaceIndex) => {
    const visit = (
      objects: EditorObject[] | undefined,
      parentLocalToScene = coordinateMatrix("parent-local", "scene", [
        1,
        0,
        0,
        1,
        surface.bounds.x,
        surface.bounds.y,
      ]),
      ancestorVisible = true,
      groupId?: string,
      objectsPath = `/surfaces/${surfaceIndex}/objects`,
      pathPrefix: readonly number[] = [],
    ) => {
      objects?.forEach((object, index) => {
        const objectPath = `${objectsPath}/${index}`;
        const orderingPath = [...pathPrefix, index];
        const visible = ancestorVisible && object.visible;
        const framePlacement = createFrameAffinePlacement(
          object,
          parentLocalToScene,
        );
        const interaction = createObjectInteractionAspect(
          object,
          objectSchemaRegistry,
          { document, objectId: object.id, path: objectPath },
        );
        if (isEditorGroupObject(object)) {
          if (interaction) {
            drafts.push(
              createGroupInteractionProxyDraft(
                surface,
                object,
                surfaceIndex,
                orderingPath,
                visible,
                framePlacement,
                interaction,
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
            visible,
            object.id,
            `${objectPath}/children`,
            orderingPath,
          );
          return;
        }
        const draft = createObjectRenderIntentDraft(
          surface,
          object,
          surfaceIndex,
          orderingPath,
          visible,
          resolvedImages.get(object.id),
          object.type === "image"
            ? resolveImageVisualAsset(document, object)
            : undefined,
          framePlacement,
          groupId,
          interaction,
          object.type === "image" && isImageSlotPlaceholderFallback(object),
        );
        if (draft) drafts.push(draft);
      });
    };
    visit(surface.objects);
  });
  const draftsById = new Map(drafts.map((draft) => [draft.id, draft]));
  visitDocumentVisualObjects(document, (object) => {
    object.effects?.forEach((effect, effectIndex) => {
      if (
        !isEditorBuiltinObjectEffect(effect) ||
        effect.type !== "core.geometry.clip"
      )
        return;
      const target = draftsById.get(object.id);
      if (!target) return;
      const participation = effect.participation ?? "both";
      target.effects = [
        ...(target.effects ?? []),
        {
          type: "clipPath",
          id: `document-object:${object.id}:clip:${effectIndex}`,
          coordinateMode: "absolute",
          ...(participation !== "export"
            ? {
                previewGeometryRef: {
                  sourceId: "document-object",
                  geometryId: effect.sourceObjectId,
                  purpose: "preview",
                },
              }
            : {}),
          ...(participation !== "preview"
            ? {
                exportGeometryRef: {
                  sourceId: "document-object",
                  geometryId: effect.sourceObjectId,
                  purpose: "export",
                },
              }
            : {}),
          source: {
            id: `document-object:${effect.sourceObjectId}:clip-placeholder`,
            type: "path",
            space: "scene",
            props: {},
          },
        },
      ];
    });
  });
  return drafts;
}

function visitDocumentVisualObjects(
  document: EditorDocument,
  visitor: (object: EditorLeafObject) => void,
): void {
  const visit = (objects: EditorObject[] | undefined) =>
    objects?.forEach((object) => {
      if (isEditorGroupObject(object)) visit(object.children);
      else visitor(object);
    });
  document.surfaces.forEach((surface) => visit(surface.objects));
}

function createGroupInteractionProxyDraft(
  surface: EditorSurface,
  object: EditorGroupObject,
  layerOrder: number,
  path: readonly number[],
  visible: boolean,
  placement: AffinePlacement,
  interaction: InteractionSpec,
): RenderIntentDraft {
  const memberNodeIds: string[] = [];
  const collectMembers = (children: EditorObject[]) =>
    children.forEach((child) => {
      if (isEditorGroupObject(child)) collectMembers(child.children);
      else memberNodeIds.push(child.id);
    });
  collectMembers(object.children);
  return {
    id: `${object.id}:interaction-proxy`,
    subject: {
      kind: "object",
      sceneId: surface.id,
      layerId: surface.id,
      objectId: object.id,
      objectType: "group",
    },
    visual: { type: "rect", visible },
    containerGeometryRef: {
      sourceId: DOCUMENT_OBJECT_GEOMETRY_SOURCE_ID,
      geometryId: object.id,
      variant: "base",
    },
    placement,
    interaction,
    export: { tags: [...object.tags] },
    ordering: {
      layerId: surface.id,
      layerOrder,
      path,
      channel: "overlay",
      subOrder: 1,
    },
    props: {
      fill: "rgba(0,0,0,0)",
      stroke: null,
      excludeFromExport: true,
    },
    data: {
      id: object.id,
      groupProxy: true,
      groupMemberNodeIds: memberNodeIds,
      documentSurfaceId: surface.id,
      layerId: surface.id,
    },
  };
}

function createObjectRenderIntentDraft(
  surface: EditorSurface,
  object: EditorLeafObject,
  layerOrder: number,
  path: readonly number[],
  visible: boolean,
  imageResolution?: ImageResourceResolution,
  imageAsset?: EditorImageAsset,
  framePlacement: AffinePlacement = createFrameAffinePlacement(object),
  groupId?: string,
  interaction?: InteractionSpec,
  placeholderFallback = false,
): RenderIntentDraft | null {
  const locked = object.locked === true;
  const objectEffects = cloneObjectEffects(object.effects);
  const isGuide =
    object.traits?.some((trait) => trait.type === "core.guide") ?? false;
  const outputMaskKeys = Array.from(
    new Set(
      object.traits
        ?.filter(
          (
            trait,
          ): trait is Extract<
            EditorObjectTrait,
            { type: "core.output-mask" }
          > => trait.type === "core.output-mask",
        )
        .flatMap((trait) => trait.keys) ?? [],
    ),
  );
  const tags = [...object.tags];
  const base = {
    id: object.id,
    subject: {
      kind: "object" as const,
      sceneId: surface.id,
      layerId: surface.id,
      objectId: object.id,
      objectType: object.type,
    },
    placement: framePlacement,
    containerGeometryRef: {
      sourceId: DOCUMENT_OBJECT_GEOMETRY_SOURCE_ID,
      geometryId: object.id,
      variant: "base",
    },
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
      layerId: surface.id,
      layerOrder,
      path,
      channel: "normal" as const,
      subOrder: 0,
    },
    export: {
      tags,
    },
    ...(interaction ? { interaction } : {}),
    props: {
      ...(object.type === "image" ? {} : (object.paint ?? {})),
      opacity: object.opacity ?? 1,
      ...(isGuide || placeholderFallback ? { excludeFromExport: true } : {}),
    },
    data: {
      id: object.id,
      layerId: surface.id,
      documentSurfaceId: surface.id,
      documentObjectType: object.type,
      ...(groupId ? { groupId } : {}),
      ...(objectEffects ? { documentObjectEffects: objectEffects } : {}),
      ...(typeof locked === "boolean" ? { locked } : {}),
      ...(outputMaskKeys.length ? { outputMaskKeys } : {}),
    },
  } satisfies Omit<RenderIntentDraft, "visual">;

  if (object.type === "image") {
    return createImageRenderIntentDraft(
      base,
      object as EditorImageObject,
      visible,
      imageResolution,
      imageAsset,
      placeholderFallback,
      resolveEditorImageClipFrame(
        surface,
        object as EditorImageObject,
        framePlacement,
      ),
    );
  }
  const visual = resolveObjectSource(object);
  if (!visual) return null;
  if (visual.imageUrl) {
    return {
      ...base,
      visual: {
        type: "image",
        src: visual.imageUrl,
        visible,
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
      visual: { type: "path", visible },
      props: {
        ...base.props,
        path: visual.pathData,
        pathData: visual.pathData,
        source: object.source,
      },
    };
  }
  return null;
}

function createImageRenderIntentDraft(
  base: Omit<RenderIntentDraft, "visual">,
  object: EditorImageObject,
  visible: boolean,
  resolution?: ImageResourceResolution,
  resource?: EditorImageAsset,
  placeholderFallback = false,
  clipFrame?: import("@pooder/core").CoordinateRect<"object-local">,
): RenderIntentDraft {
  const resolved = resolution?.ok
    ? resolution
    : resolution === undefined && resource?.intrinsicSize
      ? {
          ok: true as const,
          src:
            resource.source.kind === "data-url"
              ? resource.source.dataUrl
              : resource.source.url,
          width: resource.intrinsicSize.width,
          height: resource.intrinsicSize.height,
        }
      : undefined;
  const image = resolved;
  const contentFit = placeholderFallback
    ? {
        ...object.contentFit,
        fit: "stretch" as const,
        anchorX: 0.5,
        anchorY: 0.5,
        zoom: 1,
        rotation: 0,
      }
    : object.contentFit;
  // Render props carry the fit transform only; clip is a document enum, while
  // the props of the same name hold a resolved rect.
  const { clip: contentClip, ...contentFitTransform } = contentFit;
  const fit = contentFitTransform.fit;
  const geometryDescriptor = image
    ? {
        source: {
          src: image.src,
          size: { width: image.width, height: image.height },
        },
        frame: coordinateRect("object-local", {
          left: object.localFrame.x,
          top: object.localFrame.y,
          width: object.localFrame.width,
          height: object.localFrame.height,
        }),
        fit,
        transform: contentFitTransform,
        ...(contentClip === "frame" && clipFrame ? { clip: clipFrame } : {}),
      }
    : undefined;
  const geometry = geometryDescriptor
    ? resolveImageGeometry(geometryDescriptor)
    : undefined;
  return {
    ...base,
    visual: { type: "image", visible, ...(image ? { src: image.src } : {}) },
    previewGeometryRef: {
      sourceId: "render-intent",
      geometryId: object.id,
      purpose: "preview",
    },
    exportGeometryRef: {
      sourceId: "render-intent",
      geometryId: object.id,
      purpose: "export",
    },
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
      ...contentFitTransform,
      source: object.source,
      opacity: object.opacity ?? 1,
      ...(geometry?.clip ? { clip: geometry.clip } : {}),
    },
    data: {
      ...base.data,
      emptyImageSlot: placeholderFallback,
      ...(placeholderFallback ? { imageSlotVisualFallback: true } : {}),
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
  const content = surfaceContentRect(surface);
  if (!getImageSlotBehaviorConfig(object)) return objectFrame;
  const contentInObject = transformCoordinateRect(
    invertCoordinateMatrix(objectPlacement.localToScene),
    coordinateRect("scene", {
      left: content.x,
      top: content.y,
      width: content.width,
      height: content.height,
    }),
  );
  const left = Math.max(objectFrame.left, contentInObject.left);
  const top = Math.max(objectFrame.top, contentInObject.top);
  const right = Math.min(
    objectFrame.left + objectFrame.width,
    contentInObject.left + contentInObject.width,
  );
  const bottom = Math.min(
    objectFrame.top + objectFrame.height,
    contentInObject.top + contentInObject.height,
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

function getImageSlotBehaviorConfig(
  object: EditorImageObject,
): EditorImageSlotBehaviorConfig | undefined {
  const behavior = object.behaviors?.find(
    (candidate) => candidate.type === "pooder.image-slot",
  );
  return behavior?.config && typeof behavior.config === "object"
    ? (behavior.config as unknown as EditorImageSlotBehaviorConfig)
    : undefined;
}

function resolveImageVisualAsset(
  document: EditorDocument,
  object: EditorImageObject,
): EditorImageAsset | undefined {
  const source =
    object.source ?? getImageSlotBehaviorConfig(object)?.placeholderSource;
  return resolveEditorDocumentAsset<EditorImageAsset>(
    document,
    source,
    "image",
  );
}

function isImageSlotPlaceholderFallback(object: EditorImageObject): boolean {
  return object.source === null && Boolean(getImageSlotBehaviorConfig(object));
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

function imageResourceDescriptor(
  asset: EditorImageAsset,
): ImageResourceDescriptor {
  return {
    ...asset.source,
    assetId: asset.id,
    ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
    ...(asset.intrinsicSize ? { intrinsicSize: asset.intrinsicSize } : {}),
  };
}

/**
 * Read every image resolution the document needs. Resources whose bytes are already
 * established resolve synchronously, so a mutation only awaits genuinely new bytes
 * instead of re-deriving the whole document's resources on every apply.
 */
async function resolveDocumentImageResources(
  runtime: EditorDocumentRuntime,
  document: EditorDocument,
): Promise<Map<string, ImageResourceResolution>> {
  const service = runtime.services.get?.<ImageResourceService>(
    IMAGE_RESOURCE_SERVICE,
  );
  const resolutions = new Map<string, ImageResourceResolution>();
  const pending: Array<Promise<void>> = [];
  const collect = (objects: EditorObject[] | undefined) =>
    objects?.forEach((object) => {
      if (isEditorGroupObject(object)) {
        collect(object.children);
        return;
      }
      if (object.type !== "image" || !service) return;
      const asset = resolveImageVisualAsset(document, object);
      if (!asset) return;
      const resource = imageResourceDescriptor(asset);
      const established = service.read(resource);
      if (established) {
        resolutions.set(object.id, established);
        return;
      }
      pending.push(
        service.ensure(resource).then((resolution) => {
          resolutions.set(object.id, resolution);
        }),
      );
    });
  document.surfaces.forEach((surface) => collect(surface.objects));
  if (pending.length) await Promise.all(pending);
  return resolutions;
}

/**
 * Ids of the image objects whose bytes cannot be resolved. Such an object compiles to
 * an image visual with no source and therefore draws nothing, so an export taken now
 * would silently omit it — which is why callers that produce artwork must ask first
 * rather than trusting the rendered canvas.
 *
 * Hidden objects still export when tagged, so missing bytes there would also
 * silently omit artwork. Image-slot placeholders are excluded because they never
 * reach the exported pixels. Resources are converged before being judged, so the
 * answer does not depend on whether the document has been applied yet; established
 * ones cost no I/O.
 */
export async function collectUnresolvableImageObjectIds(
  document: EditorDocument,
  service: Pick<ImageResourceService, "read" | "ensure"> | undefined,
): Promise<string[]> {
  if (!service) return [];
  const unresolvable: string[] = [];
  const pending: Array<Promise<void>> = [];
  const judge = (objectId: string, resolution: ImageResourceResolution) => {
    if (!resolution.ok) unresolvable.push(objectId);
  };
  const collect = (objects: EditorObject[] | undefined) =>
    objects?.forEach((object) => {
      if (isEditorGroupObject(object)) {
        collect(object.children);
        return;
      }
      if (object.type !== "image") return;
      if (isImageSlotPlaceholderFallback(object)) return;
      const asset = resolveImageVisualAsset(document, object);
      if (!asset) return;
      const resource = imageResourceDescriptor(asset);
      const established = service.read(resource);
      if (established) {
        judge(object.id, established);
        return;
      }
      pending.push(
        service.ensure(resource).then((resolution) => {
          judge(object.id, resolution);
        }),
      );
    });
  document.surfaces.forEach((surface) => collect(surface.objects));
  if (pending.length) await Promise.all(pending);
  return unresolvable;
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
    const collectObjectEntries = (
      objects: EditorObject[] | undefined,
      objectsPath: string,
    ) =>
      objects?.forEach((object, objectIndex) => {
        const objectPath = `${objectsPath}/${objectIndex}`;
        if (isEditorLeafObject(object)) {
          object.effects?.forEach((effect, effectIndex) => {
            if (isEditorExtensionObjectEffect(effect)) {
              entries.push({
                effect,
                context: { surface, object },
                path: `${objectPath}/effects/${effectIndex}`,
              });
            }
          });
        }
        if (isEditorGroupObject(object)) {
          collectObjectEntries(object.children, `${objectPath}/children`);
        }
      });
    collectObjectEntries(surface.objects, `/surfaces/${surfaceIndex}/objects`);
  });
  return entries;
}

function createObjectInteractionAspect(
  object: EditorObject,
  registry: ObjectSchemaRegistry,
  context: ObjectSchemaContext,
): InteractionSpec | undefined {
  const behaviorInteraction = object.behaviors?.reduce<InteractionSpec>(
    (compiled, behavior) => {
      const interaction = registry
        .getBehavior(behavior.type)
        ?.compileInteraction?.(behavior, context);
      return interaction
        ? { ...compiled, ...normalizeBehaviorInteraction(interaction) }
        : compiled;
    },
    {},
  );
  if (!object.interaction && !Object.keys(behaviorInteraction ?? {}).length) {
    return undefined;
  }
  return {
    ...(behaviorInteraction ?? {}),
    ...(object.interaction as DocumentInteractionSpec | undefined),
  };
}

function normalizeBehaviorInteraction(
  interaction: ObjectBehaviorInteractionSpec,
): InteractionSpec {
  const { activation, ...rest } = interaction;
  if (!activation) return rest;
  const { session, ...activationRest } = activation;
  return {
    ...rest,
    activation: {
      ...activationRest,
      ...(session
        ? {
            session: {
              ...session,
              scope: session.scope === "surface" ? "scene" : session.scope,
            },
          }
        : {}),
    },
  };
}

function resolveRenderIntentTarget(
  _effect: EditorExtensionObjectEffect,
  context: EffectContext,
  _document: EditorDocument,
): RenderIntentDraft["subject"] | null {
  if (!context.object) return null;
  return {
    kind: "object",
    sceneId: context.surface.id,
    layerId: context.surface.id,
    objectId: context.object.id,
    objectType: context.object.type,
  };
}

function findObjectContext(document: EditorDocument, objectId: string) {
  for (const surface of document.surfaces) {
    const object = findEditorDocumentObject(
      { ...document, surfaces: [surface] },
      objectId,
    );
    if (object) return { surface, object };
  }
  return null;
}

function severityForEffect(
  _effect: EditorExtensionObjectEffect,
): EditorDocumentDiagnostic["severity"] {
  return "error";
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
        .map((draft) => draft.subject.sceneId)
        .filter((sceneId) => sceneId.length > 0),
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

function resolveShapeSource(
  source: EditorShapeContent,
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
