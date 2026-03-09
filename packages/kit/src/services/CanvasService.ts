import { Canvas, Group, FabricObject, Rect, Path, Image, Text } from "fabric";
import {
  Service,
  EventBus,
  ServiceContext,
  TOOL_SESSION_SERVICE,
  ToolSessionService,
  WORKBENCH_SERVICE,
  WorkbenchService,
} from "@pooder/core";
import { ViewportSystem } from "./ViewportSystem";
import type {
  RenderCoordinateSpace,
  RenderLayerMount,
  RenderLayerSpec,
  RenderLayoutInsets,
  RenderLayoutLength,
  RenderObjectLayoutSpec,
  RenderObjectSpec,
} from "./renderSpec";
import { evaluateVisibilityExpr, type VisibilityLayerState } from "./visibility";

export interface RenderProducerResult {
  layers?: RenderLayerSpec[];
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

interface ResolvedRenderLayerSpec {
  id: string;
  mount: RenderLayerMount;
  stack: number;
  order: number;
  replace: boolean;
  visibility?: RenderLayerSpec["visibility"];
  props?: Record<string, any>;
  objects: RenderObjectSpec[];
}

interface ManagedLayerMeta {
  id: string;
  mount: RenderLayerMount;
  stack: number;
  order: number;
  visibility?: RenderLayerSpec["visibility"];
}

export default class CanvasService implements Service {
  public canvas: Canvas;
  public viewport: ViewportSystem;
  private context?: ServiceContext;
  private eventBus?: EventBus;
  private workbenchService?: WorkbenchService;
  private toolSessionService?: ToolSessionService;
  private renderProducers: Map<string, RenderProducerEntry> = new Map();
  private producerOrder = 0;
  private producerFlushRequested = false;
  private producerLoopPending = false;
  private producerLoopPromise: Promise<void> | null = null;
  private producerApplyInProgress = false;
  private visibilityRefreshScheduled = false;
  private managedProducerLayerIds: Set<string> = new Set();
  private managedProducerRootLayerIds: Set<string> = new Set();
  private managedLayerMetas: Map<string, ManagedLayerMeta> = new Map();

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
    this.applyManagedLayerVisibility();
  };
  private readonly onToolSessionChanged = () => {
    this.applyManagedLayerVisibility();
  };
  private readonly onCanvasObjectChanged = () => {
    if (this.producerApplyInProgress) return;
    this.scheduleManagedLayerVisibilityRefresh();
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
    this.setEventBus(context.eventBus);
    this.attachContextEvents(context.eventBus);
  }

  private attachContextEvents(eventBus: EventBus) {
    eventBus.on("tool:activated", this.onToolActivated);
    eventBus.on("tool:session:change", this.onToolSessionChanged);
    eventBus.on("object:added", this.onCanvasObjectChanged);
    eventBus.on("object:removed", this.onCanvasObjectChanged);
  }

