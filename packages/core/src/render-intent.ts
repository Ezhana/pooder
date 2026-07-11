import EventBus from "./event";
import type Disposable from "./disposable";
import type { Service } from "./service";
import type {
  RenderCoordinateSpace,
  RenderEffectSpec,
  RenderObjectSpec,
  RuntimeConditionEvalContext,
  RuntimeConditionExpr,
} from "./render";
import type { ConstraintSpec } from "./constraint-resolver";
import type { SessionScope } from "./workflow-session";

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

export interface RenderIntentFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderIntentTransform {
  left?: number;
  top?: number;
  scaleX?: number;
  scaleY?: number;
  angle?: number;
  originX?: "left" | "center" | "right";
  originY?: "top" | "center" | "bottom";
}

export interface RenderIntentPlacementAspect {
  frame?: RenderIntentFrame;
  transform?: RenderIntentTransform;
  width?: number;
  height?: number;
  fit?: "cover" | "contain" | "stretch";
}

export interface RenderIntentInteractionConstraint {
  activeWhen?: RuntimeConditionExpr;
  spec: ConstraintSpec;
}

export interface RenderIntentTransformInteractionAspect {
  enabled?: boolean;
}

export interface RenderIntentDragInteractionAspect {
  enabled?: boolean;
  constraints?: readonly RenderIntentInteractionConstraint[];
}

export interface RenderIntentInteractionAspect {
  transform?: RenderIntentTransformInteractionAspect;
  drag?: RenderIntentDragInteractionAspect;
  enabledWhen?: RuntimeConditionExpr;
  locked?: boolean;
}

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
  stack?: number;
}

export interface RenderIntentDraft {
  id: string;
  subject: RenderIntentSubject;
  visual?: RenderIntentVisualAspect;
  placement?: RenderIntentPlacementAspect;
  effects?: RenderEffectSpec[];
  interaction?: RenderIntentInteractionAspect;
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
  coordinateSpace: RenderCoordinateSpace;
  exportKeys: string[];
  frame?: RenderIntentFrame;
  transform?: RenderIntentTransform;
  props: Record<string, unknown>;
  data: Record<string, unknown>;
  effects: RenderEffectSpec[];
  interaction?: RenderIntentInteractionAspect;
  visibleWhen?: RuntimeConditionExpr;
  visible: boolean;
  tags: string[];
  sortKey: RenderGraphSortKey;
}

export interface RenderGraphLayer {
  id: string;
  surfaceId: string;
  order: number;
  stack: number;
  visible: boolean;
  nodes: RenderGraphNode[];
  effects: RenderEffectSpec[];
  metadata?: Record<string, unknown>;
}

export interface RenderGraph {
  revision: number;
  surfaceIds: string[];
  layers: RenderGraphLayer[];
  diagnostics: RenderIntentDiagnostic[];
}

export interface RenderIntentCompilerContext<TEffect = unknown, TDocument = unknown> {
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
  ): RenderIntentPatch[] | RenderIntentPatch | void | Promise<RenderIntentPatch[] | RenderIntentPatch | void>;
}

export interface RegisteredRenderIntentCompiler
  extends RenderIntentCompilerContribution {
  extensionId: string;
}

export interface RenderIntentCompilerQuery {
  capabilityId?: string;
  effectType: string;
}

export interface RenderIntentChangeEvent {
  graph: RenderGraph;
  revision: number;
}

export type RenderIntentDiagnosticSeverity = "warning" | "error";

export type RenderIntentDiagnosticCode =
  | "render-intent-patch-base-missing"
  | "render-intent-clear-path-invalid"
  | "render-intent-field-conflict"
  | "render-intent-missing-layer";

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
  "placement.frame",
  "ordering.layerId",
  "export.visibleWhen",
] as const;

