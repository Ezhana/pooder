import type Disposable from "./disposable";
import type { Service } from "./service";
import type { SceneFrameMm, SurfaceSceneFrames } from "./render";

export interface SurfaceFrameChangeEvent {
  surfaceId: string;
  frames: SurfaceSceneFrames | null;
}

export interface SurfaceFrameService extends Service {
  clear(): void;
  getFrames(surfaceId?: string): SurfaceSceneFrames | null;
  importFrames(framesBySurfaceId: Record<string, SurfaceSceneFrames>): void;
  listSurfaceIds(): string[];
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
    ...(frames.exportFrame ? { exportFrame: cloneFrame(frames.exportFrame) } : {}),
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
  private readonly listenersBySurfaceId = new Map<
    string,
    Set<(event: SurfaceFrameChangeEvent) => void>
  >();
  private readonly anyListeners = new Set<
    (event: SurfaceFrameChangeEvent) => void
  >();

  init(): void {}

  clear(): void {
    const previous = Array.from(this.framesBySurfaceId.keys());
    this.framesBySurfaceId.clear();
    previous.forEach((surfaceId) => this.emit(surfaceId));
  }

  getFrames(surfaceId?: string): SurfaceSceneFrames | null {
    const normalized = normalizeId(surfaceId);
    const key = normalized || this.listSurfaceIds()[0];
    if (!key) return null;
    const frames = this.framesBySurfaceId.get(key);
    return frames ? cloneFrames(frames) : null;
  }

  importFrames(framesBySurfaceId: Record<string, SurfaceSceneFrames>): void {
    this.clear();
    Object.entries(framesBySurfaceId).forEach(([surfaceId, frames]) => {
      this.setFrames(surfaceId, frames);
    });
  }

  listSurfaceIds(): string[] {
    return Array.from(this.framesBySurfaceId.keys()).sort();
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
    this.framesBySurfaceId.set(normalized, normalizeFrames(frames));
    this.emit(normalized);
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
