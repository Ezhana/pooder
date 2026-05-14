import EventBus from "./event";
import type Disposable from "./disposable";
import type { Service } from "./service";
import type { RenderEffectSpec, RenderObjectSpec, VisibilityExpr } from "./render";

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
  assetId?: string;
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

export interface RenderIntentOverlayAspect {
  enabled?: boolean;
  role?: string;
  slot?: string;
}

export interface RenderIntentClippingAspect {
  enabled?: boolean;
  effects?: RenderEffectSpec[];
}

export interface RenderIntentInteractionAspect {
  imagePlacement?: Record<string, unknown>;
  selectable?: boolean;
  evented?: boolean;
  locked?: boolean;
}

export interface RenderIntentExportAspect {
  exportable?: boolean;
  visible?: boolean;
  visibility?: VisibilityExpr;
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
  overlay?: RenderIntentOverlayAspect;
  clipping?: RenderIntentClippingAspect;
  interaction?: RenderIntentInteractionAspect;
  export?: RenderIntentExportAspect;
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
};

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
  frame?: RenderIntentFrame;
  transform?: RenderIntentTransform;
  props: Record<string, unknown>;
  data: Record<string, unknown>;
  effects: RenderEffectSpec[];
  visibility?: VisibilityExpr;
  visible: boolean;
  exportable: boolean;
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
  diagnostics: string[];
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

const CHANNEL_ORDER: Record<RenderIntentChannel, number> = {
  background: 0,
  normal: 10,
  fallback: 10,
  replacement: 10,
  overlay: 20,
  effect: 30,
};

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
  private runtimePatches = new Map<string, RenderIntentPatch>();
  private graph: RenderGraph = createRenderGraph([], 0);
  private revision = 0;

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

  patchIntent(patch: RenderIntentPatch): RenderGraph {
    const id = normalizeId(patch.id, "RenderIntentPatch.id");
    this.runtimePatches.set(id, clonePatch({ ...patch, id }));
    return this.recompile();
  }

  clearRuntimePatch(id: string): boolean {
    if (!this.runtimePatches.delete(id)) return false;
    this.recompile();
    return true;
  }

  clearRuntimePatches(): boolean {
    if (this.runtimePatches.size === 0) return false;
    this.runtimePatches.clear();
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
    const patched = applyRuntimePatches(this.baseIntents, this.runtimePatches);
    this.graph = createRenderGraph(patched, this.revision);
    this.eventBus.emit("render-intent:change", {
      graph: cloneGraph(this.graph),
      revision: this.revision,
    });
    return this.getGraph();
  }
}

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

export function createRenderGraph(
  drafts: readonly RenderIntentDraft[],
  revision = 0,
): RenderGraph {
  const diagnostics: string[] = [];
  const layerMap = new Map<string, RenderGraphLayer>();
  const surfaceIds = new Set<string>();

  reduceRenderIntentDrafts(drafts).forEach((draft) => {
    const layerId = draft.ordering.layerId;
    if (!layerId) {
      diagnostics.push(`RenderIntent "${draft.id}" is missing ordering.layerId.`);
      return;
    }
    surfaceIds.add(draft.subject.surfaceId);
    const layer = getOrCreateGraphLayer(layerMap, draft);
    const node = createGraphNode(draft);
    if (node) {
      layer.nodes.push(node);
    }
    if (draft.clipping?.effects?.length) {
      layer.effects.push(...draft.clipping.effects.map(cloneRecord));
    }
  });

  const layers = Array.from(layerMap.values())
    .map((layer) => ({
      ...layer,
      nodes: layer.nodes.sort(compareGraphNodes),
    }))
    .sort((a, b) => a.stack - b.stack || a.order - b.order || a.id.localeCompare(b.id));

  return {
    revision,
    surfaceIds: Array.from(surfaceIds.values()),
    layers,
    diagnostics,
  };
}

function applyRuntimePatches(
  drafts: readonly RenderIntentDraft[],
  patches: Map<string, RenderIntentPatch>,
): RenderIntentDraft[] {
  const result = reduceRenderIntentDrafts(drafts);
  patches.forEach((patch) => {
    const index = result.findIndex((draft) => draft.id === patch.id);
    if (index >= 0) {
      result[index] = mergePatch(result[index], patch);
    } else if (patch.subject?.surfaceId && patch.ordering?.layerId) {
      result.push({
        id: patch.id,
        subject: {
          kind: patch.subject.kind ?? "object",
          surfaceId: patch.subject.surfaceId,
          layerId: patch.subject.layerId,
          objectId: patch.subject.objectId,
          objectType: patch.subject.objectType,
        },
        ordering: {
          layerId: patch.ordering.layerId,
          layerOrder: patch.ordering.layerOrder,
          objectOrder: patch.ordering.objectOrder,
          channel: patch.ordering.channel,
          subOrder: patch.ordering.subOrder,
          stack: patch.ordering.stack,
        },
        visual: patch.visual,
        placement: patch.placement,
        overlay: patch.overlay,
        clipping: patch.clipping,
        interaction: patch.interaction,
        export: patch.export,
        props: patch.props,
        data: patch.data,
        extensions: patch.extensions,
      });
    }
  });
  return result;
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
  return {
    id: source.kind === "replacement" ? `image:${draft.id}` : draft.id,
    subjectId: draft.subject.objectId ?? draft.subject.layerId ?? draft.subject.surfaceId,
    layerId: draft.ordering.layerId,
    surfaceId: draft.subject.surfaceId,
    type,
    visual: source.source,
    frame: draft.placement?.frame,
    transform: draft.placement?.transform,
    props: cloneRecord(draft.props ?? {}),
    data: {
      ...(draft.data ?? {}),
      renderIntentId: draft.id,
      subject: draft.subject,
      ...(draft.overlay ? { templateOverlay: draft.overlay } : {}),
      ...(draft.interaction?.imagePlacement
        ? { imagePlacement: draft.interaction.imagePlacement }
        : {}),
    },
    effects: draft.clipping?.effects?.map(cloneRecord) ?? [],
    visibility: cloneRecord(draft.export?.visibility),
    visible: draft.export?.visible !== false,
    exportable: draft.export?.exportable !== false,
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
  if (replacement?.src || replacement?.assetId) {
    return { kind: "replacement", source: cloneRecord(replacement) };
  }
  const fallback = draft.visual?.fallback;
  if (fallback?.src || fallback?.assetId) {
    return { kind: "fallback", source: cloneRecord(fallback) };
  }
  return {
    kind: "base",
    source: {
      ...(draft.visual?.assetId ? { assetId: draft.visual.assetId } : {}),
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
    overlay: mergeOptionalRecord(base.overlay, patch.overlay),
    clipping: mergeOptionalRecord(base.clipping, patch.clipping),
    interaction: mergeOptionalRecord(base.interaction, patch.interaction),
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
): RenderIntentDraft {
  return {
    ...base,
    subject: { ...base.subject, ...(patch.subject ?? {}) },
    visual: mergeOptionalRecord(base.visual, patch.visual),
    placement: mergeOptionalRecord(base.placement, patch.placement),
    overlay: mergeOptionalRecord(base.overlay, patch.overlay),
    clipping: mergeOptionalRecord(base.clipping, patch.clipping),
    interaction: mergeOptionalRecord(base.interaction, patch.interaction),
    export: mergeOptionalRecord(base.export, patch.export),
    ordering: { ...base.ordering, ...(patch.ordering ?? {}) },
    props: mergeOptionalRecord(base.props, patch.props),
    data: mergeOptionalRecord(base.data, patch.data),
    extensions: mergeOptionalRecord(base.extensions, patch.extensions),
  };
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
