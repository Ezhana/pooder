import {
  Canvas,
  Group,
  FabricObject,
  Rect,
  Path,
  Image,
  Text,
} from "fabric";
import { Service, EventBus } from "@pooder/core";
import { ViewportSystem } from "./ViewportSystem";
import type { RenderLayerSpec, RenderObjectSpec } from "./renderSpec";

export interface RenderProducerResult {
  layerSpecs?: Record<string, RenderObjectSpec[]>;
  rootLayerSpecs?: Record<string, RenderObjectSpec[]>;
  replaceLayerIds?: string[];
  replaceRootLayerIds?: string[];
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

export default class CanvasService implements Service {
  public canvas: Canvas;
  public viewport: ViewportSystem;
  private eventBus?: EventBus;
  private renderProducers: Map<string, RenderProducerEntry> = new Map();
  private producerOrder = 0;
  private producerFlushRequested = false;
  private producerLoopPending = false;
  private producerLoopPromise: Promise<void> | null = null;
  private managedProducerLayerIds: Set<string> = new Set();
  private managedProducerRootLayerIds: Set<string> = new Set();

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

  setEventBus(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.setupEvents();
  }

  private setupEvents() {
    if (!this.eventBus) return;
    const bus = this.eventBus;

    const forward = (name: string) => (e: any) => bus.emit(name, e);

    this.canvas.on("selection:created", forward("selection:created"));
    this.canvas.on("selection:updated", forward("selection:updated"));
    this.canvas.on("selection:cleared", forward("selection:cleared"));
    this.canvas.on("object:modified", forward("object:modified"));
    this.canvas.on("object:added", forward("object:added"));
    this.canvas.on("object:removed", forward("object:removed"));
  }

  dispose() {
    this.renderProducers.clear();
    this.managedProducerLayerIds.clear();
    this.managedProducerRootLayerIds.clear();
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
      throw new Error("[CanvasService] registerRenderProducer requires a toolId.");
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

  private appendLayerSpecMap(
    map: Map<string, RenderObjectSpec[]>,
    source?: Record<string, RenderObjectSpec[]>,
  ) {
    if (!source) return;
    Object.entries(source).forEach(([layerId, specs]) => {
      if (!Array.isArray(specs)) return;
      const list = map.get(layerId) || [];
      list.push(...specs);
      map.set(layerId, list);
    });
  }

  private async collectAndApplyProducerSpecs(): Promise<void> {
    const groupLayerSpecs = new Map<string, RenderObjectSpec[]>();
    const rootLayerSpecs = new Map<string, RenderObjectSpec[]>();
    const replaceLayerIds = new Set<string>();
    const replaceRootLayerIds = new Set<string>();
    const entries = this.sortedRenderProducerEntries();

    for (const entry of entries) {
      try {
        const result = await entry.producer();
        if (!result) continue;
        this.appendLayerSpecMap(groupLayerSpecs, result.layerSpecs);
        this.appendLayerSpecMap(rootLayerSpecs, result.rootLayerSpecs);
        if (Array.isArray(result.replaceLayerIds)) {
          result.replaceLayerIds.forEach((layerId) => {
            if (layerId) replaceLayerIds.add(layerId);
          });
        }
        if (Array.isArray(result.replaceRootLayerIds)) {
          result.replaceRootLayerIds.forEach((layerId) => {
            if (layerId) replaceRootLayerIds.add(layerId);
          });
        }
      } catch (error) {
        console.error(
          `[CanvasService] render producer "${entry.toolId}" failed.`,
          error,
        );
      }
    }

    const nextLayerIds = new Set(groupLayerSpecs.keys());
    const nextRootLayerIds = new Set(rootLayerSpecs.keys());

    for (const [layerId, specs] of groupLayerSpecs.entries()) {
      if (replaceLayerIds.has(layerId)) {
        const layer = this.getLayer(layerId);
        if (layer) {
          (layer.getObjects() as any[]).forEach((obj) => layer.remove(obj));
        }
      }
      await this.applyObjectSpecsToLayer(layerId, specs, { render: false });
    }

    for (const layerId of this.managedProducerLayerIds) {
      if (nextLayerIds.has(layerId)) continue;
      const layer = this.getLayer(layerId);
      if (!layer) continue;
      await this.applyObjectSpecsToContainer(layer, [], { render: false });
    }

    for (const [layerId, specs] of rootLayerSpecs.entries()) {
      if (replaceRootLayerIds.has(layerId)) {
        const existing = this.getRootLayerObjects(layerId) as any[];
        existing.forEach((obj) => this.canvas.remove(obj));
      }
      await this.applyObjectSpecsToRootLayer(layerId, specs, { render: false });
    }

    for (const layerId of this.managedProducerRootLayerIds) {
      if (nextRootLayerIds.has(layerId)) continue;
      await this.applyObjectSpecsToRootLayer(layerId, [], { render: false });
    }

    this.managedProducerLayerIds = nextLayerIds;
    this.managedProducerRootLayerIds = nextRootLayerIds;
    this.requestRenderAll();
  }

  /**
   * Get a layer (Group) by its ID.
   * We assume layers are Groups directly on the canvas with a data.id property.
   */
  getLayer(id: string): Group | undefined {
    return this.canvas.getObjects().find((obj: any) => obj.data?.id === id) as
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
    }
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

  async applyLayerSpec(spec: RenderLayerSpec): Promise<void> {
    const layer = this.createLayer(spec.id, spec.props || {});
    await this.applyObjectSpecsToContainer(layer, spec.objects);
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
    obj.set({ ...(spec.props || {}), data: nextData });
    obj.setCoords();
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
      const rect = new Rect({
        ...(spec.props || {}),
        data: { ...(spec.data || {}), id: spec.id },
      } as any);
      rect.setCoords();
      return rect;
    }

    if (spec.type === "path") {
      const pathData = (spec.props as any)?.path || (spec.props as any)?.pathData;
      if (!pathData) return undefined;
      const path = new Path(pathData, {
        ...(spec.props || {}),
        data: { ...(spec.data || {}), id: spec.id },
      } as any);
      path.setCoords();
      return path;
    }

    if (spec.type === "image") {
      if (!spec.src) return undefined;
      const image = await Image.fromURL(spec.src, { crossOrigin: "anonymous" });
      image.set({
        ...(spec.props || {}),
        data: { ...(spec.data || {}), id: spec.id },
      } as any);
      image.setCoords();
      return image as any;
    }

    if (spec.type === "text") {
      const content = String((spec.props as any)?.text ?? "");
      const text = new Text(content, {
        ...(spec.props || {}),
        data: { ...(spec.data || {}), id: spec.id },
      } as any);
      text.setCoords();
      return text as any;
    }

    return undefined;
  }
}
