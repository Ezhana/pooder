import { TypedEventEmitter } from "./typed-event";
import type Disposable from "./disposable";
import type { Service } from "./service";
import {
  coordinateMatrix,
  multiplyCoordinateMatrices,
  type AffinePlacement,
  type Matrix2D,
} from "./coordinate";
import type {
  RenderCoordinateSpace,
  RenderEffectSpec,
  RenderObjectSpec,
  RuntimeConditionEvalContext,
  RuntimeConditionExpr,
} from "./render";
import type {
  InteractionOperationSpec,
  InteractionSpec,
} from "./interaction-service";
import type {
  GeometryRef,
  GeometrySource,
  GeometrySnapshot,
} from "./geometry-source";

export type RenderIntentSubjectKind = "surface" | "layer" | "object";
export type RenderIntentChannel =
  | "background"
  | "normal"
  | "fallback"
  | "replacement"
  | "overlay"
  | "effect";

export interface RenderIntentSubject {
  kind: RenderIntentSubjectKind;
  surfaceId: string;
  layerId?: string;
  objectId?: string;
  objectType?: string;
}

export interface RenderIntentSource {
  src?: string;
  metadata?: Record<string, unknown>;
}

export interface RenderIntentVisualAspect extends RenderIntentSource {
  type?: RenderObjectSpec["type"];
  fallback?: RenderIntentSource;
  replacement?: RenderIntentSource;
}

export type RenderIntentPlacementAspect = AffinePlacement;

export interface RenderIntentExportAspect {
  keys?: readonly string[];
  tags?: readonly string[];
  visible?: boolean;
  visibleWhen?: RuntimeConditionExpr;
}

export interface RenderIntentOrderingAspect {
  layerId: string;
  layerOrder?: number;
  objectOrder?: number;
  channel?: RenderIntentChannel;
  subOrder?: number;
}

