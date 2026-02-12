import { Canvas, Group, FabricObject, Rect, Path, Image } from "fabric";
import { Service, EventBus } from "@pooder/core";
import { ViewportSystem } from "./ViewportSystem";
import type { RenderLayerSpec, RenderObjectSpec } from "./renderSpec";

export default class CanvasService implements Service {
  public canvas: Canvas;
  public viewport: ViewportSystem;
  private eventBus?: EventBus;

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
    this.canvas.dispose();
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

  async applyLayerSpec(spec: RenderLayerSpec): Promise<void> {
    const layer = this.createLayer(spec.id, spec.props || {});
    await this.applyObjectSpecsToContainer(layer, spec.objects);
  }

  async applyObjectSpecsToLayer(
    layerId: string,
    objects: RenderObjectSpec[],
  ): Promise<void> {
    const layer = this.createLayer(layerId, {});
    await this.applyObjectSpecsToContainer(layer, objects);
  }

  getRootLayerObjects(layerId: string): FabricObject[] {
    return this.canvas
      .getObjects()
      .filter((obj: any) => obj?.data?.layerId === layerId);
  }

  async applyObjectSpecsToRootLayer(
    layerId: string,
    specs: RenderObjectSpec[],
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

    this.requestRenderAll();
  }

  private async applyObjectSpecsToContainer(
    container: Group,
    specs: RenderObjectSpec[],
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
    this.requestRenderAll();
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

    return undefined;
  }
}
