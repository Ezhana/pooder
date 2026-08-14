import type {
  ElementId,
  CreateSceneInput,
  LayerId,
  SceneChangeSet,
  SceneElement,
  SceneElementInput,
  SceneElementPatch,
  SceneElementSelector,
  SceneHandle,
  SceneId,
  SceneInput,
  SceneLayer,
  SceneLayerInput,
  SceneLayerPatch,
  SceneLayerSelector,
  ScenePatch,
  SceneRecord,
  SceneScopeOptions,
  SceneServiceEventMap,
  SceneSnapshot,
  SceneTransaction,
  SceneTransactionOptions,
  SceneChangeCause,
} from "../scene";
import { DEFAULT_SCENE_ID } from "../scene";
import type { RenderEffectSpec } from "../render";
import type { Service, ServiceContext } from "../service";
import type SessionService from "./SessionService";
import { SESSION_SERVICE } from "./tokens";
import { TypedEventEmitter } from "../typed-event";
import type { AffinePlacement } from "../coordinate";

export type SceneChangeEvent = SceneChangeSet;

interface SceneStore {
  record: SceneRecord;
  layersById: Map<LayerId, SceneLayer>;
  elementsById: Map<ElementId, SceneElement>;
}

class SceneHandleImpl implements SceneHandle {
  private disposed = false;

  constructor(
    private readonly service: SceneService,
    private readonly snapshot: SceneSnapshot,
  ) {}

  get id() {
    return this.snapshot.id;
  }
  get owner() {
    return cloneSceneOwner(this.snapshot.owner);
  }
  get composition() {
    return cloneComposition(this.snapshot.composition);
  }
  getSnapshot(): SceneSnapshot {
    return cloneSceneSnapshot(this.snapshot);
  }
  addLayer(layer: SceneLayerInput): SceneLayer {
    this.ensureActive();
    return this.service.addLayer(layer, { sceneId: this.id });
  }
  updateLayer(id: LayerId, patch: SceneLayerPatch): SceneLayer {
    this.ensureActive();
    return this.service.updateLayer(id, patch, { sceneId: this.id });
  }
  removeLayer(id: LayerId): boolean {
    this.ensureActive();
    return this.service.removeLayer(id, { sceneId: this.id });
  }
  addElement(element: SceneElementInput): SceneElement {
    this.ensureActive();
    return this.service.addElement(element, { sceneId: this.id });
  }
  updateElement(id: ElementId, patch: SceneElementPatch): SceneElement {
    this.ensureActive();
    return this.service.updateElement(id, patch, { sceneId: this.id });
  }
  removeElement(id: ElementId): boolean {
    this.ensureActive();
    return this.service.removeElement(id, { sceneId: this.id });
  }
  selectLayers(
    selector: Omit<SceneLayerSelector, "sceneId"> = {},
  ): SceneLayer[] {
    this.ensureActive();
    return this.service.selectLayers({ ...selector, sceneId: this.id });
  }
  selectElements(
    selector: Omit<SceneElementSelector, "sceneId"> = {},
  ): SceneElement[] {
    this.ensureActive();
    return this.service.selectElements({ ...selector, sceneId: this.id });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.service.disposeHandle(this);
  }
  private ensureActive(): void {
    if (this.disposed) throw new Error(`Scene "${this.id}" is disposed.`);
  }
}

function createEmptyScopedChangeSet(): Required<
  Pick<SceneChangeSet, "layers" | "elements">
> {
  return {
    layers: { added: [], updated: [], removed: [] },
    elements: { added: [], updated: [], removed: [] },
  };
}

function createEmptyChangeSet(cause: SceneChangeCause): SceneChangeSet {
  return {
    causes: [cloneSceneChangeCause(cause)],
    scenes: { added: [], updated: [], removed: [] },
    sceneChanges: {},
    ...createEmptyScopedChangeSet(),
  };
}

function cloneSceneChangeCause(cause: SceneChangeCause): SceneChangeCause {
  return cause.type === "interaction-preview"
    ? {
        type: cause.type,
        sessionId: cause.sessionId,
        ...(cause.toolId ? { toolId: cause.toolId } : {}),
      }
    : { type: "scene-content" };
}