export interface RenderIntentDraft {
  id: string;
  subject: RenderIntentSubject;
  visual?: RenderIntentVisualAspect;
  /** Logical container geometry, excluding boolean and visual placement. */
  containerGeometryRef?: GeometryRef;
  /** Final visual geometry used by interactive preview renderers. */
  previewGeometryRef?: GeometryRef;
  /** Final visual geometry used by export renderers. */
  exportGeometryRef?: GeometryRef;
  placement?: RenderIntentPlacementAspect;
  effects?: RenderEffectSpec[];
  interaction?: InteractionSpec;
  export?: RenderIntentExportAspect;
  coordinateSpace?: RenderCoordinateSpace;
  ordering: RenderIntentOrderingAspect;
  props?: Record<string, unknown>;
  data?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export type RenderIntentPatch = Partial<
  Omit<RenderIntentDraft, "id" | "subject" | "ordering">
> & {
  id: string;
  /** Local-space post-transform composed onto the canonical placement. */
  placementTransform?: Matrix2D<"object-local", "object-local">;
  subject?: Partial<RenderIntentSubject>;
  ordering?: Partial<RenderIntentOrderingAspect>;
  clear?: readonly RenderIntentPatchClearPath[];
};

export type RenderIntentPatchClearPath = string;

export type RenderIntentPatchPhase =
  | "document"
  | "layout"
  | "render"
  | "interaction"
  | "export"
  | "runtime"
  | string;

export interface RenderIntentPatchEntry {
  sourceId: string;
  patch: RenderIntentPatch;
  priority?: number;
  phase?: RenderIntentPatchPhase;
  sequence?: number;
  reason?: string;
  debugLabel?: string;
}

export interface RenderGraphSortKey {
  layerOrder: number;
  objectOrder: number;
  channel: RenderIntentChannel;
  channelOrder: number;
  subOrder: number;
}

export interface RenderGraphNode {
  id: string;
  subjectId: string;
  layerId: string;
  surfaceId: string;
  type: RenderObjectSpec["type"];
  visual?: RenderIntentSource;
  containerGeometryRef: GeometryRef;
  previewGeometryRef: GeometryRef;
  exportGeometryRef: GeometryRef;
  coordinateSpace: "scene";
  exportKeys: string[];
  placement: AffinePlacement;
  props: Record<string, unknown>;
  data: Record<string, unknown>;
  effects: RenderEffectSpec[];
  interaction?: InteractionSpec;
  visibleWhen?: RuntimeConditionExpr;
  visible: boolean;
  tags: string[];
  sortKey: RenderGraphSortKey;
}

/**
 * Authoritative one-to-many mapping from a logical subject to its independent
 * render projections. Backends may materialize every node differently, but
 * selection and interaction must resolve through this membership first.
 */
export interface RenderGraphProjectionMembership {
  subjectId: string;
  nodeIds: string[];
}

export interface RenderGraphLayer {
  id: string;
  surfaceId: string;
  order: number;
  visible: boolean;
  nodes: RenderGraphNode[];
  effects: RenderEffectSpec[];
  metadata?: Record<string, unknown>;
}

export interface RenderGraph {
  revision: number;
  surfaceIds: string[];
  layers: RenderGraphLayer[];
  projectionMemberships: RenderGraphProjectionMembership[];
  diagnostics: RenderIntentDiagnostic[];
}

export interface RenderGraphNodeSelector {
  /** Logical document/runtime subject ids. */
  ids?: readonly string[];
  /** Runtime projection ids; use only for projection-specific diagnostics. */
  projectionIds?: readonly string[];
  tags?: readonly string[];
  tagMatch?: "all" | "any";
  visible?: boolean;
}

export function selectRenderGraphNodes(
  graph: RenderGraph,
  selector: RenderGraphNodeSelector = {},
): RenderGraphNode[] {
  const ids = selectorValues(selector.ids);
  const projectionIds = selectorValues(selector.projectionIds);
  const tags = selectorValues(selector.tags);
  return graph.layers.flatMap((layer) =>
    layer.nodes.filter((node) => {
      if (ids && !ids.has(node.subjectId)) return false;
      if (projectionIds && !projectionIds.has(node.id)) return false;
      if (selector.visible !== undefined && node.visible !== selector.visible)
        return false;
      if (!tags) return true;
      const nodeTags = new Set(node.tags);
      return selector.tagMatch === "any"
        ? Array.from(tags).some((tag) => nodeTags.has(tag))
        : Array.from(tags).every((tag) => nodeTags.has(tag));
    }),
  );
}

export function selectOneRenderGraphNode(
  graph: RenderGraph,
  selector: RenderGraphNodeSelector,
): RenderGraphNode | undefined {
  const nodes = selectRenderGraphNodes(graph, selector);
  if (nodes.length > 1) throw new Error("render-graph-selector-ambiguous");
  return nodes[0];
}

function selectorValues(
  values: readonly string[] | undefined,
): Set<string> | undefined {
  if (!values?.length) return undefined;
  const normalized = new Set(
    values.map((value) => value.trim()).filter(Boolean),
  );
  return normalized.size ? normalized : undefined;
}

export type RenderIntentDocumentPublicationMode = "replace" | "update";

/**
 * Opaque candidate produced without mutating the live RenderIntent state.
 * Publish rejects candidates prepared before a runtime patch changed.
 */
export interface PreparedRenderIntentDocumentPublication {
  readonly graph: RenderGraph;
}

export interface RenderIntentCompilerContext<
  TEffect = unknown,
  TDocument = unknown,
> {
  document: TDocument;
  effect: TEffect;
  services?: unknown;
  target: RenderIntentSubject;
}

export interface RenderIntentCompilerContribution<
  TEffect = unknown,
  TDocument = unknown,
> {
  capabilityId?: string;
  effectType?: string;
  compile(
    context: RenderIntentCompilerContext<TEffect, TDocument>,
  ):
    | RenderIntentPatch[]
    | RenderIntentPatch
    | void
    | Promise<RenderIntentPatch[] | RenderIntentPatch | void>;
}

export interface RegisteredRenderIntentCompiler extends RenderIntentCompilerContribution {
  extensionId: string;
}

export interface RenderIntentCompilerQuery {
  capabilityId?: string;
  effectType: string;
}

export type RenderIntentChangeReason =
  | { type: "base-replaced" }
  | { type: "base-updated"; intentIds: string[] }
  | {
      type: "runtime-patch";
      operation: "upsert" | "remove" | "clear";
      sourceId?: string;
      intentIds: string[];
    }
  | {
      type: "runtime-condition";
      operation: "set" | "delete" | "clear";
      keys: string[];
    };

export interface RenderIntentChangeEvent {
  graph: RenderGraph;
  reason: RenderIntentChangeReason;
  revision: number;
}

export type RenderIntentDiagnosticSeverity = "warning" | "error";

export type RenderIntentDiagnosticCode =
  | "render-intent-patch-base-missing"
  | "render-intent-clear-path-invalid"
  | "render-intent-field-conflict"
  | "render-intent-missing-layer"
  | "render-intent-missing-placement"
  | "render-intent-non-scene-space";

export interface RenderIntentDiagnostic {
  code: RenderIntentDiagnosticCode;
  severity: RenderIntentDiagnosticSeverity;
  message: string;
  patchId?: string;
  sourceId?: string;
  field?: string;
  reason?: string;
  debugLabel?: string;
}

export interface RenderIntentPatchMergeResult {
  draft?: RenderIntentDraft;
  diagnostics: RenderIntentDiagnostic[];
}

export interface RenderIntentPatchBatchMergeResult {
  drafts: RenderIntentDraft[];
  diagnostics: RenderIntentDiagnostic[];
}

const CHANNEL_ORDER: Record<RenderIntentChannel, number> = {
  background: 0,
  normal: 10,
  fallback: 10,
  replacement: 10,
  overlay: 20,
  effect: 30,
};

const PATCH_PHASE_ORDER: Record<string, number> = {
  document: 0,
  layout: 10,
  render: 20,
  interaction: 30,
  export: 40,
  runtime: 50,
};

const CRITICAL_PATCH_FIELDS = [
  "visual.replacement",
  "placement.localBounds",
  "placement.localToScene",
  "placementTransform",
  "ordering.layerId",
  "export.visibleWhen",
] as const;

const CLEARABLE_ROOT_FIELDS = new Set([
  "subject",
  "visual",
  "containerGeometryRef",
  "previewGeometryRef",
  "exportGeometryRef",
  "placement",
  "effects",
  "interaction",
  "export",
  "coordinateSpace",
  "ordering",
  "props",
  "data",
  "extensions",
]);

class RegistryDisposable implements Disposable {
  private disposed = false;

  constructor(private readonly disposeFn: () => void) {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeFn();
  }
}

export class RenderIntentCompilerRegistryService implements Service {
  private readonly compilers: RegisteredRenderIntentCompiler[] = [];

  init(): void {}

  registerCompiler(
    extensionId: string,
    compiler: RenderIntentCompilerContribution,
  ): Disposable {
    const effectType = String(compiler.effectType || "").trim();
    const capabilityId = String(compiler.capabilityId || "").trim();
    if (!effectType && !capabilityId) {
      throw new Error(
        "Render intent compiler requires effectType or capabilityId.",
      );
    }

    const registered: RegisteredRenderIntentCompiler = {
      ...compiler,
      ...(capabilityId ? { capabilityId } : {}),
      ...(effectType ? { effectType } : {}),
      extensionId,
    };
    this.compilers.push(registered);

    return new RegistryDisposable(() => {
      const index = this.compilers.indexOf(registered);
      if (index >= 0) this.compilers.splice(index, 1);
    });
  }

  getCompilers(
    query: RenderIntentCompilerQuery,
  ): RegisteredRenderIntentCompiler[] {
    const capabilityId = String(query.capabilityId || "").trim();
    const effectType = String(query.effectType || "").trim();
    return this.compilers.filter((compiler) => {
      if (compiler.capabilityId && compiler.capabilityId !== capabilityId) {
        return false;
      }
      if (compiler.effectType && compiler.effectType !== effectType) {
        return false;
      }
      return true;
    });
  }

  hasCompiler(query: RenderIntentCompilerQuery): boolean {
    return this.getCompilers(query).length > 0;
  }

