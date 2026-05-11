import { Canvas, FabricObject, Rect, Path, Image, Text } from "fabric";
import {
  Service,
  EventBus,
  ServiceContext,
  TOOL_SESSION_SERVICE,
  ToolSessionService,
  WORKBENCH_SERVICE,
  WorkbenchService,
  WORKFLOW_SESSION_SERVICE,
  WorkflowSessionService,
} from "@pooder/core";
import { ViewportSystem } from "./viewport-system";
import type {
  RenderCoordinateSpace,
  RenderEffectSpec,
  RenderLayoutInsets,
  RenderLayoutLength,
  RenderObjectLayoutSpec,
  RenderObjectSpec,
  RenderPassSpec,
} from "./render-spec";
import {
  evaluateVisibilityExpr,
  type VisibilityLayerState,
} from "./visibility";

export interface RenderProducerResult {
  passes?: RenderPassSpec[];
}

export type RenderProducer = () =>
  | RenderProducerResult
  | undefined
  | Promise<RenderProducerResult | undefined>;

export interface RegisterRenderProducerOptions {
  priority?: number;
}

interface RenderProducerEntry {
  toolId: string;
  producer: RenderProducer;
  priority: number;
  order: number;
}

interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ResolvedRenderPassSpec {
  id: string;
  sourceKey: string;
  scope: string;
  targetLayerId: string;
  stack: number;
  order: number;
  producerOrder: number;
  replace: boolean;
  visibility?: RenderPassSpec["visibility"];
  effects: RenderEffectSpec[];
  objects: RenderObjectSpec[];
}

interface ResolvedClipPathEffectSpec {
  type: "clipPath";
  key: string;
  visibility?: RenderPassSpec["visibility"];
  source: RenderObjectSpec;
  targetPassIds: string[];
}

interface ManagedPassMeta {
  id: string;
  sourceKey: string;
  scope: string;
  targetLayerId: string;
  stack: number;
  order: number;
  producerOrder: number;
  visibility?: RenderPassSpec["visibility"];
}

export interface CanvasPassStackingMeta {
  id: string;
  stack?: number;
  order?: number;
}

export default class CanvasService implements Service {
  public canvas: Canvas;
  public viewport: ViewportSystem;
  private context?: ServiceContext;
  private eventBus?: EventBus;
  private workbenchService?: WorkbenchService;
  private toolSessionService?: ToolSessionService;
  private workflowSessionService?: WorkflowSessionService;

  private renderProducers: Map<string, RenderProducerEntry> = new Map();
  private producerOrder = 0;
  private producerFlushRequested = false;
  private producerLoopPending = false;
  private producerLoopPromise: Promise<void> | null = null;
  private producerApplyInProgress = false;
  private visibilityRefreshScheduled = false;

  private managedProducerPassIds: Set<string> = new Set();
  private managedPassMetas: Map<string, ManagedPassMeta> = new Map();
  private managedPassEffects: ResolvedClipPathEffectSpec[] = [];
  private layerStackingMetas: Map<string, CanvasPassStackingMeta> = new Map();
  private visibilityContextValues: Map<string, unknown> = new Map();

  private canvasForwardersBound = false;
  private readonly forwardSelectionCreated = (e: any) => {
    this.eventBus?.emit("selection:created", e);
  };
  private readonly forwardSelectionUpdated = (e: any) => {
    this.eventBus?.emit("selection:updated", e);
  };
  private readonly forwardSelectionCleared = (e: any) => {
    this.eventBus?.emit("selection:cleared", e);
  };
  private readonly forwardObjectModified = (e: any) => {
    this.eventBus?.emit("object:modified", e);
  };
  private readonly forwardObjectAdded = (e: any) => {
    this.eventBus?.emit("object:added", e);
  };
  private readonly forwardObjectRemoved = (e: any) => {
    this.eventBus?.emit("object:removed", e);
  };

  private readonly onToolActivated = () => {
    this.refreshManagedVisibility();
  };
  private readonly onToolSessionChanged = () => {
    this.refreshManagedVisibility();
  };
  private readonly onCanvasObjectChanged = () => {
    if (this.producerApplyInProgress) return;
    this.scheduleManagedPassVisibilityRefresh();
  };

  constructor(el: HTMLCanvasElement | string | Canvas, options?: any) {
    if (el instanceof Canvas) {
      this.canvas = el;
    } else {
      this.canvas = new Canvas(el, {
        preserveObjectStacking: true,
        ...options,
      });
    }

    this.viewport = new ViewportSystem();
    if (this.canvas.width !== undefined && this.canvas.height !== undefined) {
      this.viewport.updateContainer(this.canvas.width, this.canvas.height);
    }

    if (options?.eventBus) {
      this.setEventBus(options.eventBus);
    }
  }

  init(context: ServiceContext) {
    if (this.context) {
      this.detachContextEvents(this.context.eventBus);
    }

    this.context = context;
    this.workbenchService = context.get(WORKBENCH_SERVICE);
    this.toolSessionService = context.get(TOOL_SESSION_SERVICE);
    this.workflowSessionService = context.get(WORKFLOW_SESSION_SERVICE);
    this.setEventBus(context.eventBus);
    this.attachContextEvents(context.eventBus);
  }

  private attachContextEvents(eventBus: EventBus) {
    eventBus.on("tool:activated", this.onToolActivated);
    eventBus.on("tool:session:change", this.onToolSessionChanged);
    eventBus.on("workflow:session:change", this.onToolSessionChanged);
    eventBus.on("object:added", this.onCanvasObjectChanged);
    eventBus.on("object:removed", this.onCanvasObjectChanged);
  }

