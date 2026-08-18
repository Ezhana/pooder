import type Disposable from "./disposable";
import type { SceneId } from "./scene";
import type { Service } from "./service";

/** Millimetre rectangle. Same shape as `@pooder/document` `RectMm`. */
export interface RectMm {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Millimetre box insets. Same shape as `@pooder/document` `BoxInsetsMm`. */
export interface BoxInsetsMm {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const ZERO_BOX_INSETS_MM: BoxInsetsMm = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

export interface SceneBounds {
  bounds: RectMm;
  insets?: BoxInsetsMm;
}

export interface SceneBoundsChangeEvent {
  sceneId: SceneId;
  bounds: SceneBounds | null;
}

export interface PreparedSceneBoundsPublication {
  readonly boundsBySceneId: Readonly<Record<SceneId, SceneBounds>>;
}

export interface SceneBoundsService extends Service {
  clear(): void;
  getBounds(sceneId: SceneId): SceneBounds | null;
  importBounds(boundsBySceneId: Record<SceneId, SceneBounds>): void;
  prepareImportBounds(
    boundsBySceneId: Record<SceneId, SceneBounds>,
  ): PreparedSceneBoundsPublication;
  assertImportBoundsPublicationCurrent(
    publication: PreparedSceneBoundsPublication,
  ): void;
  publishImportBounds(
    publication: PreparedSceneBoundsPublication,
    options?: { notify?: boolean },
  ): void;
  notifyImportBoundsPublished(publication: PreparedSceneBoundsPublication): void;
  listSceneIds(): SceneId[];
  onAnyBoundsChange(
    listener: (event: SceneBoundsChangeEvent) => void,
  ): Disposable;
  onBoundsChange(
    sceneId: SceneId,
    listener: (event: SceneBoundsChangeEvent) => void,
  ): Disposable;
  setBounds(sceneId: SceneId, bounds: SceneBounds): void;
}

export function sceneInsets(scene: SceneBounds): BoxInsetsMm {
  return scene.insets ?? ZERO_BOX_INSETS_MM;
}

export function sceneContentRect(scene: SceneBounds): RectMm {
  const insets = sceneInsets(scene);
  return {
    x: scene.bounds.x + insets.left,
    y: scene.bounds.y + insets.top,
    width: scene.bounds.width - insets.left - insets.right,
    height: scene.bounds.height - insets.top - insets.bottom,
  };
}

function normalizeId(value: unknown): SceneId {
  return String(value || "").trim();
}

function cloneRect(rect: RectMm): RectMm {
  return { ...rect };
}

function cloneInsets(insets: BoxInsetsMm): BoxInsetsMm {
  return { ...insets };
}

function cloneBounds(bounds: SceneBounds): SceneBounds {
  return {
    bounds: cloneRect(bounds.bounds),
    ...(bounds.insets ? { insets: cloneInsets(bounds.insets) } : {}),
  };
}

function validateRect(rect: RectMm, label: string): RectMm {
  const x = Number(rect?.x);
  const y = Number(rect?.y);
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`Invalid ${label}.`);
  }
  return { x, y, width, height };
}

function validateInsets(insets: BoxInsetsMm): BoxInsetsMm {
  const top = Number(insets?.top);
  const right = Number(insets?.right);
  const bottom = Number(insets?.bottom);
  const left = Number(insets?.left);
  if (
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom) ||
    !Number.isFinite(left) ||
    top < 0 ||
    right < 0 ||
    bottom < 0 ||
    left < 0
  ) {
    throw new Error("Invalid scene insets.");
  }
  return { top, right, bottom, left };
}

function isZeroInsets(insets: BoxInsetsMm): boolean {
  return (
    insets.top === 0 &&
    insets.right === 0 &&
    insets.bottom === 0 &&
    insets.left === 0
  );
}

function normalizeBounds(value: SceneBounds): SceneBounds {
  const bounds = validateRect(value.bounds, "scene bounds");
  if (!value.insets) return { bounds };
  const insets = validateInsets(value.insets);
  const content = sceneContentRect({ bounds, insets });
  if (!(content.width > 0 && content.height > 0)) {
    throw new Error("Invalid scene insets.");
  }
  return isZeroInsets(insets) ? { bounds } : { bounds, insets };
}

export class DefaultSceneBoundsService implements SceneBoundsService {
  private readonly boundsBySceneId = new Map<SceneId, SceneBounds>();
  private revision = 0;
  private readonly listenersBySceneId = new Map<
    SceneId,
    Set<(event: SceneBoundsChangeEvent) => void>
  >();
  private readonly anyListeners = new Set<
    (event: SceneBoundsChangeEvent) => void
  >();
  private readonly preparedPublications = new WeakMap<
    PreparedSceneBoundsPublication,
    {
      bounds: Map<SceneId, SceneBounds>;
      changedSceneIds: SceneId[];
      revision: number;
    }
  >();
  private readonly pendingPublicationNotifications = new WeakMap<
    PreparedSceneBoundsPublication,
    SceneId[]
  >();

  init(): void {}

  clear(): void {
    const previous = this.listSceneIds();
    if (!previous.length) return;
    this.boundsBySceneId.clear();
    this.revision += 1;
    previous.forEach((sceneId) => this.emit(sceneId));
  }