  listCompilers(): RegisteredRenderIntentCompiler[] {
    return this.compilers.slice();
  }
}

export class RenderIntentService implements Service {
  private readonly events = new TypedEventEmitter<{
    change: RenderIntentChangeEvent;
  }>();
  private baseIntents: RenderIntentDraft[] = [];
  private runtimePatches = new Map<string, RequiredRuntimePatchEntry>();
  private runtimeConditionValues = new Map<string, unknown>();
  private graph: RenderGraph = createRenderGraph([], 0);
  private revision = 0;
  private runtimePatchSequence = 0;
  private runtimePatchRevision = 0;
  private readonly preparedDocumentPublications = new WeakMap<
    PreparedRenderIntentDocumentPublication,
    {
      baseIntents: RenderIntentDraft[];
      graph: RenderGraph;
      reason: RenderIntentChangeReason | null;
      runtimePatchRevision: number;
    }
  >();
  private readonly pendingDocumentPublicationNotifications = new WeakMap<
    PreparedRenderIntentDocumentPublication,
    RenderIntentChangeReason | null
  >();

  init(): void {}

  setDocumentIntents(intents: readonly RenderIntentDraft[]): RenderGraph {
    return this.publishDocumentIntents(
      this.prepareDocumentIntents(intents, "replace"),
    );
  }

  updateDocumentIntents(intents: readonly RenderIntentDraft[]): RenderGraph {
    return this.publishDocumentIntents(
      this.prepareDocumentIntents(intents, "update"),
    );
  }

  prepareDocumentIntents(
    intents: readonly RenderIntentDraft[],
    mode: RenderIntentDocumentPublicationMode = "replace",
  ): PreparedRenderIntentDocumentPublication {
    const baseIntents = intents.map(cloneDraft);
    const merged = mergeRenderIntentPatchEntries(
      baseIntents,
      Array.from(this.runtimePatches.values()),
    );
    const graph = createRenderGraph(
      merged.drafts,
      this.revision + 1,
      merged.diagnostics,
    );
    const reason =
      mode === "replace"
        ? ({ type: "base-replaced" } as const)
        : createBaseUpdateReason(this.graph, graph);
    const publication: PreparedRenderIntentDocumentPublication = {
      graph: cloneGraph(graph),
    };
    this.preparedDocumentPublications.set(publication, {
      baseIntents,
      graph,
      reason,
      runtimePatchRevision: this.runtimePatchRevision,
    });
    return publication;
  }

  publishDocumentIntents(
    publication: PreparedRenderIntentDocumentPublication,
    options: { notify?: boolean } = {},
  ): RenderGraph {
    const prepared = this.requireCurrentDocumentPublication(publication);
    this.preparedDocumentPublications.delete(publication);
    this.baseIntents = prepared.baseIntents;
    this.graph = prepared.graph;
    this.revision = prepared.graph.revision;
    if (options.notify === false) {
      this.pendingDocumentPublicationNotifications.set(
        publication,
        prepared.reason,
      );
    } else if (prepared.reason) {
      this.emitChange(prepared.reason);
    }
    return this.getGraph();
  }

  assertDocumentIntentsPublicationCurrent(
    publication: PreparedRenderIntentDocumentPublication,
  ): void {
    this.requireCurrentDocumentPublication(publication);
  }

  notifyDocumentIntentsPublished(
    publication: PreparedRenderIntentDocumentPublication,
  ): void {
    if (!this.pendingDocumentPublicationNotifications.has(publication)) {
      throw new Error(
        "RenderIntent publication has no pending change notification.",
      );
    }
    const reason =
      this.pendingDocumentPublicationNotifications.get(publication) ?? null;
    this.pendingDocumentPublicationNotifications.delete(publication);
    if (reason) this.emitChange(reason);
  }

  getDocumentIntents(): RenderIntentDraft[] {
    return this.baseIntents.map(cloneDraft);
  }

  getGraph(): RenderGraph {
    return cloneGraph(this.graph);
  }

  getRuntimeConditionValue(key: string): unknown {
    return this.runtimeConditionValues.get(
      normalizeId(key, "runtime condition key"),
    );
  }

  setRuntimeConditionValue(key: string, value: unknown): boolean {
    const normalizedKey = normalizeId(key, "runtime condition key");
    const previous = this.runtimeConditionValues.get(normalizedKey);
    if (Object.is(previous, value)) return false;
    this.runtimeConditionValues.set(normalizedKey, value);
    this.emitChange({
      type: "runtime-condition",
      operation: "set",
      keys: [normalizedKey],
    });
    return true;
  }

  deleteRuntimeConditionValue(key: string): boolean {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return false;
    const removed = this.runtimeConditionValues.delete(normalizedKey);
    if (removed) {
      this.emitChange({
        type: "runtime-condition",
        operation: "delete",
        keys: [normalizedKey],
      });
    }
    return removed;
  }

  clearRuntimeConditionValues(): boolean {
    if (!this.runtimeConditionValues.size) return false;
    const keys = Array.from(this.runtimeConditionValues.keys());
    this.runtimeConditionValues.clear();
    this.emitChange({
      type: "runtime-condition",
      operation: "clear",
      keys,
    });
    return true;
  }

  createRuntimeConditionContext(
    extra: Partial<RuntimeConditionEvalContext> = {},
  ): RuntimeConditionEvalContext {
    return {
      ...extra,
      getContextValue: (key: string) => {
        const normalizedKey = String(key || "").trim();
        if (!normalizedKey) return undefined;
        const extraValue = extra.getContextValue?.(normalizedKey);
        return extraValue !== undefined
          ? extraValue
          : this.runtimeConditionValues.get(normalizedKey);
      },
    };
  }

  patchIntent(sourceId: string, patch: RenderIntentPatch): RenderGraph {
    this.upsertRuntimePatchEntry({
      sourceId,
      patch,
      phase: "runtime",
      priority: 0,
    });
    return this.recompile({
      type: "runtime-patch",
      operation: "upsert",
      sourceId,
      intentIds: [patch.id],
    });
  }

  patchIntentEntry(entry: RenderIntentPatchEntry): RenderGraph {
    this.upsertRuntimePatchEntry(entry);
    return this.recompile({
      type: "runtime-patch",
      operation: "upsert",
      sourceId: entry.sourceId,
      intentIds: [entry.patch.id],
    });
  }