const CLEARABLE_ROOT_FIELDS = new Set([
  "subject",
  "visual",
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
      throw new Error("Render intent compiler requires effectType or capabilityId.");
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

  getCompilers(query: RenderIntentCompilerQuery): RegisteredRenderIntentCompiler[] {
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
  private readonly eventBus = new EventBus();
  private baseIntents: RenderIntentDraft[] = [];
  private runtimePatches = new Map<string, RequiredRuntimePatchEntry>();
  private runtimeConditionValues = new Map<string, unknown>();
  private graph: RenderGraph = createRenderGraph([], 0);
  private revision = 0;
  private runtimePatchSequence = 0;

  init(): void {}

  setDocumentIntents(intents: readonly RenderIntentDraft[]): RenderGraph {
    this.baseIntents = intents.map(cloneDraft);
    return this.recompile();
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
    this.emitChange();
    return true;
  }

  deleteRuntimeConditionValue(key: string): boolean {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return false;
    const removed = this.runtimeConditionValues.delete(normalizedKey);
    if (removed) this.emitChange();
    return removed;
  }

  clearRuntimeConditionValues(): boolean {
    if (!this.runtimeConditionValues.size) return false;
    this.runtimeConditionValues.clear();
    this.emitChange();
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
    return this.recompile();
  }

  patchIntentEntry(entry: RenderIntentPatchEntry): RenderGraph {
    this.upsertRuntimePatchEntry(entry);
    return this.recompile();
  }

  clearRuntimePatch(sourceId: string, intentId: string): boolean {
    const source = normalizeId(sourceId, "RenderIntentPatch.sourceId");
    const id = normalizeId(intentId, "RenderIntentPatch.id");
    if (!this.runtimePatches.delete(getRuntimePatchKey(source, id))) return false;
    this.recompile();
    return true;
  }

  clearRuntimePatches(sourceId?: string): boolean {
    if (sourceId === undefined) {
      if (this.runtimePatches.size === 0) return false;
      this.runtimePatches.clear();
      this.recompile();
      return true;
    }
    const source = normalizeId(sourceId, "RenderIntentPatch.sourceId");
    let removed = false;
    for (const key of Array.from(this.runtimePatches.keys())) {
      if (this.runtimePatches.get(key)?.sourceId === source) {
        this.runtimePatches.delete(key);
        removed = true;
      }
    }
    if (!removed) return false;
    this.recompile();
    return true;
  }

  onDidChange(callback: (event: RenderIntentChangeEvent) => void): Disposable {
    this.eventBus.on("render-intent:change", callback);
    return new RegistryDisposable(() => {
      this.eventBus.off("render-intent:change", callback);
    });
  }

  private recompile(): RenderGraph {
    this.revision += 1;
    const merged = mergeRenderIntentPatchEntries(
      this.baseIntents,
      Array.from(this.runtimePatches.values()),
    );
    this.graph = createRenderGraph(merged.drafts, this.revision, merged.diagnostics);
    this.emitChange();
    return this.getGraph();
  }

  private emitChange(): void {
    this.eventBus.emit("render-intent:change", {
      graph: cloneGraph(this.graph),
      revision: this.revision,
    });
  }

  private upsertRuntimePatchEntry(entry: RenderIntentPatchEntry): void {
    const sourceId = normalizeId(entry.sourceId, "RenderIntentPatch.sourceId");
    const patchId = normalizeId(entry.patch.id, "RenderIntentPatch.id");
    const key = getRuntimePatchKey(sourceId, patchId);
    const existing = this.runtimePatches.get(key);
    const sequence = entry.sequence ?? existing?.sequence ?? this.runtimePatchSequence++;
    this.runtimePatches.set(key, normalizePatchEntry(entry, sequence));
  }
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
    byId.set(draft.id, current ? mergeDraft(current, draft) : cloneDraft(draft));
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
  const normalizedEntries = entries.map((entry, index) =>
    normalizePatchEntry(entry, entry.sequence ?? index),
  ).sort(comparePatchEntries);
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
  const seen = new Map<string, { sourceId: string; value: unknown; entry: RequiredRuntimePatchEntry }>();
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

  return {
    revision,
    surfaceIds: Array.from(surfaceIds.values()),
    layers,
    diagnostics,
  };
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
      stack: ordering.stack,
    },
    visual: patch.visual,
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
    existing.stack = Math.min(existing.stack, draft.ordering.stack ?? 0);
    existing.visible = existing.visible || draft.export?.visible !== false;
    return existing;
  }

  const layer: RenderGraphLayer = {
    id: draft.ordering.layerId,
    surfaceId: draft.subject.surfaceId,
    order: draft.ordering.layerOrder ?? 0,
    stack: draft.ordering.stack ?? 0,
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
  if (!type) return null;

  const channel = draft.ordering.channel ?? (source.kind === "replacement" ? "replacement" : source.kind === "fallback" ? "fallback" : "normal");
  const id = source.kind === "replacement" ? `image:${draft.id}` : draft.id;
  const subjectId =
    draft.subject.objectId ?? draft.subject.layerId ?? draft.subject.surfaceId;
  return {
    id,
    subjectId,
    layerId: draft.ordering.layerId,
    surfaceId: draft.subject.surfaceId,
    type,
    visual: source.source,
    coordinateSpace: draft.coordinateSpace || "scene",
    exportKeys: normalizeIdList([id, ...(draft.export?.keys ?? [])]),
    tags: normalizeIdList(draft.export?.tags),
    frame: draft.placement?.frame,
    transform: draft.placement?.transform,
    props: {
      ...(draft.props ?? {}),
    },
    data: {
      ...(draft.data ?? {}),
      renderIntentId: draft.id,
      subject: draft.subject,
      tags: normalizeIdList(draft.export?.tags),
      ...(typeof draft.interaction?.locked === "boolean"
        ? { locked: draft.interaction.locked }
        : {}),
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

function resolveVisualSource(
  draft: RenderIntentDraft,
): { kind: "replacement" | "fallback" | "base"; source: RenderIntentSource } {
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
      ...(draft.visual?.metadata ? { metadata: cloneRecord(draft.visual.metadata) } : {}),
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
  return a.stack - b.stack || a.order - b.order || a.id.localeCompare(b.id);
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
  return {
    draft: {
      ...clearedBase,
      subject: { ...clearedBase.subject, ...(patch.subject ?? {}) },
      visual: mergeOptionalRecord(clearedBase.visual, patch.visual),
      placement: mergeOptionalRecord(clearedBase.placement, patch.placement),
      effects: mergeOptionalEffects(clearedBase.effects, patch.effects),
      interaction: mergeInteractionAspect(clearedBase.interaction, patch.interaction),
      export: mergeOptionalRecord(clearedBase.export, patch.export),
      ordering: { ...clearedBase.ordering, ...(patch.ordering ?? {}) },
      props: mergeOptionalRecord(clearedBase.props, patch.props),
      data: mergeOptionalRecord(clearedBase.data, patch.data),
      extensions: mergeOptionalRecord(clearedBase.extensions, patch.extensions),
    },
    diagnostics: clearResult.diagnostics,
  };
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
  if (!normalized || segments.some((segment) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(segment))) {
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
  base: RenderIntentInteractionAspect | undefined,
  patch: RenderIntentInteractionAspect | undefined,
): RenderIntentInteractionAspect | undefined {
  if (patch === undefined) return cloneRecord(base);
  const dragConstraints = [
    ...(base?.drag?.constraints ?? []),
    ...(patch.drag?.constraints ?? []),
  ].map(cloneRecord);
  const merged = {
    ...((base ?? {}) as object),
    ...((patch ?? {}) as object),
    ...(base?.transform || patch.transform
      ? {
          transform: {
            ...(base?.transform ?? {}),
            ...(patch.transform ?? {}),
          },
        }
      : {}),
    ...(base?.drag || patch.drag
      ? {
          drag: {
            ...(base?.drag ?? {}),
            ...(patch.drag ?? {}),
          },
        }
      : {}),
  } as RenderIntentInteractionAspect;
  if (merged.drag) {
    if (dragConstraints.length) {
      merged.drag.constraints = dragConstraints;
    } else {
      delete merged.drag.constraints;
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

function mergeOptionalRecord<T>(
  base: T,
  patch: T,
): T {
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

function normalizeId(value: string, label: string): string {
  const id = String(value || "").trim();
  if (!id) throw new Error(`${label} is required.`);
  return id;
}
