import type Disposable from "./disposable";
import type { SceneId } from "./scene";
import type { Service } from "./service";

export interface SceneRect {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface SceneLayoutSnapshot {
  sceneId: SceneId;
  revision: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Screen-space projection of `surface.bounds` after contain-fit. */
  viewRect: SceneRect;
}

export interface SceneLayoutService extends Service {
  getLayout(sceneId: SceneId): SceneLayoutSnapshot | null;
  recomputeLayout(sceneId: SceneId): SceneLayoutSnapshot | null;
  invalidateLayout(sceneId: SceneId): void;
  onLayoutChange(
    sceneId: SceneId,
    listener: (layout: SceneLayoutSnapshot | null) => void,
  ): Disposable;
}
