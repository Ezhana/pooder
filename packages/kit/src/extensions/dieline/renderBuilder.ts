import type { Pattern } from "fabric";
import type { RenderEffectSpec, RenderObjectSpec, VisibilityExpr } from "../../services";
import type { SceneLayoutSnapshot } from "../../shared/scene/sceneLayoutModel";
import { generateBleedZonePath, generateDielinePath } from "../geometry";
import { IMAGE_OBJECT_LAYER_ID } from "../../shared/constants/layers";
import type { DielineState } from "./model";

interface DielineRenderIds {
  inside: string;
  bleedZone: string;
  offsetBorder: string;
  border: string;
  clip: string;
  clipSource: string;
}

export interface DielineRenderBundle {
  specs: RenderObjectSpec[];
  effects: RenderEffectSpec[];
}

export interface DielineRenderOptions {
  state: DielineState;
  sceneLayout: SceneLayoutSnapshot;
  canvasWidth: number;
  canvasHeight: number;
  hasImages: boolean;
  ids?: Partial<DielineRenderIds>;
  createHatchPattern?: (color: string) => Pattern | undefined;
  includeImageClipEffect?: boolean;
  clipTargetPassIds?: string[];
  clipVisibility?: VisibilityExpr;
}

const DEFAULT_IDS: DielineRenderIds = {
  inside: "dieline.inside",
  bleedZone: "dieline.bleed-zone",
  offsetBorder: "dieline.offset-border",
  border: "dieline.border",
  clip: "dieline.clip.image",
  clipSource: "dieline.effect.clip-path",
};

function scaleFeatures(state: DielineState, scale: number) {
  return (state.features || []).map((feature) => ({
    ...feature,
    x: feature.x,
    y: feature.y,
    width: (feature.width || 0) * scale,
    height: (feature.height || 0) * scale,
    radius: (feature.radius || 0) * scale,
  }));
}

export function buildDielineRenderBundle(
  options: DielineRenderOptions,
): DielineRenderBundle {
  const ids = { ...DEFAULT_IDS, ...(options.ids || {}) };
  const {
    state,
    sceneLayout,
    canvasWidth,
    canvasHeight,
    hasImages,
    createHatchPattern,
    includeImageClipEffect = true,
    clipTargetPassIds = [IMAGE_OBJECT_LAYER_ID],
    clipVisibility,
  } = options;
  const { shape, shapeStyle, radius, mainLine, offsetLine, insideColor } = state;

  const scale = sceneLayout.scale;
  const cx = sceneLayout.trimRect.centerX;
  const cy = sceneLayout.trimRect.centerY;
  const visualWidth = sceneLayout.trimRect.width;
  const visualHeight = sceneLayout.trimRect.height;
  const visualRadius = radius * scale;
  const cutW = sceneLayout.cutRect.width;
  const cutH = sceneLayout.cutRect.height;
  const visualOffset = (cutW - visualWidth) / 2;
  const cutR =
    visualRadius === 0 ? 0 : Math.max(0, visualRadius + visualOffset);
  const absoluteFeatures = scaleFeatures(state, scale);
  const cutFeatures = absoluteFeatures.filter((feature) => !feature.skipCut);

  const common = {
    shape,
    shapeStyle,
    pathData: state.pathData,
    customSourceWidthPx: state.customSourceWidthPx,
    customSourceHeightPx: state.customSourceHeightPx,
    canvasWidth,
    canvasHeight,
  };

  const specs: RenderObjectSpec[] = [];

  if (
    insideColor &&
    insideColor !== "transparent" &&
    insideColor !== "rgba(0,0,0,0)" &&
    !hasImages
  ) {
    specs.push({
      id: ids.inside,
      type: "path",
      space: "screen",
      data: { id: ids.inside, type: "dieline" },
      props: {
        pathData: generateDielinePath({
          ...common,
          width: cutW,
          height: cutH,
          radius: cutR,
          x: cx,
          y: cy,
          features: cutFeatures,
        }),
        fill: insideColor,
        stroke: null,
        selectable: false,
        evented: false,
        originX: "left",
        originY: "top",
      },
    });
  }

  if (Math.abs(visualOffset) > 0.0001) {
    const trimPathInput = {
      ...common,
      width: visualWidth,
      height: visualHeight,
      radius: visualRadius,
      x: cx,
      y: cy,
      features: cutFeatures,
    };
    const cutPathInput = {
      ...common,
      width: cutW,
      height: cutH,
      radius: cutR,
      x: cx,
      y: cy,
      features: cutFeatures,
    };

    if (state.showBleedLines !== false) {
      const pattern = createHatchPattern?.(mainLine.color);
      if (pattern) {
        specs.push({
          id: ids.bleedZone,
          type: "path",
          space: "screen",
          data: { id: ids.bleedZone, type: "dieline" },
          props: {
            pathData: generateBleedZonePath(
              trimPathInput,
              cutPathInput,
              visualOffset,
            ),
            fill: pattern,
            stroke: null,
            selectable: false,
            evented: false,
            objectCaching: false,
            originX: "left",
            originY: "top",
          },
        });
      }
    }

    specs.push({
      id: ids.offsetBorder,
      type: "path",
      space: "screen",
      data: { id: ids.offsetBorder, type: "dieline" },
      props: {
        pathData: generateDielinePath(cutPathInput),
        fill: null,
        stroke: offsetLine.style === "hidden" ? null : offsetLine.color,
        strokeWidth: offsetLine.width,
        strokeDashArray:
          offsetLine.style === "dashed"
            ? [offsetLine.dashLength, offsetLine.dashLength]
            : undefined,
        selectable: false,
        evented: false,
        originX: "left",
        originY: "top",
      },
    });
  }

  specs.push({
    id: ids.border,
    type: "path",
    space: "screen",
    data: { id: ids.border, type: "dieline" },
    props: {
      pathData: generateDielinePath({
        ...common,
        width: visualWidth,
        height: visualHeight,
        radius: visualRadius,
        x: cx,
        y: cy,
        features: absoluteFeatures,
      }),
      fill: "transparent",
      stroke: mainLine.style === "hidden" ? null : mainLine.color,
      strokeWidth: mainLine.width,
      strokeDashArray:
        mainLine.style === "dashed"
          ? [mainLine.dashLength, mainLine.dashLength]
          : undefined,
      selectable: false,
      evented: false,
      originX: "left",
      originY: "top",
    },
  });

  if (!includeImageClipEffect) {
    return { specs, effects: [] };
  }

  const clipPathData = generateDielinePath({
    ...common,
    width: cutW,
    height: cutH,
    radius: cutR,
    x: cx,
    y: cy,
    features: cutFeatures,
  });

  if (!clipPathData) {
    return { specs, effects: [] };
  }

  return {
    specs,
    effects: [
      {
        type: "clipPath",
        id: ids.clip,
        visibility: clipVisibility,
        targetPassIds: clipTargetPassIds,
        source: {
          id: ids.clipSource,
          type: "path",
          space: "screen",
          data: {
            id: ids.clipSource,
            type: "dieline-effect",
            effect: "clipPath",
          },
          props: {
            pathData: clipPathData,
            fill: "#000000",
            stroke: null,
            originX: "left",
            originY: "top",
            selectable: false,
            evented: false,
            excludeFromExport: true,
          },
        },
      },
    ],
  };
}
