import type Disposable from "./disposable";
import type { Service } from "./service";
import type { SceneFrameMm, SurfaceSceneFrames } from "./render";

export interface SurfaceFrameChangeEvent {
  surfaceId: string;
  frames: SurfaceSceneFrames | null;
}

export interface ActiveSurfaceChangeEvent {
  surfaceId: string | null;
}

export interface PreparedSurfaceFramePublication {
  readonly framesBySurfaceId: Readonly<Record<string, SurfaceSceneFrames>>;
}

export interface SurfaceFrameService extends Service {
  clear(): void;
  activateSurface(surfaceId: string): void;
  getActiveSurfaceId(): string | null;
  getFrames(surfaceId?: string): SurfaceSceneFrames | null;
  importFrames(framesBySurfaceId: Record<string, SurfaceSceneFrames>): void;
  prepareImportFrames(
    framesBySurfaceId: Record<string, SurfaceSceneFrames>,
  ): PreparedSurfaceFramePublication;
  assertImportFramesPublicationCurrent(
    publication: PreparedSurfaceFramePublication,
  ): void;
  publishImportFrames(
    publication: PreparedSurfaceFramePublication,
    options?: { notify?: boolean },
  ): void;
  notifyImportFramesPublished(
    publication: PreparedSurfaceFramePublication,
  ): void;
  listSurfaceIds(): string[];
  onActiveSurfaceChange(
    listener: (event: ActiveSurfaceChangeEvent) => void,
  ): Disposable;
  onAnyFramesChange(
    listener: (event: SurfaceFrameChangeEvent) => void,
  ): Disposable;
  onFramesChange(
    surfaceId: string,
    listener: (event: SurfaceFrameChangeEvent) => void,
  ): Disposable;
  setFrames(surfaceId: string, frames: SurfaceSceneFrames): void;
}

function normalizeId(value: unknown): string {
  return String(value || "").trim();
}

function cloneFrame(frame: SceneFrameMm): SceneFrameMm {
  return {
    xMm: frame.xMm,
    yMm: frame.yMm,
    widthMm: frame.widthMm,
    heightMm: frame.heightMm,
  };
}

