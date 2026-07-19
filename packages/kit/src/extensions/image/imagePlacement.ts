import { resolveImageGeometry, type ImageFitMode } from "@pooder/core";
import type { FrameRect } from "../../shared/scene/frame";
import type { SourceSize } from "../../shared/imaging/sourceSizeCache";

export interface ImagePlacementState {
  left: number;
  top: number;
  scale: number;
  angle: number;
}

export interface ImagePlacementValidationArgs {
  frame: FrameRect;
  source: SourceSize;
  fit: ImageFitMode;
  placement: ImagePlacementState;
}

export interface ImagePlacementValidationResult {
  ok: boolean;
}

function toRadians(angle: number): number {
  return (angle * Math.PI) / 180;
}

export function validateImagePlacement(
  args: ImagePlacementValidationArgs,
): ImagePlacementValidationResult {
  const { frame, source, fit, placement } = args;
  if (
    frame.width <= 0 ||
    frame.height <= 0 ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    return { ok: true };
  }

  const geometry = resolveImageGeometry({
    source: { src: "", size: source },
    frame,
    fit,
    transform: {
      anchorX: placement.left,
      anchorY: placement.top,
      zoom: placement.scale,
      rotation: placement.angle,
    },
  });
  const imageWidth = source.width * Math.abs(geometry.scaleX);
  const imageHeight = source.height * Math.abs(geometry.scaleY);

  if (imageWidth <= 0 || imageHeight <= 0) {
    return { ok: true };
  }

  const centerX = geometry.left;
  const centerY = geometry.top;
  const halfWidth = imageWidth / 2;
  const halfHeight = imageHeight / 2;
  const radians = toRadians(geometry.angle);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const frameCorners = [
    { x: frame.left, y: frame.top },
    { x: frame.left + frame.width, y: frame.top },
    { x: frame.left + frame.width, y: frame.top + frame.height },
    { x: frame.left, y: frame.top + frame.height },
  ];

  const coversFrame = frameCorners.every((corner) => {
    const dx = corner.x - centerX;
    const dy = corner.y - centerY;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    return (
      Math.abs(localX) <= halfWidth + 1e-6 &&
      Math.abs(localY) <= halfHeight + 1e-6
    );
  });

  return { ok: coversFrame };
}