  clearRuntimePatch(sourceId: string, intentId: string): boolean {
    const source = normalizeId(sourceId, "RenderIntentPatch.sourceId");
    const id = normalizeId(intentId, "RenderIntentPatch.id");
    if (!this.runtimePatches.delete(getRuntimePatchKey(source, id)))
      return false;
    this.runtimePatchRevision += 1;
    this.recompile({
      type: "runtime-patch",
      operation: "remove",
      sourceId: source,
      intentIds: [id],
    });
    return true;
  }

  clearRuntimePatches(sourceId?: string): boolean {
    if (sourceId === undefined) {
      if (this.runtimePatches.size === 0) return false;
      const intentIds = Array.from(
        new Set(
          Array.from(this.runtimePatches.values()).map(
            (entry) => entry.patch.id,
          ),
        ),
      );
      this.runtimePatches.clear();
      this.runtimePatchRevision += 1;
      this.recompile({
        type: "runtime-patch",
        operation: "clear",
        intentIds,
      });
      return true;
    }
    const source = normalizeId(sourceId, "RenderIntentPatch.sourceId");
    let removed = false;
    const intentIds: string[] = [];
    for (const key of Array.from(this.runtimePatches.keys())) {
      if (this.runtimePatches.get(key)?.sourceId === source) {
        intentIds.push(this.runtimePatches.get(key)!.patch.id);
        this.runtimePatches.delete(key);
        removed = true;
      }
    }
    if (!removed) return false;
    this.runtimePatchRevision += 1;
    this.recompile({
      type: "runtime-patch",
      operation: "clear",
      sourceId: source,
      intentIds: Array.from(new Set(intentIds)),
    });
    return true;
  }

  onDidChange(callback: (event: RenderIntentChangeEvent) => void): Disposable {
    return this.events.on("change", callback);
  }

  private recompile(reason: RenderIntentChangeReason): RenderGraph {
    this.revision += 1;
    const merged = mergeRenderIntentPatchEntries(
      this.baseIntents,
      Array.from(this.runtimePatches.values()),
    );
    this.graph = createRenderGraph(
      merged.drafts,
      this.revision,
      merged.diagnostics,
    );
    this.emitChange(reason);
    return this.getGraph();
  }

  private emitChange(reason: RenderIntentChangeReason): void {
    this.events.emit("change", {
      graph: cloneGraph(this.graph),
      reason,
      revision: this.revision,
    });
  }

  private upsertRuntimePatchEntry(entry: RenderIntentPatchEntry): void {
    const sourceId = normalizeId(entry.sourceId, "RenderIntentPatch.sourceId");
    const patchId = normalizeId(entry.patch.id, "RenderIntentPatch.id");
    const key = getRuntimePatchKey(sourceId, patchId);
    const existing = this.runtimePatches.get(key);
    const sequence =
      entry.sequence ?? existing?.sequence ?? this.runtimePatchSequence++;
    this.runtimePatches.set(key, normalizePatchEntry(entry, sequence));
    this.runtimePatchRevision += 1;
  }

