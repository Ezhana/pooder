import type { ConfigurationService } from "./services";
import { Coordinate, type Unit } from "./coordinate";
import {
  DEFAULT_DIELINE_SHAPE,
  DEFAULT_DIELINE_SHAPE_STYLE,
  normalizeDielineShape,
  normalizeShapeStyle,
} from "./dieline-shape";
import type {
  CanvasService,
  SceneFrameMm,
  SceneGeometrySnapshot,
  SceneLayoutSnapshot,
  SceneRect,
  SurfaceSceneFrames,
  SizeConstraintMode,
  SizeState,
  CutMode,
} from "./render";
import { parseLengthToMm } from "./units";

export const DEFAULT_SIZE_STATE: SizeState = {
  unit: "mm",
  surfaceWidthMm: 500,
  surfaceHeightMm: 500,
  sceneFrames: {
    previewBounds: { xMm: 0, yMm: 0, widthMm: 500, heightMm: 500 },
    productionFrame: { xMm: 0, yMm: 0, widthMm: 500, heightMm: 500 },
  },
  constraintMode: "free",
  aspectRatio: 1,
  cutMode: "trim",
  cutMarginMm: 0,
  viewPadding: "16%",
  minMm: 10,
  maxMm: 2000,
  stepMm: 0.1,
};

const FIXED_VIEW_PADDING_LIMIT_RATIO = 0.12;
const MIN_VIEW_CONTENT_SIDE_PX = 160;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function readLengthMm(
  configService: ConfigurationService,
  key: string,
  fallback: number,
): number {
  const parsed = readOptionalLengthMm(configService, key);
  return parsed === undefined ? fallback : parsed;
}

