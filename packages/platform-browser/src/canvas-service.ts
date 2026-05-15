import { Canvas, FabricObject, Image, Path, Pattern, Rect, Text } from "fabric";
import {
  EventBus,
  Service,
  ServiceContext,
  type CanvasObjectLike,
  type CanvasService as CanvasServiceContract,
  type CanvasSize,
  type CanvasViewportLayout,
  type RenderCoordinateSpace,
  type RenderEffectSpec,
  type RenderLayoutInsets,
  type RenderLayoutLength,
  type RenderObjectLayoutSpec,
  type RenderObjectSpec,
  type RenderPatternSpec,
} from "@pooder/core";
import { ViewportSystem } from "./viewport-system";

interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FabricRenderTargetItem {
  key: string;
  layerId: string;
  order: number;
  spec: RenderObjectSpec;
}

export interface FabricRenderTargetClipEffect {
  key: string;
  source: RenderObjectSpec;
  targetLayerIds?: string[];
  targetSubjectIds?: string[];
}

const GRAPH_RENDER_TARGET = "render-graph";

export default class CanvasService implements Service, CanvasServiceContract {
  public canvas: Canvas;
  public viewport: ViewportSystem;
  private context?: ServiceContext;
  private eventBus?: EventBus;
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
  private readonly forwardMouseDown = (e: any) => {
    this.eventBus?.emit("mouse:down", e);
  };
  private readonly forwardObjectAdded = (e: any) => {
    this.eventBus?.emit("object:added", e);
  };
  private readonly forwardObjectRemoved = (e: any) => {
    this.eventBus?.emit("object:removed", e);
  };

  constructor(el: HTMLCanvasElement | string | Canvas, options?: any) {
    if (el instanceof Canvas) {
      this.canvas = el;
    } else {
      this.canvas = new Canvas(el, {
        ...options,
        preserveObjectStacking: true,
      });
    }
    this.ensureCanvasPreservesObjectStacking();

    this.viewport = new ViewportSystem();
    if (this.canvas.width !== undefined && this.canvas.height !== undefined) {
      this.viewport.updateContainer(this.canvas.width, this.canvas.height);
    }

    if (options?.eventBus) {
      this.setEventBus(options.eventBus);
    }
  }

  init(context: ServiceContext) {
    this.context = context;
    this.setEventBus(context.eventBus);
  }

  dispose() {
    this.context = undefined;
    this.canvas.dispose();
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
    this.canvas.on("mouse:down", this.forwardMouseDown);
    this.canvas.on("object:added", this.forwardObjectAdded);
    this.canvas.on("object:removed", this.forwardObjectRemoved);
    this.canvasForwardersBound = true;
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

  getViewportSize(): CanvasSize {
    return {
      width: Number(this.canvas.width || 0),
      height: Number(this.canvas.height || 0),
    };
  }

  updateViewportLayout(options: {
    containerWidth: number;
    containerHeight: number;
    padding: number;
    widthMm: number;
    heightMm: number;
    offsetX?: number;
    offsetY?: number;
  }): CanvasViewportLayout | null {
    this.viewport.updateContainer(options.containerWidth, options.containerHeight);
    this.viewport.setPadding(options.padding);
    this.viewport.updatePhysical(options.widthMm, options.heightMm);
    if (
      Number.isFinite(options.offsetX) &&
      Number.isFinite(options.offsetY)
    ) {
      this.viewport.setOffset(Number(options.offsetX), Number(options.offsetY));
    }
    return this.viewport.layout;
  }

  getObjects(query: {
    layerId?: string;
    id?: string;
    type?: string;
    includeHidden?: boolean;
    predicate?: (object: CanvasObjectLike) => boolean;
  } = {}): CanvasObjectLike[] {
    return (this.canvas.getObjects() as CanvasObjectLike[]).filter((obj: any) => {
      if (!query.includeHidden && obj?.visible === false) return false;
      if (query.layerId !== undefined && obj?.data?.layerId !== query.layerId) {
        return false;
      }
      if (query.id !== undefined && obj?.data?.id !== query.id) return false;
      if (query.type !== undefined && obj?.data?.type !== query.type) return false;
      return query.predicate ? query.predicate(obj) : true;
    });
  }

  getObject(id: string, layerId?: string): FabricObject | undefined {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) return undefined;

    return this.canvas.getObjects().find((obj: any) => {
      if (obj?.data?.id !== normalizedId) return false;
      if (!layerId) return true;
      return obj?.data?.layerId === layerId;
    }) as FabricObject | undefined;
  }

