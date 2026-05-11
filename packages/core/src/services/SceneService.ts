import type {
  ElementId,
  LayerId,
  SceneChangeSet,
  SceneElement,
  SceneElementInput,
  SceneElementPatch,
  SceneElementQuery,
  SceneLayer,
  SceneLayerInput,
  SceneLayerPatch,
  SceneMetadata,
  SceneTransaction,
} from "../scene";
import EventBus from "../event";
import type { Service } from "../service";

export type SceneChangeEvent = SceneChangeSet;

function createEmptyChangeSet(): SceneChangeSet {
  return {
    layers: { added: [], updated: [], removed: [] },
    elements: { added: [], updated: [], removed: [] },
  };
}

export default class SceneService implements Service {
  private readonly eventBus = new EventBus();
  private layersById = new Map<LayerId, SceneLayer>();
  private elementsById = new Map<ElementId, SceneElement>();
  private transactionDepth = 0;
  private pendingChange: SceneChangeSet | null = null;

  addLayer(layer: SceneLayerInput): SceneLayer {
    const id = this.normalizeId(layer.id, "SceneLayer.id");
    if (this.layersById.has(id)) {
      throw new Error(`Scene layer "${id}" is already registered.`);
    }

    const next: SceneLayer = {
      id,
      order: layer.order ?? this.layersById.size,
      visible: layer.visible ?? true,
      metadata: this.cloneRecord(layer.metadata),
    };

    this.layersById.set(id, next);
    this.recordLayerChange("added", id);
    return this.cloneLayer(next);
  }

  updateLayer(id: LayerId, patch: SceneLayerPatch): SceneLayer {
    const layerId = this.normalizeId(id, "SceneLayer.id");
    const current = this.layersById.get(layerId);
    if (!current) {
      throw new Error(`Scene layer "${layerId}" not found.`);
    }

    const next: SceneLayer = {
      ...current,
      order: patch.order ?? current.order,
      visible: patch.visible ?? current.visible,
      metadata:
        patch.metadata === undefined
          ? this.cloneRecord(current.metadata)
          : this.cloneRecord(patch.metadata),
    };

    this.layersById.set(layerId, next);
    this.recordLayerChange("updated", layerId);
    return this.cloneLayer(next);
  }

  removeLayer(id: LayerId): boolean {
    const layerId = this.normalizeId(id, "SceneLayer.id");
    if (!this.layersById.has(layerId)) {
      return false;
    }

    const removedElementIds = this.listElements({ layerId }).map(
      (element) => element.id,
    );
    removedElementIds.forEach((elementId) => {
      this.elementsById.delete(elementId);
      this.recordElementChange("removed", elementId);
    });

    this.layersById.delete(layerId);
    this.recordLayerChange("removed", layerId);
    return true;
  }

  getLayer(id: LayerId): SceneLayer | undefined {
    const layer = this.layersById.get(id);
    return layer ? this.cloneLayer(layer) : undefined;
  }

  listLayers(): SceneLayer[] {
    return Array.from(this.layersById.values())
      .map((layer) => this.cloneLayer(layer))
      .sort(this.compareOrderedItems);
  }

  addElement(element: SceneElementInput): SceneElement {
    const id = this.normalizeId(element.id, "SceneElement.id");
    const layerId = this.normalizeId(element.layerId, "SceneElement.layerId");
    if (this.elementsById.has(id)) {
      throw new Error(`Scene element "${id}" is already registered.`);
    }
    if (!this.layersById.has(layerId)) {
      throw new Error(`Scene layer "${layerId}" not found.`);
    }

    this.validateElementInput(element);

    const next = this.cloneElement({
      ...element,
      id,
      layerId,
      order: element.order ?? this.countLayerElements(layerId),
      visible: element.visible ?? true,
    } as SceneElement);

    this.elementsById.set(id, next);
    this.recordElementChange("added", id);
    return this.cloneElement(next);
  }

  updateElement(id: ElementId, patch: SceneElementPatch): SceneElement {
    const elementId = this.normalizeId(id, "SceneElement.id");
    const current = this.elementsById.get(elementId);
    if (!current) {
      throw new Error(`Scene element "${elementId}" not found.`);
    }

    const nextLayerId =
      patch.layerId === undefined
        ? current.layerId
        : this.normalizeId(patch.layerId, "SceneElement.layerId");
    if (!this.layersById.has(nextLayerId)) {
      throw new Error(`Scene layer "${nextLayerId}" not found.`);
    }

    const next = this.cloneElement({
      ...current,
      ...patch,
      id: current.id,
      type: current.type,
      layerId: nextLayerId,
      order: patch.order ?? current.order,
      visible: patch.visible ?? current.visible,
      metadata:
        patch.metadata === undefined
          ? this.cloneRecord(current.metadata)
          : this.cloneRecord(patch.metadata),
      data:
        patch.data === undefined
          ? this.cloneRecord(current.data)
          : this.cloneRecord(patch.data),
      style:
        patch.style === undefined
          ? this.cloneRecord(current.style)
          : this.cloneRecord(patch.style),
      transform:
        patch.transform === undefined
          ? this.cloneRecord(current.transform)
          : this.cloneRecord(patch.transform),
    } as SceneElement);

    this.elementsById.set(elementId, next);
    this.recordElementChange("updated", elementId);
    return this.cloneElement(next);
  }

  removeElement(id: ElementId): boolean {
    const elementId = this.normalizeId(id, "SceneElement.id");
    if (!this.elementsById.delete(elementId)) {
      return false;
    }

    this.recordElementChange("removed", elementId);
    return true;
  }

