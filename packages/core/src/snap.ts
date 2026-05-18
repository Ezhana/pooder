import type { Service } from "./service";

export type SnapAxis = "x" | "y";
export type SnapLineKind = "edge" | "center";

export interface SnapBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SnapLine {
  id: string;
  axis: SnapAxis;
  kind: SnapLineKind;
  position: number;
}

export interface SnapTarget {
  id: string;
  bounds?: SnapBounds;
  lines?: readonly SnapLine[];
}

export interface SnapMatch {
  axis: SnapAxis;
  kind: SnapLineKind;
  targetId: string;
  targetLineId: string;
  movingLineId: string;
  position: number;
  delta: number;
}

export interface SnapGuide {
  axis: SnapAxis;
  kind: SnapLineKind;
  position: number;
  targetId: string;
  targetLineId: string;
}

export interface SnapOptions {
  thresholdPx?: number;
  viewportScale?: number;
  includeEdges?: boolean;
  includeCenters?: boolean;
}

export interface SnapInput {
  moving: SnapBounds;
  targets: readonly SnapTarget[];
  options?: SnapOptions;
}

export interface SnapResult {
  delta: { x: number; y: number };
  matches: SnapMatch[];
  guides: SnapGuide[];
}

const DEFAULT_THRESHOLD_PX = 6;

type ResolvedSnapLine = SnapLine & { targetId: string };

export default class SnapService implements Service {
  init(): void {}

  compute(input: SnapInput): SnapResult {
    const moving = normalizeBounds(input.moving);
    const options = input.options ?? {};
    const threshold = resolveThreshold(options);
    const movingLines = createBoundsLines("moving", moving, options);
    const targetLines = input.targets.flatMap((target) =>
      normalizeTargetLines(target, options),
    );
    const bestX = pickBestMatch("x", movingLines, targetLines, threshold);
    const bestY = pickBestMatch("y", movingLines, targetLines, threshold);
    const matches = [bestX, bestY].filter((match): match is SnapMatch =>
      Boolean(match),
    );

    return {
      delta: {
        x: bestX?.delta ?? 0,
        y: bestY?.delta ?? 0,
      },
      matches,
      guides: matches.map((match) => ({
        axis: match.axis,
        kind: match.kind,
        position: match.position,
        targetId: match.targetId,
        targetLineId: match.targetLineId,
      })),
    };
  }
}

function resolveThreshold(options: SnapOptions): number {
  const thresholdPx = finiteNumber(options.thresholdPx, DEFAULT_THRESHOLD_PX);
  const scale = finiteNumber(options.viewportScale, 1);
  return thresholdPx / Math.max(0.0001, scale);
}

function normalizeBounds(bounds: SnapBounds): SnapBounds {
  return {
    left: finiteNumber(bounds.left, 0),
    top: finiteNumber(bounds.top, 0),
    width: Math.max(0, finiteNumber(bounds.width, 0)),
    height: Math.max(0, finiteNumber(bounds.height, 0)),
  };
}

function normalizeTargetLines(
  target: SnapTarget,
  options: SnapOptions,
): ResolvedSnapLine[] {
  const explicit = Array.isArray(target.lines) ? target.lines : [];
  const lines = explicit.map((line) => ({
    id: String(line.id || "").trim(),
    targetId: target.id,
    axis: line.axis,
    kind: line.kind,
    position: finiteNumber(line.position, Number.NaN),
  })).filter((line) =>
    Boolean(line.id) &&
    (line.axis === "x" || line.axis === "y") &&
    (line.kind === "edge" || line.kind === "center") &&
    Number.isFinite(line.position) &&
    shouldIncludeKind(line.kind, options),
  );

  if (target.bounds) {
    lines.push(
      ...createBoundsLines(target.id, normalizeBounds(target.bounds), options)
        .map((line) => ({ ...line, targetId: target.id })),
    );
  }
  return lines;
}

function createBoundsLines(
  prefix: string,
  bounds: SnapBounds,
  options: SnapOptions,
): SnapLine[] {
  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  return [
    { id: `${prefix}:left`, axis: "x" as const, kind: "edge" as const, position: bounds.left },
    { id: `${prefix}:center-x`, axis: "x" as const, kind: "center" as const, position: centerX },
    { id: `${prefix}:right`, axis: "x" as const, kind: "edge" as const, position: right },
    { id: `${prefix}:top`, axis: "y" as const, kind: "edge" as const, position: bounds.top },
    { id: `${prefix}:center-y`, axis: "y" as const, kind: "center" as const, position: centerY },
    { id: `${prefix}:bottom`, axis: "y" as const, kind: "edge" as const, position: bottom },
  ].filter((line) => shouldIncludeKind(line.kind, options));
}

function shouldIncludeKind(kind: SnapLineKind, options: SnapOptions): boolean {
  if (kind === "edge") return options.includeEdges !== false;
  return options.includeCenters !== false;
}

function pickBestMatch(
  axis: SnapAxis,
  movingLines: readonly SnapLine[],
  targetLines: readonly ResolvedSnapLine[],
  threshold: number,
): SnapMatch | null {
  let best: SnapMatch | null = null;
  const movingAxisLines = movingLines.filter((line) => line.axis === axis);
  const targetAxisLines = targetLines.filter((line) => line.axis === axis);
  movingAxisLines.forEach((moving) => {
    targetAxisLines.forEach((target) => {
      const delta = target.position - moving.position;
      if (Math.abs(delta) > threshold) return;
      if (best && Math.abs(best.delta) <= Math.abs(delta)) return;
      best = {
        axis,
        kind: target.kind,
        targetId: target.targetId,
        targetLineId: target.id,
        movingLineId: moving.id,
        position: target.position,
        delta,
      };
    });
  });
  return best;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
