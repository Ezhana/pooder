import type { CapabilityDefinition } from "@pooder/core";
import type { MaskMode } from "../maskOps";
import type { ImageTraceOptions } from "../tracer";

export const EDGE_DETECTION_CAPABILITY_ID = "pooder.kit.edge-detection";

export interface DetectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectEdgeOptions {
  expand?: number;
  smoothing?: boolean;
  simplifyTolerance?: number;
  threshold?: number;
  maxTraceDimension?: number;
  maskMode?: MaskMode;
  debug?: boolean;
}

export interface DetectEdgeResult {
  pathData: string;
  rawBounds?: DetectBounds;
  baseBounds?: DetectBounds;
  imageWidth?: number;
  imageHeight?: number;
}

export interface EdgeDetectionCapabilityApi {
  detectEdge(
    imageUrl: string,
    options?: DetectEdgeOptions,
  ): Promise<DetectEdgeResult>;
}

function normalizeTraceOptions(
  options: DetectEdgeOptions = {},
): ImageTraceOptions {
  return {
    expand: options.expand ?? 0,
    smoothing: options.smoothing ?? true,
    simplifyTolerance: options.simplifyTolerance ?? 2,
    threshold: options.threshold,
    maxTraceDimension: options.maxTraceDimension,
    maskMode: options.maskMode,
    debug: options.debug === true,
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => resolve(img);
    img.onerror = (error) => reject(error);
    img.src = url;
  });
}

export async function detectImageEdge(
  imageUrl: string,
  options: DetectEdgeOptions = {},
): Promise<DetectEdgeResult> {
  try {
    const tracerOptions = normalizeTraceOptions(options);
    const [img, traced] = await Promise.all([
      loadImage(imageUrl),
      import("../tracer").then(({ ImageTracer }) =>
        ImageTracer.traceWithBounds(imageUrl, tracerOptions),
      ),
    ]);
    const { pathData, baseBounds, bounds } = traced;

    if (tracerOptions.debug) {
      console.info("[EdgeDetectionCapability] detectEdge", {
        imageWidth: img.width,
        imageHeight: img.height,
        baseBounds,
        expandedBounds: bounds,
        options: tracerOptions,
        strategy: "single-connected-silhouette",
      });
    }

    return {
      pathData,
      rawBounds: bounds,
      baseBounds,
      imageWidth: img.width,
      imageHeight: img.height,
    };
  } catch (error) {
    console.error("Edge detection failed", error);
    throw error;
  }
}

export function createEdgeDetectionCapabilityDefinition(
  facade: EdgeDetectionCapabilityApi,
  options: { capabilityId?: string } = {},
): CapabilityDefinition<EdgeDetectionCapabilityApi> {
  return {
    id: options.capabilityId || EDGE_DETECTION_CAPABILITY_ID,
    metadata: {
      name: "Edge Detection",
      description:
        "Detect image silhouettes and return SVG path geometry without " +
        "mutating dieline state.",
      tags: ["kit", "edge", "dieline"],
    },
    commands: [{ id: "detectEdge", title: "Detect Edge" }],
    facade,
  };
}
