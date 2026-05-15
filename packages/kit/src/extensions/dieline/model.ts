import type { ConfigurationService } from "@pooder/core";
import { parseLengthToMm } from "../../units";
import {
  DEFAULT_DIELINE_SHAPE,
  DEFAULT_DIELINE_SHAPE_STYLE,
  normalizeShapeStyle,
  normalizeDielineShape,
} from "../dielineShape";
import type { DielineShape, DielineShapeStyle } from "../dielineShape";
import { readSizeState } from "../../shared/scene/scene-layout-model";
import type { DielineFeature } from "../geometry";

export interface DielineGeometry {
  shape: DielineShape;
  shapeStyle: DielineShapeStyle;
  unit: "px";
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  offset: number;
  borderLength?: number;
  scale?: number;
  strokeWidth?: number;
  pathData?: string;
  customSourceWidthPx?: number;
  customSourceHeightPx?: number;
}

export interface LineStyle {
  width: number;
  color: string;
  dashLength: number;
  style: "solid" | "dashed" | "hidden";
}

export interface DielineState {
  shape: DielineShape;
  shapeStyle: DielineShapeStyle;
  width: number;
  height: number;
  radius: number;
  offset: number;
  padding: number | string;
  mainLine: LineStyle;
  offsetLine: LineStyle;
  insideColor: string;
  showBleedLines: boolean;
  features: DielineFeature[];
  pathData?: string;
  customSourceWidthPx?: number;
  customSourceHeightPx?: number;
}

export function normalizeDielineConfigNamespace(
  namespace: string | undefined,
): string {
  const normalized = String(namespace || "dieline").trim();
  return normalized || "dieline";
}

export function getDielineConfigKey(
  namespace: string | undefined,
  path: string,
): string {
  return `${normalizeDielineConfigNamespace(namespace)}.${path}`;
}

export function createDefaultDielineState(): DielineState {
  return {
    shape: DEFAULT_DIELINE_SHAPE,
    shapeStyle: { ...DEFAULT_DIELINE_SHAPE_STYLE },
    width: 500,
    height: 500,
    radius: 0,
    offset: 0,
    padding: 140,
    mainLine: {
      width: 2.7,
      color: "#FF0000",
      dashLength: 5,
      style: "solid",
    },
    offsetLine: {
      width: 2.7,
      color: "#FF0000",
      dashLength: 5,
      style: "solid",
    },
    insideColor: "rgba(0,0,0,0)",
    showBleedLines: true,
    features: [],
  };
}

export function readDielineState(
  configService: ConfigurationService,
  fallback?: Partial<DielineState>,
  namespace?: string,
): DielineState {
  const base = createDefaultDielineState();
  if (fallback) {
    Object.assign(base, fallback);
    if (fallback.mainLine) {
      base.mainLine = { ...base.mainLine, ...fallback.mainLine };
    }
    if (fallback.offsetLine) {
      base.offsetLine = { ...base.offsetLine, ...fallback.offsetLine };
    }
    if (fallback.shapeStyle) {
      base.shapeStyle = normalizeShapeStyle(
        fallback.shapeStyle,
        base.shapeStyle,
      );
    }
  }

  const sizeState = readSizeState(configService);
  const configKey = (path: string) => getDielineConfigKey(namespace, path);
  const sourceWidth = Number(
    configService.get(configKey("customSourceWidthPx"), 0),
  );
  const sourceHeight = Number(
    configService.get(configKey("customSourceHeightPx"), 0),
  );

  return {
    ...base,
    shape: normalizeDielineShape(
      configService.get(configKey("shape"), base.shape),
      base.shape,
    ),
    shapeStyle: normalizeShapeStyle(
      configService.get(configKey("shapeStyle"), base.shapeStyle),
      base.shapeStyle,
    ),
    width: sizeState.sceneFrames.productionFrame.widthMm,
    height: sizeState.sceneFrames.productionFrame.heightMm,
    radius: parseLengthToMm(
      configService.get(configKey("radius"), base.radius),
      "mm",
    ),
    padding: sizeState.viewPadding,
    offset:
      sizeState.cutMode === "outset"
        ? sizeState.cutMarginMm
        : sizeState.cutMode === "inset"
          ? -sizeState.cutMarginMm
          : 0,
    mainLine: {
      width: configService.get(configKey("strokeWidth"), base.mainLine.width),
      color: configService.get(configKey("strokeColor"), base.mainLine.color),
      dashLength: configService.get(
        configKey("dashLength"),
        base.mainLine.dashLength,
      ),
      style: configService.get(configKey("style"), base.mainLine.style),
    },
    offsetLine: {
      width: configService.get(
        configKey("offsetStrokeWidth"),
        base.offsetLine.width,
      ),
      color: configService.get(
        configKey("offsetStrokeColor"),
        base.offsetLine.color,
      ),
      dashLength: configService.get(
        configKey("offsetDashLength"),
        base.offsetLine.dashLength,
      ),
      style: configService.get(configKey("offsetStyle"), base.offsetLine.style),
    },
    insideColor: configService.get(configKey("insideColor"), base.insideColor),
    showBleedLines: configService.get(
      configKey("showBleedLines"),
      base.showBleedLines,
    ),
    features: configService.get(configKey("features"), base.features),
    pathData: configService.get(configKey("pathData"), base.pathData),
    customSourceWidthPx:
      Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : undefined,
    customSourceHeightPx:
      Number.isFinite(sourceHeight) && sourceHeight > 0
        ? sourceHeight
        : undefined,
  };
}
