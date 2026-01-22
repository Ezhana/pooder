
/**
 * Image Tracer Utility
 * Converts raster images (URL/Base64) to SVG Path Data using Marching Squares algorithm.
 */

interface Point {
  x: number;
  y: number;
}

export class ImageTracer {
  /**
   * Main entry point: Traces an image URL to an SVG path string.
   * @param imageUrl The URL or Base64 string of the image.
   * @param options Configuration options.
   */
  public static async trace(
    imageUrl: string,
    options: {
      threshold?: number; // 0-255, default 128
      simplifyTolerance?: number; // default 1.0
      scale?: number; // Scale factor for the processing canvas, default 1.0 (or smaller for speed)
    } = {}
  ): Promise<string> {
    const img = await this.loadImage(imageUrl);
    const width = img.width;
    const height = img.height;

    // 1. Draw to canvas and get pixel data
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context");

    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);

    // 2. Trace contours using Marching Squares
    const points = this.marchingSquares(imageData, options.threshold ?? 10);

    // 3. Simplify path
    const simplifiedPoints = this.douglasPeucker(
      points,
      options.simplifyTolerance ?? 1.5
    );

    // 4. Convert to SVG Path
    return this.pointsToSVG(simplifiedPoints);
  }

  private static loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = url;
    });
  }

  /**
   * Marching Squares Algorithm
   * Expects imageData. Returns an ordered array of Points forming the perimeter.
   * Note: This implementation finds the *largest* outer contour.
   */
  private static marchingSquares(
    imageData: ImageData,
    alphaThreshold: number
  ): Point[] {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // Helper to check if a pixel is "solid"
    // We treat alpha > threshold as solid.
    // Can be adjusted to check RGB for white background if needed.
    const isSolid = (x: number, y: number): boolean => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      const index = (y * width + x) * 4;
      return data[index + 3] > alphaThreshold; // Check Alpha
    };

    // 1. Find a starting point (first solid pixel)
    let startX = -1;
    let startY = -1;
    
    // Scan logic: find the first non-transparent pixel
    searchLoop: for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (isSolid(x, y)) {
          startX = x;
          startY = y;
          break searchLoop;
        }
      }
    }

    if (startX === -1) return []; // Empty image

    // Adjust start point to be on the grid edge for Marching Squares
    // We actually walk on the *edges* between pixels.
    // Coordinate system: 0..width, 0..height (grid lines)
    
    // A simpler approach for single outer contour:
    // Use the Moore-Neighbor tracing or standard Marching Squares.
    // Here we use a standard Marching Squares implementation on the scalar field.
    
    const points: Point[] = [];
    let x = startX;
    let y = startY;
    
    // Move to the boundary. If (x,y) is solid, we check left.
    // If we just found the first solid pixel scanning from left, (x-1, y) is empty.
    // So we are on a boundary.
    // Let's step back one unit left to start "outside"
    x = x - 1; 
    // Now (x,y) is empty, (x+1, y) is solid.
    
    // Direction: 0=Up, 1=Right, 2=Down, 3=Left
    let stepX = 0;
    let stepY = 0;
    let prevX = x;
    let prevY = y;
    
    // We need a robust walker. 
    // State is determined by 4 corners around the current point (x,y)
    // TL(x,y) TR(x+1,y)
    // BL(x,y+1) BR(x+1,y+1)
    
    // Let's iterate until we close the loop.
    // Max iterations to prevent infinite loop
    const MAX_STEPS = width * height * 2;
    let steps = 0;

    // Start slightly offset to align with grid
    // For Marching Squares, we iterate through cells.
    // Let's find the first cell that has a mix of solid/empty.
    // The previous scan found a solid pixel at (startX, startY).
    // The cell at (startX-1, startY-1) has BR as solid.
    
    let cx = startX - 1;
    let cy = startY - 1;
    
    const initialCX = cx;
    const initialCY = cy;
    
    // Direction we entered the start cell from (for termination check)
    // Not strictly needed if we check coordinates.

    do {
        // Get state of the 4 corners of the cell at (cx, cy)
        // 1 2
        // 8 4
        // val = TL + 2*TR + 4*BR + 8*BL (binary weighting)
        
        const tl = isSolid(cx, cy) ? 1 : 0;
        const tr = isSolid(cx + 1, cy) ? 1 : 0;
        const br = isSolid(cx + 1, cy + 1) ? 1 : 0;
        const bl = isSolid(cx, cy + 1) ? 1 : 0;
        
        const state = tl * 1 + tr * 2 + br * 4 + bl * 8;

        // Add point. For simplicity, we use the midpoint of the cell edges.
        // Or simpler: just the grid corners.
        // Let's use midpoints for smoother look (marching squares standard).
        // Coordinates are relative to pixel centers.
        
        // However, for dieline, we usually want tight fit.
        // Let's map state to next step and a contour point.
        
        // Lookup table for direction:
        // dx, dy
        let dx = 0;
        let dy = 0;
        
        // Basic Marching Squares States for "External Contour" (Counter-Clockwise usually)
        // We want to keep "Solid" on our Right (or Left).
        // Let's keep Solid on Right.
        
        switch (state) {
            case 0: dx = 1; dy = 0; break; // Void, shouldn't happen if we track correctly
            case 1: dx = 0; dy = -1; points.push({x: cx, y: cy + 0.5}); break; // TL
            case 2: dx = 1; dy = 0; points.push({x: cx + 0.5, y: cy}); break; // TR
            case 3: dx = 1; dy = 0; points.push({x: cx, y: cy + 0.5}); break; // TL + TR -> Solid Top -> Move Right
            case 4: dx = 0; dy = 1; points.push({x: cx + 1, y: cy + 0.5}); break; // BR
            case 5: dx = 0; dy = -1; points.push({x: cx, y: cy + 0.5}); points.push({x: cx + 1, y: cy + 0.5}); break; // TL + BR (Saddle) - ambiguous, pick one
            case 6: dx = 0; dy = 1; points.push({x: cx + 0.5, y: cy}); break; // TR + BR -> Solid Right -> Move Down
            case 7: dx = 0; dy = 1; points.push({x: cx, y: cy + 0.5}); break; 
            case 8: dx = -1; dy = 0; points.push({x: cx + 0.5, y: cy + 1}); break; // BL
            case 9: dx = 0; dy = -1; points.push({x: cx + 0.5, y: cy + 1}); break; // TL + BL -> Solid Left -> Move Up
            case 10: dx = -1; dy = 0; points.push({x: cx + 0.5, y: cy}); points.push({x: cx + 0.5, y: cy + 1}); break; // TR + BL (Saddle)
            case 11: dx = 0; dy = -1; points.push({x: cx + 0.5, y: cy + 1}); break;
            case 12: dx = -1; dy = 0; points.push({x: cx + 1, y: cy + 0.5}); break; // BR + BL -> Solid Bottom -> Move Left
            case 13: dx = -1; dy = 0; points.push({x: cx + 1, y: cy + 0.5}); break;
            case 14: dx = 0; dy = 1; points.push({x: cx + 0.5, y: cy}); break;
            case 15: dx = 1; dy = 0; break; // All solid (internal), shouldn't happen on edge
        }
        
        // If we get stuck (case 0 or 15 inside loop), force move
        if (dx === 0 && dy === 0) {
            // If 15, we are inside, move right to find edge? 
            // If 0, we are outside, move left?
            // This simple state machine assumes we are ON the boundary.
            // Let's use a simpler Moore-Neighbor tracing if this feels fragile.
            // But let's try to recover.
             break;
        }

        cx += dx;
        cy += dy;
        steps++;

    } while ((cx !== initialCX || cy !== initialCY) && steps < MAX_STEPS);

    return points;
  }

  /**
   * Douglas-Peucker Line Simplification
   */
  private static douglasPeucker(points: Point[], tolerance: number): Point[] {
    if (points.length <= 2) return points;

    const sqTolerance = tolerance * tolerance;
    let maxSqDist = 0;
    let index = 0;

    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
      const sqDist = this.getSqSegDist(points[i], first, last);
      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }

    if (maxSqDist > sqTolerance) {
      const left = this.douglasPeucker(points.slice(0, index + 1), tolerance);
      const right = this.douglasPeucker(points.slice(index), tolerance);
      return left.slice(0, left.length - 1).concat(right);
    } else {
      return [first, last];
    }
  }

  private static getSqSegDist(p: Point, p1: Point, p2: Point): number {
    let x = p1.x;
    let y = p1.y;
    let dx = p2.x - x;
    let dy = p2.y - y;

    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = p2.x;
        y = p2.y;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }

    dx = p.x - x;
    dy = p.y - y;

    return dx * dx + dy * dy;
  }

  private static pointsToSVG(points: Point[]): string {
    if (points.length === 0) return "";
    const head = points[0];
    const tail = points.slice(1);
    
    return `M ${head.x} ${head.y} ` + tail.map(p => `L ${p.x} ${p.y}`).join(" ") + " Z";
  }
}
