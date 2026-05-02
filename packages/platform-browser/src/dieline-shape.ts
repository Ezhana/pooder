export const BUILTIN_DIELINE_SHAPES = [
  "rect",
  "circle",
  "ellipse",
  "heart",
] as const;

export type BuiltinDielineShape = (typeof BUILTIN_DIELINE_SHAPES)[number];

export const DIELINE_SHAPES = [...BUILTIN_DIELINE_SHAPES, "custom"] as const;

export type DielineShape = (typeof DIELINE_SHAPES)[number];

export const DEFAULT_DIELINE_SHAPE: BuiltinDielineShape = "rect";

export type ShapeFitMode = "contain" | "stretch";

export interface DielineShapeStyle {
  fitMode: ShapeFitMode;
  [key: string]: unknown;
}

interface HeartShapeParams {
  lobeSpread: number;
  notchDepth: number;
  tipSharpness: number;
}

const DEFAULT_HEART_SHAPE_PARAMS: HeartShapeParams = {
  lobeSpread: 0.46,
  notchDepth: 0.24,
  tipSharpness: 0,
};

export const DEFAULT_DIELINE_SHAPE_STYLE: DielineShapeStyle = {
  fitMode: "stretch",
  ...DEFAULT_HEART_SHAPE_PARAMS,
};

export function isDielineShape(value: unknown): value is DielineShape {
  return (
    typeof value === "string" &&
    (DIELINE_SHAPES as readonly string[]).includes(value)
  );
}

function normalizeFitMode(
  value: unknown,
  fallback: ShapeFitMode,
): ShapeFitMode {
  if (value === "contain" || value === "stretch") return value;
  return fallback;
}

function normalizeUnitInterval(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

export function normalizeDielineShape(
  value: unknown,
  fallback: DielineShape = DEFAULT_DIELINE_SHAPE,
): DielineShape {
  return isDielineShape(value) ? value : fallback;
}

export function normalizeShapeStyle(
  value: unknown,
  fallback: DielineShapeStyle = DEFAULT_DIELINE_SHAPE_STYLE,
): DielineShapeStyle {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    ...fallback,
    fitMode: normalizeFitMode(raw.fitMode, fallback.fitMode),
    lobeSpread: normalizeUnitInterval(
      raw.lobeSpread,
      Number(fallback.lobeSpread ?? DEFAULT_HEART_SHAPE_PARAMS.lobeSpread),
    ),
    notchDepth: normalizeUnitInterval(
      raw.notchDepth,
      Number(fallback.notchDepth ?? DEFAULT_HEART_SHAPE_PARAMS.notchDepth),
    ),
    tipSharpness: normalizeUnitInterval(
      raw.tipSharpness,
      Number(fallback.tipSharpness ?? DEFAULT_HEART_SHAPE_PARAMS.tipSharpness),
    ),
  };
}