  private detachContextEvents(eventBus: EventBus) {
    eventBus.off("tool:activated", this.onToolActivated);
    eventBus.off("tool:session:change", this.onToolSessionChanged);
    eventBus.off("workflow:session:change", this.onToolSessionChanged);
    eventBus.off("object:added", this.onCanvasObjectChanged);
    eventBus.off("object:removed", this.onCanvasObjectChanged);
  }

  setEventBus(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.setupEvents();
  }

  private setupEvents() {
    if (this.canvasForwardersBound) return;
    this.canvas.on("selection:created", this.forwardSelectionCreated);
    this.canvas.on("selection:updated", this.forwardSelectionUpdated);
    this.canvas.on("selection:cleared", this.forwardSelectionCleared);
    this.canvas.on("object:modified", this.forwardObjectModified);
    this.canvas.on("object:added", this.forwardObjectAdded);
    this.canvas.on("object:removed", this.forwardObjectRemoved);
    this.canvasForwardersBound = true;
  }

  dispose() {
    if (this.context) {
      this.detachContextEvents(this.context.eventBus);
    }
    this.renderProducers.clear();
    this.managedProducerPassIds.clear();
    this.managedPassMetas.clear();
    this.managedPassEffects = [];
    this.layerStackingMetas.clear();
    this.context = undefined;
    this.workbenchService = undefined;
    this.toolSessionService = undefined;
    this.workflowSessionService = undefined;
    this.producerFlushRequested = false;
    this.visibilityContextValues.clear();
    this.canvas.dispose();
  }

  registerRenderProducer(
    toolId: string,
    producer: RenderProducer,
    options: RegisterRenderProducerOptions = {},
  ): { dispose: () => void } {
    const normalizedToolId = String(toolId || "").trim();
    if (!normalizedToolId) {
      throw new Error(
        "[CanvasService] registerRenderProducer requires a toolId.",
      );
    }
    if (typeof producer !== "function") {
      throw new Error(
        `[CanvasService] registerRenderProducer("${normalizedToolId}") requires a producer function.`,
      );
    }
    const entry: RenderProducerEntry = {
      toolId: normalizedToolId,
      producer,
      priority: Number.isFinite(options.priority)
        ? Number(options.priority)
        : 0,
      order: this.producerOrder++,
    };
    this.renderProducers.set(normalizedToolId, entry);
    this.requestRenderFromProducers();
    return {
      dispose: () => {
        this.unregisterRenderProducer(normalizedToolId);
      },
    };
  }

  unregisterRenderProducer(toolId: string): boolean {
    const normalizedToolId = String(toolId || "").trim();
    if (!normalizedToolId) return false;
    const removed = this.renderProducers.delete(normalizedToolId);
    if (removed) {
      this.requestRenderFromProducers();
    }
    return removed;
  }

  requestRenderFromProducers() {
    this.producerFlushRequested = true;
    this.scheduleProducerLoop();
  }

  async flushRenderFromProducers(): Promise<void> {
    this.requestRenderFromProducers();
    if (this.producerLoopPromise) {
      await this.producerLoopPromise;
    }
  }

  private scheduleProducerLoop() {
    if (this.producerLoopPending) return;
    this.producerLoopPending = true;
    this.producerLoopPromise = Promise.resolve()
      .then(() => this.runProducerLoop())
      .catch((error) => {
        console.error("[CanvasService] render producer loop failed.", error);
      })
      .finally(() => {
        this.producerLoopPending = false;
        if (this.producerFlushRequested) {
          this.scheduleProducerLoop();
        }
      });
  }

  private async runProducerLoop(): Promise<void> {
    while (this.producerFlushRequested) {
      this.producerFlushRequested = false;
      await this.collectAndApplyProducerSpecs();
    }
  }