  getBounds(sceneId: SceneId): SceneBounds | null {
    const normalized = normalizeId(sceneId);
    if (!normalized) throw new Error("SceneBoundsService requires sceneId.");
    const bounds = this.boundsBySceneId.get(normalized);
    return bounds ? cloneBounds(bounds) : null;
  }

  importBounds(boundsBySceneId: Record<SceneId, SceneBounds>): void {
    this.publishImportBounds(this.prepareImportBounds(boundsBySceneId));
  }

  prepareImportBounds(
    boundsBySceneId: Record<SceneId, SceneBounds>,
  ): PreparedSceneBoundsPublication {
    const next = new Map<SceneId, SceneBounds>();
    Object.entries(boundsBySceneId).forEach(([sceneId, bounds]) => {
      const normalized = normalizeId(sceneId);
      if (normalized) next.set(normalized, normalizeBounds(bounds));
    });
    const changed = new Set<SceneId>();
    this.boundsBySceneId.forEach((bounds, sceneId) => {
      const replacement = next.get(sceneId);
      if (!replacement || !sameBounds(bounds, replacement))
        changed.add(sceneId);
    });
    next.forEach((bounds, sceneId) => {
      const current = this.boundsBySceneId.get(sceneId);
      if (!current || !sameBounds(current, bounds)) changed.add(sceneId);
    });
    const publication: PreparedSceneBoundsPublication = {
      boundsBySceneId: Object.fromEntries(
        Array.from(next, ([sceneId, bounds]) => [sceneId, cloneBounds(bounds)]),
      ),
    };
    this.preparedPublications.set(publication, {
      bounds: next,
      changedSceneIds: Array.from(changed),
      revision: this.revision,
    });
    return publication;
  }

  assertImportBoundsPublicationCurrent(
    publication: PreparedSceneBoundsPublication,
  ): void {
    this.requireCurrentPublication(publication);
  }

  publishImportBounds(
    publication: PreparedSceneBoundsPublication,
    options: { notify?: boolean } = {},
  ): void {
    const prepared = this.requireCurrentPublication(publication);
    this.preparedPublications.delete(publication);
    this.boundsBySceneId.clear();
    prepared.bounds.forEach((bounds, sceneId) =>
      this.boundsBySceneId.set(sceneId, bounds),
    );
    if (prepared.changedSceneIds.length) this.revision += 1;
    if (options.notify === false) {
      this.pendingPublicationNotifications.set(
        publication,
        prepared.changedSceneIds,
      );
      return;
    }
    prepared.changedSceneIds.forEach((sceneId) => this.emit(sceneId));
  }

  notifyImportBoundsPublished(
    publication: PreparedSceneBoundsPublication,
  ): void {
    const sceneIds = this.pendingPublicationNotifications.get(publication);
    if (!sceneIds) {
      throw new Error("Scene bounds publication has no pending notifications.");
    }
    this.pendingPublicationNotifications.delete(publication);
    sceneIds.forEach((sceneId) => this.emit(sceneId));
  }

  listSceneIds(): SceneId[] {
    return Array.from(this.boundsBySceneId.keys());
  }

  onAnyBoundsChange(
    listener: (event: SceneBoundsChangeEvent) => void,
  ): Disposable {
    this.anyListeners.add(listener);
    return { dispose: () => this.anyListeners.delete(listener) };
  }

  onBoundsChange(
    sceneId: SceneId,
    listener: (event: SceneBoundsChangeEvent) => void,
  ): Disposable {
    const normalized = normalizeId(sceneId);
    if (!normalized)
      throw new Error("SceneBoundsService listener requires sceneId.");
    const listeners =
      this.listenersBySceneId.get(normalized) ??
      new Set<(event: SceneBoundsChangeEvent) => void>();
    listeners.add(listener);
    this.listenersBySceneId.set(normalized, listeners);
    return {
      dispose: () => {
        listeners.delete(listener);
        if (!listeners.size) this.listenersBySceneId.delete(normalized);
      },
    };
  }

  setBounds(sceneId: SceneId, bounds: SceneBounds): void {
    const normalized = normalizeId(sceneId);
    if (!normalized) throw new Error("SceneBoundsService requires sceneId.");
    const next = normalizeBounds(bounds);
    const current = this.boundsBySceneId.get(normalized);
    if (current && sameBounds(current, next)) return;
    this.boundsBySceneId.set(normalized, next);
    this.revision += 1;
    this.emit(normalized);
  }

  private requireCurrentPublication(
    publication: PreparedSceneBoundsPublication,
  ) {
    const prepared = this.preparedPublications.get(publication);
    if (!prepared) {
      throw new Error(
        "Scene bounds publication is invalid or already published.",
      );
    }
    if (prepared.revision !== this.revision) {
      throw new Error(
        "Scene bounds publication is stale because bounds changed after prepare.",
      );
    }
    return prepared;
  }

  private emit(sceneId: SceneId): void {
    const bounds = this.boundsBySceneId.get(sceneId);
    const event = { sceneId, bounds: bounds ? cloneBounds(bounds) : null };
    this.anyListeners.forEach((listener) => listener(event));
    this.listenersBySceneId
      .get(sceneId)
      ?.forEach((listener) => listener(event));
  }
}

function sameBounds(left: SceneBounds, right: SceneBounds): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
