import type { RenderObjectSpec } from "@pooder/core";
import type {
  SceneLayoutSnapshot,
  SceneRect,
} from "../../shared/scene/scene-layout-model";

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

function buildRectPath(width: number, height: number): string {
  return `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`;
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

export function buildImageSessionOverlaySpecs(args: {
  viewport: ImageSessionOverlayViewport;
  layout: SceneLayoutSnapshot;
  visual: ImageSessionOverlayVisualConfig;
}): RenderObjectSpec[] {
  const { viewport, layout, visual } = args;
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