  private requireCurrentDocumentPublication(
    publication: PreparedRenderIntentDocumentPublication,
  ) {
    const prepared = this.preparedDocumentPublications.get(publication);
    if (!prepared) {
      throw new Error(
        "RenderIntent publication is invalid or already published.",
      );
    }
    if (prepared.runtimePatchRevision !== this.runtimePatchRevision) {
      throw new Error(
        "RenderIntent publication is stale because runtime patches changed after prepare.",
      );
    }
    return prepared;
  }
}

function createBaseUpdateReason(
  previous: RenderGraph,
  next: RenderGraph,
): RenderIntentChangeReason | null {
  const intentIds = collectChangedRenderIntentIds(previous, next);
  return intentIds.length ? { type: "base-updated", intentIds } : null;
}

function collectChangedRenderIntentIds(
  previous: RenderGraph,
  next: RenderGraph,
): string[] {
  const before = collectRenderIntentSnapshots(previous);
  const after = collectRenderIntentSnapshots(next);
  return Array.from(new Set([...before.keys(), ...after.keys()]))
    .filter(
      (intentId) => !sameJsonValue(before.get(intentId), after.get(intentId)),
    )
    .sort();
}

function collectRenderIntentSnapshots(graph: RenderGraph) {
  const snapshots = new Map<string, unknown[]>();
  graph.layers.forEach((layer) => {
    layer.nodes.forEach((node) => {
      const intentId = String(node.data.renderIntentId || node.id);
      const entries = snapshots.get(intentId) ?? [];
      entries.push({
        layer: {
          effects: layer.effects,
          id: layer.id,
          order: layer.order,
          surfaceId: layer.surfaceId,
          visible: layer.visible,
        },
        node,
      });
      snapshots.set(intentId, entries);
    });
  });
  return snapshots;
}

type RequiredRuntimePatchEntry = RenderIntentPatchEntry & {
  priority: number;
  phase: RenderIntentPatchPhase;
  sequence: number;
};

export function reduceRenderIntentDrafts(
  drafts: readonly RenderIntentDraft[],
): RenderIntentDraft[] {
  const byId = new Map<string, RenderIntentDraft>();
  drafts.forEach((draft) => {
    const current = byId.get(draft.id);
    byId.set(
      draft.id,
      current ? mergeDraft(current, draft) : cloneDraft(draft),
    );
  });
  return Array.from(byId.values());
}

export function mergeRenderIntentPatchDraft(
  drafts: readonly RenderIntentDraft[],
  patch: RenderIntentPatch,
): RenderIntentPatchMergeResult {
  const result = mergeRenderIntentPatchEntries(drafts, [
    {
      sourceId: "document",
      patch,
      phase: "document",
      priority: 0,
      sequence: 0,
    },
  ]);
  return {
    draft: findLastRenderIntentDraft(result.drafts, patch.id),
    diagnostics: result.diagnostics,
  };
}

export function mergeRenderIntentPatchEntries(
  drafts: readonly RenderIntentDraft[],
  entries: readonly RenderIntentPatchEntry[],
): RenderIntentPatchBatchMergeResult {
  const result = reduceRenderIntentDrafts(drafts);
  const normalizedEntries = entries
    .map((entry, index) => normalizePatchEntry(entry, entry.sequence ?? index))
    .sort(comparePatchEntries);
  const diagnostics = collectPatchConflictDiagnostics(normalizedEntries);

  normalizedEntries.forEach((entry) => {
    const patch = entry.patch;
    const index = result.findIndex((draft) => draft.id === patch.id);
    if (index >= 0) {
      const mergeResult = mergePatch(result[index], patch, entry);
      result[index] = mergeResult.draft;
      diagnostics.push(...mergeResult.diagnostics);
      return;
    }

    const subject = patch.subject;
    const ordering = patch.ordering;
    const surfaceId = subject?.surfaceId;
    const layerId = ordering?.layerId;
    if (!surfaceId || !layerId) {
      diagnostics.push({
        code: "render-intent-patch-base-missing",
        severity: "error",
        patchId: patch.id,
        sourceId: entry.sourceId,
        reason: entry.reason,
        debugLabel: entry.debugLabel,
        message:
          `RenderIntentPatch "${patch.id}" has no base intent and must ` +
          "provide subject.surfaceId and ordering.layerId.",
      });
      return;
    }

    const draft = createDraftFromPatch(
      patch,
      { ...subject, surfaceId },
      { ...ordering, layerId },
    );
    const mergeResult = applyPatchClear(draft, patch, entry);
    result.push(mergeResult.draft);
    diagnostics.push(...mergeResult.diagnostics);
  });

  return {
    drafts: result,
    diagnostics,
  };
}

function normalizePatchEntry(
  entry: RenderIntentPatchEntry,
  sequence: number,
): RequiredRuntimePatchEntry {
  const sourceId = normalizeId(entry.sourceId, "RenderIntentPatch.sourceId");
  const patchId = normalizeId(entry.patch.id, "RenderIntentPatch.id");
  return {
    sourceId,
    patch: clonePatch({ ...entry.patch, id: patchId }),
    priority: entry.priority ?? 0,
    phase: entry.phase ?? "runtime",
    sequence,
    reason: entry.reason,
    debugLabel: entry.debugLabel,
  };
}

function comparePatchEntries(
  left: RequiredRuntimePatchEntry,
  right: RequiredRuntimePatchEntry,
): number {
  return (
    left.priority - right.priority ||
    getPhaseOrder(left.phase) - getPhaseOrder(right.phase) ||
    left.sequence - right.sequence ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.patch.id.localeCompare(right.patch.id)
  );
}

function getPhaseOrder(phase: RenderIntentPatchPhase): number {
  return PATCH_PHASE_ORDER[phase] ?? 100;
}

function getRuntimePatchKey(sourceId: string, patchId: string): string {
  return `${sourceId}\u0000${patchId}`;
}

function collectPatchConflictDiagnostics(
  entries: readonly RequiredRuntimePatchEntry[],
): RenderIntentDiagnostic[] {
  const seen = new Map<
    string,
    { sourceId: string; value: unknown; entry: RequiredRuntimePatchEntry }
  >();
  const diagnostics: RenderIntentDiagnostic[] = [];

  entries.forEach((entry) => {
    CRITICAL_PATCH_FIELDS.forEach((field) => {
      const touched = getTouchedPatchFieldValue(entry.patch, field);
      if (!touched.touched) return;
      const key = `${entry.patch.id}:${field}`;
      const previous = seen.get(key);
      if (!previous) {
        seen.set(key, {
          sourceId: entry.sourceId,
          value: touched.value,
          entry,
        });
        return;
      }
      if (
        previous.sourceId === entry.sourceId ||
        sameJsonValue(previous.value, touched.value)
      ) {
        return;
      }
      diagnostics.push({
        code: "render-intent-field-conflict",
        severity: "warning",
        patchId: entry.patch.id,
        sourceId: entry.sourceId,
        field,
        reason: entry.reason,
        debugLabel: entry.debugLabel,
        message:
          `RenderIntentPatch "${entry.patch.id}" field "${field}" is modified ` +
          `by both "${previous.sourceId}" and "${entry.sourceId}".`,
      });
    });
  });

  return diagnostics;
}

function getTouchedPatchFieldValue(
  patch: RenderIntentPatch,
  field: string,
): { touched: boolean; value?: unknown } {
  if (patch.clear?.some((path) => isSameOrParentClearPath(path, field))) {
    return { touched: true, value: { clear: true } };
  }
  const value = getPathValue(patch, field);
  return value === undefined ? { touched: false } : { touched: true, value };
}

function isSameOrParentClearPath(path: string, field: string): boolean {
  return field === path || field.startsWith(`${path}.`);
}

function findLastRenderIntentDraft(
  drafts: readonly RenderIntentDraft[],
  id: string,
): RenderIntentDraft | undefined {
  for (let index = drafts.length - 1; index >= 0; index -= 1) {
    if (drafts[index]?.id === id) return drafts[index];
  }
  return undefined;
}

export function createRenderGraph(
  drafts: readonly RenderIntentDraft[],
  revision = 0,
  inputDiagnostics: readonly RenderIntentDiagnostic[] = [],
): RenderGraph {
  const diagnostics: RenderIntentDiagnostic[] = [...inputDiagnostics];
  const layerMap = new Map<string, RenderGraphLayer>();
  const surfaceIds = new Set<string>();
  const reducedDrafts = reduceRenderIntentDrafts(drafts);

  reducedDrafts.forEach((draft) => {
    const layerId = draft.ordering.layerId;
    if (!layerId) {
      diagnostics.push({
        code: "render-intent-missing-layer",
        severity: "error",
        patchId: draft.id,
        field: "ordering.layerId",
        message: `RenderIntent "${draft.id}" is missing ordering.layerId.`,
      });
      return;
    }
    surfaceIds.add(draft.subject.surfaceId);
    const layer = getOrCreateGraphLayer(layerMap, draft);
    if (draft.coordinateSpace && draft.coordinateSpace !== "scene") {
      diagnostics.push({
        code: "render-intent-non-scene-space",
        severity: "error",
        patchId: draft.id,
        field: "coordinateSpace",
        message:
          `RenderIntent "${draft.id}" uses ${draft.coordinateSpace} space. ` +
          "Formal RenderGraph nodes must be projected to scene space first.",
      });
      return;
    }
    if (draft.visual?.type && !draft.placement) {
      diagnostics.push({
        code: "render-intent-missing-placement",
        severity: "error",
        patchId: draft.id,
        field: "placement",
        message: `RenderIntent "${draft.id}" must provide an affine placement.`,
      });
      return;
    }
    const node = createGraphNode(draft);
    if (node) {
      layer.nodes.push(node);
    }
    if (draft.subject.kind === "layer" && draft.effects?.length) {
      layer.effects.push(...draft.effects.map(cloneRecord));
    }
  });

  const layers = Array.from(layerMap.values())
    .map((layer) => ({
      ...layer,
      nodes: layer.nodes.sort(compareGraphNodes),
    }))
    .sort(compareGraphLayers);
  const projectionMemberships = collectProjectionMemberships(layers);

  return {
    revision,
    surfaceIds: Array.from(surfaceIds.values()),
    layers,
    projectionMemberships,
    diagnostics,
  };
}

function collectProjectionMemberships(
  layers: readonly RenderGraphLayer[],
): RenderGraphProjectionMembership[] {
  const memberships = new Map<string, string[]>();
  layers.forEach((layer) => {
    layer.nodes.forEach((node) => {
      const nodeIds = memberships.get(node.subjectId) ?? [];
      nodeIds.push(node.id);
      memberships.set(node.subjectId, nodeIds);
    });
  });
  return Array.from(memberships, ([subjectId, nodeIds]) => ({
    subjectId,
    nodeIds,
  })).sort((left, right) => left.subjectId.localeCompare(right.subjectId));
}

function normalizeIdList(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter((value) => value.length > 0),
    ),
  );
}