function readOptionalLengthMm(
  configService: ConfigurationService,
  key: string,
): number | undefined {
  const value = configService.get(key);
  if (typeof value === "number") {
    return Number.isFinite(value) ? parseLengthToMm(value, "mm") : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = parseLengthToMm(value, "mm");
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFrameMm(
  value: unknown,
  fallback: SceneFrameMm,
): SceneFrameMm {
  if (!isRecord(value)) return { ...fallback };
  const xMm = Number(value.xMm);
  const yMm = Number(value.yMm);
  const widthMm = Number(value.widthMm);
  const heightMm = Number(value.heightMm);

  if (
    !Number.isFinite(xMm) ||
    !Number.isFinite(yMm) ||
    !Number.isFinite(widthMm) ||
    !Number.isFinite(heightMm) ||
    widthMm <= 0 ||
    heightMm <= 0
  ) {
    return { ...fallback };
  }

  return { xMm, yMm, widthMm, heightMm };
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

  const surfaceWidthMm = sanitizeMmValue(
    readLengthMm(
      configService,
      "surface.widthMm",
      DEFAULT_SIZE_STATE.surfaceWidthMm,
    ),
    { minMm, maxMm, stepMm },
  );
  const surfaceHeightMm = sanitizeMmValue(
    readLengthMm(
      configService,
      "surface.heightMm",
      DEFAULT_SIZE_STATE.surfaceHeightMm,
    ),
    { minMm, maxMm, stepMm },
  );

  const aspectRaw = Number(
    configService.get("size.aspectRatio", DEFAULT_SIZE_STATE.aspectRatio),
  );
  const aspectRatio =
    Number.isFinite(aspectRaw) && aspectRaw > 0
      ? aspectRaw
      : surfaceWidthMm / Math.max(0.001, surfaceHeightMm);

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
  const defaultPreviewBounds = {
    xMm: 0,
    yMm: 0,
    widthMm: surfaceWidthMm,
    heightMm: surfaceHeightMm,
  };
  const previewBounds = normalizeFrameMm(
    configService.get("scene.previewBounds"),
    defaultPreviewBounds,
  );
  const productionFrame = normalizeFrameMm(
    configService.get("scene.productionFrame"),
    previewBounds,
  );
  const explicitExportFrame = isRecord(configService.get("scene.exportFrame"))
    ? normalizeFrameMm(configService.get("scene.exportFrame"), productionFrame)
    : undefined;
  const explicitViewportFocusFrame = isRecord(
    configService.get("scene.viewportFocusFrame"),
  )
    ? normalizeFrameMm(
        configService.get("scene.viewportFocusFrame"),
        productionFrame,
      )
    : undefined;

  return {
    unit,
    surfaceWidthMm,
    surfaceHeightMm,
    sceneFrames: {
      previewBounds,
      productionFrame,
      ...(explicitExportFrame ? { exportFrame: explicitExportFrame } : {}),
      ...(explicitViewportFocusFrame
        ? { viewportFocusFrame: explicitViewportFocusFrame }
        : {}),
    },
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

function rectByFrame(
  frame: SceneFrameMm,
  scale: number,
  offsetX: number,
  offsetY: number,
): SceneRect {
  const left = offsetX + frame.xMm * scale;
  const top = offsetY + frame.yMm * scale;
  const width = frame.widthMm * scale;
  const height = frame.heightMm * scale;
  return {
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function getCutFrameMm(size: SizeState, frame: SceneFrameMm): SceneFrameMm {
  if (size.cutMode === "trim") {
    return { ...frame };
  }

  const delta = size.cutMarginMm * 2;
  if (size.cutMode === "outset") {
    return {
      xMm: frame.xMm - size.cutMarginMm,
      yMm: frame.yMm - size.cutMarginMm,
      widthMm: frame.widthMm + delta,
      heightMm: frame.heightMm + delta,
    };
  }

  const widthMm = Math.max(size.minMm, frame.widthMm - delta);
  const heightMm = Math.max(size.minMm, frame.heightMm - delta);
  return {
    xMm: frame.xMm + (frame.widthMm - widthMm) / 2,
    yMm: frame.yMm + (frame.heightMm - heightMm) / 2,
    widthMm,
    heightMm,
  };
}

function boundingRect(left: SceneRect, right: SceneRect): SceneRect {
  const minLeft = Math.min(left.left, right.left);
  const minTop = Math.min(left.top, right.top);
  const maxRight = Math.max(left.left + left.width, right.left + right.width);
  const maxBottom = Math.max(left.top + left.height, right.top + right.height);
  const width = maxRight - minLeft;
  const height = maxBottom - minTop;
  return {
    left: minLeft,
    top: minTop,
    width,
    height,
    centerX: minLeft + width / 2,
    centerY: minTop + height / 2,
  };
}

type ResolvedSurfaceSceneFrames = SurfaceSceneFrames & {
  exportFrame: SceneFrameMm;
  viewportFocusFrame: SceneFrameMm;
};

function deriveSceneFrames(size: SizeState): ResolvedSurfaceSceneFrames {
  const { previewBounds, productionFrame, viewportFocusFrame } =
    size.sceneFrames;
  return {
    previewBounds,
    productionFrame,
    exportFrame:
      size.sceneFrames.exportFrame ?? getCutFrameMm(size, productionFrame),
    viewportFocusFrame: viewportFocusFrame ?? productionFrame,
  };
}

function resolveFrameOffset(
  frame: SceneFrameMm,
  focusFrame: SceneFrameMm,
  scale: number,
  canvasWidth: number,
  canvasHeight: number,
  padding: number,
): { offsetX: number; offsetY: number } {
  const viewportCenterX = canvasWidth / 2;
  const viewportCenterY = canvasHeight / 2;
  const initialOffsetX =
    viewportCenterX - (focusFrame.xMm + focusFrame.widthMm / 2) * scale;
  const initialOffsetY =
    viewportCenterY - (focusFrame.yMm + focusFrame.heightMm / 2) * scale;

  const offsetLeftX = padding - frame.xMm * scale;
  const offsetRightX = canvasWidth - padding - (frame.xMm + frame.widthMm) * scale;
  const offsetTopY = padding - frame.yMm * scale;
  const offsetBottomY =
    canvasHeight - padding - (frame.yMm + frame.heightMm) * scale;

  return {
    offsetX: clamp(
      initialOffsetX,
      Math.min(offsetLeftX, offsetRightX),
      Math.max(offsetLeftX, offsetRightX),
    ),
    offsetY: clamp(
      initialOffsetY,
      Math.min(offsetTopY, offsetBottomY),
      Math.max(offsetTopY, offsetBottomY),
    ),
  };
}

export function computeSceneLayout(
  canvasService: CanvasService,
  size: SizeState,
): SceneLayoutSnapshot | null {
  const viewportSize = canvasService.getViewportSize();
  const canvasWidth = viewportSize.width || 0;
  const canvasHeight = viewportSize.height || 0;
  if (canvasWidth <= 0 || canvasHeight <= 0) return null;

  const sceneFrames = deriveSceneFrames(size);
  const { previewBounds, productionFrame, exportFrame, viewportFocusFrame } =
    sceneFrames;
  const viewWidthMm = previewBounds.widthMm;
  const viewHeightMm = previewBounds.heightMm;
  if (
    !Number.isFinite(viewWidthMm) ||
    !Number.isFinite(viewHeightMm) ||
    viewWidthMm <= 0 ||
    viewHeightMm <= 0
  ) {
    return null;
  }

  const viewPaddingPx = resolveViewPaddingPx(
    size.viewPadding,
    canvasWidth,
    canvasHeight,
  );
  const baseLayout = Coordinate.calculateLayout(
    { width: canvasWidth, height: canvasHeight },
    { width: viewWidthMm, height: viewHeightMm },
    viewPaddingPx,
  );
  const { offsetX, offsetY } = resolveFrameOffset(
    previewBounds,
    viewportFocusFrame,
    baseLayout.scale,
    canvasWidth,
    canvasHeight,
    viewPaddingPx,
  );
  const layout =
    canvasService.updateViewportLayout({
      containerWidth: canvasWidth,
      containerHeight: canvasHeight,
      padding: viewPaddingPx,
      widthMm: viewWidthMm,
      heightMm: viewHeightMm,
      offsetX,
      offsetY,
    }) ?? { ...baseLayout, offsetX, offsetY };
  if (
    !Number.isFinite(layout.scale) ||
    !Number.isFinite(layout.offsetX) ||
    !Number.isFinite(layout.offsetY) ||
    layout.scale <= 0
  ) {
    return null;
  }

  const trimRect = rectByFrame(
    productionFrame,
    layout.scale,
    layout.offsetX,
    layout.offsetY,
  );
  const cutRect = rectByFrame(
    exportFrame,
    layout.scale,
    layout.offsetX,
    layout.offsetY,
  );
  const bleedRect = boundingRect(trimRect, cutRect);

  return {
    scale: layout.scale,
    canvasWidth,
    canvasHeight,
    trimRect,
    cutRect,
    bleedRect,
    trimWidthMm: productionFrame.widthMm,
    trimHeightMm: productionFrame.heightMm,
    cutWidthMm: exportFrame.widthMm,
    cutHeightMm: exportFrame.heightMm,
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
  const sourceWidth = Number(
    configService.get("dieline.customSourceWidthPx", 0),
  );
  const sourceHeight = Number(
    configService.get("dieline.customSourceHeightPx", 0),
  );
  const shapeStyle = normalizeShapeStyle(
    configService.get("dieline.shapeStyle", DEFAULT_DIELINE_SHAPE_STYLE),
  );

  return {
    shape: normalizeDielineShape(
      configService.get("dieline.shape", DEFAULT_DIELINE_SHAPE),
    ),
    shapeStyle,
    unit: "px",
    x: layout.trimRect.centerX,
    y: layout.trimRect.centerY,
    width: layout.trimRect.width,
    height: layout.trimRect.height,
    radius: radiusMm * layout.scale,
    offset,
    scale: layout.scale,
    pathData: configService.get("dieline.pathData"),
    customSourceWidthPx:
      Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : undefined,
    customSourceHeightPx:
      Number.isFinite(sourceHeight) && sourceHeight > 0
        ? sourceHeight
        : undefined,
  };
}
