import paper from "paper";

export type PositionAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface HoleData {
  x?: number;
  y?: number;
  anchor?: PositionAnchor;
  offsetX?: number;
  offsetY?: number;
  innerRadius: number;
  outerRadius: number;
}

export function resolveHolePosition(
  hole: HoleData,
  geometry: { x: number; y: number; width: number; height: number },
  canvasSize: { width: number; height: number }
): { x: number; y: number } {
  if (hole.anchor) {
    const { x, y, width, height } = geometry;
    let bx = x; // center x
    let by = y; // center y

    // Calculate anchor base position based on shape bounds
    // Note: geometry.x/y is the CENTER of the shape
    const left = x - width / 2;
    const right = x + width / 2;
    const top = y - height / 2;
    const bottom = y + height / 2;

    switch (hole.anchor) {
      case "top-left":
        bx = left;
        by = top;
        break;
      case "top-center":
        bx = x;
        by = top;
        break;
      case "top-right":
        bx = right;
        by = top;
        break;
      case "center-left":
        bx = left;
        by = y;
        break;
      case "center":
        bx = x;
        by = y;
        break;
      case "center-right":
        bx = right;
        by = y;
        break;
      case "bottom-left":
        bx = left;
        by = bottom;
        break;
      case "bottom-center":
        bx = x;
        by = bottom;
        break;
      case "bottom-right":
        bx = right;
        by = bottom;
        break;
    }

    return {
      x: bx + (hole.offsetX || 0),
      y: by + (hole.offsetY || 0),
    };
  } else if (hole.x !== undefined && hole.y !== undefined) {
    // Legacy / Direct coordinates (Normalized)
    // We assume x/y are normalized to canvas size if no anchor is present
    // Or should we support absolute?
    // Current system uses normalized.
    // Coordinate.denormalizePoint logic:
    return {
      x: hole.x * canvasSize.width,
      y: hole.y * canvasSize.height,
    };
  }
  return { x: 0, y: 0 };
}

export interface GeometryOptions {
  shape: "rect" | "circle" | "ellipse" | "custom";
  width: number;
  height: number;
  radius: number;
  x: number;
  y: number;
  holes: Array<HoleData>;
  pathData?: string;
}

