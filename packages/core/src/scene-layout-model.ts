import type { ConfigurationService } from "./services";
import { Coordinate, type Unit } from "./coordinate";
import type { CanvasSize } from "./render";
import type { RectMm, SceneBounds } from "./scene-bounds";
import type { SceneLayoutSnapshot, SceneRect } from "./scene-layout";

export type SizeConstraintMode = "free" | "lockAspect" | "equal";

export interface SizeState {
  unit: Unit;
  sceneBounds: SceneBounds;
  constraintMode: SizeConstraintMode;
  aspectRatio: number;
  minMm: number;
  maxMm: number;
  stepMm: number;
}

export const DEFAULT_SIZE_STATE: SizeState = {
  unit: "mm",
  sceneBounds: {
    bounds: { x: 0, y: 0, width: 500, height: 500 },
  },
  constraintMode: "free",
  aspectRatio: 1,
  minMm: 10,
  maxMm: 2000,
  stepMm: 0.1,
};

export interface SceneLayoutFitOptions {
  viewPadding?: number | string;
}

export interface SceneLayoutInput {
  bounds: RectMm;
  viewportSize: CanvasSize;
  fitOptions?: SceneLayoutFitOptions;
  sceneId: string;
  revision?: number;
}

const FIXED_VIEW_PADDING_LIMIT_RATIO = 0.12;
const MIN_VIEW_CONTENT_SIDE_PX = 160;

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

export function toMm(value: number, fromUnit: Unit): number {
  return Coordinate.convertUnit(value, fromUnit, "mm");
}

export function fromMm(valueMm: number, toUnit: Unit): number {
  return Coordinate.convertUnit(valueMm, "mm", toUnit);
}

function getContainerShortSide(
  containerWidth: number,
  containerHeight: number,
): number {
  return Math.min(Math.max(0, containerWidth), Math.max(0, containerHeight));
}

function limitViewPaddingPx(
  paddingPx: number,
  containerWidth: number,
  containerHeight: number,
  options: { capFixedPadding?: boolean } = {},
): number {
  const shortSide = getContainerShortSide(containerWidth, containerHeight);
  if (!Number.isFinite(paddingPx) || paddingPx <= 0 || shortSide <= 0) {
    return 0;
  }

  const minContentSide = Math.min(MIN_VIEW_CONTENT_SIDE_PX, shortSide);
  const contentLimit = Math.max(0, (shortSide - minContentSide) / 2);
  const fixedLimit = options.capFixedPadding
    ? shortSide * FIXED_VIEW_PADDING_LIMIT_RATIO
    : Number.POSITIVE_INFINITY;

  return Math.min(paddingPx, contentLimit, fixedLimit);
}

export function resolveViewPaddingPx(
  raw: number | string,
  containerWidth: number,
  containerHeight: number,
): number {
  if (typeof raw === "number") {
    return limitViewPaddingPx(raw, containerWidth, containerHeight, {
      capFixedPadding: true,
    });
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) return 0;

    if (value.endsWith("%")) {
      const percent = parseFloat(value) / 100;
      if (!Number.isFinite(percent)) return 0;
      return limitViewPaddingPx(
        getContainerShortSide(containerWidth, containerHeight) * percent,
        containerWidth,
        containerHeight,
      );
    }
    const fixed = parseFloat(value);
    return Number.isFinite(fixed)
      ? limitViewPaddingPx(fixed, containerWidth, containerHeight, {
          capFixedPadding: true,
        })
      : 0;
  }
  return 0;
}

export const resolvePaddingPx = resolveViewPaddingPx;

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

  const defaultBounds = {
    x: 0,
    y: 0,
    width: sanitizeMmValue(DEFAULT_SIZE_STATE.sceneBounds.bounds.width, {
      minMm,
      maxMm,
      stepMm,
    }),
    height: sanitizeMmValue(DEFAULT_SIZE_STATE.sceneBounds.bounds.height, {
      minMm,
      maxMm,
      stepMm,
    }),
  };
  const aspectRaw = Number(
    configService.get("size.aspectRatio", DEFAULT_SIZE_STATE.aspectRatio),
  );
  const aspectRatio =
    Number.isFinite(aspectRaw) && aspectRaw > 0
      ? aspectRaw
      : defaultBounds.width / Math.max(0.001, defaultBounds.height);

  return {
    unit,
    sceneBounds: {
      bounds: defaultBounds,
    },
    constraintMode: normalizeConstraintMode(
      configService.get(
        "size.constraintMode",
        DEFAULT_SIZE_STATE.constraintMode,
      ),
    ),
    aspectRatio,
    minMm,
    maxMm,
    stepMm,
  };
}

function rectByBounds(
  bounds: RectMm,
  scale: number,
  offsetX: number,
  offsetY: number,
): SceneRect {
  const left = offsetX + bounds.x * scale;
  const top = offsetY + bounds.y * scale;
  const width = bounds.width * scale;
  const height = bounds.height * scale;
  return {
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

export function computeSceneLayout(
  input: SceneLayoutInput,
): SceneLayoutSnapshot | null {
  const canvasWidth = input.viewportSize.width || 0;
  const canvasHeight = input.viewportSize.height || 0;
  if (canvasWidth <= 0 || canvasHeight <= 0) return null;

  const { bounds } = input;
  const viewWidthMm = bounds.width;
  const viewHeightMm = bounds.height;
  if (
    !Number.isFinite(viewWidthMm) ||
    !Number.isFinite(viewHeightMm) ||
    viewWidthMm <= 0 ||
    viewHeightMm <= 0
  ) {
    return null;
  }

  const viewPaddingPx = resolveViewPaddingPx(
    input.fitOptions?.viewPadding ?? "16%",
    canvasWidth,
    canvasHeight,
  );
  const baseLayout = Coordinate.calculateLayout(
    { width: canvasWidth, height: canvasHeight },
    { width: viewWidthMm, height: viewHeightMm },
    viewPaddingPx,
  );
  const layout = {
    ...baseLayout,
    offsetX: baseLayout.offsetX - bounds.x * baseLayout.scale,
    offsetY: baseLayout.offsetY - bounds.y * baseLayout.scale,
  };
  if (
    !Number.isFinite(layout.scale) ||
    !Number.isFinite(layout.offsetX) ||
    !Number.isFinite(layout.offsetY) ||
    layout.scale <= 0
  ) {
    return null;
  }

  return {
    sceneId: input.sceneId,
    revision: input.revision ?? 0,
    scale: layout.scale,
    offsetX: layout.offsetX,
    offsetY: layout.offsetY,
    viewRect: rectByBounds(
      bounds,
      layout.scale,
      layout.offsetX,
      layout.offsetY,
    ),
  };
}