function createDraftFromPatch(
  patch: RenderIntentPatch,
  subject: Partial<RenderIntentSubject> & { surfaceId: string },
  ordering: Partial<RenderIntentOrderingAspect> & { layerId: string },
): RenderIntentDraft {
  return {
    id: patch.id,
    subject: {
      kind: subject.kind ?? "object",
      surfaceId: subject.surfaceId,
      layerId: subject.layerId,
      objectId: subject.objectId,
      objectType: subject.objectType,
    },
    ordering: {
      layerId: ordering.layerId,
      layerOrder: ordering.layerOrder,
      objectOrder: ordering.objectOrder,
      channel: ordering.channel,
      subOrder: ordering.subOrder,
    },
    visual: patch.visual,
    containerGeometryRef: patch.containerGeometryRef,
    previewGeometryRef: patch.previewGeometryRef,
    exportGeometryRef: patch.exportGeometryRef,
    placement: patch.placement,
    effects: patch.effects,
    interaction: patch.interaction,
    export: patch.export,
    coordinateSpace: patch.coordinateSpace,
    props: patch.props,
    data: patch.data,
    extensions: patch.extensions,
  };
}

function getOrCreateGraphLayer(
  layerMap: Map<string, RenderGraphLayer>,
  draft: RenderIntentDraft,
): RenderGraphLayer {
  const existing = layerMap.get(draft.ordering.layerId);
  if (existing) {
    existing.order = Math.min(existing.order, draft.ordering.layerOrder ?? 0);
    existing.visible = existing.visible || draft.export?.visible !== false;
    return existing;
  }

  const layer: RenderGraphLayer = {
    id: draft.ordering.layerId,
    surfaceId: draft.subject.surfaceId,
    order: draft.ordering.layerOrder ?? 0,
    visible: draft.export?.visible !== false,
    nodes: [],
    effects: [],
  };
  layerMap.set(layer.id, layer);
  return layer;
}

function createGraphNode(draft: RenderIntentDraft): RenderGraphNode | null {
  const source = resolveVisualSource(draft);
  const type = draft.visual?.type;
  if (!type || !draft.placement) return null;

  const channel =
    draft.ordering.channel ??
    (source.kind === "replacement"
      ? "replacement"
      : source.kind === "fallback"
        ? "fallback"
        : "normal");
  const id = source.kind === "replacement" ? `image:${draft.id}` : draft.id;
  const subjectId =
    draft.subject.objectId ?? draft.subject.layerId ?? draft.subject.surfaceId;
  const defaultGeometryId = draft.id;
  return {
    id,
    subjectId,
    layerId: draft.ordering.layerId,
    surfaceId: draft.subject.surfaceId,
    type,
    visual: source.source,
    containerGeometryRef: cloneRecord(
      draft.containerGeometryRef ??
        draft.previewGeometryRef ?? {
          sourceId: "render-intent",
          geometryId: defaultGeometryId,
          purpose: "preview",
        },
    ),
    previewGeometryRef: cloneRecord(
      draft.previewGeometryRef ?? {
        sourceId: "render-intent",
        geometryId: defaultGeometryId,
        purpose: "preview",
      },
    ),
    exportGeometryRef: cloneRecord(
      draft.exportGeometryRef ?? {
        sourceId: "render-intent",
        geometryId: defaultGeometryId,
        purpose: "export",
      },
    ),
    coordinateSpace: "scene",
    exportKeys: normalizeIdList([id, ...(draft.export?.keys ?? [])]),
    tags: cloneTagList(draft.export?.tags),
    placement: cloneRecord(draft.placement),
    props: {
      ...(draft.props ?? {}),
    },
    data: {
      ...(draft.data ?? {}),
      renderIntentId: draft.id,
      subject: draft.subject,
      tags: cloneTagList(draft.export?.tags),
    },
    effects: draft.effects?.map(cloneRecord) ?? [],
    interaction: cloneRecord(draft.interaction),
    visibleWhen: cloneRecord(draft.export?.visibleWhen),
    visible: draft.export?.visible !== false,
    sortKey: {
      layerOrder: draft.ordering.layerOrder ?? 0,
      objectOrder: draft.ordering.objectOrder ?? 0,
      channel,
      channelOrder: CHANNEL_ORDER[channel],
      subOrder: draft.ordering.subOrder ?? 0,
    },
  };
}