export interface MaskGeometryOptions extends GeometryOptions {
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Initializes paper.js project if not already initialized.
 */
function ensurePaper(width: number, height: number) {
  if (!paper.project) {
    paper.setup(new paper.Size(width, height));
  } else {
    paper.view.viewSize = new paper.Size(width, height);
  }
}

/**
 * Creates the base dieline shape (Rect/Circle/Ellipse/Custom)
 */
function createBaseShape(options: GeometryOptions): paper.PathItem {
  const { shape, width, height, radius, x, y, pathData } = options;
  const center = new paper.Point(x, y);

  if (shape === "rect") {
    return new paper.Path.Rectangle({
      point: [x - width / 2, y - height / 2],
      size: [Math.max(0, width), Math.max(0, height)],
      radius: Math.max(0, radius),
    });
  } else if (shape === "circle") {
    const r = Math.min(width, height) / 2;
    return new paper.Path.Circle({
      center: center,
      radius: Math.max(0, r),
    });
  } else if (shape === "ellipse") {
    return new paper.Path.Ellipse({
      center: center,
      radius: [Math.max(0, width / 2), Math.max(0, height / 2)],
    });
  } else if (shape === "custom" && pathData) {
    const path = new paper.Path();
    path.pathData = pathData;
    // Align center
    path.position = center;
    // Scale to match width/height if needed?
    // For now, assume pathData is correct size, but we might want to support resizing.
    // If width/height are provided and different from bounds, we could scale.
    if (
      width > 0 &&
      height > 0 &&
      path.bounds.width > 0 &&
      path.bounds.height > 0
    ) {
      path.scale(width / path.bounds.width, height / path.bounds.height);
    }
    return path;
  } else {
    // Fallback
    return new paper.Path.Rectangle({
      point: [x - width / 2, y - height / 2],
      size: [Math.max(0, width), Math.max(0, height)],
    });
  }
}

/**
 * Creates an offset version of the base shape.
 * For Rect/Circle, we can just adjust params.
 * For Custom shapes, we need a true offset algorithm (Paper.js doesn't have a robust one built-in for all cases,
 * but we can simulate it or use a simple scaling if offset is small, OR rely on a library like Clipper.js.
 * However, since we want to avoid heavy deps, let's try a simple approach:
 * If it's a simple shape, we re-create it.
 * If it's custom, we unfortunately have to scale it for now as a poor-man's offset,
 * UNLESS we implement a stroke expansion.
 *
 * Stroke Expansion Trick:
 * 1. Create path
 * 2. Set strokeWidth = offset * 2
 * 3. Convert stroke to path (paper.js has path.expand())
 * 4. Union original + expanded (for positive offset) or Subtract (for negative).
 */
function createOffsetShape(
  options: GeometryOptions,
  offset: number,
): paper.PathItem {
  const { shape, width, height, radius, x, y, pathData } = options;
  const center = new paper.Point(x, y);

  if (shape === "rect" || shape === "circle" || shape === "ellipse") {
    // For standard shapes, we can just adjust the dimensions
    const offsetOptions = {
      ...options,
      width: Math.max(0, width + offset * 2),
      height: Math.max(0, height + offset * 2),
      radius: radius === 0 ? 0 : Math.max(0, radius + offset),
    };
    return createBaseShape(offsetOptions);
  } else if (shape === "custom" && pathData) {
    const original = createBaseShape(options);
    if (offset === 0) return original;

    // Use Stroke Expansion for Offset
    // Create a copy for stroking
    const stroker = original.clone() as paper.Path;
    stroker.strokeColor = new paper.Color("black");
    stroker.strokeWidth = Math.abs(offset) * 2;
    // Round join usually looks better for offsets
    stroker.strokeJoin = "round";
    stroker.strokeCap = "round";

    // Expand stroke to path
    // @ts-ignore - paper.js types might be missing expand depending on version, but it exists in recent versions
    // If expand is not available, we might fallback to scaling.
    // Assuming modern paper.js
    let expanded: paper.Item;
    try {
      // @ts-ignore
      expanded = stroker.expand({ stroke: true, fill: false, insert: false });
    } catch (e) {
      // Fallback if expand fails or not present
      stroker.remove();
      // Fallback to scaling (imperfect)
      const scaleX =
        (original.bounds.width + offset * 2) / original.bounds.width;
      const scaleY =
        (original.bounds.height + offset * 2) / original.bounds.height;
      original.scale(scaleX, scaleY);
      return original;
    }

    stroker.remove();

    // The expanded stroke is a "ring".
    // For positive offset: Union(Original, Ring)
    // For negative offset: Subtract(Original, Ring) ? No, that makes a hole.
    // For negative offset: We want the "inner" boundary of the ring.

    // Actually, expand() returns a Group or Path.
    // If it's a closed path, the ring has an outer and inner boundary.

    let result: paper.PathItem;

    if (offset > 0) {
      // @ts-ignore
      result = original.unite(expanded);
    } else {
      // For negative offset (shrink), we want the original MINUS the stroke?
      // No, the stroke is centered on the line.
      // So the inner edge of the stroke is at -offset.
      // We want the area INSIDE the inner edge.
      // That is Original SUBTRACT the Ring?
      // Yes, if we subtract the ring, we lose the border area.
      // @ts-ignore
      result = original.subtract(expanded);
    }

    // Cleanup
    original.remove();
    expanded.remove();

    return result;
  }

  return createBaseShape(options);
}

/**
 * Internal helper to generate the Dieline Shape (Paper Item).
 * Caller is responsible for cleanup.
 */
function getDielineShape(options: GeometryOptions): paper.PathItem {
  // 1. Create Base Shape
  let mainShape = createBaseShape(options);

  const { holes } = options;

  if (holes && holes.length > 0) {
    let lugsPath: paper.PathItem | null = null;
    let cutsPath: paper.PathItem | null = null;

    holes.forEach((hole) => {
      // Create Lug (Outer Radius)
      const lug = new paper.Path.Circle({
        center: [hole.x, hole.y],
        radius: hole.outerRadius,
      });

      // REMOVED: Intersects check. We want to process all holes defined in config.
      // If a hole is completely outside, it might form an island, but that's better than missing it.
      // Users can remove the hole if they don't want it.

      // Create Cut (Inner Radius)
      const cut = new paper.Path.Circle({
        center: [hole.x, hole.y],
        radius: hole.innerRadius,
      });

      // Union Lugs
      if (!lugsPath) {
        lugsPath = lug;
      } else {
        try {
          const temp = lugsPath.unite(lug);
          lugsPath.remove();
          lug.remove();
          lugsPath = temp;
        } catch (e) {
          console.error("Geometry: Failed to unite lug", e);
          // Keep previous lugsPath, ignore this one to prevent crash
          lug.remove();
        }
      }

      // Union Cuts
      if (!cutsPath) {
        cutsPath = cut;
      } else {
        try {
          const temp = cutsPath.unite(cut);
          cutsPath.remove();
          cut.remove();
          cutsPath = temp;
        } catch (e) {
          console.error("Geometry: Failed to unite cut", e);
          cut.remove();
        }
      }
    });

    // 2. Add Lugs to Main Shape (Union) - Additive Fusion
    if (lugsPath) {
      try {
        const temp = mainShape.unite(lugsPath);
        mainShape.remove();
        // @ts-ignore
        lugsPath.remove();
        mainShape = temp;
      } catch (e) {
        console.error("Geometry: Failed to unite lugsPath to mainShape", e);
      }
    }

    // 3. Subtract Cuts from Main Shape (Difference)
    if (cutsPath) {
      try {
        const temp = mainShape.subtract(cutsPath);
        mainShape.remove();
        // @ts-ignore
        cutsPath.remove();
        mainShape = temp;
      } catch (e) {
        console.error("Geometry: Failed to subtract cutsPath from mainShape", e);
      }
    }
  }

  return mainShape;
}

/**
 * Generates the path data for the Dieline (Product Shape).
 * Logic: (BaseShape UNION IntersectingLugs) SUBTRACT Cuts
 */
export function generateDielinePath(options: GeometryOptions): string {
  ensurePaper(options.width * 2, options.height * 2);
  paper.project.activeLayer.removeChildren();

  const mainShape = getDielineShape(options);

  const pathData = mainShape.pathData;
  mainShape.remove();

  return pathData;
}

/**
 * Generates the path data for the Mask (Background Overlay).
 * Logic: Canvas SUBTRACT ProductShape
 */
export function generateMaskPath(options: MaskGeometryOptions): string {
  ensurePaper(options.canvasWidth, options.canvasHeight);
  paper.project.activeLayer.removeChildren();

  const { canvasWidth, canvasHeight } = options;

  // 1. Canvas Background
  const maskRect = new paper.Path.Rectangle({
    point: [0, 0],
    size: [canvasWidth, canvasHeight],
  });

  // 2. Re-create Product Shape
  const mainShape = getDielineShape(options);

  // 3. Subtract Product from Mask
  const finalMask = maskRect.subtract(mainShape);

  maskRect.remove();
  mainShape.remove();

  const pathData = finalMask.pathData;
  finalMask.remove();

  return pathData;
}

/**
 * Generates the path data for the Bleed Zone (Area between Original and Offset).
 */
export function generateBleedZonePath(
  options: GeometryOptions,
  offset: number,
): string {
  // Ensure canvas is large enough
  const maxDim = Math.max(options.width, options.height) + Math.abs(offset) * 4;
  ensurePaper(maxDim, maxDim);
  paper.project.activeLayer.removeChildren();

  // 1. Original Shape
  const shapeOriginal = getDielineShape(options);

  // 2. Offset Shape
  // We use createOffsetShape for more accurate offset (especially for custom shapes)
  // But we still need to respect holes if they exist.
  // getDielineShape handles holes.
  // The issue is: do holes shrink/expand with bleed?
  // Usually, bleed is only for the outer cut. Holes are internal cuts.
  // Internal cuts usually also have bleed if they are die-cut, but maybe different direction?
  // For simplicity, let's assume we offset the FINAL shape (including holes).

  // Actually, getDielineShape calls createBaseShape.
  // Let's modify generateBleedZonePath to use createOffsetShape logic if possible,
  // OR just perform offset on the final shape result.

  // The previous logic was: create base shape with adjusted width/height/radius.
  // This works for Rect/Circle.
  // For Custom, we need createOffsetShape.

  let shapeOffset: paper.PathItem;

  if (options.shape === "custom") {
    // For custom shape, we offset the base shape first, then apply holes?
    // Or offset the final result?
    // Bleed is usually "outside" the cut line.
    // If we have a donut, bleed is outside the outer circle AND inside the inner circle?
    // Or just outside the outer?
    // Let's assume bleed expands the solid area.

    // So we take the final shape (Original) and expand it.
    // We can use the same Stroke Expansion trick on the final shape.

    // Since shapeOriginal is already the final shape (Base - Holes),
    // we can try to offset it directly.

    const stroker = shapeOriginal.clone() as paper.Path;
    stroker.strokeColor = new paper.Color("black");
    stroker.strokeWidth = Math.abs(offset) * 2;
    stroker.strokeJoin = "round";
    stroker.strokeCap = "round";

    let expanded: paper.Item;
    try {
      // @ts-ignore
      expanded = stroker.expand({ stroke: true, fill: false, insert: false });
    } catch (e) {
      // Fallback
      stroker.remove();
      shapeOffset = shapeOriginal.clone();
      // scaling fallback...
      return shapeOffset.pathData; // Fail gracefully
    }
    stroker.remove();

    if (offset > 0) {
      // @ts-ignore
      shapeOffset = shapeOriginal.unite(expanded);
    } else {
      // @ts-ignore
      shapeOffset = shapeOriginal.subtract(expanded);
    }
    expanded.remove();
  } else {
    // Legacy logic for standard shapes (still valid and fast)
    // Adjust dimensions for offset
    const offsetOptions: GeometryOptions = {
      ...options,
      width: Math.max(0, options.width + offset * 2),
      height: Math.max(0, options.height + offset * 2),
      radius: options.radius === 0 ? 0 : Math.max(0, options.radius + offset),
    };
    shapeOffset = getDielineShape(offsetOptions);
  }

  // 3. Calculate Difference
  let bleedZone: paper.PathItem;
  if (offset > 0) {
    bleedZone = shapeOffset.subtract(shapeOriginal);
  } else {
    bleedZone = shapeOriginal.subtract(shapeOffset);
  }

  const pathData = bleedZone.pathData;

  // Cleanup
  shapeOriginal.remove();
  shapeOffset.remove();
  bleedZone.remove();

  return pathData;
}

/**
 * Finds the nearest point on the Dieline geometry for a given target point.
 * Used for constraining hole movement.
 */
export function getNearestPointOnDieline(
  point: { x: number; y: number },
  options: GeometryOptions,
): { x: number; y: number } {
  ensurePaper(options.width * 2, options.height * 2);
  paper.project.activeLayer.removeChildren();

  const shape = createBaseShape(options);

  const p = new paper.Point(point.x, point.y);
  const nearest = shape.getNearestPoint(p);

  const result = { x: nearest.x, y: nearest.y };
  shape.remove();

  return result;
}

export function getPathBounds(pathData: string): {
  width: number;
  height: number;
} {
  const path = new paper.Path();
  path.pathData = pathData;
  const bounds = path.bounds;
  path.remove();
  return { width: bounds.width, height: bounds.height };
}
