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

    const tasks = specs.map(async (spec) => {
      const current = byId.get(spec.id);
      if (current) {
        if (
          spec.type === "image" &&
          spec.src &&
          current.getSrc &&
          current.getSrc() !== spec.src
        ) {
          container.remove(current);
          byId.delete(spec.id);
        } else {
          this.patchFabricObject(current, spec);
          container.remove(current);
          container.add(current);
          return;
        }
        return;
      }

      const created = await this.createFabricObject(spec);
      if (!created) return;
      container.add(created as any);
    });

    await Promise.all(tasks);
    container.dirty = true;
    this.requestRenderAll();
  }

  private patchFabricObject(obj: any, spec: RenderObjectSpec) {
    const nextData = { ...(obj.data || {}), ...(spec.data || {}), id: spec.id };
    obj.set({ ...(spec.props || {}), data: nextData });
    obj.setCoords();
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
