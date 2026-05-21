import type {
  ElementId,
  LayerId,
  SceneChangeSet,
  SceneElement,
  SceneElementInput,
  SceneElementPatch,
  SceneElementQuery,
  SceneId,
  SceneInput,
  SceneLayer,
  SceneLayerInput,
  SceneLayerPatch,
  ScenePatch,
  SceneRecord,
  SceneScopeOptions,
  SceneTransaction,
} from "../scene";
import { DEFAULT_SCENE_ID } from "../scene";
import EventBus from "../event";
import type { Service } from "../service";

export type SceneChangeEvent = SceneChangeSet;

interface SceneStore {
  record: SceneRecord;
  layersById: Map<LayerId, SceneLayer>;
  elementsById: Map<ElementId, SceneElement>;
}

function createEmptyScopedChangeSet(): Required<
  Pick<SceneChangeSet, "layers" | "elements">
> {
  return {
    layers: { added: [], updated: [], removed: [] },
    elements: { added: [], updated: [], removed: [] },
  };
}

function createEmptyChangeSet(): SceneChangeSet {
  return {
    scenes: { added: [], updated: [], removed: [] },
    sceneChanges: {},
    ...createEmptyScopedChangeSet(),
  };
}

export default class SceneService implements Service {
  private readonly eventBus = new EventBus();
  private scenesById = new Map<SceneId, SceneStore>();
  private transactionDepth = 0;
  private pendingChange: SceneChangeSet | null = null;

  constructor() {
    this.scenesById.set(
      DEFAULT_SCENE_ID,
      this.createSceneStore({
        id: DEFAULT_SCENE_ID,
        order: 0,
        visible: true,
        renderable: false,
        transient: false,
      }),
    );
  }

  addScene(scene: SceneInput): SceneRecord {
    const id = this.normalizeId(scene.id, "Scene.id");
    if (this.scenesById.has(id)) {
      throw new Error(`Scene "${id}" is already registered.`);
    }
    const next = this.createSceneStore({
      id,
      order: scene.order ?? this.scenesById.size,
      visible: scene.visible ?? true,
      renderable: scene.renderable ?? false,
      transient: scene.transient ?? false,
      metadata: this.cloneRecord(scene.metadata),
    });
    this.scenesById.set(id, next);
    this.recordSceneChange("added", id);
    return this.cloneScene(next.record);
  }

  ensureScene(scene: SceneInput): SceneRecord {
    const id = this.normalizeId(scene.id, "Scene.id");
    const current = this.scenesById.get(id);
    if (current) {
      return this.cloneScene(current.record);
    }
    return this.addScene(scene);
  }

  updateScene(id: SceneId, patch: ScenePatch): SceneRecord {
    const scene = this.getSceneStore(id);
    const next: SceneRecord = {
      ...scene.record,
      order: patch.order ?? scene.record.order,
      visible: patch.visible ?? scene.record.visible,
      renderable: patch.renderable ?? scene.record.renderable,
      transient: patch.transient ?? scene.record.transient,
      metadata:
        patch.metadata === undefined
          ? this.cloneRecord(scene.record.metadata)
          : this.cloneRecord(patch.metadata),
    };
    scene.record = next;
    this.recordSceneChange("updated", scene.record.id);
    return this.cloneScene(next);
  }

  removeScene(id: SceneId): boolean {
    const sceneId = this.normalizeId(id, "Scene.id");
    if (sceneId === DEFAULT_SCENE_ID) {
      throw new Error(`Scene "${DEFAULT_SCENE_ID}" cannot be removed.`);
    }
    if (!this.scenesById.has(sceneId)) return false;
    this.scenesById.delete(sceneId);
    this.recordSceneChange("removed", sceneId);
    return true;
  }

  clearScene(id: SceneId): boolean {
    const scene = this.getSceneStore(id);
    if (!scene.layersById.size && !scene.elementsById.size) return false;
    const layerIds = Array.from(scene.layersById.keys());
    const elementIds = Array.from(scene.elementsById.keys());
    scene.layersById.clear();
    scene.elementsById.clear();
    elementIds.forEach((elementId) =>
      this.recordElementChange(scene.record.id, "removed", elementId),
    );
    layerIds.forEach((layerId) =>
      this.recordLayerChange(scene.record.id, "removed", layerId),
    );
    return true;
  }

  getScene(id: SceneId): SceneRecord | undefined {
    const scene = this.scenesById.get(id);
    return scene ? this.cloneScene(scene.record) : undefined;
  }

  listScenes(): SceneRecord[] {
    return Array.from(this.scenesById.values())
      .map((scene) => this.cloneScene(scene.record))
      .sort(this.compareOrderedItems);
  }

