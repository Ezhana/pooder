import paper from "paper";

export type FeatureOperation = "add" | "subtract";
export type FeatureShape = "rect" | "circle";

export interface EdgeFeature {
  id: string;
  groupId?: string; // For grouping features together (e.g. double-layer hole)
  operation: FeatureOperation;
  shape: FeatureShape;
  x: number; // Normalized 0-1 relative to geometry bounds
  y: number; // Normalized 0-1 relative to geometry bounds
  width?: number; // For rect (Physical units)
  height?: number; // For rect (Physical units)
  radius?: number; // For circle or rect corners (Physical units)
  rotation?: number; // Degrees
}

export interface GeometryOptions {
  shape: "rect" | "circle" | "ellipse" | "custom";
  width: number;
  height: number;
  radius: number;
  x: number;
  y: number;
  features: Array<EdgeFeature>;
  pathData?: string;
  canvasWidth?: number;
  canvasHeight?: number;
}

export interface MaskGeometryOptions extends GeometryOptions {
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Resolves the absolute position of a feature based on normalized coordinates.
 */
export function resolveFeaturePosition(
  feature: EdgeFeature,
  geometry: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const { x, y, width, height } = geometry;
  // geometry.x/y is the Center.
  const left = x - width / 2;
  const top = y - height / 2;

  return {
    x: left + feature.x * width,
    y: top + feature.y * height,
  };
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
    return new paper.Path.Rectangle({
      point: [x - width / 2, y - height / 2],
      size: [Math.max(0, width), Math.max(0, height)],
    });
  }
}

/**
 * Creates a Paper.js Item for a single feature.
 */
function createFeatureItem(
  feature: EdgeFeature,
  center: paper.Point,
): paper.PathItem {
  let item: paper.PathItem;

  if (feature.shape === "rect") {
    const w = feature.width || 10;
    const h = feature.height || 10;
    const r = feature.radius || 0;
    item = new paper.Path.Rectangle({
      point: [center.x - w / 2, center.y - h / 2],
      size: [w, h],
      radius: r,
    });
  } else {
    // Circle
    const r = feature.radius || 5;
    item = new paper.Path.Circle({
      center: center,
      radius: r,
    });
  }

  if (feature.rotation) {
    item.rotate(feature.rotation, center);
  }

  return item;
}

/**
 * Internal helper to generate the Dieline Shape (Paper Item).
 * Logic: (Base U Adds) - Subtracts
 */
function getDielineShape(options: GeometryOptions): paper.PathItem {
  // 1. Create Base Shape
  let mainShape = createBaseShape(options);

  const { features } = options;

  if (features && features.length > 0) {
    const adds: paper.PathItem[] = [];
    const subtracts: paper.PathItem[] = [];

    features.forEach((f) => {
      const pos = resolveFeaturePosition(f, options);
      const center = new paper.Point(pos.x, pos.y);
      const item = createFeatureItem(f, center);
      
      if (f.operation === "add") {
        adds.push(item);
      } else {
        subtracts.push(item);
      }
    });

    // 2. Process Additions (Union)
    if (adds.length > 0) {
      // Unite all additions first to avoid artifacts?
      // Or unite one by one to mainShape?
      // Unite one by one is safer for simple logic.
      for (const item of adds) {
        try {
          const temp = mainShape.unite(item);
          mainShape.remove();
          item.remove();
          mainShape = temp;
        } catch (e) {
          console.error("Geometry: Failed to unite feature", e);
          item.remove();
        }
      }
    }

    // 3. Process Subtractions (Difference)
    if (subtracts.length > 0) {
      for (const item of subtracts) {
        try {
          const temp = mainShape.subtract(item);
          mainShape.remove();
          item.remove();
          mainShape = temp;
        } catch (e) {
          console.error("Geometry: Failed to subtract feature", e);
          item.remove();
        }
      }
    }
  }

  return mainShape;
}

/**
 * Generates the path data for the Dieline (Product Shape).
 */
export function generateDielinePath(options: GeometryOptions): string {
  const paperWidth = options.canvasWidth || options.width * 2 || 2000;
  const paperHeight = options.canvasHeight || options.height * 2 || 2000;
  ensurePaper(paperWidth, paperHeight);
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

  const maskRect = new paper.Path.Rectangle({
    point: [0, 0],
    size: [canvasWidth, canvasHeight],
  });

  const mainShape = getDielineShape(options);

  const finalMask = maskRect.subtract(mainShape);

  maskRect.remove();
  mainShape.remove();

  const pathData = finalMask.pathData;
  finalMask.remove();

  return pathData;
}

/**
 * Generates the path data for the Bleed Zone.
 */
export function generateBleedZonePath(
  options: GeometryOptions,
  offset: number,
): string {
  const paperWidth = options.canvasWidth || options.width * 2 || 2000;
  const paperHeight = options.canvasHeight || options.height * 2 || 2000;
  ensurePaper(paperWidth, paperHeight);
  paper.project.activeLayer.removeChildren();

  // 1. Original Shape (Base + Features)
  const shapeOriginal = getDielineShape(options);

  // 2. Offset Shape
  // We offset the FINAL shape now, because features are part of the dieline.
  
  const stroker = shapeOriginal.clone() as paper.Path;
  stroker.strokeColor = new paper.Color("black");
  stroker.strokeWidth = Math.abs(offset) * 2;
  stroker.strokeJoin = "round";
  stroker.strokeCap = "round";

  let expanded: paper.Item;
  let shapeOffset: paper.PathItem;

  try {
    // @ts-ignore
    expanded = stroker.expand({ stroke: true, fill: false, insert: false });
    
    if (offset > 0) {
      // @ts-ignore
      shapeOffset = shapeOriginal.unite(expanded);
    } else {
      // @ts-ignore
      shapeOffset = shapeOriginal.subtract(expanded);
    }
    expanded.remove();
  } catch (e) {
    // Fallback if expand fails
    stroker.remove();
    shapeOffset = shapeOriginal.clone();
    // Simple scale fallback?
    // shapeOffset.scale(...)
  }
  stroker.remove();

  // 3. Calculate Difference
  let bleedZone: paper.PathItem;
  if (offset > 0) {
    bleedZone = shapeOffset.subtract(shapeOriginal);
  } else {
    bleedZone = shapeOriginal.subtract(shapeOffset);
  }

  const pathData = bleedZone.pathData;

  shapeOriginal.remove();
  shapeOffset.remove();
  bleedZone.remove();

  return pathData;
}

/**
 * Finds the nearest point on the Dieline geometry (Base Shape ONLY) for a given target point.
 * Used for constraining feature movement.
 */
export function getNearestPointOnDieline(
  point: { x: number; y: number },
  options: GeometryOptions,
): { x: number; y: number } {
  ensurePaper(options.width * 2, options.height * 2);
  paper.project.activeLayer.removeChildren();

  // We constrain to the BASE shape, not including other features,
  // because usually you want to snap to the main edge.
  const shape = createBaseShape(options);

  const p = new paper.Point(point.x, point.y);
  const nearest = shape.getNearestPoint(p);

  const result = { x: nearest.x, y: nearest.y };
  shape.remove();

  return result;
}

export function getPathBounds(pathData: string): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const path = new paper.Path();
  path.pathData = pathData;
  const bounds = path.bounds;
  path.remove();
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}
