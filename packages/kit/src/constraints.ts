import { DielineFeature } from "./geometry";

export interface ConstraintContext {
  dielineWidth: number;
  dielineHeight: number;
}

export type ConstraintHandler = (
  x: number,
  y: number,
  feature: DielineFeature,
  context: ConstraintContext
) => { x: number; y: number };

export class ConstraintRegistry {
  private static handlers = new Map<string, ConstraintHandler>();

  static register(type: string, handler: ConstraintHandler) {
    this.handlers.set(type, handler);
  }

  static apply(
    x: number,
    y: number,
    feature: DielineFeature,
    context: ConstraintContext
  ): { x: number; y: number } {
    if (!feature.constraints || !feature.constraints.type) {
      return { x, y };
    }

    const handler = this.handlers.get(feature.constraints.type);
    if (handler) {
      return handler(x, y, feature, context);
    }

    return { x, y };
  }
}

// --- Built-in Strategies ---

/**
 * Edge Constraint Strategy
 * Snaps the feature to the nearest allowed edge.
 * Params:
 * - allowedEdges: ('top' | 'bottom' | 'left' | 'right')[] (default: all)
 * - confine: boolean (default: false) - if true, keeps feature within edge length
 * - offset: number (default: 0) - physical offset from edge (positive = inwards usually, but here 0 is edge)
 *   For simplicity, let's say offset is additive to the edge position.
 *   Top: 0 + offset
 *   Bottom: 1 - offset
 *   Left: 0 + offset
 *   Right: 1 - offset
 */
const edgeConstraint: ConstraintHandler = (x, y, feature, context) => {
  const { dielineWidth, dielineHeight } = context;
  const params = feature.constraints?.params || {};
  const allowedEdges = params.allowedEdges || [
    "top",
    "bottom",
    "left",
    "right",
  ];
  const confine = params.confine || false;
  const offset = params.offset || 0;

  // Calculate physical distances to allowed edges
  const distances: { edge: string; dist: number }[] = [];

  if (allowedEdges.includes("top"))
    distances.push({ edge: "top", dist: y * dielineHeight });
  if (allowedEdges.includes("bottom"))
    distances.push({ edge: "bottom", dist: (1 - y) * dielineHeight });
  if (allowedEdges.includes("left"))
    distances.push({ edge: "left", dist: x * dielineWidth });
  if (allowedEdges.includes("right"))
    distances.push({ edge: "right", dist: (1 - x) * dielineWidth });

  if (distances.length === 0) return { x, y };

  // Find nearest
  distances.sort((a, b) => a.dist - b.dist);
  const nearest = distances[0].edge;

  let newX = x;
  let newY = y;
  const fw = feature.width || 0;
  const fh = feature.height || 0;

  // Snap to edge
  switch (nearest) {
    case "top":
      newY = 0 + offset / dielineHeight;
      if (confine) {
        const minX = (fw / 2) / dielineWidth;
        const maxX = 1 - minX;
        newX = Math.max(minX, Math.min(newX, maxX));
      }
      break;
    case "bottom":
      newY = 1 - offset / dielineHeight;
      if (confine) {
        const minX = (fw / 2) / dielineWidth;
        const maxX = 1 - minX;
        newX = Math.max(minX, Math.min(newX, maxX));
      }
      break;
    case "left":
      newX = 0 + offset / dielineWidth;
      if (confine) {
        const minY = (fh / 2) / dielineHeight;
        const maxY = 1 - minY;
        newY = Math.max(minY, Math.min(newY, maxY));
      }
      break;
    case "right":
      newX = 1 - offset / dielineWidth;
      if (confine) {
        const minY = (fh / 2) / dielineHeight;
        const maxY = 1 - minY;
        newY = Math.max(minY, Math.min(newY, maxY));
      }
      break;
  }

  return { x: newX, y: newY };
};

/**
 * Internal Constraint Strategy
 * Keeps the feature strictly inside the dieline bounds with optional margin.
 * Params:
 * - margin: number (default: 0) - physical margin
 */
const internalConstraint: ConstraintHandler = (x, y, feature, context) => {
  const { dielineWidth, dielineHeight } = context;
  const params = feature.constraints?.params || {};
  const margin = params.margin || 0;
  const fw = feature.width || 0;
  const fh = feature.height || 0;

  const minX = (margin + fw / 2) / dielineWidth;
  const maxX = 1 - (margin + fw / 2) / dielineWidth;
  
  const minY = (margin + fh / 2) / dielineHeight;
  const maxY = 1 - (margin + fh / 2) / dielineHeight;

  // Handle case where feature is larger than container
  const clampedX = minX > maxX ? 0.5 : Math.max(minX, Math.min(x, maxX));
  const clampedY = minY > maxY ? 0.5 : Math.max(minY, Math.min(y, maxY));

  return { x: clampedX, y: clampedY };
};

// Register built-ins
ConstraintRegistry.register("edge", edgeConstraint);
ConstraintRegistry.register("internal", internalConstraint);