  addLayer(layer: SceneLayerInput, options: SceneScopeOptions = {}): SceneLayer {
    const scene = this.getSceneStore(options.sceneId);
    const id = this.normalizeId(layer.id, "SceneLayer.id");
    if (scene.layersById.has(id)) {
      throw new Error(`Scene layer "${id}" is already registered.`);
    }

    const next: SceneLayer = {
      id,
      order: layer.order ?? scene.layersById.size,
      visible: layer.visible ?? true,
      metadata: this.cloneRecord(layer.metadata),
    };

    scene.layersById.set(id, next);
    this.recordLayerChange(scene.record.id, "added", id);
    return this.cloneLayer(next);
  }

  updateLayer(
    id: LayerId,
    patch: SceneLayerPatch,
    options: SceneScopeOptions = {},
  ): SceneLayer {
    const scene = this.getSceneStore(options.sceneId);
    const layerId = this.normalizeId(id, "SceneLayer.id");
    const current = scene.layersById.get(layerId);
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

    scene.layersById.set(layerId, next);
    this.recordLayerChange(scene.record.id, "updated", layerId);
    return this.cloneLayer(next);
  }

  removeLayer(id: LayerId, options: SceneScopeOptions = {}): boolean {
    const scene = this.getSceneStore(options.sceneId);
    const layerId = this.normalizeId(id, "SceneLayer.id");
    if (!scene.layersById.has(layerId)) {
      return false;
    }

    const removedElementIds = this.listElements(
      { layerId },
      { sceneId: scene.record.id },
    ).map((element) => element.id);
    removedElementIds.forEach((elementId) => {
      scene.elementsById.delete(elementId);
      this.recordElementChange(scene.record.id, "removed", elementId);
    });

    scene.layersById.delete(layerId);
    this.recordLayerChange(scene.record.id, "removed", layerId);
    return true;
  }

  getLayer(id: LayerId, options: SceneScopeOptions = {}): SceneLayer | undefined {
    const layer = this.getSceneStore(options.sceneId).layersById.get(id);
    return layer ? this.cloneLayer(layer) : undefined;
  }

  listLayers(options: SceneScopeOptions = {}): SceneLayer[] {
    return Array.from(this.getSceneStore(options.sceneId).layersById.values())
      .map((layer) => this.cloneLayer(layer))
      .sort(this.compareOrderedItems);
  }

  addElement(
    element: SceneElementInput,
    options: SceneScopeOptions = {},
  ): SceneElement {
    const scene = this.getSceneStore(options.sceneId);
    const id = this.normalizeId(element.id, "SceneElement.id");
    const layerId = this.normalizeId(element.layerId, "SceneElement.layerId");
    if (scene.elementsById.has(id)) {
      throw new Error(`Scene element "${id}" is already registered.`);
    }
    if (!scene.layersById.has(layerId)) {
      throw new Error(`Scene layer "${layerId}" not found.`);
    }

    this.validateElementInput(element);

    const next = this.cloneElement({
      ...element,
      id,
      layerId,
      order: element.order ?? this.countLayerElements(scene.record.id, layerId),
      visible: element.visible ?? true,
    } as SceneElement);

    scene.elementsById.set(id, next);
    this.recordElementChange(scene.record.id, "added", id);
    return this.cloneElement(next);
  }