function cloneFrames(frames: SurfaceSceneFrames): SurfaceSceneFrames {
  return {
    previewBounds: cloneFrame(frames.previewBounds),
    productionFrame: cloneFrame(frames.productionFrame),
    ...(frames.exportFrame
      ? { exportFrame: cloneFrame(frames.exportFrame) }
      : {}),
    ...(frames.viewportFocusFrame
      ? { viewportFocusFrame: cloneFrame(frames.viewportFocusFrame) }
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
    throw new Error(`Invalid ${label} surface frame.`);
  }
  return { xMm, yMm, widthMm, heightMm };
}

function normalizeFrames(frames: SurfaceSceneFrames): SurfaceSceneFrames {
  const productionFrame = validateFrame(
    frames.productionFrame,
    "productionFrame",
  );
  return {
    previewBounds: validateFrame(frames.previewBounds, "previewBounds"),
    productionFrame,
    ...(frames.exportFrame
      ? { exportFrame: validateFrame(frames.exportFrame, "exportFrame") }
      : {}),
    ...(frames.viewportFocusFrame
      ? {
          viewportFocusFrame: validateFrame(
            frames.viewportFocusFrame,
            "viewportFocusFrame",
          ),
        }
      : {}),
  };
}

export class DefaultSurfaceFrameService implements SurfaceFrameService {
  private readonly framesBySurfaceId = new Map<string, SurfaceSceneFrames>();
  private activeSurfaceId: string | null = null;
  private revision = 0;
  private readonly listenersBySurfaceId = new Map<
    string,
    Set<(event: SurfaceFrameChangeEvent) => void>
  >();
  private readonly anyListeners = new Set<
    (event: SurfaceFrameChangeEvent) => void
  >();
  private readonly activeSurfaceListeners = new Set<
    (event: ActiveSurfaceChangeEvent) => void
  >();
  private readonly preparedPublications = new WeakMap<
    PreparedSurfaceFramePublication,
    {
      frames: Map<string, SurfaceSceneFrames>;
      changedSurfaceIds: string[];
      revision: number;
    }
  >();
  private readonly pendingPublicationNotifications = new WeakMap<
    PreparedSurfaceFramePublication,
    string[]
  >();

  init(): void {}

  clear(): void {
    const previous = Array.from(this.framesBySurfaceId.keys());
    if (!previous.length && this.activeSurfaceId === null) return;
    this.framesBySurfaceId.clear();
    this.revision += 1;
    previous.forEach((surfaceId) => this.emit(surfaceId));
    this.setActiveSurfaceId(null);
  }

  activateSurface(surfaceId: string): void {
    const normalized = normalizeId(surfaceId);
    if (!normalized) {
      throw new Error("SurfaceFrameService requires surfaceId.");
    }
    if (!this.framesBySurfaceId.has(normalized)) {
      throw new Error(`Unknown surface "${normalized}".`);
    }
    this.setActiveSurfaceId(normalized);
  }

  getActiveSurfaceId(): string | null {
    return this.activeSurfaceId;
  }

  getFrames(surfaceId?: string): SurfaceSceneFrames | null {
    const normalized = normalizeId(surfaceId);
    const key =
      normalized || this.activeSurfaceId || this.listSurfaceIds()[0] || "";
    if (!key) return null;
    const frames = this.framesBySurfaceId.get(key);
    return frames ? cloneFrames(frames) : null;
  }

  importFrames(framesBySurfaceId: Record<string, SurfaceSceneFrames>): void {
    this.publishImportFrames(this.prepareImportFrames(framesBySurfaceId));
  }

  prepareImportFrames(
    framesBySurfaceId: Record<string, SurfaceSceneFrames>,
  ): PreparedSurfaceFramePublication {
    const next = new Map<string, SurfaceSceneFrames>();
    Object.entries(framesBySurfaceId).forEach(([surfaceId, frames]) => {
      const normalized = normalizeId(surfaceId);
      if (!normalized) return;
      next.set(normalized, normalizeFrames(frames));
    });
    const changed = new Set<string>();
    this.framesBySurfaceId.forEach((frames, surfaceId) => {
      const replacement = next.get(surfaceId);
      if (!replacement || !sameFrames(frames, replacement)) {
        changed.add(surfaceId);
      }
    });
    next.forEach((frames, surfaceId) => {
      const current = this.framesBySurfaceId.get(surfaceId);
      if (!current || !sameFrames(current, frames)) changed.add(surfaceId);
    });
    const publication: PreparedSurfaceFramePublication = {
      framesBySurfaceId: Object.fromEntries(
        Array.from(next, ([surfaceId, frames]) => [
          surfaceId,
          cloneFrames(frames),
        ]),
      ),
    };
    this.preparedPublications.set(publication, {
      frames: next,
      changedSurfaceIds: Array.from(changed),
      revision: this.revision,
    });
    return publication;
  }

  assertImportFramesPublicationCurrent(
    publication: PreparedSurfaceFramePublication,
  ): void {
    this.requireCurrentPublication(publication);
  }

  publishImportFrames(
    publication: PreparedSurfaceFramePublication,
    options: { notify?: boolean } = {},
  ): void {
    const prepared = this.requireCurrentPublication(publication);
    this.preparedPublications.delete(publication);
    this.framesBySurfaceId.clear();
    prepared.frames.forEach((frames, surfaceId) =>
      this.framesBySurfaceId.set(surfaceId, frames),
    );
    if (prepared.changedSurfaceIds.length) this.revision += 1;
    this.reconcileActiveSurface();
    if (options.notify === false) {
      this.pendingPublicationNotifications.set(
        publication,
        prepared.changedSurfaceIds,
      );
      return;
    }
    prepared.changedSurfaceIds.forEach((surfaceId) => this.emit(surfaceId));
  }

  notifyImportFramesPublished(
    publication: PreparedSurfaceFramePublication,
  ): void {
    const surfaceIds = this.pendingPublicationNotifications.get(publication);
    if (!surfaceIds) {
      throw new Error(
        "Surface frame publication has no pending notifications.",
      );
    }
    this.pendingPublicationNotifications.delete(publication);
    surfaceIds.forEach((surfaceId) => this.emit(surfaceId));
  }

  listSurfaceIds(): string[] {
    return Array.from(this.framesBySurfaceId.keys());
  }

  onActiveSurfaceChange(
    listener: (event: ActiveSurfaceChangeEvent) => void,
  ): Disposable {
    this.activeSurfaceListeners.add(listener);
    return {
      dispose: () => {
        this.activeSurfaceListeners.delete(listener);
      },
    };
  }

  onAnyFramesChange(
    listener: (event: SurfaceFrameChangeEvent) => void,
  ): Disposable {
    this.anyListeners.add(listener);
    return {
      dispose: () => {
        this.anyListeners.delete(listener);
      },
    };
  }

  onFramesChange(
    surfaceId: string,
    listener: (event: SurfaceFrameChangeEvent) => void,
  ): Disposable {
    const normalized = normalizeId(surfaceId);
    if (!normalized) {
      throw new Error("SurfaceFrameService listener requires surfaceId.");
    }
    const listeners =
      this.listenersBySurfaceId.get(normalized) ??
      new Set<(event: SurfaceFrameChangeEvent) => void>();
    listeners.add(listener);
    this.listenersBySurfaceId.set(normalized, listeners);
    return {
      dispose: () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.listenersBySurfaceId.delete(normalized);
        }
      },
    };
  }

  setFrames(surfaceId: string, frames: SurfaceSceneFrames): void {
    const normalized = normalizeId(surfaceId);
    if (!normalized) {
      throw new Error("SurfaceFrameService requires surfaceId.");
    }
    const next = normalizeFrames(frames);
    const current = this.framesBySurfaceId.get(normalized);
    if (current && sameFrames(current, next)) return;
    this.framesBySurfaceId.set(normalized, next);
    this.revision += 1;
    this.emit(normalized);
  }

  private requireCurrentPublication(
    publication: PreparedSurfaceFramePublication,
  ) {
    const prepared = this.preparedPublications.get(publication);
    if (!prepared) {
      throw new Error(
        "Surface frame publication is invalid or already published.",
      );
    }
    if (prepared.revision !== this.revision) {
      throw new Error(
        "Surface frame publication is stale because frames changed after prepare.",
      );
    }
    return prepared;
  }

  private reconcileActiveSurface(): void {
    if (
      this.activeSurfaceId &&
      this.framesBySurfaceId.has(this.activeSurfaceId)
    ) {
      return;
    }
    this.setActiveSurfaceId(this.listSurfaceIds()[0] ?? null);
  }

  private setActiveSurfaceId(surfaceId: string | null): void {
    if (this.activeSurfaceId === surfaceId) return;
    this.activeSurfaceId = surfaceId;
    const event = { surfaceId };
    this.activeSurfaceListeners.forEach((listener) => listener(event));
  }

  private emit(surfaceId: string): void {
    const frames = this.framesBySurfaceId.get(surfaceId);
    const event = {
      surfaceId,
      frames: frames ? cloneFrames(frames) : null,
    };
    this.anyListeners.forEach((listener) => listener(event));
    this.listenersBySurfaceId
      .get(surfaceId)
      ?.forEach((listener) => listener(event));
  }
}

function sameFrames(
  left: SurfaceSceneFrames,
  right: SurfaceSceneFrames,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
