import type { RenderObjectSpec, RenderPatternSpec } from "@pooder/core";
import type {
  SceneGeometrySnapshot,
  SceneLayoutSnapshot,
  SceneRect,
} from "../../shared/scene/scene-layout-model";
import { generateDielinePath } from "../geometry";

export interface ImageSessionOverlayVisualConfig {
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "hidden";
  dashLength: number;
  innerBackground: string;
  outerBackground: string;
}

export interface ImageSessionOverlayViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface BuiltinShapeOverlayPaths {
  hatchPathData: string;
  shapePathData: string;
}

const EPSILON = 0.0001;
const SHAPE_OUTLINE_COLOR = "rgba(255, 0, 0, 0.9)";
const DEFAULT_HATCH_FILL = "rgba(255, 0, 0, 0.22)";

function buildRectPath(width: number, height: number): string {
  return `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`;
}

function buildAbsoluteRectPath(rect: SceneRect): string {
  return `M ${rect.left} ${rect.top} L ${rect.left + rect.width} ${rect.top} L ${
    rect.left + rect.width
  } ${rect.top + rect.height} L ${rect.left} ${rect.top + rect.height} Z`;
}

function buildViewportMaskPath(
  viewport: ImageSessionOverlayViewport,
  cutRect: SceneRect,
): string {
  const cutLeft = cutRect.left - viewport.left;
  const cutTop = cutRect.top - viewport.top;
  return [
    buildRectPath(viewport.width, viewport.height),
    `M ${cutLeft} ${cutTop} L ${cutLeft + cutRect.width} ${cutTop} L ${
      cutLeft + cutRect.width
    } ${cutTop + cutRect.height} L ${cutLeft} ${cutTop + cutRect.height} Z`,
  ].join(" ");
}

function resolveDielineShapeRadiusPx(geometry: SceneGeometrySnapshot): number {
  const visualRadius = Number.isFinite(geometry.radius)
    ? Math.max(0, geometry.radius)
    : 0;
  const maxRadius = Math.max(0, Math.min(geometry.width, geometry.height) / 2);
  return Math.max(0, Math.min(maxRadius, visualRadius));
}

function buildBuiltinShapeOverlayPaths(
  layout: SceneLayoutSnapshot,
  geometry: SceneGeometrySnapshot | null,
): BuiltinShapeOverlayPaths | null {
  if (!geometry || geometry.shape === "custom") {
    return null;
  }

  const radius = resolveDielineShapeRadiusPx(geometry);
  if (geometry.shape === "rect" && radius <= EPSILON) {
    return null;
  }

  const shapePathData = generateDielinePath({
    shape: geometry.shape,
    shapeStyle: geometry.shapeStyle,
    width: Math.max(1, geometry.width),
    height: Math.max(1, geometry.height),
    radius,
    x: geometry.x,
    y: geometry.y,
    features: [],
    canvasWidth: layout.canvasWidth,
    canvasHeight: layout.canvasHeight,
  });
  if (!shapePathData) {
    return null;
  }

  return {
    shapePathData,
    hatchPathData: `${buildAbsoluteRectPath(layout.cutRect)} ${shapePathData}`,
  };
}

export function buildImageSessionOverlaySpecs(args: {
  viewport: ImageSessionOverlayViewport;
  layout: SceneLayoutSnapshot;
  geometry: SceneGeometrySnapshot | null;
  visual: ImageSessionOverlayVisualConfig;
  hatchPattern?: RenderPatternSpec;
}): RenderObjectSpec[] {
  const { viewport, layout, geometry, visual, hatchPattern } = args;
  const cutRect = layout.cutRect;
  const specs: RenderObjectSpec[] = [];

  specs.push({
    id: "image.cropMask.rect",
    type: "path",
    space: "screen",
    data: { id: "image.cropMask.rect", zIndex: 1 },
    props: {
      pathData: buildViewportMaskPath(viewport, cutRect),
      left: viewport.left,
      top: viewport.top,
      originX: "left",
      originY: "top",
      fill: visual.outerBackground,
      stroke: null,
      fillRule: "evenodd",
      selectable: false,
      evented: false,
      excludeFromExport: true,
      objectCaching: false,
    },
  });

  const shapeOverlay = buildBuiltinShapeOverlayPaths(layout, geometry);
  if (shapeOverlay) {
    specs.push({
      id: "image.cropShapeHatch",
      type: "path",
      space: "screen",
      data: { id: "image.cropShapeHatch", zIndex: 5 },
      props: {
        pathData: shapeOverlay.hatchPathData,
        originX: "left",
        originY: "top",
        fill: hatchPattern || DEFAULT_HATCH_FILL,
        opacity: hatchPattern ? 1 : 0.8,
        stroke: null,
        fillRule: "evenodd",
        selectable: false,
        evented: false,
        excludeFromExport: true,
        objectCaching: false,
      },
    });
    specs.push({
      id: "image.cropShapeOutline",
      type: "path",
      space: "screen",
      data: { id: "image.cropShapeOutline", zIndex: 6 },
      props: {
        pathData: shapeOverlay.shapePathData,
        originX: "left",
        originY: "top",
        fill: "transparent",
        stroke: SHAPE_OUTLINE_COLOR,
        strokeWidth: 1,
        selectable: false,
        evented: false,
        excludeFromExport: true,
        objectCaching: false,
      },
    });
  }

  specs.push({
    id: "image.cropFrame",
    type: "rect",
    space: "screen",
    data: { id: "image.cropFrame", zIndex: 7 },
    props: {
      left: cutRect.left,
      top: cutRect.top,
      width: cutRect.width,
      height: cutRect.height,
      originX: "left",
      originY: "top",
      fill: visual.innerBackground,
      stroke:
        visual.strokeStyle === "hidden" ? "rgba(0,0,0,0)" : visual.strokeColor,
      strokeWidth: visual.strokeStyle === "hidden" ? 0 : visual.strokeWidth,
      strokeDashArray:
        visual.strokeStyle === "dashed"
          ? [visual.dashLength, visual.dashLength]
          : undefined,
      selectable: false,
      evented: false,
      excludeFromExport: true,
    },
  });

  return specs;
}