function cloneTagList(tags: readonly string[] | undefined): string[] {
  return tags ? [...tags] : [];
}

function resolveVisualSource(draft: RenderIntentDraft): {
  kind: "replacement" | "fallback" | "base";
  source: RenderIntentSource;
} {
  const replacement = draft.visual?.replacement;
  if (replacement?.src) {
    return { kind: "replacement", source: cloneRecord(replacement) };
  }
  const fallback = draft.visual?.fallback;
  if (fallback?.src) {
    return { kind: "fallback", source: cloneRecord(fallback) };
  }
  return {
    kind: "base",
    source: {
      ...(draft.visual?.src ? { src: draft.visual.src } : {}),
      ...(draft.visual?.metadata
        ? { metadata: cloneRecord(draft.visual.metadata) }
        : {}),
    },
  };
}

function compareGraphNodes(a: RenderGraphNode, b: RenderGraphNode): number {
  return (
    a.sortKey.objectOrder - b.sortKey.objectOrder ||
    a.sortKey.channelOrder - b.sortKey.channelOrder ||
    a.sortKey.subOrder - b.sortKey.subOrder ||
    a.id.localeCompare(b.id)
  );
}

function compareGraphLayers(a: RenderGraphLayer, b: RenderGraphLayer): number {
  return a.order - b.order;
}

function mergeDraft(
  base: RenderIntentDraft,
  patch: RenderIntentDraft,
): RenderIntentDraft {
  return {
    ...base,
    ...patch,
    subject: { ...base.subject, ...patch.subject },
    visual: mergeOptionalRecord(base.visual, patch.visual),
    containerGeometryRef: cloneRecord(
      patch.containerGeometryRef ?? base.containerGeometryRef,
    ),
    previewGeometryRef: cloneRecord(
      patch.previewGeometryRef ?? base.previewGeometryRef,
    ),
    exportGeometryRef: cloneRecord(
      patch.exportGeometryRef ?? base.exportGeometryRef,
    ),
    placement: mergeOptionalRecord(base.placement, patch.placement),
    effects: mergeOptionalEffects(base.effects, patch.effects),
    interaction: mergeInteractionAspect(base.interaction, patch.interaction),
    export: mergeOptionalRecord(base.export, patch.export),
    ordering: { ...base.ordering, ...patch.ordering },
    props: mergeOptionalRecord(base.props, patch.props),
    data: mergeOptionalRecord(base.data, patch.data),
    extensions: mergeOptionalRecord(base.extensions, patch.extensions),
  };
}

function mergePatch(
  base: RenderIntentDraft,
  patch: RenderIntentPatch,
  entry: Pick<RenderIntentPatchEntry, "sourceId" | "reason" | "debugLabel">,
): { draft: RenderIntentDraft; diagnostics: RenderIntentDiagnostic[] } {
  const clearResult = applyPatchClear(base, patch, entry);
  const clearedBase = clearResult.draft;
  const placement = mergeOptionalRecord(clearedBase.placement, patch.placement);
  const transformedPlacement =
    placement && patch.placementTransform
      ? {
          ...placement,
          localToScene: multiplyCoordinateMatrices(
            placement.localToScene,
            createPivotTransform(placement, patch.placementTransform),
          ),
        }
      : placement;
  return {
    draft: {
      ...clearedBase,
      subject: { ...clearedBase.subject, ...(patch.subject ?? {}) },
      visual: mergeOptionalRecord(clearedBase.visual, patch.visual),
      containerGeometryRef: cloneRecord(
        patch.containerGeometryRef ?? clearedBase.containerGeometryRef,
      ),
      previewGeometryRef: cloneRecord(
        patch.previewGeometryRef ?? clearedBase.previewGeometryRef,
      ),
      exportGeometryRef: cloneRecord(
        patch.exportGeometryRef ?? clearedBase.exportGeometryRef,
      ),
      placement: transformedPlacement,
      effects: mergeOptionalEffects(clearedBase.effects, patch.effects),
      interaction: mergeInteractionAspect(
        clearedBase.interaction,
        patch.interaction,
      ),
      export: mergeOptionalRecord(clearedBase.export, patch.export),
      ordering: { ...clearedBase.ordering, ...(patch.ordering ?? {}) },
      props: mergeOptionalRecord(clearedBase.props, patch.props),
      data: mergeOptionalRecord(clearedBase.data, patch.data),
      extensions: mergeOptionalRecord(clearedBase.extensions, patch.extensions),
    },
    diagnostics: clearResult.diagnostics,
  };
}

function createPivotTransform(
  placement: AffinePlacement,
  transform: Matrix2D<"object-local", "object-local">,
): Matrix2D<"object-local", "object-local"> {
  const { x, y } = placement.pivot;
  return multiplyCoordinateMatrices(
    coordinateMatrix("object-local", "object-local", [1, 0, 0, 1, x, y]),
    multiplyCoordinateMatrices(
      transform,
      coordinateMatrix("object-local", "object-local", [1, 0, 0, 1, -x, -y]),
    ),
  );
}

function applyPatchClear(
  base: RenderIntentDraft,
  patch: RenderIntentPatch,
  entry: Pick<RenderIntentPatchEntry, "sourceId" | "reason" | "debugLabel">,
): { draft: RenderIntentDraft; diagnostics: RenderIntentDiagnostic[] } {
  const draft = cloneDraft(base);
  const diagnostics: RenderIntentDiagnostic[] = [];
  patch.clear?.forEach((path) => {
    const validation = validateClearPath(path);
    if (!validation.ok) {
      diagnostics.push({
        code: "render-intent-clear-path-invalid",
        severity: "error",
        patchId: patch.id,
        sourceId: entry.sourceId,
        field: String(path || ""),
        reason: entry.reason,
        debugLabel: entry.debugLabel,
        message: validation.message,
      });
      return;
    }
    deletePathValue(draft as unknown as Record<string, unknown>, path);
  });
  return { draft, diagnostics };
}