  getElement<TElement extends SceneElement = SceneElement>(
    id: ElementId,
  ): TElement | undefined {
    const element = this.elementsById.get(id);
    return element ? (this.cloneElement(element) as TElement) : undefined;
  }

  listElements(query: SceneElementQuery = {}): SceneElement[] {
    return Array.from(this.elementsById.values())
      .filter((element) => {
        if (query.layerId !== undefined && element.layerId !== query.layerId) {
          return false;
        }
        if (query.type !== undefined && element.type !== query.type) {
          return false;
        }
        if (query.visible !== undefined && element.visible !== query.visible) {
          return false;
        }
        return true;
      })
      .map((element) => this.cloneElement(element))
      .sort(this.compareOrderedItems);
  }

  transaction<T>(run: SceneTransaction<T>): T {
    const layerSnapshot = this.cloneLayerMap();
    const elementSnapshot = this.cloneElementMap();
    const pendingSnapshot = this.pendingChange
      ? this.cloneChangeSet(this.pendingChange)
      : null;
    const depthSnapshot = this.transactionDepth;

    this.transactionDepth += 1;
    try {
      const result = run();
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0) {
        this.flushPendingChange();
      }
      return result;
    } catch (error) {
      this.layersById = layerSnapshot;
      this.elementsById = elementSnapshot;
      this.pendingChange = pendingSnapshot;
      this.transactionDepth = depthSnapshot;
      throw error;
    }
  }

  onDidChange(callback: (event: SceneChangeEvent) => void) {
    this.eventBus.on("change", callback);
    return {
      dispose: () => this.eventBus.off("change", callback),
    };
  }

  dispose() {
    this.layersById.clear();
    this.elementsById.clear();
    this.pendingChange = null;
    this.transactionDepth = 0;
    this.eventBus.clear();
  }

  private countLayerElements(layerId: LayerId): number {
    let count = 0;
    this.elementsById.forEach((element) => {
      if (element.layerId === layerId) {
        count += 1;
      }
    });
    return count;
  }

  private validateElementInput(element: SceneElementInput) {
    if (element.type === "image" && !element.src) {
      throw new Error("Scene image element src is required.");
    }
    if (element.type === "path" && !element.path) {
      throw new Error("Scene path element path is required.");
    }
    if (
      element.type === "rect" &&
      (!Number.isFinite(element.width) || !Number.isFinite(element.height))
    ) {
      throw new Error("Scene rect element width and height are required.");
    }
    if (element.type === "text" && typeof element.text !== "string") {
      throw new Error("Scene text element text is required.");
    }
  }

  private recordLayerChange(
    kind: keyof SceneChangeSet["layers"],
    id: LayerId,
  ) {
    const change = this.ensurePendingChange();
    this.mergeChange(change.layers, kind, id);
    this.flushChangeIfNeeded();
  }

  private recordElementChange(
    kind: keyof SceneChangeSet["elements"],
    id: ElementId,
  ) {
    const change = this.ensurePendingChange();
    this.mergeChange(change.elements, kind, id);
    this.flushChangeIfNeeded();
  }

  private mergeChange<TKind extends string>(
    target: Record<TKind, string[]>,
    kind: TKind,
    id: string,
  ) {
    if (!target[kind].includes(id)) {
      target[kind].push(id);
    }
  }

  private ensurePendingChange(): SceneChangeSet {
    if (!this.pendingChange) {
      this.pendingChange = createEmptyChangeSet();
    }
    return this.pendingChange;
  }

  private flushChangeIfNeeded() {
    if (this.transactionDepth === 0) {
      this.flushPendingChange();
    }
  }

  private flushPendingChange() {
    if (!this.pendingChange) {
      return;
    }

    const change = this.pendingChange;
    this.pendingChange = null;
    this.eventBus.emit("change", this.cloneChangeSet(change));
  }

  private cloneLayer(layer: SceneLayer): SceneLayer {
    return {
      ...layer,
      metadata: this.cloneRecord(layer.metadata),
    };
  }

  private cloneElement<TElement extends SceneElement>(
    element: TElement,
  ): TElement {
    return {
      ...element,
      metadata: this.cloneRecord(element.metadata),
      data: this.cloneRecord(element.data),
      style: this.cloneRecord(element.style),
      transform: this.cloneRecord(element.transform),
    };
  }

  private cloneLayerMap(): Map<LayerId, SceneLayer> {
    return new Map(
      Array.from(this.layersById.entries()).map(([id, layer]) => [
        id,
        this.cloneLayer(layer),
      ]),
    );
  }

  private cloneElementMap(): Map<ElementId, SceneElement> {
    return new Map(
      Array.from(this.elementsById.entries()).map(([id, element]) => [
        id,
        this.cloneElement(element),
      ]),
    );
  }

  private cloneChangeSet(change: SceneChangeSet): SceneChangeSet {
    return {
      layers: {
        added: change.layers.added.slice(),
        updated: change.layers.updated.slice(),
        removed: change.layers.removed.slice(),
      },
      elements: {
        added: change.elements.added.slice(),
        updated: change.elements.updated.slice(),
        removed: change.elements.removed.slice(),
      },
    };
  }

  private cloneRecord<T extends object>(value?: T): T | undefined {
    return value ? ({ ...value } as T) : undefined;
  }

  private normalizeId(id: string, label: string): string {
    const normalized = String(id || "").trim();
    if (!normalized) {
      throw new Error(`${label} is required.`);
    }
    return normalized;
  }

  private compareOrderedItems<T extends { id: string; order: number }>(
    left: T,
    right: T,
  ): number {
    return left.order - right.order || left.id.localeCompare(right.id);
  }
}
