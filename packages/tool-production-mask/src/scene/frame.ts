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

export function resolveSceneFrameRect(
  sceneId: string,
  canvasService?: CanvasService,
  sceneLayoutService?: SceneLayoutService,
): FrameRect {
  if (!canvasService || !sceneLayoutService) {
    return emptyFrameRect();
  }

  const layout = sceneLayoutService.getLayout(sceneId);
  if (!layout) {
    return emptyFrameRect();
  }

  return canvasService.toSceneRect({
    space: "screen",
    left: layout.contentRect.left,
    top: layout.contentRect.top,
    width: layout.contentRect.width,
    height: layout.contentRect.height,
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
