import type {
  RenderEffectSpec,
  RenderObjectSpec,
  RenderPatternSpec,
  RuntimeConditionExpr,
} from "@pooder/core";
import type { SceneLayoutSnapshot } from "../../shared/scene/scene-layout-model";
import { generateBleedZonePath, generateDielinePath } from "../geometry";
import {
  projectPlacedFeatures,
  resolveFeaturePlacements,
} from "../featurePlacement";
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
  createHatchPattern?: (color: string) => RenderPatternSpec | undefined;
  includeImageClipEffect?: boolean;
  clipActiveWhen?: RuntimeConditionExpr;
}

export interface DielineClipSourceOptions {
  state: DielineState;
  sceneLayout: SceneLayoutSnapshot;
  canvasWidth: number;
  canvasHeight: number;
  id?: string;
}

const DEFAULT_IDS: DielineRenderIds = {
  inside: "dieline.inside",
  bleedZone: "dieline.bleed-zone",
  offsetBorder: "dieline.offset-border",
  border: "dieline.border",
  clip: "dieline.clip.image",
  clipSource: "dieline.effect.clip-path",
};

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
    clipActiveWhen,
  } = options;
  const { shape, shapeStyle, radius, mainLine, offsetLine, insideColor } =
    state;

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
  const placements = resolveFeaturePlacements(state.features || [], {
    shape,
    shapeStyle,
    pathData: state.pathData,
    customSourceWidthPx: state.customSourceWidthPx,
    customSourceHeightPx: state.customSourceHeightPx,
    canvasWidth,
    canvasHeight,
    x: cx,
    y: cy,
    width: visualWidth,
    height: visualHeight,
    radius: visualRadius,
    scale,
  });
  const absoluteFeatures = projectPlacedFeatures(
    placements,
    {
      x: cx,
      y: cy,
      width: visualWidth,
      height: visualHeight,
    },
    scale,
  );
  const cutFeatures = projectPlacedFeatures(
    placements.filter((placement) => !placement.feature.skipCut),
    {
      x: cx,
      y: cy,
      width: cutW,
      height: cutH,
    },
    scale,
  );

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

  const clipSource = buildDielineClipSourceSpec({
    state,
    sceneLayout,
    canvasWidth,
    canvasHeight,
    id: ids.clipSource,
  });

  if (!clipSource) {
    return { specs, effects: [] };
  }

  return {
    specs,
    effects: [
      {
        type: "clipPath",
        id: ids.clip,
        activeWhen: clipActiveWhen,
        source: clipSource,
        coordinateMode: "absolute",
      },
    ],
  };
}

export function buildDielineGuideRenderSpecs(
  options: DielineRenderOptions,
): RenderObjectSpec[] {
  return buildDielineRenderBundle({
    ...options,
    includeImageClipEffect: false,
  }).specs;
}

export function buildDielineClipSourceSpec(
  options: DielineClipSourceOptions,
): RenderObjectSpec | null {
  const { state, sceneLayout, canvasWidth, canvasHeight } = options;
  const scale = sceneLayout.scale;
  const cx = sceneLayout.trimRect.centerX;
  const cy = sceneLayout.trimRect.centerY;
  const visualWidth = sceneLayout.trimRect.width;
  const visualHeight = sceneLayout.trimRect.height;
  const visualRadius = state.radius * scale;
  const cutW = sceneLayout.cutRect.width;
  const cutH = sceneLayout.cutRect.height;
  const visualOffset = (cutW - visualWidth) / 2;
  const cutR =
    visualRadius === 0 ? 0 : Math.max(0, visualRadius + visualOffset);
  const placements = resolveFeaturePlacements(state.features || [], {
    shape: state.shape,
    shapeStyle: state.shapeStyle,
    pathData: state.pathData,
    customSourceWidthPx: state.customSourceWidthPx,
    customSourceHeightPx: state.customSourceHeightPx,
    canvasWidth,
    canvasHeight,
    x: cx,
    y: cy,
    width: visualWidth,
    height: visualHeight,
    radius: visualRadius,
    scale,
  });
  const cutFeatures = projectPlacedFeatures(
    placements.filter((placement) => !placement.feature.skipCut),
    {
      x: cx,
      y: cy,
      width: cutW,
      height: cutH,
    },
    scale,
  );
  const clipPathData = generateDielinePath({
    shape: state.shape,
    shapeStyle: state.shapeStyle,
    pathData: state.pathData,
    customSourceWidthPx: state.customSourceWidthPx,
    customSourceHeightPx: state.customSourceHeightPx,
    canvasWidth,
    canvasHeight,
    width: cutW,
    height: cutH,
    radius: cutR,
    x: cx,
    y: cy,
    features: cutFeatures,
  });
  if (!clipPathData) return null;

  const id = String(options.id || DEFAULT_IDS.clipSource).trim();
  return {
    id: id || DEFAULT_IDS.clipSource,
    type: "path",
    space: "screen",
    data: {
      id: id || DEFAULT_IDS.clipSource,
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
  };
}
