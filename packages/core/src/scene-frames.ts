import type Disposable from "./disposable";
import type { SceneId } from "./scene";
import type { Service } from "./service";

export interface SceneFrameMm {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface SceneFrames {
  preview: SceneFrameMm;
  production: SceneFrameMm;
  export?: SceneFrameMm;
  viewportFocus?: SceneFrameMm;
}

export interface SceneFrameChangeEvent {
  sceneId: SceneId;
  frames: SceneFrames | null;
}

export interface PreparedSceneFramePublication {
  readonly framesBySceneId: Readonly<Record<SceneId, SceneFrames>>;
}

export interface SceneFrameService extends Service {
  clear(): void;
  getFrames(sceneId: SceneId): SceneFrames | null;
  importFrames(framesBySceneId: Record<SceneId, SceneFrames>): void;
  prepareImportFrames(
    framesBySceneId: Record<SceneId, SceneFrames>,
  ): PreparedSceneFramePublication;
  assertImportFramesPublicationCurrent(
    publication: PreparedSceneFramePublication,
  ): void;
  publishImportFrames(
    publication: PreparedSceneFramePublication,
    options?: { notify?: boolean },
  ): void;
  notifyImportFramesPublished(publication: PreparedSceneFramePublication): void;
  listSceneIds(): SceneId[];
  onAnyFramesChange(
    listener: (event: SceneFrameChangeEvent) => void,
  ): Disposable;
  onFramesChange(
    sceneId: SceneId,
    listener: (event: SceneFrameChangeEvent) => void,
  ): Disposable;
  setFrames(sceneId: SceneId, frames: SceneFrames): void;
}

function normalizeId(value: unknown): SceneId {
  return String(value || "").trim();
}

function cloneFrame(frame: SceneFrameMm): SceneFrameMm {
  return { ...frame };
}

function cloneFrames(frames: SceneFrames): SceneFrames {
  return {
    preview: cloneFrame(frames.preview),
    production: cloneFrame(frames.production),
    ...(frames.export ? { export: cloneFrame(frames.export) } : {}),
    ...(frames.viewportFocus
      ? { viewportFocus: cloneFrame(frames.viewportFocus) }
      : {}),
  };
}

function validateFrame(frame: SceneFrameMm, label: string): SceneFrameMm {
  const xMm = Number(frame?.xMm);
  const yMm = Number(frame?.yMm);
  const widthMm = Number(frame?.widthMm);
  const heightMm = Number(frame?.heightMm);
  if (
    !Number.isFinite(xMm) ||
    !Number.isFinite(yMm) ||
    !Number.isFinite(widthMm) ||
    !Number.isFinite(heightMm) ||
    widthMm <= 0 ||
    heightMm <= 0
  ) {
    throw new Error(`Invalid ${label} scene frame.`);
  }
  return { xMm, yMm, widthMm, heightMm };
}

function normalizeFrames(frames: SceneFrames): SceneFrames {
  return {
    preview: validateFrame(frames.preview, "preview"),
    production: validateFrame(frames.production, "production"),
    ...(frames.export
      ? { export: validateFrame(frames.export, "export") }
      : {}),
    ...(frames.viewportFocus
      ? {
          viewportFocus: validateFrame(frames.viewportFocus, "viewportFocus"),
        }
      : {}),
  };
}

export class DefaultSceneFrameService implements SceneFrameService {
  private readonly framesBySceneId = new Map<SceneId, SceneFrames>();
  private revision = 0;
  private readonly listenersBySceneId = new Map<
    SceneId,
    Set<(event: SceneFrameChangeEvent) => void>
  >();
  private readonly anyListeners = new Set<
    (event: SceneFrameChangeEvent) => void
  >();
  private readonly preparedPublications = new WeakMap<
    PreparedSceneFramePublication,
    {
      frames: Map<SceneId, SceneFrames>;
      changedSceneIds: SceneId[];
      revision: number;
    }
  >();
  private readonly pendingPublicationNotifications = new WeakMap<
    PreparedSceneFramePublication,
    SceneId[]
  >();

  init(): void {}

  clear(): void {
    const previous = this.listSceneIds();
    if (!previous.length) return;
    this.framesBySceneId.clear();
    this.revision += 1;
    previous.forEach((sceneId) => this.emit(sceneId));
  }

  getFrames(sceneId: SceneId): SceneFrames | null {
    const normalized = normalizeId(sceneId);
    if (!normalized) throw new Error("SceneFrameService requires sceneId.");
    const frames = this.framesBySceneId.get(normalized);
    return frames ? cloneFrames(frames) : null;
  }

