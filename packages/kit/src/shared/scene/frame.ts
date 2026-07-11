import {
  type CanvasService,
  type RenderLayoutRect,
  type SceneLayoutService,
} from "@pooder/core";

export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function emptyFrameRect(): FrameRect {
  return { left: 0, top: 0, width: 0, height: 0 };
}

export function resolveSurfaceFrameRect(
  canvasService?: CanvasService,
  sceneLayoutService?: SceneLayoutService,
): FrameRect {
  if (!canvasService || !sceneLayoutService) {
    return emptyFrameRect();
  }

  const layout = sceneLayoutService.getLayout();
  if (!layout) {
    return emptyFrameRect();
  }

  return canvasService.toSceneRect({
    left: layout.cutRect.left,
    top: layout.cutRect.top,
    width: layout.cutRect.width,
    height: layout.cutRect.height,
  });
}

export function toLayoutSceneRect(rect: FrameRect): RenderLayoutRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    space: "scene",
  };
}