  private detachContextEvents(eventBus: EventBus) {
    eventBus.off("tool:activated", this.onToolActivated);
    eventBus.off("tool:session:change", this.onToolSessionChanged);
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
    this.managedProducerLayerIds.clear();
    this.managedProducerRootLayerIds.clear();
    this.managedLayerMetas.clear();
    this.context = undefined;
    this.workbenchService = undefined;
    this.toolSessionService = undefined;
    this.producerFlushRequested = false;
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

  private normalizeLayerSpecValue(spec: RenderLayerSpec): ResolvedRenderLayerSpec | null {
    const id = String(spec.id || "").trim();
    if (!id) return null;

    return {
      id,
      mount: spec.mount === "root" ? "root" : "group",
      stack: Number.isFinite(spec.stack) ? Number(spec.stack) : 0,
      order: Number.isFinite(spec.order) ? Number(spec.order) : 0,
      replace: spec.replace === true,
      visibility: spec.visibility,
      props:
        spec.props && typeof spec.props === "object"
          ? { ...(spec.props as Record<string, any>) }
          : undefined,
      objects: Array.isArray(spec.objects) ? [...spec.objects] : [],
    };
  }

  private mergeLayerSpec(
    map: Map<string, ResolvedRenderLayerSpec>,
    rawSpec: RenderLayerSpec,
    producerId: string,
  ) {
    const normalized = this.normalizeLayerSpecValue(rawSpec);
    if (!normalized) return;

    const existing = map.get(normalized.id);
    if (!existing) {
      map.set(normalized.id, normalized);
      return;
    }

    if (existing.mount !== normalized.mount) {
      console.warn(
        `[CanvasService] layer "${normalized.id}" from producer "${producerId}" has mount "${normalized.mount}" but an existing mount "${existing.mount}" is already registered in this flush.`,
      );
      return;
    }

    existing.objects.push(...normalized.objects);
    existing.replace = existing.replace || normalized.replace;
    existing.stack = normalized.stack;
    existing.order = normalized.order;
    if (normalized.visibility !== undefined) {
      existing.visibility = normalized.visibility;
    }
    if (normalized.props && normalized.mount === "group") {
      existing.props = { ...(existing.props || {}), ...normalized.props };
    }
  }

  private removeGroupLayer(layerId: string) {
    const layer = this.getLayer(layerId);
    if (!layer) return;
    this.canvas.remove(layer);
  }

  private compareLayerMeta(a: ManagedLayerMeta, b: ManagedLayerMeta): number {
    if (a.stack !== b.stack) return a.stack - b.stack;
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  }

  private getLayerCanvasObjects(
    layerId: string,
    mount: RenderLayerMount,
  ): FabricObject[] {
    if (mount === "group") {
      const layer = this.getLayer(layerId);
      return layer ? [layer as any] : [];
    }
    const rootObjects = this.getRootLayerObjects(layerId);
    const all = this.canvas.getObjects();
    return [...rootObjects].sort((a, b) => all.indexOf(a) - all.indexOf(b));
  }

  private syncManagedLayerStacking(layers: ManagedLayerMeta[]) {
    const ordered = [...layers]
      .sort((a, b) => this.compareLayerMeta(a, b))
      .map((meta) => ({
        meta,
        objects: this.getLayerCanvasObjects(meta.id, meta.mount),
      }))
      .filter((entry) => entry.objects.length > 0);

    let previousMaxIndex = -1;
    ordered.forEach((entry) => {
      const canvasObjects = this.canvas.getObjects();
      const indexes = entry.objects
        .map((obj) => canvasObjects.indexOf(obj))
        .filter((index) => index >= 0);
      if (!indexes.length) return;

      const currentMin = Math.min(...indexes);
      if (previousMaxIndex >= 0 && currentMin <= previousMaxIndex) {
        let targetIndex = previousMaxIndex + 1;
        entry.objects.forEach((obj) => {
          this.moveObjectInContainer(this.canvas, obj as any, targetIndex);
          targetIndex += 1;
        });
        previousMaxIndex = targetIndex - 1;
        return;
      }

      previousMaxIndex = Math.max(...indexes);
    });
  }

  private getLayerRuntimeState(): Map<string, VisibilityLayerState> {
    const state = new Map<string, VisibilityLayerState>();

    const ensure = (layerId: string): VisibilityLayerState => {
      const id = String(layerId || "").trim();
      if (!id) return { exists: false, objectCount: 0 };
      let item = state.get(id);
      if (!item) {
        item = { exists: false, objectCount: 0 };
        state.set(id, item);
      }
      return item;
    };

    this.canvas.getObjects().forEach((obj: any) => {
      const layerId = obj?.data?.id;
      if (obj instanceof Group && typeof layerId === "string") {
        const item = ensure(layerId);
        item.exists = true;
        item.objectCount = Math.max(
          item.objectCount,
          (obj.getObjects() as any[]).length,
        );
      }

      const rootLayerId = obj?.data?.layerId;
      if (typeof rootLayerId === "string") {
        const item = ensure(rootLayerId);
        item.exists = true;
        item.objectCount += 1;
      }
    });

    this.managedLayerMetas.forEach((meta) => {
      const item = ensure(meta.id);
      item.exists = true;
    });

    return state;
  }

  private applyManagedLayerVisibility(options: { render?: boolean } = {}): boolean {
    if (!this.managedLayerMetas.size) return false;
    const layers = this.getLayerRuntimeState();
    const activeToolId = this.workbenchService?.activeToolId ?? null;
    const isSessionActive = (toolId: string) => {
      if (!this.toolSessionService) return false;
      return this.toolSessionService.getState(toolId).status === "active";
    };

    let changed = false;

    this.managedLayerMetas.forEach((meta) => {
      const visible = evaluateVisibilityExpr(meta.visibility, {
        activeToolId,
        isSessionActive,
        layers,
      });
      changed = this.setLayerVisibility(meta.id, visible, meta.mount) || changed;
    });

    if (changed && options.render !== false) {
      this.requestRenderAll();
    }
    return changed;
  }

  private scheduleManagedLayerVisibilityRefresh() {
    if (this.visibilityRefreshScheduled) return;
    this.visibilityRefreshScheduled = true;
    void Promise.resolve().then(() => {
      this.visibilityRefreshScheduled = false;
      this.applyManagedLayerVisibility();
    });
  }

  private async collectAndApplyProducerSpecs(): Promise<void> {
    const layers = new Map<string, ResolvedRenderLayerSpec>();
    const entries = this.sortedRenderProducerEntries();

    this.producerApplyInProgress = true;
    try {
      for (const entry of entries) {
        try {
          const result = await entry.producer();
          if (!result) continue;
          const specs = Array.isArray(result.layers) ? result.layers : [];
          specs.forEach((spec) => this.mergeLayerSpec(layers, spec, entry.toolId));
        } catch (error) {
          console.error(
            `[CanvasService] render producer "${entry.toolId}" failed.`,
            error,
          );
        }
      }

      const nextLayerIds = new Set<string>();
      const nextRootLayerIds = new Set<string>();
      const nextManagedLayerMetas = new Map<string, ManagedLayerMeta>();

      for (const layer of layers.values()) {
        nextManagedLayerMetas.set(layer.id, {
          id: layer.id,
          mount: layer.mount,
          stack: layer.stack,
          order: layer.order,
          visibility: layer.visibility,
        });

        if (layer.mount === "group") {
          nextLayerIds.add(layer.id);
          if (layer.replace) {
            const existingLayer = this.getLayer(layer.id);
            if (existingLayer) {
              (existingLayer.getObjects() as any[]).forEach((obj) =>
                existingLayer.remove(obj),
              );
            }
          }
          await this.applyLayerSpec(
            {
              id: layer.id,
              mount: "group",
              stack: layer.stack,
              order: layer.order,
              replace: layer.replace,
              visibility: layer.visibility,
              objects: layer.objects,
              props: layer.props,
            },
            { render: false },
          );
          continue;
        }

        nextRootLayerIds.add(layer.id);
        if (layer.replace) {
          const existing = this.getRootLayerObjects(layer.id) as any[];
          existing.forEach((obj) => this.canvas.remove(obj));
        }
        await this.applyObjectSpecsToRootLayer(layer.id, layer.objects, {
          render: false,
        });
      }

      for (const layerId of this.managedProducerLayerIds) {
        if (nextLayerIds.has(layerId)) continue;
        this.removeGroupLayer(layerId);
      }

      for (const layerId of this.managedProducerRootLayerIds) {
        if (nextRootLayerIds.has(layerId)) continue;
        await this.applyObjectSpecsToRootLayer(layerId, [], { render: false });
      }

      this.managedProducerLayerIds = nextLayerIds;
      this.managedProducerRootLayerIds = nextRootLayerIds;
      this.managedLayerMetas = nextManagedLayerMetas;

      this.syncManagedLayerStacking(Array.from(nextManagedLayerMetas.values()));
      this.applyManagedLayerVisibility({ render: false });
    } finally {
      this.producerApplyInProgress = false;
    }

    this.requestRenderAll();
  }

  /**
   * Get a layer (Group) by its ID.
   * We assume layers are Groups directly on the canvas with a data.id property.
   */
  getLayer(id: string): Group | undefined {
    return this.canvas.getObjects().find((obj: any) => {
      if (!(obj instanceof Group)) return false;
      return (obj as any).data?.id === id;
    }) as
      | Group
      | undefined;
  }

  /**
   * Create a layer (Group) with the given ID if it doesn't exist.
   */
  createLayer(id: string, options: any = {}): Group {
    let layer = this.getLayer(id);
    if (!layer) {
      const defaultOptions = {
        selectable: false,
        evented: false,
        ...options,
        data: { ...options.data, id },
      };
      layer = new Group([], defaultOptions);
      this.canvas.add(layer);
      return layer;
    }

    const nextData = {
      ...((layer as any).data || {}),
      ...(options.data || {}),
      id,
    };
    layer.set({ ...options, data: nextData });
    layer.setCoords();
    return layer;
  }

  /**
   * Find an object by ID, optionally within a specific layer.
   */
  getObject(id: string, layerId?: string): FabricObject | undefined {
    if (layerId) {
      const layer = this.getLayer(layerId);
      if (!layer) return undefined;
      return layer.getObjects().find((obj: any) => obj.data?.id === id);
    }
    return this.canvas.getObjects().find((obj: any) => obj.data?.id === id);
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

  setLayerVisibility(
    layerId: string,
    visible: boolean,
    mount?: RenderLayerMount,
  ): boolean {
    let changed = false;

    if (mount !== "root") {
      const layer = this.getLayer(layerId);
      if (layer && layer.visible !== visible) {
        layer.set({ visible });
        layer.setCoords();
        changed = true;
      }
    }

    if (mount !== "group") {
      const objects = this.getRootLayerObjects(layerId) as any[];
      objects.forEach((obj) => {
        if (obj.visible === visible) return;
        obj.set?.({ visible });
        obj.setCoords?.();
        changed = true;
      });
    }

    return changed;
  }

  bringLayerToFront(layerId: string) {
    const layer = this.getLayer(layerId);
    if (layer) {
      this.canvas.bringObjectToFront(layer);
    }
    const objects = this.getRootLayerObjects(layerId) as any[];
    objects.forEach((obj) => this.canvas.bringObjectToFront(obj as any));
  }

  async applyLayerSpec(
    spec: RenderLayerSpec,
    options: { render?: boolean } = {},
  ): Promise<void> {
    if (spec.mount === "root") {
      await this.applyObjectSpecsToRootLayer(spec.id, spec.objects, options);
      return;
    }
    const layer = this.createLayer(spec.id, spec.props || {});
    await this.applyObjectSpecsToContainer(layer, spec.objects, options);
  }

  async applyObjectSpecsToLayer(
    layerId: string,
    objects: RenderObjectSpec[],
    options: { render?: boolean } = {},
  ): Promise<void> {
    const layer = this.createLayer(layerId, {});
    await this.applyObjectSpecsToContainer(layer, objects, options);
  }

  getRootLayerObjects(layerId: string): FabricObject[] {
    return this.canvas
      .getObjects()
      .filter((obj: any) => obj?.data?.layerId === layerId);
  }

  async applyObjectSpecsToRootLayer(
    layerId: string,
    specs: RenderObjectSpec[],
    options: { render?: boolean } = {},
  ): Promise<void> {
    const desiredIds = new Set(specs.map((s) => s.id));
    const existing = this.getRootLayerObjects(layerId) as any[];
    existing.forEach((obj) => {
      const id = obj?.data?.id;
      if (typeof id === "string" && !desiredIds.has(id)) {
        this.canvas.remove(obj);
      }
    });

    const byId = new Map<string, any>();
    this.getRootLayerObjects(layerId).forEach((obj: any) => {
      const id = obj?.data?.id;
      if (typeof id === "string") byId.set(id, obj);
    });

    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index];
      let current = byId.get(spec.id);
      if (
        current &&
        spec.type === "image" &&
        spec.src &&
        current.getSrc &&
        current.getSrc() !== spec.src
      ) {
        this.canvas.remove(current);
        byId.delete(spec.id);
        current = undefined;
      }

      if (!current) {
        const created = await this.createFabricObject(spec);
        if (!created) continue;
        this.patchFabricObject(created as any, spec, { layerId });
        this.canvas.add(created as any);
        byId.set(spec.id, created);
        continue;
      }

      this.patchFabricObject(current, spec, { layerId });
    }

    if (options.render !== false) {
      this.requestRenderAll();
    }
  }