  updateElement(
    id: ElementId,
    patch: SceneElementPatch,
    options: SceneScopeOptions = {},
  ): SceneElement {
    const scene = this.getSceneStore(options.sceneId);
    const elementId = this.normalizeId(id, "SceneElement.id");
    const current = scene.elementsById.get(elementId);
    if (!current) {
      throw new Error(`Scene element "${elementId}" not found.`);
    }

    const nextLayerId =
      patch.layerId === undefined
        ? current.layerId
        : this.normalizeId(patch.layerId, "SceneElement.layerId");
    if (!scene.layersById.has(nextLayerId)) {
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

    scene.elementsById.set(elementId, next);
    this.recordElementChange(scene.record.id, "updated", elementId);
    return this.cloneElement(next);
  }

  removeElement(id: ElementId, options: SceneScopeOptions = {}): boolean {
    const scene = this.getSceneStore(options.sceneId);
    const elementId = this.normalizeId(id, "SceneElement.id");
    if (!scene.elementsById.delete(elementId)) {
      return false;
    }

    this.recordElementChange(scene.record.id, "removed", elementId);
    return true;
  }

  getElement<TElement extends SceneElement = SceneElement>(
    id: ElementId,
    options: SceneScopeOptions = {},
  ): TElement | undefined {
    const element = this.getSceneStore(options.sceneId).elementsById.get(id);
    return element ? (this.cloneElement(element) as TElement) : undefined;
  }

  listElements(
    query: SceneElementQuery = {},
    options: SceneScopeOptions = {},
  ): SceneElement[] {
    const sceneId = query.sceneId ?? options.sceneId;
    return Array.from(this.getSceneStore(sceneId).elementsById.values())
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
    const sceneSnapshot = this.cloneSceneMap();
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
      this.scenesById = sceneSnapshot;
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
    this.scenesById.clear();
    this.scenesById.set(
      DEFAULT_SCENE_ID,
      this.createSceneStore({
        id: DEFAULT_SCENE_ID,
        order: 0,
        visible: true,
        renderable: false,
        transient: false,
      }),
    );
    this.pendingChange = null;
    this.transactionDepth = 0;
    this.eventBus.clear();
  }

  private createSceneStore(record: SceneRecord): SceneStore {
    return {
      record: this.cloneScene(record),
      layersById: new Map(),
      elementsById: new Map(),
    };
  }

  private getSceneStore(id?: SceneId): SceneStore {
    const sceneId = this.normalizeId(id || DEFAULT_SCENE_ID, "Scene.id");
    const scene = this.scenesById.get(sceneId);
    if (!scene) throw new Error(`Scene "${sceneId}" not found.`);
    return scene;
  }

  private countLayerElements(sceneId: SceneId, layerId: LayerId): number {
    let count = 0;
    this.getSceneStore(sceneId).elementsById.forEach((element) => {
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

  private recordSceneChange(
    kind: keyof NonNullable<SceneChangeSet["scenes"]>,
    id: SceneId,
  ) {
    const change = this.ensurePendingChange();
    this.mergeChange(change.scenes!, kind, id);
    this.flushChangeIfNeeded();
  }

  private recordLayerChange(
    sceneId: SceneId,
    kind: keyof SceneChangeSet["layers"],
    id: LayerId,
  ) {
    const change = this.ensurePendingChange();
    this.mergeChange(change.layers, kind, id);
    this.mergeChange(this.ensureScopedChange(change, sceneId).layers, kind, id);
    this.flushChangeIfNeeded();
  }

  private recordElementChange(
    sceneId: SceneId,
    kind: keyof SceneChangeSet["elements"],
    id: ElementId,
  ) {
    const change = this.ensurePendingChange();
    this.mergeChange(change.elements, kind, id);
    this.mergeChange(this.ensureScopedChange(change, sceneId).elements, kind, id);
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

  private ensureScopedChange(
    change: SceneChangeSet,
    sceneId: SceneId,
  ): Required<Pick<SceneChangeSet, "layers" | "elements">> {
    if (!change.sceneChanges) change.sceneChanges = {};
    if (!change.sceneChanges[sceneId]) {
      change.sceneChanges[sceneId] = createEmptyScopedChangeSet();
    }
    return change.sceneChanges[sceneId];
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

  private cloneScene(scene: SceneRecord): SceneRecord {
    return {
      ...scene,
      metadata: this.cloneRecord(scene.metadata),
    };
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

  private cloneSceneMap(): Map<SceneId, SceneStore> {
    return new Map(
      Array.from(this.scenesById.entries()).map(([id, scene]) => [
        id,
        {
          record: this.cloneScene(scene.record),
          layersById: new Map(
            Array.from(scene.layersById.entries()).map(([layerId, layer]) => [
              layerId,
              this.cloneLayer(layer),
            ]),
          ),
          elementsById: new Map(
            Array.from(scene.elementsById.entries()).map(([elementId, element]) => [
              elementId,
              this.cloneElement(element),
            ]),
          ),
        },
      ]),
    );
  }

  private cloneChangeSet(change: SceneChangeSet): SceneChangeSet {
    const sceneChanges: NonNullable<SceneChangeSet["sceneChanges"]> = {};
    Object.entries(change.sceneChanges ?? {}).forEach(([sceneId, scoped]) => {
      sceneChanges[sceneId] = {
        layers: {
          added: scoped.layers.added.slice(),
          updated: scoped.layers.updated.slice(),
          removed: scoped.layers.removed.slice(),
        },
        elements: {
          added: scoped.elements.added.slice(),
          updated: scoped.elements.updated.slice(),
          removed: scoped.elements.removed.slice(),
        },
      };
    });
    return {
      scenes: {
        added: change.scenes?.added.slice() ?? [],
        updated: change.scenes?.updated.slice() ?? [],
        removed: change.scenes?.removed.slice() ?? [],
      },
      sceneChanges,
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
