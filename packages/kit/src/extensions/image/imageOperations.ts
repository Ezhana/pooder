import type { FrameRect } from "../../shared/scene/frame";
import {
  getCoverScale as getCoverScaleFromRect,
  type SourceSize,
} from "../../shared/imaging/sourceSizeCache";

export interface ImageOperationArea {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface ImageOperationViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type ImageOperationAreaSpec =
  | { type: "frame" }
  | { type: "viewport" }
  | ({
      type: "custom";
    } & ImageOperationArea);

export type ImageOperation =
  | { type: "cover"; area?: ImageOperationAreaSpec }
  | { type: "contain"; area?: ImageOperationAreaSpec }
  | { type: "maximizeWidth"; area?: ImageOperationAreaSpec }
  | { type: "maximizeHeight"; area?: ImageOperationAreaSpec }
  | { type: "center"; area?: ImageOperationAreaSpec }
  | { type: "resetTransform" };

export interface ComputeImageOperationArgs {
  frame: FrameRect;
  source: SourceSize;
  operation: ImageOperation;
  area: ImageOperationArea;
}

function clampNormalizedAnchor(value: number): number {
  return Math.max(-1, Math.min(2, value));
}

function toNormalizedAnchor(center: number, start: number, size: number): number {
  return clampNormalizedAnchor((center - start) / Math.max(1, size));
}

function resolveAbsoluteScale(
  operation: ImageOperation,
  area: ImageOperationArea,
  source: SourceSize,
): number | null {
  const widthScale = Math.max(1, area.width) / Math.max(1, source.width);
  const heightScale = Math.max(1, area.height) / Math.max(1, source.height);

  switch (operation.type) {
    case "cover":
      return Math.max(widthScale, heightScale);
    case "contain":
      return Math.min(widthScale, heightScale);
    case "maximizeWidth":
      return widthScale;
    case "maximizeHeight":
      return heightScale;
    default:
      return null;
  }
}

export function resolveImageOperationArea(args: {
  frame: FrameRect;
  viewport: ImageOperationViewport;
  area?: ImageOperationAreaSpec;
}): ImageOperationArea {
  const spec = args.area || { type: "frame" };

  if (spec.type === "custom") {
    return {
      width: Math.max(1, spec.width),
      height: Math.max(1, spec.height),
      centerX: spec.centerX,
      centerY: spec.centerY,
    };
  }

  if (spec.type === "viewport") {
    return {
      width: Math.max(1, args.viewport.width),
      height: Math.max(1, args.viewport.height),
      centerX: args.viewport.left + args.viewport.width / 2,
      centerY: args.viewport.top + args.viewport.height / 2,
    };
  }

  return {
    width: Math.max(1, args.frame.width),
    height: Math.max(1, args.frame.height),
    centerX: args.frame.left + args.frame.width / 2,
    centerY: args.frame.top + args.frame.height / 2,
  };
}

export function computeImageOperationUpdates(
  args: ComputeImageOperationArgs,
): { scale?: number; left?: number; top?: number; angle?: number } {
  const { frame, source, operation, area } = args;

  if (operation.type === "resetTransform") {
    return {
      scale: 1,
      left: 0.5,
      top: 0.5,
      angle: 0,
    };
  }

  const left = toNormalizedAnchor(area.centerX, frame.left, frame.width);
  const top = toNormalizedAnchor(area.centerY, frame.top, frame.height);

  if (operation.type === "center") {
    return { left, top };
  }

  const absoluteScale = resolveAbsoluteScale(operation, area, source);
  const coverScale = getCoverScaleFromRect(frame, source);

  return {
    scale: Math.max(0.05, (absoluteScale || coverScale) / coverScale),
    left,
    top,
  };
}
