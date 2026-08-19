import {
  Canvas,
  FabricObject,
  Image,
  Path,
  Pattern,
  Rect,
  Text,
  controlsUtils,
  util,
} from "fabric";
import {
  Service,
  TypedEventEmitter,
  evaluateRuntimeCondition,
  coordinateMatrix,
  multiplyCoordinateMatrices,
  type CanvasObjectLike,
  type CanvasObjectSelector,
  type CanvasServiceEventMap,
  type CanvasService as CanvasServiceContract,
  type CanvasSize,
  type CanvasViewportLayout,
  type CoordinatePoint,
  type CoordinateRect,
  type CoordinateSpace,
  type Matrix2D,
  type RenderCoordinateSpace,
  type RenderEffectSpec,
  type RenderInvalidation,
  type RenderLayoutInsets,
  type RenderLayoutLength,
  type RenderViewportCoordinateSpace,
  type RenderObjectOrigin,
  type RenderObjectOwnership,
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
  origin?: RenderObjectOrigin;
  spec: RenderObjectSpec;
}

export interface FabricRenderGraphReconcileOptions {
  invalidations?: readonly RenderInvalidation[];
  render?: boolean;
}

export interface FabricObjectEffectRendererContext {
  canvasService: CanvasService;
  effect: RenderEffectSpec;
  object: FabricObject;
  spec: RenderObjectSpec;
}

export interface FabricObjectEffectRenderer {
  type: RenderEffectSpec["type"] | string;
  apply(context: FabricObjectEffectRendererContext): Promise<void> | void;
  clear(context: Omit<FabricObjectEffectRendererContext, "effect">): void;
}

declare const process:
  | {
      env?: {
        NODE_ENV?: string;
      };
    }
  | undefined;

const isDevelopmentRuntime = () => {
  if (typeof process === "undefined") {
    return false;
  }

  return (
    process.env?.NODE_ENV === "development" || process.env?.NODE_ENV === "test"
  );
};

export class FabricEffectRendererRegistry {
  private readonly renderers = new Map<string, FabricObjectEffectRenderer>();

  register(renderer: FabricObjectEffectRenderer) {
    const type = String(renderer.type || "").trim();
    if (!type) {
      throw new Error("Fabric effect renderer requires type.");
    }
    this.renderers.set(type, { ...renderer, type });
    return {
      dispose: () => {
        if (this.renderers.get(type)?.apply === renderer.apply) {
          this.renderers.delete(type);
        }
      },
    };
  }

  get(type: string): FabricObjectEffectRenderer | undefined {
    return this.renderers.get(String(type || "").trim());
  }

  list(): FabricObjectEffectRenderer[] {
    return Array.from(this.renderers.values());
  }
}

const GRAPH_RENDER_TARGET = "render-graph";
const POODER_INTERACTIVE_CONTROL_STYLE = {
  borderColor: "#1677ff",
  borderScaleFactor: 1.5,
  cornerColor: "#1677ff",
  cornerSize: 18,
  cornerStrokeColor: "#ffffff",
  cornerStyle: "circle" as const,
  padding: 2,
  touchCornerSize: 32,
  transparentCorners: false,
};

function createPooderInteractiveControls() {
  const defaultControls = controlsUtils.createObjectDefaultControls();
  return {
    tl: defaultControls.tl,
    tr: defaultControls.tr,
    bl: defaultControls.bl,
    br: defaultControls.br,
    mtr: defaultControls.mtr,
  };
}

function finitePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default class CanvasService implements Service, CanvasServiceContract {
  public canvas: Canvas;
  public viewport: ViewportSystem;
  public effectRenderers = new FabricEffectRendererRegistry();
  private readonly events = new TypedEventEmitter<CanvasServiceEventMap>();
  private canvasForwardersBound = false;

  private readonly forwardSelectionCreated = (event: unknown) => {
    this.events.emit("selection", {
      kind: "created",
      target: readFabricTarget(event),
    });
  };
  private readonly forwardSelectionUpdated = (event: unknown) => {
    this.events.emit("selection", {
      kind: "updated",
      target: readFabricTarget(event),
    });
  };
  private readonly forwardSelectionCleared = (event: unknown) => {
    this.events.emit("selection", {
      kind: "cleared",
      target: readFabricTarget(event),
    });
  };
  private readonly forwardObjectModified = (event: unknown) => {
    const target = readFabricTarget(event);
    this.events.emit("objectChange", { kind: "modified", target });
    this.events.emit("transform", { kind: "commit", target });
  };
  private readonly forwardMouseDown = (event: unknown) => {
    this.events.emit("pointer", {
      kind: "down",
      target: readFabricTarget(event),
    });
  };
  private readonly forwardDoubleClick = (event: unknown) => {
    this.events.emit("pointer", {
      kind: "double-click",
      target: readFabricTarget(event),
    });
  };
  private readonly forwardObjectAdded = (event: unknown) => {
    this.events.emit("objectChange", {
      kind: "added",
      target: readFabricTarget(event),
    });
  };
  private readonly forwardObjectRemoved = (event: unknown) => {
    this.events.emit("objectChange", {
      kind: "removed",
      target: readFabricTarget(event),
    });
  };
  private readonly forwardObjectMoving = (event: unknown) => {
    this.events.emit("transform", {
      kind: "move",
      target: readFabricTarget(event),
    });
  };
  private readonly forwardObjectScaling = (event: unknown) => {
    this.events.emit("transform", {
      kind: "resize",
      target: readFabricTarget(event),
    });
  };
  private readonly forwardObjectRotating = (event: unknown) => {
    this.events.emit("transform", {
      kind: "rotate",
      target: readFabricTarget(event),
    });
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
    this.effectRenderers.register(this.createClipPathEffectRenderer());

    this.viewport = new ViewportSystem();
    if (this.canvas.width !== undefined && this.canvas.height !== undefined) {
      this.viewport.updateContainer(this.canvas.width, this.canvas.height);
    }
  }

  init() {
    this.setupEvents();
    if (isDevelopmentRuntime() && typeof globalThis !== "undefined") {
      (globalThis as any).__POODER_CANVAS_SERVICE__ = this;
    }
  }

  dispose() {
    if (
      typeof globalThis !== "undefined" &&
      (globalThis as any).__POODER_CANVAS_SERVICE__ === this
    ) {
      delete (globalThis as any).__POODER_CANVAS_SERVICE__;
    }
    this.canvas.dispose();
    this.events.clear();
  }

  on<TKey extends keyof CanvasServiceEventMap>(
    type: TKey,
    listener: (event: CanvasServiceEventMap[TKey]) => void,
  ) {
    return this.events.on(type, listener);
  }

  private setupEvents() {
    if (this.canvasForwardersBound) return;
    this.canvas.on("selection:created", this.forwardSelectionCreated);
    this.canvas.on("selection:updated", this.forwardSelectionUpdated);
    this.canvas.on("selection:cleared", this.forwardSelectionCleared);
    this.canvas.on("object:modified", this.forwardObjectModified);
    this.canvas.on("mouse:down", this.forwardMouseDown);
    this.canvas.on("mouse:dblclick", this.forwardDoubleClick);
    this.canvas.on("object:added", this.forwardObjectAdded);
    this.canvas.on("object:removed", this.forwardObjectRemoved);
    this.canvas.on("object:moving", this.forwardObjectMoving);
    this.canvas.on("object:scaling", this.forwardObjectScaling);
    this.canvas.on("object:rotating", this.forwardObjectRotating);
    this.canvasForwardersBound = true;
  }

  requestRenderAll() {
    this.canvas.requestRenderAll();
  }

  resize(width: number, height: number) {
    this.canvas.setDimensions({ width, height });
    this.viewport.updateContainer(width, height);
    this.events.emit("resized", { width, height });
    this.requestRenderAll();
  }

  getViewportSize(): CanvasSize {
    return {
      width: Number(this.canvas.width || 0),
      height: Number(this.canvas.height || 0),
    };
  }

  setViewportLayout(layout: CanvasViewportLayout): void {
    this.viewport.setLayout(layout);
  }

  selectObjects(selector: CanvasObjectSelector = {}): CanvasObjectLike[] {
    return (this.canvas.getObjects() as CanvasObjectLike[]).filter(
      (obj: any) => {
        return this.matchesObjectSelector(obj, selector);
      },
    );
  }

  selectOneObject(selector: CanvasObjectSelector): FabricObject | undefined {
    const objects = this.selectObjects(selector);
    if (objects.length > 1) {
      throw new Error("canvas-selector-ambiguous");
    }
    return objects[0] as FabricObject | undefined;
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

  /** @internal Legacy extension adapter. */
  onCanvasEvent(event: string, handler: (...args: any[]) => void): void {
    this.canvas.on(event as any, handler as any);
  }

  /** @internal Legacy extension adapter. */
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

  toScreenPoint(point: CoordinatePoint<"scene">): CoordinatePoint<"screen"> {
    return this.viewport.sceneToScreenPoint(point);
  }

  toScenePoint(point: CoordinatePoint<"screen">): CoordinatePoint<"scene"> {
    return this.viewport.screenToScenePoint(point);
  }

  toScreenMatrix<TFrom extends CoordinateSpace>(
    matrix: Matrix2D<TFrom, "scene">,
  ): Matrix2D<TFrom, "screen"> {
    return this.viewport.sceneToScreenMatrix(matrix);
  }

  toSceneMatrix<TFrom extends CoordinateSpace>(
    matrix: Matrix2D<TFrom, "screen">,
  ): Matrix2D<TFrom, "scene"> {
    return this.viewport.screenToSceneMatrix(matrix);
  }

  toScreenLength(value: number): number {
    return this.viewport.sceneToScreenLength(value);
  }

  toSceneLength(value: number): number {
    return this.viewport.screenToSceneLength(value);
  }

  toScreenRect(rect: CoordinateRect<"scene">): CoordinateRect<"screen"> {
    return this.viewport.sceneToScreenRect(rect);
  }

  toSceneRect(rect: CoordinateRect<"screen">): CoordinateRect<"scene"> {
    return this.viewport.screenToSceneRect(rect);
  }

  getSceneViewportRect(): CoordinateRect<"scene"> {
    const width = Number(this.canvas.width || 0);
    const height = Number(this.canvas.height || 0);
    return this.toSceneRect({
      space: "screen",
      left: 0,
      top: 0,
      width,
      height,
    });
  }

  getScreenViewportRect(): CoordinateRect<"screen"> {
    return {
      space: "screen",
      left: 0,
      top: 0,
      width: Number(this.canvas.width || 0),
      height: Number(this.canvas.height || 0),
    };
  }

  async reconcileRenderGraphDrawList(
    items: FabricRenderTargetItem[],
    options: FabricRenderGraphReconcileOptions = {},
  ): Promise<void> {
    const normalizedItems = items
      .map((item, index) => ({
        ...item,
        key: String(item.key || item.spec.id || "").trim(),
        layerId: String(item.layerId || item.spec.data?.layerId || "").trim(),
        order: Number.isFinite(item.order) ? Number(item.order) : index,
      }))
      .filter((item) => item.key && item.layerId)
      .sort((left, right) => left.order - right.order);
    const desiredKeys = new Set(normalizedItems.map((item) => item.key));
    const invalidations = options.invalidations?.length
      ? options.invalidations
      : [{ type: "full" } satisfies RenderInvalidation];
    const hasFullInvalidation = invalidations.some(
      (invalidation) => invalidation.type === "full",
    );

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
      const shouldPatch =
        !current ||
        hasFullInvalidation ||
        this.isRenderTargetInvalidated(item, invalidations);
      const ownership = this.readRenderObjectOwnership(current);
      const interactionOwnsTransform =
        !hasFullInvalidation &&
        ownership?.type === "interaction" &&
        ownership.phase === "active";
      const shouldApplySpec = shouldPatch && !interactionOwnsTransform;

      if (shouldApplySpec && spec.type === "path") {
        const nextPathData = this.readPathDataFromSpec(spec);
        if (!nextPathData?.trim()) {
          if (current) this.canvas.remove(current);
          continue;
        }
      }

      if (
        current &&
        shouldApplySpec &&
        this.shouldRecreateObject(current, spec)
      ) {
        this.canvas.remove(current);
        current = undefined;
      }

      if (!current) {
        const created = await this.createFabricObject(spec);
        if (!created) continue;
        current = created as any;
        this.canvas.add(current);
      }

      const renderMetadata = {
        renderTarget: GRAPH_RENDER_TARGET,
        renderKey: item.key,
        layerId: item.layerId,
        renderOrigin: item.origin,
        renderOrder: item.order,
      };
      if (shouldApplySpec) {
        this.patchFabricObject(current, spec, {
          ...renderMetadata,
          renderOwnership: { type: "declarative" },
        });
        await this.applyObjectEffects(current as FabricObject, spec);
      } else {
        this.patchFabricRenderMetadata(current, renderMetadata);
      }
    }

    this.syncRenderGraphStacking(normalizedItems.map((item) => item.key));

    if (options.render !== false) {
      this.requestRenderAll();
    }
  }

  private async applyObjectEffects(
    object: FabricObject,
    spec: RenderObjectSpec,
  ) {
    if (!this.effectRenderers) {
      this.effectRenderers = new FabricEffectRendererRegistry();
      this.effectRenderers.register(this.createClipPathEffectRenderer());
    }
    const effects = (spec.effects ?? []).filter((effect) =>
      evaluateRuntimeCondition(effect.activeWhen, {}),
    );
    const effectsByType = new Map<string, RenderEffectSpec[]>();
    effects.forEach((effect) => {
      const type = String(effect.type || "").trim();
      if (!type) return;
      const list = effectsByType.get(type) ?? [];
      list.push(effect);
      effectsByType.set(type, list);
    });

    for (const renderer of this.effectRenderers.list()) {
      const typedEffects = effectsByType.get(String(renderer.type));
      if (!typedEffects?.length) {
        renderer.clear({ canvasService: this, object, spec });
        continue;
      }
      for (const effect of typedEffects) {
        await renderer.apply({ canvasService: this, effect, object, spec });
      }
    }
  }

  private createClipPathEffectRenderer(): FabricObjectEffectRenderer {
    return {
      type: "clipPath",
      apply: async ({ effect, object }) => {
        if (effect.type !== "clipPath") return;
        const template = await this.createClipPathTemplate(effect);
        if (!template) {
          this.clearClipPathEffectFromObject(object as any);
          return;
        }
        await this.applyClipPathEffectToObject(
          object as any,
          template,
          String(effect.id || effect.source.id || "clipPath"),
          effect.coordinateMode,
        );
      },
      clear: ({ object }) => this.clearClipPathEffectFromObject(object as any),
    };
  }

  private async createClipPathTemplate(
    effect: Extract<RenderEffectSpec, { type: "clipPath" }>,
  ): Promise<FabricObject | null> {
    const source = effect.source;
    const sourceId = String(source.id || "").trim();
    if (!sourceId) return null;

    const templateSpec: RenderObjectSpec = {
      ...source,
      id: sourceId,
      data: {
        ...(source.data || {}),
        id: sourceId,
        type: "clip-path-effect-template",
        effectKey: effect.id,
      },
      props: {
        ...(source.props || {}),
        selectable: false,
        evented: false,
        excludeFromExport: true,
      },
    };
    const template = await this.createFabricObject(templateSpec);
    if (!template) return null;

    this.patchFabricObject(template, templateSpec);

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
    coordinateMode: "absolute" | "object" = "absolute",
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
      absolutePositioned: coordinateMode !== "object",
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
      .filter(
        (object: any) => object?.data?.renderTarget === GRAPH_RENDER_TARGET,
      )
      .sort((a: any, b: any) => {
        const aOrder = order.get(String(a?.data?.renderKey || "")) ?? 0;
        const bOrder = order.get(String(b?.data?.renderKey || "")) ?? 0;
        return aOrder - bOrder;
      });

    objects.forEach((object, index) => this.moveObjectInCanvas(object, index));
  }

  private normalizeSelectorValues(
    value?: readonly string[],
  ): Set<string> | undefined {
    if (!Array.isArray(value)) return undefined;
    const values = Array.from(
      new Set(
        value
          .map((item) => String(item || "").trim())
          .filter((item) => item.length > 0),
      ),
    );
    return values.length ? new Set(values) : undefined;
  }

  private matchesObjectSelector(
    object: CanvasObjectLike,
    selector: CanvasObjectSelector,
  ): boolean {
    if (
      selector.visible !== undefined &&
      object?.visible !== selector.visible
    ) {
      return false;
    }
    const data = object?.data ?? {};
    const ids = this.normalizeSelectorValues(selector.ids);
    const subjectId = String(
      data.subjectId ||
        data.subject?.objectId ||
        data.subject?.layerId ||
        data.subject?.sceneId ||
        data.id ||
        "",
    ).trim();
    if (ids && !ids.has(subjectId)) return false;
    const projectionIds = this.normalizeSelectorValues(selector.projectionIds);
    if (
      projectionIds &&
      !projectionIds.has(
        String(
          data.renderGraphNodeId || data.renderIntentId || data.id || "",
        ).trim(),
      )
    )
      return false;
    const layerIds = this.normalizeSelectorValues(selector.layerIds);
    if (
      layerIds &&
      !layerIds.has(String(data.layerId || data.passId || "").trim())
    ) {
      return false;
    }
    const types = this.normalizeSelectorValues(selector.types);
    if (types && !types.has(String(data.type || object?.type || "").trim())) {
      return false;
    }
    const tags = this.normalizeSelectorValues(selector.tags);
    if (tags) {
      const objectTags = Array.isArray(data.tags) ? data.tags : [];
      const normalizedObjectTags = new Set(
        objectTags.map((tag: unknown) => String(tag || "").trim()),
      );
      const matches =
        selector.tagMatch === "any"
          ? Array.from(tags).some((tag) => normalizedObjectTags.has(tag))
          : Array.from(tags).every((tag) => normalizedObjectTags.has(tag));
      if (!matches) {
        return false;
      }
    }
    if (selector.data) {
      const matchesData = Object.entries(selector.data).every(
        ([key, expected]) => data?.[key] === expected,
      );
      if (!matchesData) return false;
    }
    return true;
  }

  private toSpaceRect(
    rect: RectLike,
    from: RenderViewportCoordinateSpace,
    to: RenderViewportCoordinateSpace,
  ): RectLike {
    if (from === to) return { ...rect };
    return from === "scene"
      ? this.toScreenRect({ ...rect, space: "scene" })
      : this.toSceneRect({ ...rect, space: "screen" });
  }

  private resolveLayoutLength(
    value: RenderLayoutLength | undefined,
    base: number,
  ): number | undefined {
    if (typeof value === "number")
      return Number.isFinite(value) ? value : undefined;
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
        this.resolveLayoutLength(
          inset,
          Math.min(reference.width, reference.height),
        ) ?? 0;
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
    space: RenderViewportCoordinateSpace,
  ): RectLike {
    if (layout.referenceRect) {
      const sourceSpace: RenderViewportCoordinateSpace =
        layout.referenceRect.space;
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
    if (space !== "scene" && space !== "screen") {
      throw new Error(
        `Render layout requires scene or screen space; received ${space}.`,
      );
    }
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

  private patchFabricObject(
    obj: any,
    spec: RenderObjectSpec,
    extraData?: Record<string, any>,
  ) {
    const nextData = this.resolveFabricObjectData(obj, spec, extraData);
    const props = this.resolveObjectFabricProps(obj, spec);
    obj.set({ ...props, data: nextData });
    this.applyAffinePlacement(obj, spec);
    obj.setCoords();
  }

  private applyAffinePlacement(
    object: FabricObject,
    spec: RenderObjectSpec,
  ): void {
    const placement = spec.placement;
    if (!placement) return;
    const bounds = placement.localBounds;
    const fabricCenterToLocal = coordinateMatrix(
      "object-local",
      "object-local",
      [
        1,
        0,
        0,
        1,
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      ],
    );
    const fabricCenterToScene = multiplyCoordinateMatrices(
      placement.localToScene,
      fabricCenterToLocal,
    );
    const fabricCenterToScreen = this.toScreenMatrix(fabricCenterToScene);
    util.applyTransformToObject(object, [...fabricCenterToScreen.values]);
  }

  async createDetachedRenderObject(
    spec: RenderObjectSpec,
    sceneToTarget: Matrix2D<"scene", "screen">,
  ): Promise<FabricObject | undefined> {
    const object = await this.createFabricObject(spec);
    if (!object) return undefined;
    object.set(this.resolveObjectFabricProps(object, spec));
    const placement = spec.placement;
    if (placement) {
      const bounds = placement.localBounds;
      const centerToLocal = coordinateMatrix("object-local", "object-local", [
        1,
        0,
        0,
        1,
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      ]);
      const centerToTarget = multiplyCoordinateMatrices(
        sceneToTarget,
        multiplyCoordinateMatrices(placement.localToScene, centerToLocal),
      );
      util.applyTransformToObject(object, [...centerToTarget.values]);
    }
    object.set({ selectable: false, evented: false, visible: true });
    for (const effect of spec.effects ?? []) {
      if (effect.type !== "clipPath") continue;
      const clipPath = await this.createDetachedRenderObject(
        { ...effect.source, effects: [] },
        sceneToTarget,
      );
      if (!clipPath) continue;
      clipPath.set({
        selectable: false,
        evented: false,
        excludeFromExport: true,
        absolutePositioned: effect.coordinateMode !== "object",
      } as any);
      object.set({ clipPath } as any);
    }
    object.setCoords();
    return object;
  }

  private patchFabricRenderMetadata(obj: any, metadata: Record<string, any>) {
    obj.set({ data: { ...(obj.data || {}), ...metadata } });
  }

  private resolveFabricObjectData(
    obj: any,
    spec: RenderObjectSpec,
    extraData?: Record<string, any>,
  ): Record<string, any> {
    const nextData = {
      ...(obj.data || {}),
      ...(spec.data || {}),
      ...(extraData || {}),
      id: spec.id,
      ...(spec.placement ? { affinePlacement: spec.placement } : {}),
    };
    nextData.renderSourceKey = this.getSpecRenderSourceKey(spec);
    return nextData;
  }

  private readRenderObjectOwnership(
    obj: any,
  ): RenderObjectOwnership | undefined {
    const ownership = obj?.data?.renderOwnership;
    if (ownership?.type === "declarative") return ownership;
    if (
      ownership?.type === "interaction" &&
      typeof ownership.interactionId === "string" &&
      (ownership.phase === "active" || ownership.phase === "committing")
    ) {
      return ownership;
    }
    return undefined;
  }

  private isRenderTargetInvalidated(
    item: FabricRenderTargetItem,
    invalidations: readonly RenderInvalidation[],
  ): boolean {
    const origin = item.origin;
    if (!origin) return true;
    return invalidations.some((invalidation) => {
      if (invalidation.type === "full" || invalidation.type === "composition")
        return true;
      if (origin.type === "render-intent") {
        return (
          invalidation.type === "render-intents" &&
          invalidation.intentIds.includes(origin.intentId)
        );
      }
      if (invalidation.type === "scene") {
        return invalidation.sceneId === origin.sceneId;
      }
      return (
        invalidation.type === "scene-elements" &&
        invalidation.sceneId === origin.sceneId &&
        invalidation.elementIds.includes(origin.elementId)
      );
    });
  }

  private resolveObjectFabricProps(
    obj: any,
    spec: RenderObjectSpec,
  ): Record<string, any> {
    const props = this.resolveFabricProps(spec, spec.props || {});
    if (spec.type === "path") {
      return this.omitPathSourceProps(props);
    }
    if (spec.placement && (spec.type === "image" || spec.type === "rect")) {
      return {
        ...props,
        width: spec.placement.localBounds.width,
        height: spec.placement.localBounds.height,
      };
    }
    if (spec.type !== "image") return props;
    return this.resolveImageTargetSizeProps(obj, props);
  }

  private omitPathSourceProps(props: Record<string, any>): Record<string, any> {
    const { path: _path, pathData: _pathData, ...pathProps } = props;
    return pathProps;
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
    if (spec.placement && spec.layout) {
      throw new Error(
        `RenderObjectSpec "${spec.id}" cannot combine affine placement with layout.`,
      );
    }
    const next: Record<string, any> = {
      selectable: false,
      evented: false,
      ...this.resolveRenderPatternProps(this.resolveLayoutProps(spec, props)),
    };
    if (spec.placement) {
      return this.removeUndefinedFabricProps(
        this.resolveInteractiveControlProps(next),
      );
    }
    if (space !== "scene") {
      return this.removeUndefinedFabricProps(
        this.resolveInteractiveControlProps(next),
      );
    }

    const hasLeft = Number.isFinite(next.left);
    const hasTop = Number.isFinite(next.top);
    if (hasLeft || hasTop) {
      const mapped = this.toScreenPoint({
        space: "scene",
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
    return this.removeUndefinedFabricProps(
      this.resolveInteractiveControlProps(next),
    );
  }

  private removeUndefinedFabricProps(
    props: Record<string, any>,
  ): Record<string, any> {
    return Object.fromEntries(
      Object.entries(props).filter(([, value]) => value !== undefined),
    );
  }

  private resolveImageTargetSizeProps(
    obj: any,
    props: Record<string, any>,
  ): Record<string, any> {
    const targetWidth = finitePositiveNumber(props.width);
    const targetHeight = finitePositiveNumber(props.height);
    if (!targetWidth && !targetHeight) return props;

    const source = this.resolveImageSourceSize(obj);
    const next = { ...props };
    delete next.width;
    delete next.height;

    if (targetWidth && source.width) {
      const scaleX = Number.isFinite(next.scaleX) ? Number(next.scaleX) : 1;
      next.scaleX = scaleX * (targetWidth / source.width);
    }
    if (targetHeight && source.height) {
      const scaleY = Number.isFinite(next.scaleY) ? Number(next.scaleY) : 1;
      next.scaleY = scaleY * (targetHeight / source.height);
    }
    return next;
  }

  private resolveImageSourceSize(obj: any): CanvasSize {
    const cachedWidth = finitePositiveNumber(obj?.__pooderSourceWidth);
    const cachedHeight = finitePositiveNumber(obj?.__pooderSourceHeight);
    if (cachedWidth && cachedHeight) {
      return { width: cachedWidth, height: cachedHeight };
    }

    const element =
      typeof obj?.getElement === "function" ? obj.getElement() : obj?._element;
    const width =
      finitePositiveNumber(element?.naturalWidth) ??
      finitePositiveNumber(element?.width) ??
      finitePositiveNumber(obj?.width) ??
      1;
    const height =
      finitePositiveNumber(element?.naturalHeight) ??
      finitePositiveNumber(element?.height) ??
      finitePositiveNumber(obj?.height) ??
      1;
    obj.__pooderSourceWidth = width;
    obj.__pooderSourceHeight = height;
    return { width, height };
  }

  private resolveInteractiveControlProps(
    props: Record<string, any>,
  ): Record<string, any> {
    if (props.hasControls !== true) return props;
    return {
      ...props,
      ...POODER_INTERACTIVE_CONTROL_STYLE,
      controls: createPooderInteractiveControls(),
    };
  }

  private resolveRenderPatternProps(
    props: Record<string, any>,
  ): Record<string, any> {
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
      const props = this.omitPathSourceProps(
        this.resolveFabricProps(spec, spec.props || {}),
      );
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
      (image as any).__pooderSourceWidth =
        finitePositiveNumber(image.width) ?? 1;
      (image as any).__pooderSourceHeight =
        finitePositiveNumber(image.height) ?? 1;
      const props = this.resolveFabricProps(spec, spec.props || {});
      image.set({
        ...this.resolveImageTargetSizeProps(image, props),
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

function readFabricTarget(event: unknown): CanvasObjectLike | undefined {
  if (typeof event !== "object" || event === null || !("target" in event)) {
    return undefined;
  }
  const target = (event as { target?: unknown }).target;
  return typeof target === "object" && target !== null
    ? (target as CanvasObjectLike)
    : undefined;
}