  getActiveObject(): CanvasObjectLike | undefined {
    return this.canvas.getActiveObject() as CanvasObjectLike | undefined;
  }

  setActiveObject(object: CanvasObjectLike): boolean {
    if (!object) return false;
    this.ensureCanvasPreservesObjectStacking();
    this.canvas.setActiveObject(object as any);
    return true;
  }

  discardActiveObject(): boolean {
    this.canvas.discardActiveObject();
    return true;
  }

  setViewportMirror(enabled: boolean): void {
    const width = this.canvas.width || 800;
    let vpt = this.canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    vpt = [...vpt];
    const isFlipped = vpt[0] < 0;

    if (enabled && !isFlipped) {
      vpt[0] = -vpt[0];
      vpt[4] = width - vpt[4];
    } else if (!enabled && isFlipped) {
      vpt[0] = -vpt[0];
      vpt[4] = width - vpt[4];
    }

    this.canvas.setViewportTransform(vpt as any);
    this.requestRenderAll();
  }

  onCanvasEvent(event: string, handler: (...args: any[]) => void): void {
    this.canvas.on(event as any, handler as any);
  }

  offCanvasEvent(event: string, handler: (...args: any[]) => void): void {
    this.canvas.off(event as any, handler as any);
  }

  getTopContext(): CanvasRenderingContext2D | undefined {
    return (this.canvas as any).contextTop;
  }

  clearTopContext(): void {
    const context = this.getTopContext();
    if (context) {
      this.canvas.clearContext(context);
    }
  }