  private sortedRenderProducerEntries(): RenderProducerEntry[] {
    return Array.from(this.renderProducers.values()).sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.toolId.localeCompare(b.toolId);
    });
  }

  private normalizePassSpecValue(
    spec: RenderPassSpec,
    entry: RenderProducerEntry,
  ): ResolvedRenderPassSpec | null {
    const id = String(spec.id || "").trim();
    if (!id) return null;
    const targetLayerId = String(spec.targetLayerId || "").trim() || id;
    const sourceKey = this.getProducerPassSourceKey(entry.toolId, id);

    return {
      id,
      sourceKey,
      scope: sourceKey,
      targetLayerId,
      stack: Number.isFinite(spec.stack) ? Number(spec.stack) : 0,
      order: Number.isFinite(spec.order) ? Number(spec.order) : 0,
      producerOrder: entry.order,
      replace: spec.replace !== false,
      visibility: spec.visibility,
      effects: Array.isArray(spec.effects) ? [...spec.effects] : [],
      objects: Array.isArray(spec.objects) ? [...spec.objects] : [],
    };
  }

  private getProducerPassSourceKey(producerId: string, passId: string): string {
    return `render-producer:${producerId}:${passId}`;
  }

  private normalizeClipPathEffectSpec(
    effect: RenderEffectSpec,
    pass: ResolvedRenderPassSpec,
    index: number,
  ): ResolvedClipPathEffectSpec | null {
    if (!effect || effect.type !== "clipPath") return null;

    const source = effect.source;
    if (!source || typeof source !== "object") return null;

    const sourceId = String(source.id || "").trim();
    if (!sourceId) return null;

    const targetPassIds = Array.isArray(effect.targetPassIds)
      ? effect.targetPassIds
          .map((item) => String(item || "").trim())
          .filter((item) => item.length > 0)
      : [];
    if (!targetPassIds.length) return null;

    const customId = String((effect as any).id || "").trim();
    const key = customId || `${pass.sourceKey}.effect.clipPath.${index}`;

    return {
      type: "clipPath",
      key,
      visibility: effect.visibility,
      source: {
        ...source,
        id: sourceId,
      },
      targetPassIds,
    };
  }

  private mergePassSpec(
    map: Map<string, ResolvedRenderPassSpec>,
    rawSpec: RenderPassSpec,
    entry: RenderProducerEntry,
  ) {
    const normalized = this.normalizePassSpecValue(rawSpec, entry);
    if (!normalized) return;

    const existing = map.get(normalized.sourceKey);
    if (!existing) {
      map.set(normalized.sourceKey, normalized);
      return;
    }

    existing.objects.push(...normalized.objects);
    existing.replace = existing.replace || normalized.replace;
    existing.targetLayerId = normalized.targetLayerId;
    existing.stack = normalized.stack;
    existing.order = normalized.order;
    if (normalized.visibility !== undefined) {
      existing.visibility = normalized.visibility;
    }
    existing.effects.push(...normalized.effects);

    if (normalized.objects.length === 0 && normalized.effects.length === 0) {
      console.debug(
        `[CanvasService] pass "${normalized.id}" from producer "${entry.toolId}" updated ordering/visibility only.`,
      );
    }
  }

  private comparePassMeta(
    a: { id: string; stack: number; order: number },
    b: { id: string; stack: number; order: number },
  ): number {
    if (a.stack !== b.stack) return a.stack - b.stack;
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  }

  private getPassObjectOrder(obj: FabricObject): number {
    const raw = Number((obj as any)?.data?.passOrder);
    return Number.isFinite(raw) ? raw : Number.MAX_SAFE_INTEGER;
  }

  private getPassCanvasObjects(passId: string): FabricObject[] {
    const all = this.canvas.getObjects();
    return all
      .filter((obj: any) => obj?.data?.passId === passId)
      .sort((a, b) => {
        const orderA = this.getPassObjectOrder(a as FabricObject);
        const orderB = this.getPassObjectOrder(b as FabricObject);
        if (orderA !== orderB) return orderA - orderB;
        return all.indexOf(a) - all.indexOf(b);
      });
  }

  getPassObjects(passId: string): FabricObject[] {
    return this.getPassCanvasObjects(passId);
  }

  getRootLayerObjects(layerId: string): FabricObject[] {
    return this.getPassCanvasObjects(layerId);
  }

  private isManagedPassObject(obj: FabricObject): boolean {
    const scope = (obj as any)?.data?.__renderScope;
    return typeof scope === "string" && this.managedPassMetas.has(scope);
  }

  syncPassStacking(passes: CanvasPassStackingMeta[]) {
    const orderedPasses = [...passes]
      .map((pass) => ({
        id: String(pass.id || "").trim(),
        stack: Number.isFinite(pass.stack) ? Number(pass.stack) : 0,
        order: Number.isFinite(pass.order) ? Number(pass.order) : 0,
      }))
      .filter((pass) => pass.id.length > 0);

    this.layerStackingMetas.clear();
    orderedPasses.forEach((pass) => {
      this.layerStackingMetas.set(pass.id, { ...pass });
    });

    this.syncLayerStacking(orderedPasses);
  }

  private syncLayerStacking(
    passes: Array<{ id: string; stack: number; order: number }>,
  ) {
    const orderedPasses = [...passes].sort((a, b) =>
      this.comparePassMeta({
        id: a.id,
        stack: a.stack,
        order: a.order,
      }, {
        id: b.id,
        stack: b.stack,
        order: b.order,
      }),
    );
    if (!orderedPasses.length) return;

    const canvasObjects = this.canvas.getObjects();
    const passIds = new Set(orderedPasses.map((pass) => pass.id));
    const managedObjects = canvasObjects.filter((obj: any) =>
      passIds.has(obj?.data?.passId),
    );

    if (!managedObjects.length) return;

    const firstManagedIndex = managedObjects
      .map((obj) => canvasObjects.indexOf(obj as any))
      .filter((index) => index >= 0)
      .reduce((min, value) => Math.min(min, value), Number.MAX_SAFE_INTEGER);

    let targetIndex = Number.isFinite(firstManagedIndex)
      ? firstManagedIndex
      : 0;

    orderedPasses.forEach((meta) => {
      const objects = this.getPassCanvasObjects(meta.id);
      objects.forEach((obj) => {
        this.moveObjectInCanvas(obj, targetIndex);
        targetIndex += 1;
      });
    });
  }

  private syncManagedPassStacking(passes: ManagedPassMeta[]) {
    const targetLayers = new Map<
      string,
      { id: string; stack: number; order: number }
    >();

    this.layerStackingMetas.forEach((meta, id) => {
      targetLayers.set(id, {
        id,
        stack: Number.isFinite(meta.stack) ? Number(meta.stack) : 0,
        order: Number.isFinite(meta.order) ? Number(meta.order) : 0,
      });
    });

    passes.forEach((pass) => {
      if (targetLayers.has(pass.targetLayerId)) return;
      targetLayers.set(pass.targetLayerId, {
        id: pass.targetLayerId,
        stack: pass.stack,
        order: pass.order,
      });
    });

    this.syncLayerStacking(Array.from(targetLayers.values()));
  }

  private getPassRuntimeState(): Map<string, VisibilityLayerState> {
    const state = new Map<string, VisibilityLayerState>();

    const ensure = (passId: string): VisibilityLayerState => {
      const id = String(passId || "").trim();
      if (!id) return { exists: false, objectCount: 0 };
      let item = state.get(id);
      if (!item) {
        item = { exists: false, objectCount: 0 };
        state.set(id, item);
      }
      return item;
    };

    this.canvas.getObjects().forEach((obj: any) => {
      const passId = obj?.data?.passId;
      if (typeof passId === "string") {
        const item = ensure(passId);
        item.exists = true;
        item.objectCount += 1;
      }
    });

    this.managedPassMetas.forEach((meta) => {
      const item = ensure(meta.targetLayerId);
      item.exists = true;
    });

    return state;
  }

  private isSessionActive(toolId: string): boolean {
    if (!this.toolSessionService) return false;
    return this.toolSessionService.getState(toolId).status === "active";
  }

  private hasAnyActiveSession(): boolean {
    return this.toolSessionService?.hasAnyActiveSession() ?? false;
  }

  private isWorkflowSessionActive(workflowId: string): boolean {
    if (!this.workflowSessionService) return false;
    return this.workflowSessionService.hasActiveSession(workflowId);
  }

  private hasAnyActiveWorkflowSession(): boolean {
    return this.workflowSessionService?.hasAnyActiveSession() ?? false;
  }

  private refreshManagedVisibility(
    options: { render?: boolean } = {},
  ): boolean {
    const changed = this.applyManagedPassVisibility(options);
    void this.applyManagedPassEffects(undefined, { render: options.render });
    return changed;
  }

  setVisibilityContextValue(
    key: string,
    value: unknown,
    options: { render?: boolean } = {},
  ): boolean {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) {
      throw new Error("[CanvasService] visibility context key is required.");
    }
    const previous = this.visibilityContextValues.get(normalizedKey);
    if (Object.is(previous, value)) return false;
    this.visibilityContextValues.set(normalizedKey, value);
    this.refreshManagedVisibility({ render: options.render });
    return true;
  }

  deleteVisibilityContextValue(
    key: string,
    options: { render?: boolean } = {},
  ): boolean {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return false;
    const removed = this.visibilityContextValues.delete(normalizedKey);
    if (removed) {
      this.refreshManagedVisibility({ render: options.render });
    }
    return removed;
  }

  clearVisibilityContextValues(options: { render?: boolean } = {}): boolean {
    if (!this.visibilityContextValues.size) return false;
    this.visibilityContextValues.clear();
    this.refreshManagedVisibility({ render: options.render });
    return true;
  }

  private buildVisibilityEvalContext(
    layers: Map<string, VisibilityLayerState>,
  ) {
    return {
      activeToolId: this.workbenchService?.activeToolId ?? null,
      contextValues: this.visibilityContextValues,
      isWorkflowSessionActive: (workflowId: string) =>
        this.isWorkflowSessionActive(workflowId),
      hasAnyActiveWorkflowSession: () =>
        this.hasAnyActiveWorkflowSession(),
      isSessionActive: (toolId: string) => this.isSessionActive(toolId),
      hasAnyActiveSession: () => this.hasAnyActiveSession(),
      layers,
    };
  }

  private applyManagedPassVisibility(
    options: { render?: boolean } = {},
  ): boolean {
    if (!this.managedPassMetas.size) return false;
    const layers = this.getPassRuntimeState();
    const context = this.buildVisibilityEvalContext(layers);

    let changed = false;

    this.managedPassMetas.forEach((meta) => {
      const visible = evaluateVisibilityExpr(meta.visibility, context);
      changed =
        this.setPassVisibility(meta.targetLayerId, visible, {
          scope: meta.scope,
        }) || changed;
    });

    if (changed && options.render !== false) {
      this.requestRenderAll();
    }
    return changed;
  }

  private scheduleManagedPassVisibilityRefresh() {
    if (this.visibilityRefreshScheduled) return;
    this.visibilityRefreshScheduled = true;
    void Promise.resolve().then(() => {
      this.visibilityRefreshScheduled = false;
      this.applyManagedPassVisibility();
    });
  }

  private getProducerPassOrderOffsets(
    passes: ResolvedRenderPassSpec[],
  ): Map<string, number> {
    const result = new Map<string, number>();
    const grouped = new Map<string, ResolvedRenderPassSpec[]>();
    const stride = 10000;

    passes.forEach((pass) => {
      const group = grouped.get(pass.targetLayerId) || [];
      group.push(pass);
      grouped.set(pass.targetLayerId, group);
    });

    grouped.forEach((group) => {
      [...group]
        .sort((a, b) => {
          if (a.stack !== b.stack) return a.stack - b.stack;
          if (a.order !== b.order) return a.order - b.order;
          if (a.producerOrder !== b.producerOrder) {
            return a.producerOrder - b.producerOrder;
          }
          return a.id.localeCompare(b.id);
        })
        .forEach((pass, index) => {
          result.set(pass.sourceKey, (index + 1) * stride);
        });
    });

    return result;
  }

  private async collectAndApplyProducerSpecs(): Promise<void> {
    const passes = new Map<string, ResolvedRenderPassSpec>();
    const entries = this.sortedRenderProducerEntries();

    this.producerApplyInProgress = true;
    try {
      for (const entry of entries) {
        try {
          const result = await entry.producer();
          if (!result) continue;
          const specs = Array.isArray(result.passes) ? result.passes : [];
          specs.forEach((spec) => this.mergePassSpec(passes, spec, entry));
        } catch (error) {
          console.error(
            `[CanvasService] render producer "${entry.toolId}" failed.`,
            error,
          );
        }
      }

      const nextPassIds = new Set<string>();
      const nextManagedPassMetas = new Map<string, ManagedPassMeta>();
      const nextEffects: ResolvedClipPathEffectSpec[] = [];
      const orderOffsets = this.getProducerPassOrderOffsets(
        Array.from(passes.values()),
      );

      for (const pass of passes.values()) {
        nextPassIds.add(pass.sourceKey);
        nextManagedPassMetas.set(pass.sourceKey, {
          id: pass.id,
          sourceKey: pass.sourceKey,
          scope: pass.scope,
          targetLayerId: pass.targetLayerId,
          stack: pass.stack,
          order: pass.order,
          producerOrder: pass.producerOrder,
          visibility: pass.visibility,
        });

        const previous = this.managedPassMetas.get(pass.sourceKey);
        if (previous && previous.targetLayerId !== pass.targetLayerId) {
          await this.applyObjectSpecsToPass(previous.targetLayerId, [], {
            render: false,
            replace: true,
            scope: previous.scope,
          });
        }

        await this.applyObjectSpecsToPass(pass.targetLayerId, pass.objects, {
          render: false,
          replace: pass.replace,
          scope: pass.scope,
          orderOffset: orderOffsets.get(pass.sourceKey) ?? 0,
        });

        pass.effects.forEach((effect, index) => {
          const normalized = this.normalizeClipPathEffectSpec(
            effect,
            pass,
            index,
          );
          if (!normalized) return;
          nextEffects.push(normalized);
        });
      }

      for (const sourceKey of this.managedProducerPassIds) {
        if (nextPassIds.has(sourceKey)) continue;
        const previous = this.managedPassMetas.get(sourceKey);
        if (!previous) continue;
        await this.applyObjectSpecsToPass(previous.targetLayerId, [], {
          render: false,
          replace: true,
          scope: previous.scope,
        });
      }

      this.managedProducerPassIds = nextPassIds;
      this.managedPassMetas = nextManagedPassMetas;
      this.managedPassEffects = nextEffects;

      this.syncManagedPassStacking(Array.from(nextManagedPassMetas.values()));
      await this.applyManagedPassEffects(nextEffects, { render: false });
      this.applyManagedPassVisibility({ render: false });
    } finally {
      this.producerApplyInProgress = false;
    }

    this.requestRenderAll();
  }

  private async applyManagedPassEffects(
    effects: ResolvedClipPathEffectSpec[] = this.managedPassEffects,
    options: { render?: boolean } = {},
  ) {
    const effectTargetMap = new Map<FabricObject, ResolvedClipPathEffectSpec>();
    const layers = this.getPassRuntimeState();
    const visibilityContext = this.buildVisibilityEvalContext(layers);

    for (const effect of effects) {
      if (effect.type !== "clipPath") continue;
      if (!evaluateVisibilityExpr(effect.visibility, visibilityContext)) {
        continue;
      }
      effect.targetPassIds.forEach((targetPassId) => {
        this.getPassCanvasObjects(targetPassId).forEach((obj) => {
          effectTargetMap.set(obj, effect);
        });
      });
    }

    const managedObjects = this.canvas
      .getObjects()
      .filter((obj: any) =>
        this.isManagedPassObject(obj as FabricObject),
      ) as FabricObject[];

    const effectTemplateCache = new Map<string, FabricObject | null>();

    for (const obj of managedObjects) {
      const targetEffect = effectTargetMap.get(obj);
      if (!targetEffect) {
        this.clearClipPathEffectFromObject(obj as any);
        continue;
      }

      let template = effectTemplateCache.get(targetEffect.key);
      if (template === undefined) {
        template = await this.createClipPathTemplate(targetEffect);
        effectTemplateCache.set(targetEffect.key, template);
      }

      if (!template) {
        this.clearClipPathEffectFromObject(obj as any);
        continue;
      }

      await this.applyClipPathEffectToObject(
        obj as any,
        template,
        targetEffect.key,
      );
    }

    if (options.render !== false) {
      this.requestRenderAll();
    }
  }

  getObject(id: string, passId?: string): FabricObject | undefined {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) return undefined;

    return this.canvas.getObjects().find((obj: any) => {
      if (obj?.data?.id !== normalizedId) return false;
      if (!passId) return true;
      return obj?.data?.passId === passId;
    }) as FabricObject | undefined;
  }

  requestRenderAll() {
    this.canvas.requestRenderAll();
  }

  resize(width: number, height: number) {
    this.canvas.setDimensions({ width, height });
    this.viewport.updateContainer(width, height);
    this.eventBus?.emit("canvas:resized", { width, height });
    this.requestRenderAll();
  }

  getSceneScale(): number {
    const scale = Number(this.viewport.scale);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  getSceneOffset(): { x: number; y: number } {
    const offset = this.viewport.offset;
    const x = Number(offset.x);
    const y = Number(offset.y);
    return {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
    };
  }

  toScreenPoint(point: { x: number; y: number }): { x: number; y: number } {
    const scale = this.getSceneScale();
    const offset = this.getSceneOffset();
    return {
      x: point.x * scale + offset.x,
      y: point.y * scale + offset.y,
    };
  }

  toScenePoint(point: { x: number; y: number }): { x: number; y: number } {
    const scale = this.getSceneScale();
    const offset = this.getSceneOffset();
    return {
      x: (point.x - offset.x) / scale,
      y: (point.y - offset.y) / scale,
    };
  }

  toScreenLength(value: number): number {
    return value * this.getSceneScale();
  }

  toSceneLength(value: number): number {
    return value / this.getSceneScale();
  }

  toScreenRect(rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  }): { left: number; top: number; width: number; height: number } {
    const start = this.toScreenPoint({ x: rect.left, y: rect.top });
    return {
      left: start.x,
      top: start.y,
      width: this.toScreenLength(rect.width),
      height: this.toScreenLength(rect.height),
    };
  }

  toSceneRect(rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  }): { left: number; top: number; width: number; height: number } {
    const start = this.toScenePoint({ x: rect.left, y: rect.top });
    return {
      left: start.x,
      top: start.y,
      width: this.toSceneLength(rect.width),
      height: this.toSceneLength(rect.height),
    };
  }

  getSceneViewportRect(): {
    left: number;
    top: number;
    width: number;
    height: number;
  } {
    const width = Number(this.canvas.width || 0);
    const height = Number(this.canvas.height || 0);
    return this.toSceneRect({ left: 0, top: 0, width, height });
  }

  getScreenViewportRect(): RectLike {
    return {
      left: 0,
      top: 0,
      width: Number(this.canvas.width || 0),
      height: Number(this.canvas.height || 0),
    };
  }

  private toSpaceRect(
    rect: RectLike,
    from: RenderCoordinateSpace,
    to: RenderCoordinateSpace,
  ): RectLike {
    if (from === to) return { ...rect };
    if (from === "scene") {
      return this.toScreenRect(rect);
    }
    return this.toSceneRect(rect);
  }

  private resolveLayoutLength(
    value: RenderLayoutLength | undefined,
    base: number,
  ): number | undefined {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value !== "string") {
      return undefined;
    }
    const raw = value.trim();
    if (!raw) return undefined;
    if (raw.endsWith("%")) {
      const percent = parseFloat(raw.slice(0, -1));
      if (!Number.isFinite(percent)) return undefined;
      return (base * percent) / 100;
    }
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private resolveLayoutInsets(
    inset: RenderLayoutLength | RenderLayoutInsets | undefined,
    reference: RectLike,
  ): { top: number; right: number; bottom: number; left: number } {
    if (typeof inset === "number" || typeof inset === "string") {
      const all =
        this.resolveLayoutLength(
          inset,
          Math.min(reference.width, reference.height),
        ) ?? 0;
      return { top: all, right: all, bottom: all, left: all };
    }

    const source = inset || {};
    const top = this.resolveLayoutLength(source.top, reference.height) ?? 0;
    const right = this.resolveLayoutLength(source.right, reference.width) ?? 0;
    const bottom =
      this.resolveLayoutLength(source.bottom, reference.height) ?? 0;
    const left = this.resolveLayoutLength(source.left, reference.width) ?? 0;
    return { top, right, bottom, left };
  }

  private resolveLayoutReferenceRect(
    layout: RenderObjectLayoutSpec,
    space: RenderCoordinateSpace,
  ): RectLike {
    if (layout.referenceRect) {
      const sourceSpace: RenderCoordinateSpace =
        layout.referenceRect.space || space;
      return this.toSpaceRect(layout.referenceRect, sourceSpace, space);
    }

    const reference = layout.reference || "sceneViewport";
    if (reference === "screenViewport") {
      const screenRect = this.getScreenViewportRect();
      return space === "screen" ? screenRect : this.toSceneRect(screenRect);
    }

    const sceneRect = this.getSceneViewportRect();
    return space === "scene" ? sceneRect : this.toScreenRect(sceneRect);
  }

  private alignFactor(value: unknown): number {
    if (value === "end") return 1;
    if (value === "center") return 0.5;
    return 0;
  }

  private normalizeOriginX(value: unknown): "left" | "center" | "right" {
    if (value === "center") return "center";
    if (value === "right") return "right";
    return "left";
  }

  private normalizeOriginY(value: unknown): "top" | "center" | "bottom" {
    if (value === "center") return "center";
    if (value === "bottom") return "bottom";
    return "top";
  }

  private originFactor(
    value: "left" | "center" | "right" | "top" | "bottom",
  ): number {
    if (value === "center") return 0.5;
    if (value === "right" || value === "bottom") return 1;
    return 0;
  }

  private resolveLayoutProps(
    spec: RenderObjectSpec,
    props: Record<string, any>,
  ): Record<string, any> {
    const layout = spec.layout;
    if (!layout) {
      return { ...props };
    }

    const space: RenderCoordinateSpace = spec.space || "scene";
    const reference = this.resolveLayoutReferenceRect(layout, space);
    const inset = this.resolveLayoutInsets(layout.inset, reference);
    const area: RectLike = {
      left: reference.left + inset.left,
      top: reference.top + inset.top,
      width: Math.max(0, reference.width - inset.left - inset.right),
      height: Math.max(0, reference.height - inset.top - inset.bottom),
    };

    const next = { ...props };
    const width =
      this.resolveLayoutLength(layout.width, area.width) ??
      (Number.isFinite(next.width) ? Number(next.width) : undefined);
    const height =
      this.resolveLayoutLength(layout.height, area.height) ??
      (Number.isFinite(next.height) ? Number(next.height) : undefined);

    if (width !== undefined) next.width = width;
    if (height !== undefined) next.height = height;

    const alignX = this.alignFactor(layout.alignX);
    const alignY = this.alignFactor(layout.alignY);
    const offsetX = this.resolveLayoutLength(layout.offsetX, area.width) ?? 0;
    const offsetY = this.resolveLayoutLength(layout.offsetY, area.height) ?? 0;
    const objectWidth = Number.isFinite(next.width) ? Number(next.width) : 0;
    const objectHeight = Number.isFinite(next.height) ? Number(next.height) : 0;

    const objectLeft =
      area.left + (area.width - objectWidth) * alignX + offsetX;
    const objectTop =
      area.top + (area.height - objectHeight) * alignY + offsetY;

    const originX = this.normalizeOriginX(next.originX);
    const originY = this.normalizeOriginY(next.originY);
    next.left = objectLeft + objectWidth * this.originFactor(originX);
    next.top = objectTop + objectHeight * this.originFactor(originY);
    return next;
  }

  setPassVisibility(
    passId: string,
    visible: boolean,
    options: { scope?: string } = {},
  ): boolean {
    const scope = String(options.scope || "").trim() || undefined;
    const objects = (this.getPassCanvasObjects(passId) as any[]).filter(
      (obj) => !scope || obj?.data?.__renderScope === scope,
    );
    let changed = false;

    objects.forEach((obj) => {
      if (obj.visible === visible) return;
      obj.set?.({ visible });
      obj.setCoords?.();
      changed = true;
    });

    return changed;
  }

  setLayerVisibility(layerId: string, visible: boolean): boolean {
    return this.setPassVisibility(layerId, visible);
  }

  bringPassToFront(passId: string) {
    const objects = this.getPassCanvasObjects(passId) as any[];
    objects.forEach((obj) => this.canvas.bringObjectToFront(obj as any));
  }

  bringLayerToFront(layerId: string) {
    this.bringPassToFront(layerId);
  }

  async applyPassSpec(
    spec: RenderPassSpec,
    options: { render?: boolean } = {},
  ): Promise<void> {
    await this.applyObjectSpecsToPass(spec.targetLayerId || spec.id, spec.objects, {
      render: options.render,
      replace: spec.replace !== false,
    });
  }

  async applyObjectSpecsToRootLayer(
    passId: string,
    specs: RenderObjectSpec[],
    options: { render?: boolean } = {},
  ): Promise<void> {
    await this.applyObjectSpecsToPass(passId, specs, {
      render: options.render,
      replace: true,
    });
  }

  private normalizeObjectSpecs(specs: RenderObjectSpec[]): RenderObjectSpec[] {
    const seen = new Set<string>();
    const normalized: RenderObjectSpec[] = [];

    (specs || []).forEach((spec) => {
      const id = String(spec?.id || "").trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      normalized.push({
        ...spec,
        id,
      });
    });

    return normalized;
  }

  private async cloneFabricObject(
    source: FabricObject,
  ): Promise<FabricObject | undefined> {
    const clone = (source as any).clone;
    if (typeof clone !== "function") return undefined;

    const result = clone.call(source);
    if (!result || typeof result.then !== "function") {
      return undefined;
    }

    try {
      const copied = (await result) as FabricObject;
      return copied;
    } catch {
      return undefined;
    }
  }

  private async createClipPathTemplate(
    effect: ResolvedClipPathEffectSpec,
  ): Promise<FabricObject | null> {
    const source = effect.source;
    const sourceId = String(source.id || "").trim();
    if (!sourceId) return null;

    const template = await this.createFabricObject({
      ...source,
      id: sourceId,
      data: {
        ...(source.data || {}),
        id: sourceId,
        type: "clip-path-effect-template",
        effectKey: effect.key,
      },
      props: {
        ...(source.props || {}),
        selectable: false,
        evented: false,
        excludeFromExport: true,
      },
    });
    if (!template) return null;

    (template as any).set?.({
      selectable: false,
      evented: false,
      excludeFromExport: true,
      absolutePositioned: true,
    });
    (template as any).setCoords?.();
    return template;
  }

  private isClipPathEffectManaged(target: any): boolean {
    return typeof target?.__pooderEffectClipKey === "string";
  }

  private clearClipPathEffectFromObject(target: any) {
    if (!target) return;
    if (!this.isClipPathEffectManaged(target)) return;
    target.set?.({ clipPath: undefined });
    target.setCoords?.();
    delete target.__pooderEffectClipKey;
  }

  private async applyClipPathEffectToObject(
    target: any,
    clipTemplate: FabricObject,
    effectKey: string,
  ) {
    if (!target) return;

    const clipPath = await this.cloneFabricObject(clipTemplate);
    if (!clipPath) {
      this.clearClipPathEffectFromObject(target);
      return;
    }

    (clipPath as any).set?.({
      selectable: false,
      evented: false,
      excludeFromExport: true,
      absolutePositioned: true,
    });
    (clipPath as any).setCoords?.();

    target.set?.({ clipPath });
    target.setCoords?.();
    target.__pooderEffectClipKey = effectKey;
  }

  async applyObjectSpecsToPass(
    passId: string,
    specs: RenderObjectSpec[],
    options: {
      render?: boolean;
      replace?: boolean;
      scope?: string;
      orderOffset?: number;
    } = {},
  ): Promise<void> {
    const normalizedPassId = String(passId || "").trim();
    if (!normalizedPassId) return;

    const replace = options.replace !== false;
    const scope = String(options.scope || "").trim() || undefined;
    const orderOffset = Number.isFinite(options.orderOffset)
      ? Number(options.orderOffset)
      : 0;
    const normalizedSpecs = this.normalizeObjectSpecs(specs);
    const desiredIds = new Set(normalizedSpecs.map((s) => s.id));
    const matchesScope = (obj: any) =>
      !scope || obj?.data?.__renderScope === scope;

    const existing = (this.getPassCanvasObjects(normalizedPassId) as any[]).filter(
      matchesScope,
    );
    if (replace) {
      existing.forEach((obj) => {
        const id = obj?.data?.id;
        if (typeof id === "string" && !desiredIds.has(id)) {
          this.canvas.remove(obj);
        }
      });
    }

    const byId = new Map<string, any>();
    this.getPassCanvasObjects(normalizedPassId).forEach((obj: any) => {
      if (!matchesScope(obj)) return;
      const id = obj?.data?.id;
      if (typeof id === "string") byId.set(id, obj);
    });

    for (let index = 0; index < normalizedSpecs.length; index += 1) {
      const spec = normalizedSpecs[index];
      let current = byId.get(spec.id);

      if (spec.type === "path") {
        const nextPathData = this.readPathDataFromSpec(spec);
        if (!nextPathData || !nextPathData.trim()) {
          if (current) {
            this.canvas.remove(current);
            byId.delete(spec.id);
          }
          continue;
        }
      }

      if (current && this.shouldRecreateObject(current, spec)) {
        this.canvas.remove(current);
        byId.delete(spec.id);
        current = undefined;
      }

      if (!current) {
        const created = await this.createFabricObject(spec);
        if (!created) continue;
        this.patchFabricObject(created as any, spec, {
          passId: normalizedPassId,
          layerId: normalizedPassId,
          passOrder: orderOffset + index,
          ...(scope ? { __renderScope: scope } : {}),
        });
        this.canvas.add(created as any);
        byId.set(spec.id, created);
        continue;
      }

      this.patchFabricObject(current, spec, {
        passId: normalizedPassId,
        layerId: normalizedPassId,
        passOrder: orderOffset + index,
        ...(scope ? { __renderScope: scope } : {}),
      });
    }

    if (options.render !== false) {
      this.requestRenderAll();
    }
  }

  private patchFabricObject(
    obj: any,
    spec: RenderObjectSpec,
    extraData?: Record<string, any>,
  ) {
    const nextData = {
      ...(obj.data || {}),
      ...(spec.data || {}),
      ...(extraData || {}),
      id: spec.id,
    };
    nextData.__renderSourceKey = this.getSpecRenderSourceKey(spec);
    const props = this.resolveFabricProps(spec, spec.props || {});
    obj.set({ ...props, data: nextData });
    obj.setCoords();
  }

  private readPathDataFromSpec(spec: RenderObjectSpec): string | undefined {
    if (spec.type !== "path") return undefined;
    const raw = (spec.props as any)?.path || (spec.props as any)?.pathData;
    if (typeof raw !== "string") return undefined;
    return raw;
  }

  private hashText(value: string): string {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash +=
        (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }

  private getSpecRenderSourceKey(spec: RenderObjectSpec): string {
    switch (spec.type) {
      case "path": {
        const pathData = this.readPathDataFromSpec(spec) || "";
        return `path:${this.hashText(pathData)}`;
      }
      case "image":
        return `image:${String(spec.src || "")}`;
      case "text":
        return `text:${String((spec.props as any)?.text ?? "")}`;
      case "rect":
        return "rect";
      default:
        return String(spec.type || "");
    }
  }

  private shouldRecreateObject(current: any, spec: RenderObjectSpec): boolean {
    if (!current) return true;

    const currentType = String(current?.type || "").toLowerCase();
    if (currentType !== spec.type) return true;

    const expectedKey = this.getSpecRenderSourceKey(spec);
    const currentKey = String(current?.data?.__renderSourceKey || "");
    if (currentKey && expectedKey && currentKey !== expectedKey) return true;

    if (spec.type === "image" && spec.src && current.getSrc) {
      return current.getSrc() !== spec.src;
    }

    return false;
  }

  private resolveFabricProps(
    spec: RenderObjectSpec,
    props: Record<string, any>,
  ): Record<string, any> {
    const space: RenderCoordinateSpace = spec.space || "scene";
    const next = this.resolveLayoutProps(spec, props);
    if (space === "screen") {
      return next;
    }

    const hasLeft = Number.isFinite(next.left);
    const hasTop = Number.isFinite(next.top);
    if (hasLeft || hasTop) {
      const mapped = this.toScreenPoint({
        x: hasLeft ? Number(next.left) : 0,
        y: hasTop ? Number(next.top) : 0,
      });
      if (hasLeft) next.left = mapped.x;
      if (hasTop) next.top = mapped.y;
    }

    const rawScaleX = Number.isFinite(next.scaleX) ? Number(next.scaleX) : 1;
    const rawScaleY = Number.isFinite(next.scaleY) ? Number(next.scaleY) : 1;
    const sceneScale = this.getSceneScale();
    next.scaleX = rawScaleX * sceneScale;
    next.scaleY = rawScaleY * sceneScale;
    return next;
  }

  private moveObjectInCanvas(obj: any, index: number) {
    if (!obj) return;

    const moveObjectTo = (this.canvas as any).moveObjectTo;
    if (typeof moveObjectTo === "function") {
      moveObjectTo.call(this.canvas, obj, index);
      return;
    }

    const list = (this.canvas as any)._objects as any[] | undefined;
    if (!Array.isArray(list)) return;
    const from = list.indexOf(obj);
    if (from < 0 || from === index) return;

    list.splice(from, 1);
    const target = Math.max(0, Math.min(index, list.length));
    list.splice(target, 0, obj);
    if (typeof (this.canvas as any)._onStackOrderChanged === "function") {
      (this.canvas as any)._onStackOrderChanged();
    }
  }

  private async createFabricObject(
    spec: RenderObjectSpec,
  ): Promise<FabricObject | undefined> {
    if (spec.type === "rect") {
      const props = this.resolveFabricProps(spec, spec.props || {});
      const rect = new Rect({
        ...props,
        data: { ...(spec.data || {}), id: spec.id },
      } as any);
      rect.setCoords();
      return rect;
    }

    if (spec.type === "path") {
      const pathData = this.readPathDataFromSpec(spec);
      if (!pathData) return undefined;
      const props = this.resolveFabricProps(spec, spec.props || {});
      const path = new Path(pathData, {
        ...props,
        data: { ...(spec.data || {}), id: spec.id },
      } as any);
      path.setCoords();
      return path;
    }

    if (spec.type === "image") {
      if (!spec.src) return undefined;
      const image = await Image.fromURL(spec.src, { crossOrigin: "anonymous" });
      const props = this.resolveFabricProps(spec, spec.props || {});
      image.set({
        ...props,
        data: { ...(spec.data || {}), id: spec.id },
      } as any);
      image.setCoords();
      return image as any;
    }

    if (spec.type === "text") {
      const content = String((spec.props as any)?.text ?? "");
      const props = this.resolveFabricProps(spec, spec.props || {});
      const text = new Text(content, {
        ...props,
        data: { ...(spec.data || {}), id: spec.id },
      } as any);
      text.setCoords();
      return text as any;
    }

    return undefined;
  }
}
