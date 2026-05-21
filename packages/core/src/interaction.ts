export interface GeometryPoint {
  x: number;
  y: number;
}

export interface GeometryRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type InteractionAxis = "x" | "y";
export type InteractionLineKind = "edge" | "center";
export type DragConstraintTarget = "frame" | "center";
export type DragConstraintMode = "contain";

export interface InteractionLine {
  id: string;
  axis: InteractionAxis;
  kind: InteractionLineKind;
  position: number;
}

export interface InteractionSnapTarget {
  id: string;
  rect?: GeometryRect;
  lines?: readonly InteractionLine[];
}

export interface DragInteractionConstraint {
  id?: string;
  rect: GeometryRect;
  mode?: DragConstraintMode;
  target?: DragConstraintTarget;
}

export interface DragInteractionOptions {
  thresholdPx?: number;
  viewportScale?: number;
  includeEdges?: boolean;
  includeCenters?: boolean;
}

export interface DragInteractionInput {
  frame: GeometryRect;
  delta?: GeometryPoint;
  proposedFrame?: GeometryRect;
  constraints?: readonly DragInteractionConstraint[];
  snapTargets?: readonly InteractionSnapTarget[];
  options?: DragInteractionOptions;
}

export interface DragInteractionSnapMatch {
  axis: InteractionAxis;
  kind: InteractionLineKind;
  targetId: string;
  targetLineId: string;
  movingLineId: string;
  position: number;
  delta: number;
}

export interface DragInteractionSnapGuide {
  axis: InteractionAxis;
  kind: InteractionLineKind;
  position: number;
  targetId: string;
  targetLineId: string;
}

export interface DragInteractionResult {
  frame: GeometryRect;
  delta: GeometryPoint;
  snappedDelta: GeometryPoint;
  constrained: boolean;
  matches: DragInteractionSnapMatch[];
  guides: DragInteractionSnapGuide[];
}

const DEFAULT_THRESHOLD_PX = 6;

type ResolvedInteractionLine = InteractionLine & { targetId: string };

export function normalizeRect(rect: {
  left?: unknown;
  top?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
}): GeometryRect {
  return {
    left: finiteNumber(rect.left ?? rect.x, 0),
    top: finiteNumber(rect.top ?? rect.y, 0),
    width: Math.max(0, finiteNumber(rect.width, 0)),
    height: Math.max(0, finiteNumber(rect.height, 0)),
  };
}

export function intersectRects(
  a: GeometryRect,
  b: GeometryRect,
): GeometryRect | null {
  const first = normalizeRect(a);
  const second = normalizeRect(b);
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.left + first.width, second.left + second.width);
  const bottom = Math.min(first.top + first.height, second.top + second.height);
  if (right < left || bottom < top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

export function containsPoint(
  rect: GeometryRect,
  point: GeometryPoint,
): boolean {
  const normalized = normalizeRect(rect);
  return (
    point.x >= normalized.left &&
    point.x <= normalized.left + normalized.width &&
    point.y >= normalized.top &&
    point.y <= normalized.top + normalized.height
  );
}

export function containsRect(
  container: GeometryRect,
  subject: GeometryRect,
): boolean {
  const outer = normalizeRect(container);
  const inner = normalizeRect(subject);
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.left + inner.width <= outer.left + outer.width &&
    inner.top + inner.height <= outer.top + outer.height
  );
}

export function projectRectIntoRect(
  subject: GeometryRect,
  container: GeometryRect,
  target: DragConstraintTarget = "frame",
): GeometryRect {
  const normalizedSubject = normalizeRect(subject);
  const normalizedContainer = normalizeRect(container);

  if (target === "center") {
    const centerX = clamp(
      normalizedSubject.left + normalizedSubject.width / 2,
      normalizedContainer.left,
      normalizedContainer.left + normalizedContainer.width,
    );
    const centerY = clamp(
      normalizedSubject.top + normalizedSubject.height / 2,
      normalizedContainer.top,
      normalizedContainer.top + normalizedContainer.height,
    );
    return {
      ...normalizedSubject,
      left: centerX - normalizedSubject.width / 2,
      top: centerY - normalizedSubject.height / 2,
    };
  }

  const minLeft = normalizedContainer.left;
  const maxLeft =
    normalizedContainer.left + normalizedContainer.width - normalizedSubject.width;
  const minTop = normalizedContainer.top;
  const maxTop =
    normalizedContainer.top + normalizedContainer.height - normalizedSubject.height;

  return {
    ...normalizedSubject,
    left:
      minLeft <= maxLeft
        ? clamp(normalizedSubject.left, minLeft, maxLeft)
        : normalizedContainer.left +
          (normalizedContainer.width - normalizedSubject.width) / 2,
    top:
      minTop <= maxTop
        ? clamp(normalizedSubject.top, minTop, maxTop)
        : normalizedContainer.top +
          (normalizedContainer.height - normalizedSubject.height) / 2,
  };
}

export function createRectSnapLines(rect: GeometryRect): InteractionLine[] {
  const normalized = normalizeRect(rect);
  const right = normalized.left + normalized.width;
  const bottom = normalized.top + normalized.height;
  return [
    { id: "left", axis: "x", kind: "edge", position: normalized.left },
    {
      id: "center-x",
      axis: "x",
      kind: "center",
      position: normalized.left + normalized.width / 2,
    },
    { id: "right", axis: "x", kind: "edge", position: right },
    { id: "top", axis: "y", kind: "edge", position: normalized.top },
    {
      id: "center-y",
      axis: "y",
      kind: "center",
      position: normalized.top + normalized.height / 2,
    },
    { id: "bottom", axis: "y", kind: "edge", position: bottom },
  ];
}

