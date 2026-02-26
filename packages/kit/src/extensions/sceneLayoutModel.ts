import type { ConfigurationService } from "@pooder/core";
import type { CanvasService } from "../services";
import { Coordinate, Unit } from "../coordinate";
import { parseLengthToMm } from "../units";

export type SizeConstraintMode = "free" | "lockAspect" | "equal";
export type CutMode = "trim" | "outset" | "inset";

export interface SizeState {
  unit: Unit;
  actualWidthMm: number;
  actualHeightMm: number;
  constraintMode: SizeConstraintMode;
  aspectRatio: number;
  cutMode: CutMode;
  cutMarginMm: number;
  viewPadding: number | string;
  minMm: number;
  maxMm: number;
  stepMm: number;
}

export interface SceneRect {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface SceneLayoutSnapshot {
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
  trimRect: SceneRect;
  cutRect: SceneRect;
  bleedRect: SceneRect;
  trimWidthMm: number;
  trimHeightMm: number;
  cutWidthMm: number;
  cutHeightMm: number;
  cutMode: CutMode;
  cutMarginMm: number;
}

export interface SceneGeometrySnapshot {
  shape: "rect" | "circle" | "ellipse" | "custom";
  unit: "mm";
  displayUnit: Unit;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  offset: number;
  scale: number;
  pathData?: string;
}

const DEFAULT_SIZE_STATE: SizeState = {
  unit: "mm",
  actualWidthMm: 500,
  actualHeightMm: 500,
  constraintMode: "free",
  aspectRatio: 1,
  cutMode: "trim",
  cutMarginMm: 0,
  viewPadding: 140,
  minMm: 10,
  maxMm: 2000,
  stepMm: 0.1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

export function sanitizeMmValue(
  valueMm: number,
  limits: { minMm: number; maxMm: number; stepMm: number },
): number {
  if (!Number.isFinite(valueMm)) return limits.minMm;
  const rounded = roundToStep(valueMm, limits.stepMm);
  return clamp(rounded, limits.minMm, limits.maxMm);
}

export function normalizeUnit(value: unknown): Unit {
  if (value === "cm" || value === "in") return value;
  return "mm";
}

export function normalizeConstraintMode(value: unknown): SizeConstraintMode {
  if (value === "lockAspect" || value === "equal") return value;
  return "free";
}

export function normalizeCutMode(value: unknown): CutMode {
  if (value === "outset" || value === "inset") return value;
  return "trim";
}

export function toMm(value: number, fromUnit: Unit): number {
  return Coordinate.convertUnit(value, fromUnit, "mm");
}

export function fromMm(valueMm: number, toUnit: Unit): number {
  return Coordinate.convertUnit(valueMm, "mm", toUnit);
}

export function resolvePaddingPx(
  raw: number | string,
  containerWidth: number,
  containerHeight: number,
): number {
  if (typeof raw === "number") return Math.max(0, raw);
  if (typeof raw === "string") {
    if (raw.endsWith("%")) {
      const percent = parseFloat(raw) / 100;
      if (!Number.isFinite(percent)) return 0;
      return Math.max(0, Math.min(containerWidth, containerHeight) * percent);
    }
    const fixed = parseFloat(raw);
    return Number.isFinite(fixed) ? Math.max(0, fixed) : 0;
  }
  return 0;
}

export function readSizeState(configService: ConfigurationService): SizeState {
  const unit = normalizeUnit(
    configService.get("size.unit", DEFAULT_SIZE_STATE.unit),
  );

  const minMm = Math.max(
    0.1,
    Number(configService.get("size.minMm", DEFAULT_SIZE_STATE.minMm)),
  );
  const maxMm = Math.max(
    minMm,
    Number(configService.get("size.maxMm", DEFAULT_SIZE_STATE.maxMm)),
  );
  const stepMm = Math.max(
    0.001,
    Number(configService.get("size.stepMm", DEFAULT_SIZE_STATE.stepMm)),
  );

  const actualWidthMm = sanitizeMmValue(
    parseLengthToMm(
      configService.get("size.actualWidthMm", DEFAULT_SIZE_STATE.actualWidthMm),
      "mm",
    ),
    { minMm, maxMm, stepMm },
  );
  const actualHeightMm = sanitizeMmValue(
    parseLengthToMm(
      configService.get(
        "size.actualHeightMm",
        DEFAULT_SIZE_STATE.actualHeightMm,
      ),
      "mm",
    ),
    { minMm, maxMm, stepMm },
  );

  const aspectRaw = Number(
    configService.get("size.aspectRatio", DEFAULT_SIZE_STATE.aspectRatio),
  );
  const aspectRatio =
    Number.isFinite(aspectRaw) && aspectRaw > 0
      ? aspectRaw
      : actualWidthMm / Math.max(0.001, actualHeightMm);

  const cutMarginMm = Math.max(
    0,
    parseLengthToMm(
      configService.get("size.cutMarginMm", DEFAULT_SIZE_STATE.cutMarginMm),
      "mm",
    ),
  );

  const viewPadding = configService.get(
    "size.viewPadding",
    DEFAULT_SIZE_STATE.viewPadding,
  );

  return {
    unit,
    actualWidthMm,
    actualHeightMm,
    constraintMode: normalizeConstraintMode(
      configService.get(
        "size.constraintMode",
        DEFAULT_SIZE_STATE.constraintMode,
      ),
    ),
    aspectRatio,
    cutMode: normalizeCutMode(
      configService.get("size.cutMode", DEFAULT_SIZE_STATE.cutMode),
    ),
    cutMarginMm,
    viewPadding,
    minMm,
    maxMm,
    stepMm,
  };
}

function rectByCenter(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
): SceneRect {
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
    centerX,
    centerY,
  };
}

function getCutSizeMm(size: SizeState): { widthMm: number; heightMm: number } {
  if (size.cutMode === "trim") {
    return { widthMm: size.actualWidthMm, heightMm: size.actualHeightMm };
  }

  const delta = size.cutMarginMm * 2;
  if (size.cutMode === "outset") {
    return {
      widthMm: size.actualWidthMm + delta,
      heightMm: size.actualHeightMm + delta,
    };
  }

  return {
    widthMm: Math.max(size.minMm, size.actualWidthMm - delta),
    heightMm: Math.max(size.minMm, size.actualHeightMm - delta),
  };
}

export function computeSceneLayout(
  canvasService: CanvasService,
  size: SizeState,
): SceneLayoutSnapshot | null {
  const canvasWidth = canvasService.canvas.width || 0;
  const canvasHeight = canvasService.canvas.height || 0;
  if (canvasWidth <= 0 || canvasHeight <= 0) return null;

  const { widthMm: cutWidthMm, heightMm: cutHeightMm } = getCutSizeMm(size);
  const viewWidthMm = Math.max(size.actualWidthMm, cutWidthMm);
  const viewHeightMm = Math.max(size.actualHeightMm, cutHeightMm);
  if (
    !Number.isFinite(viewWidthMm) ||
    !Number.isFinite(viewHeightMm) ||
    viewWidthMm <= 0 ||
    viewHeightMm <= 0
  ) {
    return null;
  }

  const paddingPx = resolvePaddingPx(
    size.viewPadding,
    canvasWidth,
    canvasHeight,
  );
  canvasService.viewport.updateContainer(canvasWidth, canvasHeight);
  canvasService.viewport.setPadding(paddingPx);
  canvasService.viewport.updatePhysical(viewWidthMm, viewHeightMm);

  const layout = canvasService.viewport.layout;
  if (
    !Number.isFinite(layout.scale) ||
    !Number.isFinite(layout.offsetX) ||
    !Number.isFinite(layout.offsetY) ||
    layout.scale <= 0
  ) {
    return null;
  }

  const centerX = layout.offsetX + layout.width / 2;
  const centerY = layout.offsetY + layout.height / 2;
  const trimWidthPx = size.actualWidthMm * layout.scale;
  const trimHeightPx = size.actualHeightMm * layout.scale;
  const cutWidthPx = cutWidthMm * layout.scale;
  const cutHeightPx = cutHeightMm * layout.scale;

  const trimRect = rectByCenter(centerX, centerY, trimWidthPx, trimHeightPx);
  const cutRect = rectByCenter(centerX, centerY, cutWidthPx, cutHeightPx);
  const bleedRect = rectByCenter(
    centerX,
    centerY,
    Math.max(trimWidthPx, cutWidthPx),
    Math.max(trimHeightPx, cutHeightPx),
  );

  return {
    scale: layout.scale,
    canvasWidth,
    canvasHeight,
    trimRect,
    cutRect,
    bleedRect,
    trimWidthMm: size.actualWidthMm,
    trimHeightMm: size.actualHeightMm,
    cutWidthMm,
    cutHeightMm,
    cutMode: size.cutMode,
    cutMarginMm: size.cutMarginMm,
  };
}

export function buildSceneGeometry(
  configService: ConfigurationService,
  layout: SceneLayoutSnapshot,
): SceneGeometrySnapshot {
  const radiusMm = parseLengthToMm(
    configService.get("dieline.radius", 0),
    "mm",
  );
  const offset = (layout.cutRect.width - layout.trimRect.width) / 2;

  return {
    shape: configService.get("dieline.shape", "rect"),
    unit: "mm",
    displayUnit: normalizeUnit(configService.get("size.unit", "mm")),
    x: layout.trimRect.centerX,
    y: layout.trimRect.centerY,
    width: layout.trimRect.width,
    height: layout.trimRect.height,
    radius: radiusMm * layout.scale,
    offset,
    scale: layout.scale,
    pathData: configService.get("dieline.pathData"),
  };
}