function getSceneChangeCauseKey(cause: SceneChangeCause): string {
  return cause.type === "interaction-preview"
    ? `${cause.type}:${cause.sessionId}:${cause.toolId ?? ""}`
    : cause.type;
}

export default class SceneService implements Service {
  private readonly events = new TypedEventEmitter<SceneServiceEventMap>();
  private scenesById = new Map<SceneId, SceneStore>();
  private readonly handlesById = new Map<SceneId, SceneHandleImpl>();
  private sessionService?: SessionService;
  private sessionSubscription?: { dispose(): void };
  private sessionTerminalSubscription?: { dispose(): void };
  private activeRootId: SceneId | null = null;
  private transactionDepth = 0;
  private pendingChange: SceneChangeSet | null = null;
  private readonly transactionCauses: SceneChangeCause[] = [];

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

  init(context: ServiceContext): void {
    this.sessionSubscription?.dispose();
    this.sessionTerminalSubscription?.dispose();
    this.sessionService = context.get(SESSION_SERVICE);
    this.sessionSubscription = this.sessionService?.onDidChange(() =>
      this.refreshActiveRoot(),
    );
    this.sessionTerminalSubscription = this.sessionService?.onDidTerminate(() =>
      this.refreshActiveRoot(),
    );
    this.refreshActiveRoot();
  }

  createScene(input: CreateSceneInput): SceneHandle {
    const id = this.normalizeId(input.id, "Scene.id");
    const sessionId = this.normalizeId(
      input.owner.sessionId,
      "Scene.owner.sessionId",
    );
    if (!this.sessionService?.getHandle(sessionId)) {
      throw new Error(`Scene owner session "${sessionId}" is not active.`);
    }
    if (this.handlesById.has(id) || this.scenesById.has(id)) {
      throw new Error(`Scene "${id}" is already registered.`);
    }
    const duplicate = [...this.handlesById.values()].find(
      (handle) => handle.owner.sessionId === sessionId,
    );
    if (duplicate) {
      throw new Error(
        `Session "${sessionId}" already owns scene "${duplicate.id}".`,
      );
    }
    const snapshot: SceneSnapshot = {
      id,
      owner: { type: "session", sessionId },
      composition: normalizeComposition(input.composition),
    };
    this.scenesById.set(
      id,
      this.createSceneStore({
        id,
        order: this.scenesById.size,
        visible: true,
        renderable: false,
        transient: false,
      }),
    );
    const handle = new SceneHandleImpl(this, snapshot);
    this.handlesById.set(id, handle);
    this.recordSceneChange("added", id);
    this.refreshActiveRoot();
    return handle;
  }

  getActiveRoot(): SceneSnapshot | null {
    const handle = this.activeRootId
      ? this.handlesById.get(this.activeRootId)
      : undefined;
    return handle?.getSnapshot() ?? null;
  }

  getSceneHandle(id: SceneId): SceneHandle | undefined {
    return this.handlesById.get(this.normalizeId(id, "Scene.id"));
  }

  on<TKey extends keyof SceneServiceEventMap>(
    type: TKey,
    listener: (event: SceneServiceEventMap[TKey]) => void,
  ) {
    return this.events.on(type, listener);
  }

  disposeHandle(handle: SceneHandleImpl): void {
    if (this.handlesById.get(handle.id) !== handle) return;
    this.handlesById.delete(handle.id);
    this.removeScene(handle.id);
    this.refreshActiveRoot();
  }

  /** @internal Legacy overlay API. */
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

  /** @internal Legacy overlay API. */
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