  private async applyObjectSpecsToContainer(
    container: Group,
    specs: RenderObjectSpec[],
    options: { render?: boolean } = {},
  ): Promise<void> {
    const desiredIds = new Set(specs.map((s) => s.id));
    const existing = container.getObjects() as any[];
    existing.forEach((obj) => {
      const id = obj?.data?.id;
      if (typeof id === "string" && !desiredIds.has(id)) {
        container.remove(obj);
      }
    });

    const byId = new Map<string, any>();
    (container.getObjects() as any[]).forEach((obj) => {
      const id = obj?.data?.id;
      if (typeof id === "string") byId.set(id, obj);
    });

    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index];
      let current = byId.get(spec.id);
      if (
        current &&
        spec.type === "image" &&
        spec.src &&
        current.getSrc &&
        current.getSrc() !== spec.src
      ) {
        container.remove(current);
        byId.delete(spec.id);
        current = undefined;
      }

      if (!current) {
        const created = await this.createFabricObject(spec);
        if (!created) continue;
        container.add(created as any);
        current = created as any;
        byId.set(spec.id, current);
      } else {
        this.patchFabricObject(current, spec);
      }

      this.moveObjectInContainer(container, current, index);
    }

    container.dirty = true;
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
    const props = this.resolveFabricProps(spec, spec.props || {});
    obj.set({ ...props, data: nextData });
    obj.setCoords();
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

  private moveObjectInContainer(
    container: Group | Canvas,
    obj: any,
    index: number,
  ) {
    if (!obj) return;

    const moveObjectTo = (container as any).moveObjectTo;
    if (typeof moveObjectTo === "function") {
      moveObjectTo.call(container, obj, index);
      return;
    }

    const list = (container as any)._objects as any[] | undefined;
    if (!Array.isArray(list)) return;
    const from = list.indexOf(obj);
    if (from < 0 || from === index) return;
    list.splice(from, 1);
    const target = Math.max(0, Math.min(index, list.length));
    list.splice(target, 0, obj);
    if (typeof (container as any)._onStackOrderChanged === "function") {
      (container as any)._onStackOrderChanged();
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
      const pathData =
        (spec.props as any)?.path || (spec.props as any)?.pathData;
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
