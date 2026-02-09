import { DielineFeature, getNearestPointOnDieline } from "./geometry";

export interface ConstraintContext {
  dielineWidth: number;
  dielineHeight: number;
  // Context may need access to geometry functions or the geometry itself
  // For now, getNearestPointOnDieline creates its own paper scope, but ideally we pass a simplified geometry representation
  geometry?: any; 
}

export interface ConstraintFeature extends DielineFeature {
  constraints?: Array<{
    type: string;
    params?: any;
    validateOnly?: boolean;
  }>;
}

export type ConstraintHandler = (
  x: number,
  y: number,
  feature: ConstraintFeature,
  context: ConstraintContext,
  params?: any
) => { x: number; y: number };

export interface ConstraintConfig {
  type: string;
  params?: any;
  validateOnly?: boolean;
}

export class ConstraintRegistry {
  private static handlers = new Map<string, ConstraintHandler>();

  static register(type: string, handler: ConstraintHandler) {
    this.handlers.set(type, handler);
  }

  static apply(
    x: number,
    y: number,
    feature: ConstraintFeature,
    context: ConstraintContext,
    constraints?: ConstraintConfig[] // Optional override, defaults to feature.constraints
  ): { x: number; y: number } {
    const list = constraints || feature.constraints;
    if (!list || list.length === 0) {
      return { x, y };
    }

    let currentX = x;
    let currentY = y;

    for (const constraint of list) {
      const handler = this.handlers.get(constraint.type);
      if (handler) {
        const result = handler(currentX, currentY, feature, context, constraint.params || {});
        currentX = result.x;
        currentY = result.y;
      }
    }

    return { x: currentX, y: currentY };
  }
}

// --- Built-in Strategies ---

/**
 * Path Constraint Strategy (formerly placement='edge')
 * Snaps the feature to the nearest point on the Dieline Path.
 */
const pathConstraint: ConstraintHandler = (x, y, feature, context, params) => {
    // We need to denormalize, find nearest, then normalize back
    // This is expensive but accurate.
    const { dielineWidth, dielineHeight, geometry } = context;
    if (!geometry) return { x, y }; // Cannot snap without geometry
    
    // Geometry is centered at (cx, cy)
    // x, y are normalized (0-1) relative to bounding box
    const minX = geometry.x - geometry.width / 2;
    const minY = geometry.y - geometry.height / 2;
    
    const absX = minX + x * geometry.width;
    const absY = minY + y * geometry.height;
    
    // Use geometry helper
    // Note: getNearestPointOnDieline creates a fresh paper scope each time.
    // Optimization: geometry object passed in context could be a reusable paper path?
    // For now, keep it simple as per existing logic.
    const nearest = getNearestPointOnDieline(
      { x: absX, y: absY },
      geometry
    );

    let finalX = nearest.x;
    let finalY = nearest.y;

    // Only allow vertical offset if explicit offset limits are provided
    // Otherwise, we snap strictly to the path (offset = 0)
    const hasOffsetParams = params.minOffset !== undefined || params.maxOffset !== undefined;

    if (hasOffsetParams && nearest.normal) {
        // Project the cursor vector onto the normal vector
        // This ensures the feature stays on the "normal line" of the nearest path point
        const dx = absX - nearest.x;
        const dy = absY - nearest.y;
        
        const nx = nearest.normal.x;
        const ny = nearest.normal.y;
        
        // Dot product to get scalar projection
        const dist = dx * nx + dy * ny;
        
        // Limit the offset
        // geometry.width is in pixels, dielineWidth is in physical units (e.g. mm)
        // We assume dielineWidth corresponds to geometry.width
        const scale = dielineWidth > 0 ? geometry.width / dielineWidth : 1;
        
        // If one is provided but the other is not, default the other to 0.
        // If neither is provided (shouldn't happen due to hasOffsetParams check), default to 0.
        const rawMin = params.minOffset !== undefined ? params.minOffset : 0;
        const rawMax = params.maxOffset !== undefined ? params.maxOffset : 0;
        
        // However, if we want to allow one-sided infinity, user must explicitly provide Infinity?
        // Wait, user requirement: "If only one is passed, the other defaults to 0."
        // This implies:
        // { minOffset: -5 } -> maxOffset = 0 (range: -5 to 0)
        // { maxOffset: 5 } -> minOffset = 0 (range: 0 to 5)
        // { minOffset: -5, maxOffset: 5 } -> (range: -5 to 5)
        
        const minOffset = rawMin * scale;
        const maxOffset = rawMax * scale;
        
        const clampedDist = Math.max(minOffset, Math.min(dist, maxOffset));

        finalX = nearest.x + nx * clampedDist;
        finalY = nearest.y + ny * clampedDist;
    }
    
    // Re-normalize
    const nx = geometry.width > 0 ? (finalX - minX) / geometry.width : 0.5;
    const ny = geometry.height > 0 ? (finalY - minY) / geometry.height : 0.5;
    
    return { x: nx, y: ny };
};

/**
 * Edge Constraint Strategy (Box Edge)
 * Snaps the feature to the nearest allowed edge of the BOUNDING BOX.
 */
const edgeConstraint: ConstraintHandler = (x, y, feature, context, params) => {
  const { dielineWidth, dielineHeight } = context;
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
 */
const internalConstraint: ConstraintHandler = (x, y, feature, context, params) => {
  const { dielineWidth, dielineHeight } = context;
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

/**
 * Bottom Tangent Strategy (stand protrusion)
 * Forces a feature to be tangent to the dieline bottom edge from outside (below).
 */
const tangentBottomConstraint: ConstraintHandler = (x, y, feature, context, params) => {
  const { dielineWidth, dielineHeight } = context;
  const gap = params.gap || 0;
  const confineX = params.confineX !== false;

  const extentY =
    feature.shape === "circle"
      ? feature.radius || 0
      : (feature.height || 0) / 2;
  const newY = 1 + (extentY + gap) / dielineHeight;

  let newX = x;
  if (confineX) {
    const extentX =
      feature.shape === "circle"
        ? feature.radius || 0
        : (feature.width || 0) / 2;
    const minX = extentX / dielineWidth;
    const maxX = 1 - extentX / dielineWidth;
    newX = minX > maxX ? 0.5 : Math.max(minX, Math.min(newX, maxX));
  }

  return { x: newX, y: newY };
};

// Register built-ins
ConstraintRegistry.register("path", pathConstraint);
ConstraintRegistry.register("edge", edgeConstraint);
ConstraintRegistry.register("internal", internalConstraint);
ConstraintRegistry.register("tangent-bottom", tangentBottomConstraint);
