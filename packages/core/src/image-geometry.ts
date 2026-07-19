export type ImageFitMode = "cover" | "contain" | "stretch";

export const IMAGE_GEOMETRY_DATA_KEY = "imageGeometry";

export interface ImageSourceSize {
  width: number;
  height: number;
}

export interface ImageGeometryFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ImageGeometryTransform {
  anchorX?: number;
  anchorY?: number;
  zoom?: number;
  rotation?: number;
  opacity?: number;
}

export interface ImageGeometryDescriptor {
  source: {
    src: string;
    size?: ImageSourceSize;
  };
  frame: ImageGeometryFrame;
  fit: ImageFitMode;
  transform?: ImageGeometryTransform;
  clip?: ImageGeometryFrame;
}

export interface ResolvedImageGeometry {
  width: number;
  height: number;
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  opacity: number;
  originX: "center";
  originY: "center";
  clip?: ImageGeometryFrame;
}

const finiteNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const positiveNumber = (value: unknown, fallback: number): number =>
  Math.max(Number.EPSILON, finiteNumber(value, fallback));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function normalizeImageGeometryDescriptor(
  value: unknown,
): ImageGeometryDescriptor | null {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.frame)) {
    return null;
  }
  const src =
    typeof value.source.src === "string" ? value.source.src.trim() : "";
  const width = finiteNumber(value.frame.width, 0);
  const height = finiteNumber(value.frame.height, 0);
  if (!src || width <= 0 || height <= 0) return null;
  const sourceWidth = isRecord(value.source.size)
    ? finiteNumber(value.source.size.width, 0)
    : 0;
  const sourceHeight = isRecord(value.source.size)
    ? finiteNumber(value.source.size.height, 0)
    : 0;
  const fit: ImageFitMode =
    value.fit === "contain" || value.fit === "stretch" ? value.fit : "cover";
  const transform = isRecord(value.transform) ? value.transform : {};
  const clip = isRecord(value.clip) ? value.clip : null;

  return {
    source: {
      src,
      ...(sourceWidth > 0 && sourceHeight > 0
        ? { size: { width: sourceWidth, height: sourceHeight } }
        : {}),
    },
    frame: {
      left: finiteNumber(value.frame.left, 0),
      top: finiteNumber(value.frame.top, 0),
      width,
      height,
    },
    fit,
    transform: {
      anchorX: finiteNumber(transform.anchorX, 0.5),
      anchorY: finiteNumber(transform.anchorY, 0.5),
      zoom: Math.max(0.05, finiteNumber(transform.zoom, 1)),
      rotation: finiteNumber(transform.rotation, 0),
      opacity: finiteNumber(transform.opacity, 1),
    },
    ...(clip
      ? {
          clip: {
            left: finiteNumber(clip.left, 0),
            top: finiteNumber(clip.top, 0),
            width: positiveNumber(clip.width, width),
            height: positiveNumber(clip.height, height),
          },
        }
      : {}),
  };
}

export function resolveImageFitScale(
  frame: Pick<ImageGeometryFrame, "width" | "height">,
  source: ImageSourceSize,
  fit: ImageFitMode,
): { x: number; y: number } {
  const widthScale =
    positiveNumber(frame.width, 1) / positiveNumber(source.width, 1);
  const heightScale =
    positiveNumber(frame.height, 1) / positiveNumber(source.height, 1);

  if (fit === "stretch") {
    return { x: widthScale, y: heightScale };
  }

  const scale =
    fit === "contain"
      ? Math.min(widthScale, heightScale)
      : Math.max(widthScale, heightScale);
  return { x: scale, y: scale };
}

export function resolveImageGeometry(
  descriptor: ImageGeometryDescriptor,
  sourceSize: ImageSourceSize = descriptor.source.size ?? {
    width: 1,
    height: 1,
  },
): ResolvedImageGeometry {
  const source = {
    width: positiveNumber(sourceSize.width, 1),
    height: positiveNumber(sourceSize.height, 1),
  };
  const frame = {
    left: finiteNumber(descriptor.frame.left, 0),
    top: finiteNumber(descriptor.frame.top, 0),
    width: positiveNumber(descriptor.frame.width, 1),
    height: positiveNumber(descriptor.frame.height, 1),
  };
  const transform = descriptor.transform ?? {};
  const zoom = Math.max(0.05, finiteNumber(transform.zoom, 1));
  const fitScale = resolveImageFitScale(frame, source, descriptor.fit);

  return {
    width: source.width,
    height: source.height,
    left: frame.left + finiteNumber(transform.anchorX, 0.5) * frame.width,
    top: frame.top + finiteNumber(transform.anchorY, 0.5) * frame.height,
    scaleX: fitScale.x * zoom,
    scaleY: fitScale.y * zoom,
    angle: finiteNumber(transform.rotation, 0),
    opacity: finiteNumber(transform.opacity, 1),
    originX: "center",
    originY: "center",
    ...(descriptor.clip ? { clip: { ...descriptor.clip } } : {}),
  };
}