  addLayer(
    layer: SceneLayerInput,
    options: SceneScopeOptions = {},
  ): SceneLayer {
    const scene = this.getSceneStore(options.sceneId);
    const id = this.normalizeId(layer.id, "SceneLayer.id");
    if (scene.layersById.has(id)) {
      throw new Error(`Scene layer "${id}" is already registered.`);
    }

    const next: SceneLayer = {
      id,
      order: layer.order ?? scene.layersById.size,
      visible: layer.visible ?? true,
      effects: this.cloneEffects(layer.effects),
      tags: this.normalizeTags(layer.tags),
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
      effects:
        patch.effects === undefined
          ? this.cloneEffects(current.effects)
          : this.cloneEffects(patch.effects),
      tags:
        patch.tags === undefined
          ? this.cloneTags(current.tags)
          : this.normalizeTags(patch.tags),
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

    const removedElementIds = this.selectElements({
      sceneId: scene.record.id,
      layerIds: [layerId],
    }).map((element) => element.id);
    removedElementIds.forEach((elementId) => {
      scene.elementsById.delete(elementId);
      this.recordElementChange(scene.record.id, "removed", elementId);
    });

    scene.layersById.delete(layerId);
    this.recordLayerChange(scene.record.id, "removed", layerId);
    return true;
  }

  selectLayers(selector: SceneLayerSelector = {}): SceneLayer[] {
    return Array.from(this.getSceneStore(selector.sceneId).layersById.values())
      .filter((layer) => this.matchesLayerSelector(layer, selector))
      .map((layer) => this.cloneLayer(layer))
      .sort(this.compareOrderedItems);
  }

  selectOneLayer(selector: SceneLayerSelector): SceneLayer | undefined {
    const layers = this.selectLayers(selector);
    if (layers.length > 1) {
      throw new Error("scene-selector-ambiguous");
    }
    return layers[0];
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
      tags: this.normalizeTags(element.tags),
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
      effects:
        patch.effects === undefined
          ? this.cloneEffects(current.effects)
          : this.cloneEffects(patch.effects),
      tags:
        patch.tags === undefined
          ? this.cloneTags(current.tags)
          : this.normalizeTags(patch.tags),
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
      placement:
        patch.placement === undefined
          ? this.clonePlacement(current.placement)
          : this.clonePlacement(patch.placement),
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

  selectElements<TElement extends SceneElement = SceneElement>(
    selector: SceneElementSelector = {},
  ): TElement[] {
    const scene = this.getSceneStore(selector.sceneId);
    return Array.from(scene.elementsById.values())
      .filter((element) => this.matchesElementSelector(element, selector))
      .sort((left, right) => this.compareSceneElements(scene, left, right))
      .map((element) => this.cloneElement(element) as TElement);
  }

  selectOneElement<TElement extends SceneElement = SceneElement>(
    selector: SceneElementSelector,
  ): TElement | undefined {
    const elements = this.selectElements<TElement>(selector);
    if (elements.length > 1) {
      throw new Error("scene-selector-ambiguous");
    }
    return elements[0];
  }

  transaction<T>(run: SceneTransaction<T>): T;
  transaction<T>(options: SceneTransactionOptions, run: SceneTransaction<T>): T;
  transaction<T>(
    optionsOrRun: SceneTransactionOptions | SceneTransaction<T>,
    maybeRun?: SceneTransaction<T>,
  ): T {
    const options =
      typeof optionsOrRun === "function" ? undefined : optionsOrRun;
    const run = typeof optionsOrRun === "function" ? optionsOrRun : maybeRun;
    if (!run) throw new Error("Scene transaction callback is required.");
    const sceneSnapshot = this.cloneSceneMap();
    const pendingSnapshot = this.pendingChange
      ? this.cloneChangeSet(this.pendingChange)
      : null;
    const depthSnapshot = this.transactionDepth;

    this.transactionDepth += 1;
    if (options)
      this.transactionCauses.push(cloneSceneChangeCause(options.cause));
    try {
      const result = run();
      if (options) this.transactionCauses.pop();
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0) {
        this.flushPendingChange();
      }
      return result;
    } catch (error) {
      if (options) this.transactionCauses.pop();
      this.scenesById = sceneSnapshot;
      this.pendingChange = pendingSnapshot;
      this.transactionDepth = depthSnapshot;
      throw error;
    }
  }

  onDidChange(callback: (event: SceneChangeEvent) => void) {
    return this.events.on("change", callback);
  }

  dispose() {
    this.sessionSubscription?.dispose();
    this.sessionTerminalSubscription?.dispose();
    this.sessionSubscription = undefined;
    this.sessionTerminalSubscription = undefined;
    this.sessionService = undefined;
    this.handlesById.clear();
    this.activeRootId = null;
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
    this.transactionCauses.length = 0;
    this.events.clear();
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
    this.mergeChange(
      this.ensureScopedChange(change, sceneId).elements,
      kind,
      id,
    );
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
    const cause =
      this.transactionCauses[this.transactionCauses.length - 1] ??
      ({ type: "scene-content" } as const);
    if (!this.pendingChange) {
      this.pendingChange = createEmptyChangeSet(cause);
    } else {
      const key = getSceneChangeCauseKey(cause);
      if (
        !this.pendingChange.causes.some(
          (candidate) => getSceneChangeCauseKey(candidate) === key,
        )
      ) {
        this.pendingChange.causes.push(cloneSceneChangeCause(cause));
      }
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
    this.events.emit("change", this.cloneChangeSet(change));
  }

  private refreshActiveRoot(): void {
    const focusedSessionId = this.sessionService?.getFocusedSessionId();
    const next = focusedSessionId
      ? ([...this.handlesById.values()].find(
          (handle) => handle.owner.sessionId === focusedSessionId,
        )?.id ?? null)
      : null;
    if (this.activeRootId === next) return;
    this.activeRootId = next;
    this.events.emit("rootChange", { activeRoot: this.getActiveRoot() });
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
      effects: this.cloneEffects(layer.effects),
      tags: this.cloneTags(layer.tags),
      metadata: this.cloneRecord(layer.metadata),
    };
  }

  private cloneElement<TElement extends SceneElement>(
    element: TElement,
  ): TElement {
    return {
      ...element,
      effects: this.cloneEffects(element.effects),
      tags: this.cloneTags(element.tags),
      metadata: this.cloneRecord(element.metadata),
      data: this.cloneRecord(element.data),
      style: this.cloneRecord(element.style),
      placement: this.clonePlacement(element.placement),
      transform: this.cloneRecord(element.transform),
    };
  }

  private clonePlacement(
    placement: AffinePlacement | undefined,
  ): AffinePlacement | undefined {
    if (!placement) return undefined;
    return {
      localBounds: { ...placement.localBounds },
      localToScene: {
        ...placement.localToScene,
        values: [...placement.localToScene.values],
      },
      pivot: { ...placement.pivot },
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
            Array.from(scene.elementsById.entries()).map(
              ([elementId, element]) => [elementId, this.cloneElement(element)],
            ),
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
      causes: change.causes.map(cloneSceneChangeCause),
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

  private cloneEffects(
    effects?: readonly RenderEffectSpec[],
  ): RenderEffectSpec[] | undefined {
    if (!effects) return undefined;
    return effects.map((effect) => {
      const source = {
        ...effect.source,
        data: this.cloneRecord(effect.source.data),
        props: this.cloneRecord(effect.source.props) ?? {},
        effects: this.cloneEffects(effect.source.effects),
      };
      return effect.coordinateMode === "object"
        ? { ...effect, coordinateMode: "object", source }
        : { ...effect, coordinateMode: "absolute", source };
    }) as RenderEffectSpec[];
  }

  private cloneTags(value?: readonly string[]): string[] | undefined {
    return value ? value.slice() : undefined;
  }

  private normalizeTags(value?: readonly string[]): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const tags = Array.from(
      new Set(
        value
          .map((item) => String(item || "").trim())
          .filter((item) => item.length > 0),
      ),
    );
    return tags.length ? tags : undefined;
  }

  private normalizeSelectorValues(
    value?: readonly string[],
  ): Set<string> | undefined {
    const values = this.normalizeTags(value);
    return values?.length ? new Set(values) : undefined;
  }

  private matchesLayerSelector(
    layer: SceneLayer,
    selector: SceneLayerSelector,
  ): boolean {
    const ids = this.normalizeSelectorValues([
      ...(selector.ids ?? []),
      ...(selector.layerIds ?? []),
    ]);
    if (ids && !ids.has(layer.id)) return false;
    if (selector.visible !== undefined && layer.visible !== selector.visible) {
      return false;
    }
    if (!this.matchesTags(layer.tags, selector.tags, selector.tagMatch))
      return false;
    if (!this.matchesMetadata(layer.metadata, selector.metadata)) return false;
    return true;
  }

  private matchesElementSelector(
    element: SceneElement,
    selector: SceneElementSelector,
  ): boolean {
    const ids = this.normalizeSelectorValues(selector.ids);
    if (ids && !ids.has(element.id)) return false;
    const projectionIds = this.normalizeSelectorValues(selector.projectionIds);
    if (projectionIds && !projectionIds.has(element.id)) return false;
    const layerIds = this.normalizeSelectorValues(selector.layerIds);
    if (layerIds && !layerIds.has(element.layerId)) return false;
    const types = this.normalizeSelectorValues(selector.types);
    if (types && !types.has(element.type)) return false;
    if (
      selector.visible !== undefined &&
      element.visible !== selector.visible
    ) {
      return false;
    }
    if (!this.matchesTags(element.tags, selector.tags, selector.tagMatch))
      return false;
    if (!this.matchesMetadata(element.metadata, selector.metadata))
      return false;
    return true;
  }

  private matchesTags(
    value: readonly string[] | undefined,
    selectorValue: readonly string[] | undefined,
    tagMatch: "all" | "any" = "all",
  ): boolean {
    const tags = this.normalizeSelectorValues(selectorValue);
    if (!tags) return true;
    const values = new Set(value ?? []);
    return tagMatch === "any"
      ? Array.from(tags).some((tag) => values.has(tag))
      : Array.from(tags).every((tag) => values.has(tag));
  }

  private matchesMetadata(
    value: SceneLayer["metadata"] | undefined,
    selectorValue: SceneLayerSelector["metadata"] | undefined,
  ): boolean {
    if (!selectorValue) return true;
    return Object.entries(selectorValue).every(
      ([key, expected]) => value?.[key] === expected,
    );
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

  private compareSceneElements(
    scene: SceneStore,
    left: SceneElement,
    right: SceneElement,
  ): number {
    const leftLayerOrder =
      scene.layersById.get(left.layerId)?.order ?? Number.MAX_SAFE_INTEGER;
    const rightLayerOrder =
      scene.layersById.get(right.layerId)?.order ?? Number.MAX_SAFE_INTEGER;

    return (
      leftLayerOrder - rightLayerOrder ||
      left.order - right.order ||
      left.id.localeCompare(right.id)
    );
  }
}

function normalizeComposition(
  composition: CreateSceneInput["composition"],
): SceneSnapshot["composition"] {
  if (!composition || !Array.isArray(composition.entries)) {
    throw new Error("Scene composition entries are required.");
  }
  return {
    entries: composition.entries.map((entry) => {
      if (entry.source === "local") {
        return {
          source: "local" as const,
          layerIds: entry.layerIds.map((id: LayerId) => {
            const normalized = String(id ?? "").trim();
            if (!normalized)
              throw new Error("Scene composition layer id is required.");
            return normalized;
          }),
        };
      }
      throw new Error("Unsupported scene composition source.");
    }),
  };
}

function cloneComposition(
  composition: SceneSnapshot["composition"],
): SceneSnapshot["composition"] {
  return {
    entries: composition.entries.map((entry) => ({
      ...entry,
      layerIds: [...entry.layerIds],
    })),
  };
}

function cloneSceneOwner(
  owner: SceneSnapshot["owner"],
): SceneSnapshot["owner"] {
  return { ...owner };
}

function cloneSceneSnapshot(snapshot: SceneSnapshot): SceneSnapshot {
  return {
    id: snapshot.id,
    owner: cloneSceneOwner(snapshot.owner),
    composition: cloneComposition(snapshot.composition),
  };
}
