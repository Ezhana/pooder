import paper from 'paper';

export interface HoleData {
    x: number;
    y: number;
    innerRadius: number;
    outerRadius: number;
}

export interface GeometryOptions {
    shape: 'rect' | 'circle' | 'ellipse';
    width: number;
    height: number;
    radius: number;
    x: number;
    y: number;
    holes: Array<HoleData>;
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
    }
}

/**
 * Creates the base dieline shape (Rect/Circle/Ellipse)
 */
function createBaseShape(options: GeometryOptions): paper.PathItem {
    const { shape, width, height, radius, x, y } = options;
    const center = new paper.Point(x, y);

    if (shape === 'rect') {
        return new paper.Path.Rectangle({
            point: [x - width / 2, y - height / 2],
            size: [Math.max(0, width), Math.max(0, height)],
            radius: Math.max(0, radius)
        });
    } else if (shape === 'circle') {
        const r = Math.min(width, height) / 2;
        return new paper.Path.Circle({
            center: center,
            radius: Math.max(0, r)
        });
    } else { // ellipse
        return new paper.Path.Ellipse({
            center: center,
            radius: [Math.max(0, width / 2), Math.max(0, height / 2)]
        });
    }
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

        holes.forEach(hole => {
            // Create Lug (Outer Radius)
            const lug = new paper.Path.Circle({
                center: [hole.x, hole.y],
                radius: hole.outerRadius
            });
            
            // Check intersection with main body
            // Only add lug if it intersects (or is contained in) the main shape
            // This prevents floating islands when bleed shrinks
            if (!mainShape.intersects(lug) && !mainShape.contains(lug.position)) {
                 lug.remove();
                 return; // Skip this lug
            }

            // Create Cut (Inner Radius)
            const cut = new paper.Path.Circle({
                center: [hole.x, hole.y],
                radius: hole.innerRadius
            });

            // Union Lugs
            if (!lugsPath) {
                lugsPath = lug;
            } else {
                const temp = lugsPath.unite(lug);
                lugsPath.remove();
                lug.remove();
                lugsPath = temp;
            }

            // Union Cuts
            if (!cutsPath) {
                cutsPath = cut;
            } else {
                const temp = cutsPath.unite(cut);
                cutsPath.remove();
                cut.remove();
                cutsPath = temp;
            }
        });

        // 2. Add Lugs to Main Shape (Union) - Additive Fusion
        if (lugsPath) {
            const temp = mainShape.unite(lugsPath);
            mainShape.remove();
            // @ts-ignore
            lugsPath.remove();
            mainShape = temp;
        }

        // 3. Subtract Cuts from Main Shape (Difference)
        if (cutsPath) {
            const temp = mainShape.subtract(cutsPath);
            mainShape.remove();
            // @ts-ignore
            cutsPath.remove();
            mainShape = temp;
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
        size: [canvasWidth, canvasHeight]
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
export function generateBleedZonePath(options: GeometryOptions, offset: number): string {
    // Ensure canvas is large enough
    const maxDim = Math.max(options.width, options.height) + Math.abs(offset) * 4;
    ensurePaper(maxDim, maxDim);
    paper.project.activeLayer.removeChildren();

    // 1. Original Shape
    const shapeOriginal = getDielineShape(options);

    // 2. Offset Shape
    // Adjust dimensions for offset
    const offsetOptions: GeometryOptions = {
        ...options,
        width: Math.max(0, options.width + offset * 2),
        height: Math.max(0, options.height + offset * 2),
        radius: options.radius === 0 ? 0 : Math.max(0, options.radius + offset)
    };
    
    const shapeOffset = getDielineShape(offsetOptions);

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
export function getNearestPointOnDieline(point: {x: number, y: number}, options: GeometryOptions): {x: number, y: number} {
    ensurePaper(options.width * 2, options.height * 2);
    paper.project.activeLayer.removeChildren();

    const shape = createBaseShape(options);
    
    const p = new paper.Point(point.x, point.y);
    const nearest = shape.getNearestPoint(p);
    
    const result = { x: nearest.x, y: nearest.y };
    shape.remove();
    
    return result;
}