export function computeDragInteraction(
  input: DragInteractionInput,
): DragInteractionResult {
  const startFrame = normalizeRect(input.frame);
  const proposedFrame = input.proposedFrame
    ? normalizeRect(input.proposedFrame)
    : {
        ...startFrame,
        left: startFrame.left + finiteNumber(input.delta?.x, 0),
        top: startFrame.top + finiteNumber(input.delta?.y, 0),
      };
  const constraints = normalizeConstraints(input.constraints);
  const options = input.options ?? {};
  const threshold = resolveThreshold(options);
  const targetLines = normalizeSnapTargetLines(input.snapTargets ?? [], options);
  const proposedLines = createRectSnapLines(proposedFrame).filter((line) =>
    shouldIncludeKind(line.kind, options),
  );

  let snappedFrame = proposedFrame;
  const matches: DragInteractionSnapMatch[] = [];
  (["x", "y"] as const).forEach((axis) => {
    const match = pickBestMatch(axis, proposedLines, targetLines, threshold);
    if (!match) return;
    const candidate = translateRect(snappedFrame, {
      x: axis === "x" ? match.delta : 0,
      y: axis === "y" ? match.delta : 0,
    });
    if (!satisfiesConstraints(candidate, constraints)) return;
    snappedFrame = candidate;
    matches.push(match);
  });

  const constrainedFrame = applyConstraints(snappedFrame, constraints);
  return {
    frame: constrainedFrame,
    delta: {
      x: constrainedFrame.left - startFrame.left,
      y: constrainedFrame.top - startFrame.top,
    },
    snappedDelta: {
      x: snappedFrame.left - proposedFrame.left,
      y: snappedFrame.top - proposedFrame.top,
    },
    constrained:
      constrainedFrame.left !== snappedFrame.left ||
      constrainedFrame.top !== snappedFrame.top,
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

function normalizeConstraints(
  constraints: readonly DragInteractionConstraint[] | undefined,
): DragInteractionConstraint[] {
  if (!Array.isArray(constraints)) return [];
  return constraints
    .map((constraint) => ({
      ...constraint,
      rect: normalizeRect(constraint.rect),
      mode: constraint.mode ?? "contain",
      target: constraint.target ?? "frame",
    }))
    .filter(
      (constraint) =>
        constraint.mode === "contain" &&
        Number.isFinite(constraint.rect.left) &&
        Number.isFinite(constraint.rect.top),
    );
}

function normalizeSnapTargetLines(
  targets: readonly InteractionSnapTarget[],
  options: DragInteractionOptions,
): ResolvedInteractionLine[] {
  return targets.flatMap((target) => {
    const targetId = String(target.id || "").trim();
    if (!targetId) return [];
    const explicit = Array.isArray(target.lines) ? target.lines : [];
    const lines = explicit
      .map((line) => normalizeInteractionLine(targetId, line))
      .filter((line): line is ResolvedInteractionLine => Boolean(line))
      .filter(
        (line) => shouldIncludeKind(line.kind, options),
      );
    if (target.rect) {
      lines.push(
        ...createRectSnapLines(target.rect)
          .filter((line) => shouldIncludeKind(line.kind, options))
          .map((line) => ({
            ...line,
            id: `${targetId}:${line.id}`,
            targetId,
          })),
      );
    }
    return lines;
  });
}

function normalizeInteractionLine(
  targetId: string,
  line: InteractionLine,
): ResolvedInteractionLine | null {
  const id = String(line.id || "").trim();
  if (!id) return null;
  if (line.axis !== "x" && line.axis !== "y") return null;
  if (line.kind !== "edge" && line.kind !== "center") return null;
  const position = finiteNumber(line.position, Number.NaN);
  if (!Number.isFinite(position)) return null;
  return { id, targetId, axis: line.axis, kind: line.kind, position };
}

function applyConstraints(
  frame: GeometryRect,
  constraints: readonly DragInteractionConstraint[],
): GeometryRect {
  return constraints.reduce(
    (next, constraint) =>
      projectRectIntoRect(next, constraint.rect, constraint.target ?? "frame"),
    normalizeRect(frame),
  );
}

function satisfiesConstraints(
  frame: GeometryRect,
  constraints: readonly DragInteractionConstraint[],
): boolean {
  return constraints.every((constraint) => {
    const target = constraint.target ?? "frame";
    if (target === "center") {
      return containsPoint(constraint.rect, {
        x: frame.left + frame.width / 2,
        y: frame.top + frame.height / 2,
      });
    }
    return containsRect(constraint.rect, frame);
  });
}

function pickBestMatch(
  axis: InteractionAxis,
  movingLines: readonly InteractionLine[],
  targetLines: readonly ResolvedInteractionLine[],
  threshold: number,
): DragInteractionSnapMatch | null {
  let best: DragInteractionSnapMatch | null = null;
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

function translateRect(rect: GeometryRect, delta: GeometryPoint): GeometryRect {
  return {
    ...rect,
    left: rect.left + delta.x,
    top: rect.top + delta.y,
  };
}

function resolveThreshold(options: DragInteractionOptions): number {
  const thresholdPx = finiteNumber(options.thresholdPx, DEFAULT_THRESHOLD_PX);
  const scale = finiteNumber(options.viewportScale, 1);
  return thresholdPx / Math.max(0.0001, scale);
}

function shouldIncludeKind(
  kind: InteractionLineKind,
  options: DragInteractionOptions,
): boolean {
  if (kind === "edge") return options.includeEdges !== false;
  return options.includeCenters !== false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