  importFrames(framesBySceneId: Record<SceneId, SceneFrames>): void {
    this.publishImportFrames(this.prepareImportFrames(framesBySceneId));
  }

  prepareImportFrames(
    framesBySceneId: Record<SceneId, SceneFrames>,
  ): PreparedSceneFramePublication {
    const next = new Map<SceneId, SceneFrames>();
    Object.entries(framesBySceneId).forEach(([sceneId, frames]) => {
      const normalized = normalizeId(sceneId);
      if (normalized) next.set(normalized, normalizeFrames(frames));
    });
    const changed = new Set<SceneId>();
    this.framesBySceneId.forEach((frames, sceneId) => {
      const replacement = next.get(sceneId);
      if (!replacement || !sameFrames(frames, replacement))
        changed.add(sceneId);
    });
    next.forEach((frames, sceneId) => {
      const current = this.framesBySceneId.get(sceneId);
      if (!current || !sameFrames(current, frames)) changed.add(sceneId);
    });
    const publication: PreparedSceneFramePublication = {
      framesBySceneId: Object.fromEntries(
        Array.from(next, ([sceneId, frames]) => [sceneId, cloneFrames(frames)]),
      ),
    };
    this.preparedPublications.set(publication, {
      frames: next,
      changedSceneIds: Array.from(changed),
      revision: this.revision,
    });
    return publication;
  }

  assertImportFramesPublicationCurrent(
    publication: PreparedSceneFramePublication,
  ): void {
    this.requireCurrentPublication(publication);
  }

  publishImportFrames(
    publication: PreparedSceneFramePublication,
    options: { notify?: boolean } = {},
  ): void {
    const prepared = this.requireCurrentPublication(publication);
    this.preparedPublications.delete(publication);
    this.framesBySceneId.clear();
    prepared.frames.forEach((frames, sceneId) =>
      this.framesBySceneId.set(sceneId, frames),
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

  notifyImportFramesPublished(
    publication: PreparedSceneFramePublication,
  ): void {
    const sceneIds = this.pendingPublicationNotifications.get(publication);
    if (!sceneIds) {
      throw new Error("Scene frame publication has no pending notifications.");
    }
    this.pendingPublicationNotifications.delete(publication);
    sceneIds.forEach((sceneId) => this.emit(sceneId));
  }

  listSceneIds(): SceneId[] {
    return Array.from(this.framesBySceneId.keys());
  }

  onAnyFramesChange(
    listener: (event: SceneFrameChangeEvent) => void,
  ): Disposable {
    this.anyListeners.add(listener);
    return { dispose: () => this.anyListeners.delete(listener) };
  }

  onFramesChange(
    sceneId: SceneId,
    listener: (event: SceneFrameChangeEvent) => void,
  ): Disposable {
    const normalized = normalizeId(sceneId);
    if (!normalized)
      throw new Error("SceneFrameService listener requires sceneId.");
    const listeners =
      this.listenersBySceneId.get(normalized) ??
      new Set<(event: SceneFrameChangeEvent) => void>();
    listeners.add(listener);
    this.listenersBySceneId.set(normalized, listeners);
    return {
      dispose: () => {
        listeners.delete(listener);
        if (!listeners.size) this.listenersBySceneId.delete(normalized);
      },
    };
  }

  setFrames(sceneId: SceneId, frames: SceneFrames): void {
    const normalized = normalizeId(sceneId);
    if (!normalized) throw new Error("SceneFrameService requires sceneId.");
    const next = normalizeFrames(frames);
    const current = this.framesBySceneId.get(normalized);
    if (current && sameFrames(current, next)) return;
    this.framesBySceneId.set(normalized, next);
    this.revision += 1;
    this.emit(normalized);
  }

  private requireCurrentPublication(
    publication: PreparedSceneFramePublication,
  ) {
    const prepared = this.preparedPublications.get(publication);
    if (!prepared) {
      throw new Error(
        "Scene frame publication is invalid or already published.",
      );
    }
    if (prepared.revision !== this.revision) {
      throw new Error(
        "Scene frame publication is stale because frames changed after prepare.",
      );
    }
    return prepared;
  }

  private emit(sceneId: SceneId): void {
    const frames = this.framesBySceneId.get(sceneId);
    const event = { sceneId, frames: frames ? cloneFrames(frames) : null };
    this.anyListeners.forEach((listener) => listener(event));
    this.listenersBySceneId
      .get(sceneId)
      ?.forEach((listener) => listener(event));
  }
}

function sameFrames(left: SceneFrames, right: SceneFrames): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