  async loadImageSize(src: string): Promise<CanvasSize | null> {
    try {
      const image = await Image.fromURL(src, {
        crossOrigin: "anonymous",
      });
      const width = Number(image?.width || 0);
      const height = Number(image?.height || 0);
      return width > 0 && height > 0 ? { width, height } : null;
    } catch {
      return null;
    }
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

  toScreenRect(rect: RectLike): RectLike {
    const start = this.toScreenPoint({ x: rect.left, y: rect.top });
    return {
      left: start.x,
      top: start.y,
      width: this.toScreenLength(rect.width),
      height: this.toScreenLength(rect.height),
    };
  }

  toSceneRect(rect: RectLike): RectLike {
    const start = this.toScenePoint({ x: rect.left, y: rect.top });
    return {
      left: start.x,
      top: start.y,
      width: this.toSceneLength(rect.width),
      height: this.toSceneLength(rect.height),
    };
  }

  getSceneViewportRect(): RectLike {
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

  async reconcileRenderGraphDrawList(
    items: FabricRenderTargetItem[],
    effects: FabricRenderTargetClipEffect[] = [],
    options: { render?: boolean } = {},
  ): Promise<void> {
    const normalizedItems = items
      .map((item, index) => ({
        ...item,
        key: String(item.key || item.spec.id || "").trim(),
        layerId: String(item.layerId || item.spec.data?.layerId || "").trim(),
        order: Number.isFinite(item.order) ? Number(item.order) : index,
      }))
      .filter((item) => item.key && item.layerId);
    const desiredKeys = new Set(normalizedItems.map((item) => item.key));

    this.canvas.getObjects().forEach((object: any) => {
      if (object?.data?.renderTarget !== GRAPH_RENDER_TARGET) return;
      if (!desiredKeys.has(String(object.data.renderKey || ""))) {
        this.canvas.remove(object);
      }
    });

    const byKey = new Map<string, any>();
    this.canvas.getObjects().forEach((object: any) => {
      if (object?.data?.renderTarget !== GRAPH_RENDER_TARGET) return;
      const key = String(object.data.renderKey || "");
      if (key) byKey.set(key, object);
    });

    for (const item of normalizedItems) {
      const spec = item.spec;
      let current = byKey.get(item.key);

      if (spec.type === "path") {
        const nextPathData = this.readPathDataFromSpec(spec);
        if (!nextPathData?.trim()) {
          if (current) this.canvas.remove(current);
          continue;
        }
      }

      if (current && this.shouldRecreateObject(current, spec)) {
        this.canvas.remove(current);
        current = undefined;
      }

      if (!current) {
        const created = await this.createFabricObject(spec);
        if (!created) continue;
        current = created as any;
        this.canvas.add(current);
      }

      this.patchFabricObject(current, spec, {
        renderTarget: GRAPH_RENDER_TARGET,
        renderKey: item.key,
        layerId: item.layerId,
        renderOrder: item.order,
      });
    }

    await this.applyRenderGraphClipEffects(effects);
    this.syncRenderGraphStacking(normalizedItems.map((item) => item.key));

    if (options.render !== false) {
      this.requestRenderAll();
    }
  }

  private async applyRenderGraphClipEffects(
    effects: FabricRenderTargetClipEffect[],
  ) {
    const targetsByObject = new Map<FabricObject, FabricRenderTargetClipEffect>();

    effects.forEach((effect) => {
      const targetLayerIds = new Set(effect.targetLayerIds ?? []);
      const targetSubjectIds = new Set(effect.targetSubjectIds ?? []);
      if (!targetLayerIds.size && !targetSubjectIds.size) return;

      this.canvas.getObjects().forEach((object: any) => {
        if (object?.data?.renderTarget !== GRAPH_RENDER_TARGET) return;
        if (
          targetLayerIds.has(String(object.data.layerId || "")) ||
          targetSubjectIds.has(String(object.data.subjectId || ""))
        ) {
          targetsByObject.set(object as FabricObject, effect);
        }
      });
    });

    const templateCache = new Map<string, FabricObject | null>();
    for (const object of this.canvas.getObjects() as FabricObject[]) {
      const data = (object as any)?.data || {};
      if (data.renderTarget !== GRAPH_RENDER_TARGET) continue;
      const effect = targetsByObject.get(object);
      if (!effect) {
        this.clearClipPathEffectFromObject(object as any);
        continue;
      }

      let template = templateCache.get(effect.key);
      if (template === undefined) {
        template = await this.createClipPathTemplate(effect);
        templateCache.set(effect.key, template);
      }

      if (!template) {
        this.clearClipPathEffectFromObject(object as any);
        continue;
      }

      await this.applyClipPathEffectToObject(object as any, template, effect.key);
    }
  }

  private async createClipPathTemplate(
    effect: FabricRenderTargetClipEffect,
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

  private clearClipPathEffectFromObject(target: any) {
    if (!target || typeof target.__pooderEffectClipKey !== "string") return;
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

  private async cloneFabricObject(
    source: FabricObject,
  ): Promise<FabricObject | undefined> {
    const clone = (source as any).clone;
    if (typeof clone !== "function") return undefined;
    const result = clone.call(source);
    if (!result || typeof result.then !== "function") return undefined;
    try {
      return (await result) as FabricObject;
    } catch {
      return undefined;
    }
  }

  private syncRenderGraphStacking(orderedKeys: string[]) {
    const order = new Map(orderedKeys.map((key, index) => [key, index]));
    const objects = this.canvas
      .getObjects()
      .filter((object: any) => object?.data?.renderTarget === GRAPH_RENDER_TARGET)
      .sort((a: any, b: any) => {
        const aOrder = order.get(String(a?.data?.renderKey || "")) ?? 0;
        const bOrder = order.get(String(b?.data?.renderKey || "")) ?? 0;
        return aOrder - bOrder;
      });

    objects.forEach((object, index) => this.moveObjectInCanvas(object, index));
  }

  private toSpaceRect(
    rect: RectLike,
    from: RenderCoordinateSpace,
    to: RenderCoordinateSpace,
  ): RectLike {
    if (from === to) return { ...rect };
    return from === "scene" ? this.toScreenRect(rect) : this.toSceneRect(rect);
  }

  private resolveLayoutLength(
    value: RenderLayoutLength | undefined,
    base: number,
  ): number | undefined {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (typeof value !== "string") return undefined;
    const raw = value.trim();
    if (!raw) return undefined;
    if (raw.endsWith("%")) {
      const percent = parseFloat(raw.slice(0, -1));
      return Number.isFinite(percent) ? (base * percent) / 100 : undefined;
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
        this.resolveLayoutLength(inset, Math.min(reference.width, reference.height)) ?? 0;
      return { top: all, right: all, bottom: all, left: all };
    }

    const source = inset || {};
    return {
      top: this.resolveLayoutLength(source.top, reference.height) ?? 0,
      right: this.resolveLayoutLength(source.right, reference.width) ?? 0,
      bottom: this.resolveLayoutLength(source.bottom, reference.height) ?? 0,
      left: this.resolveLayoutLength(source.left, reference.width) ?? 0,
    };
  }

  private resolveLayoutReferenceRect(
    layout: RenderObjectLayoutSpec,
    space: RenderCoordinateSpace,
  ): RectLike {
    if (layout.referenceRect) {
      const sourceSpace: RenderCoordinateSpace = layout.referenceRect.space || space;
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
    if (!layout) return { ...props };

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

    const objectLeft = area.left + (area.width - objectWidth) * alignX + offsetX;
    const objectTop = area.top + (area.height - objectHeight) * alignY + offsetY;

    const originX = this.normalizeOriginX(next.originX);
    const originY = this.normalizeOriginY(next.originY);
    next.left = objectLeft + objectWidth * this.originFactor(originX);
    next.top = objectTop + objectHeight * this.originFactor(originY);
    return next;
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
    nextData.renderSourceKey = this.getSpecRenderSourceKey(spec);
    const props = this.resolveFabricProps(spec, spec.props || {});
    obj.set({ ...props, data: nextData });
    obj.setCoords();
  }

  private readPathDataFromSpec(spec: RenderObjectSpec): string | undefined {
    if (spec.type !== "path") return undefined;
    const raw = (spec.props as any)?.path || (spec.props as any)?.pathData;
    return typeof raw === "string" ? raw : undefined;
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
      case "path":
        return `path:${this.hashText(this.readPathDataFromSpec(spec) || "")}`;
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
    const currentKey = String(current?.data?.renderSourceKey || "");
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
    const next: Record<string, any> = {
      selectable: false,
      evented: false,
      ...this.resolveRenderPatternProps(this.resolveLayoutProps(spec, props)),
    };
    if (space === "screen") return next;

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

  private resolveRenderPatternProps(props: Record<string, any>): Record<string, any> {
    if (!this.isRenderPatternSpec(props.fill)) return props;
    return {
      ...props,
      fill: this.createFabricPattern(props.fill),
    };
  }

  private isRenderPatternSpec(value: unknown): value is RenderPatternSpec {
    return (
      Boolean(value) &&
      typeof value === "object" &&
      (value as { type?: unknown }).type === "pattern" &&
      (value as { kind?: unknown }).kind === "diagonalHatch"
    );
  }

  private createFabricPattern(spec: RenderPatternSpec): Pattern | undefined {
    if (typeof document === "undefined") return undefined;
    const size = Math.max(1, Number(spec.size || 20));
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = spec.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, size);
    ctx.lineTo(size, 0);
    ctx.stroke();

    return new Pattern({
      source: canvas,
      repetition: spec.repetition || "repeat",
    } as any);
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

  private ensureCanvasPreservesObjectStacking() {
    const canvas = this.canvas as any;
    if (!canvas || canvas.preserveObjectStacking === true) return;
    canvas.preserveObjectStacking = true;
    if (typeof canvas._onStackOrderChanged === "function") {
      canvas._onStackOrderChanged();
    } else if ("_objectsToRender" in canvas) {
      canvas._objectsToRender = undefined;
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