function validateClearPath(
  path: RenderIntentPatchClearPath,
): { ok: true } | { ok: false; message: string } {
  const normalized = String(path || "").trim();
  const segments = normalized.split(".");
  if (
    !normalized ||
    segments.some((segment) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(segment))
  ) {
    return {
      ok: false,
      message: `RenderIntentPatch clear path "${String(path)}" is invalid.`,
    };
  }
  if (segments[0] === "id") {
    return {
      ok: false,
      message: "RenderIntentPatch clear cannot remove id.",
    };
  }
  if (!CLEARABLE_ROOT_FIELDS.has(segments[0])) {
    return {
      ok: false,
      message: `RenderIntentPatch clear path "${normalized}" has an unknown root.`,
    };
  }
  return { ok: true };
}

function deletePathValue(target: Record<string, unknown>, path: string): void {
  const segments = path.split(".");
  let cursor: Record<string, unknown> | undefined = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const value = cursor?.[segments[index]];
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    cursor = value as Record<string, unknown>;
  }
  delete cursor?.[segments[segments.length - 1]];
}

function getPathValue(target: unknown, path: string): unknown {
  let cursor = target as Record<string, unknown> | undefined;
  for (const segment of path.split(".")) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = cursor[segment] as Record<string, unknown> | undefined;
  }
  return cursor;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeInteractionAspect(
  base: InteractionSpec | undefined,
  patch: InteractionSpec | undefined,
): InteractionSpec | undefined {
  if (patch === undefined) return cloneRecord(base);
  const merged = {
    ...((base ?? {}) as object),
    ...((patch ?? {}) as object),
    ...(base?.selection || patch.selection
      ? {
          selection: { ...(base?.selection ?? {}), ...(patch.selection ?? {}) },
        }
      : {}),
    ...(base?.activation || patch.activation
      ? {
          activation: {
            ...(base?.activation ?? {}),
            ...(patch.activation ?? {}),
            action: {
              ...(base?.activation?.action ?? {}),
              ...(patch.activation?.action ?? {}),
            },
          },
        }
      : {}),
    ...(base?.manipulation || patch.manipulation
      ? {
          manipulation: {
            ...mergeInteractionOperation(
              "move",
              base?.manipulation?.move,
              patch.manipulation?.move,
            ),
            ...mergeInteractionOperation(
              "resize",
              base?.manipulation?.resize,
              patch.manipulation?.resize,
            ),
            ...mergeInteractionOperation(
              "rotate",
              base?.manipulation?.rotate,
              patch.manipulation?.rotate,
            ),
          },
        }
      : {}),
  } as InteractionSpec;
  return Object.keys(merged).length ? merged : undefined;
}

function mergeInteractionOperation(
  kind: "move" | "resize" | "rotate",
  base: InteractionOperationSpec | undefined,
  patch: InteractionOperationSpec | undefined,
): Partial<NonNullable<InteractionSpec["manipulation"]>> {
  if (!base && !patch) return {};
  const constraints = [
    ...(base?.constraints ?? []),
    ...(patch?.constraints ?? []),
  ].map(cloneRecord);
  return {
    [kind]: {
      ...(base ?? {}),
      ...(patch ?? {}),
      ...(constraints.length ? { constraints } : {}),
    },
  } as Partial<NonNullable<InteractionSpec["manipulation"]>>;
}

function mergeOptionalRecord<T>(base: T, patch: T): T {
  if (patch === undefined) return cloneRecord(base) as T;
  return {
    ...((base ?? {}) as object),
    ...((patch ?? {}) as object),
  } as T;
}

function mergeOptionalEffects(
  base: RenderEffectSpec[] | undefined,
  patch: RenderEffectSpec[] | undefined,
): RenderEffectSpec[] | undefined {
  const source = patch === undefined ? base : patch;
  return source?.map(cloneRecord);
}

function cloneDraft(draft: RenderIntentDraft): RenderIntentDraft {
  return cloneRecord(draft);
}

function clonePatch(patch: RenderIntentPatch): RenderIntentPatch {
  return cloneRecord(patch);
}

function cloneGraph(graph: RenderGraph): RenderGraph {
  return cloneRecord(graph);
}

function cloneRecord<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Compatibility source for declarative render intents. It is the only place
 * where legacy visual props are translated into the geometry contract; render
 * backends consume the resulting refs/snapshots instead of inspecting props.
 */
export function createRenderIntentGeometrySource(
  service: Pick<RenderIntentService, "getGraph">,
): GeometrySource {
  const findNode = (geometryId: string) => {
    for (const layer of service.getGraph().layers) {
      const node = layer.nodes.find(
        (candidate) =>
          candidate.id === geometryId ||
          String(candidate.data.renderIntentId || "") === geometryId,
      );
      if (node) return node;
    }
    return undefined;
  };

  return {
    sourceId: "render-intent",
    getSnapshot(ref): GeometrySnapshot | null {
      const node = findNode(ref.geometryId);
      if (!node) return null;
      const bounds = {
        left: node.placement.localBounds.left,
        top: node.placement.localBounds.top,
        width: node.placement.localBounds.width,
        height: node.placement.localBounds.height,
      };
      const base = {
        ref,
        space: "object-local" as const,
        bounds,
        localToScene: node.placement.localToScene,
        metadata: {
          renderIntentId: String(node.data.renderIntentId || node.id),
          subjectId: node.subjectId,
        },
      };
      if (node.type === "path") {
        const pathData = String(
          node.props.pathData ?? node.props.path ?? "",
        ).trim();
        return pathData
          ? { ...base, kind: "path", format: "svg-path", pathData }
          : null;
      }
      return { ...base, kind: "rect", rect: bounds };
    },
    listGeometries: () =>
      service.getGraph().layers.flatMap((layer) =>
        layer.nodes.map((node) => ({
          ref: node.previewGeometryRef,
          kind: node.type === "path" ? ("path" as const) : ("rect" as const),
          space: "object-local" as const,
          metadata: { layerId: layer.id, renderIntentId: node.id },
        })),
      ),
  };
}

function normalizeId(value: string, label: string): string {
  const id = String(value || "").trim();
  if (!id) throw new Error(`${label} is required.`);
  return id;
}
