import type { ConfigurationService } from "@pooder/core";
import {
  type CanvasService,
  type RenderLayoutRect,
} from "@pooder/core";
import { computeSceneLayout, readSizeState } from "./scene-layout-model";

export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function emptyFrameRect(): FrameRect {
  return { left: 0, top: 0, width: 0, height: 0 };
}

function sceneFrameToRect(frame: {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}): FrameRect {
  return {
    left: frame.xMm,
    top: frame.yMm,
    width: frame.widthMm,
    height: frame.heightMm,
  };
}

export function resolvePreviewFrameRect(
  configService?: ConfigurationService,
): FrameRect {
  if (!configService) {
    return emptyFrameRect();
  }

  return sceneFrameToRect(readSizeState(configService).sceneFrames.previewBounds);
}

export function resolveSurfaceFrameRect(
  canvasService?: CanvasService,
  configService?: ConfigurationService,
): FrameRect {
  if (!canvasService || !configService) {
    return emptyFrameRect();
  }

  const sizeState = readSizeState(configService);
  const layout = computeSceneLayout(canvasService, sizeState);
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
