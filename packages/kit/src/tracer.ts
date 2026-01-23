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
      scaleToWidth?: number;
      scaleToHeight?: number;
    } = {},
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

    // 2.1 Scale points if target size is provided
    let finalPoints = points;
    if (options.scaleToWidth && options.scaleToHeight && points.length > 0) {
      finalPoints = this.scalePoints(
        points,
        options.scaleToWidth,
        options.scaleToHeight,
      );
    }

    // 3. Simplify path
    const simplifiedPoints = this.douglasPeucker(
      finalPoints,
      options.simplifyTolerance ?? 0.5,
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
   * Moore-Neighbor Tracing Algorithm
   * More robust for irregular shapes than simple Marching Squares walker.
   */
  private static marchingSquares(
    imageData: ImageData,
    alphaThreshold: number,
  ): Point[] {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // Use Luminance for solid check if Alpha is fully opaque
    // Or check Alpha first, then Luminance?
    // Let's assume:
    // If pixel is transparent (Alpha <= threshold), it's empty.
    // If pixel is opaque (Alpha > threshold):
    //    If it's white (Luminance > some_high_value), it's empty (background).
    //    Else it's solid.
    // This supports black shapes on white background (JPG).

    // Luminance = 0.299*R + 0.587*G + 0.114*B
    // We treat "Dark" as solid? Or "Light" as solid?
    // Usually "Content" is non-white on white background.
    // Let's add a `luminanceThreshold` option?
    // For now, let's hardcode a heuristic:
    // If R,G,B are all > 240, treat as background (white).

    const isSolid = (x: number, y: number): boolean => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];

      if (a <= alphaThreshold) return false;

      // Check for White Background (approx)
      // If average > 240, treat as empty
      if (r > 240 && g > 240 && b > 240) return false;

      return true;
    };

    // 1. Find Starting Pixel (Scanline)
    // We want the *largest* contour ideally, or the first one.
    // For now, let's just find the first one.
    // To support holes, we would need to keep scanning.
    // But Moore Tracing follows a single contour.

    let startX = -1;
    let startY = -1;

    // Gaussian Blur Simulation (Box Blur) to reduce noise?
    // Or just simple neighbor check?
    // Let's implement a simple noise filter in isSolid? No, isSolid is per pixel.
    // Let's preprocess data? Too slow in JS?
    // Let's just rely on threshold.

    searchLoop: for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (isSolid(x, y)) {
          startX = x;
          startY = y;
          break searchLoop;
        }
      }
    }

    if (startX === -1) return [];

    const points: Point[] = [];

    // Moore-Neighbor Tracing
    // We enter from the Left (since we scan Left->Right), so "backtrack" is Left.
    // B = (startX - 1, startY)
    // P = (startX, startY)

    let cx = startX;
    let cy = startY;

    // Start backtrack direction: Left (since we found it scanning from left)
    // Directions: 0=Up, 1=UpRight, 2=Right, 3=DownRight, 4=Down, 5=DownLeft, 6=Left, 7=UpLeft
    // Offsets for 8 neighbors starting from Up (0,-1) clockwise
    const neighbors = [
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: -1, y: 1 },
      { x: -1, y: 0 },
      { x: -1, y: -1 },
    ];

    // Backtrack is Left -> Index 6.
    let backtrack = 6;

    const maxSteps = width * height * 3;
    let steps = 0;

    do {
      points.push({ x: cx, y: cy });

      // Search for next solid neighbor in clockwise order, starting from backtrack
      let found = false;

      // We check 8 neighbors.
      // Moore algorithm says: start from backtrack, go clockwise until you find a black pixel.
      // The backtrack for the NEXT step will be the neighbor BEFORE the one we found.

      for (let i = 0; i < 8; i++) {
        // Index in neighbors array. Start from backtrack direction.
        // Actually Moore algorithm typically starts from (backtrack + 1) % 8 ?
        // Let's standard: Start searching clockwise from the pixel entered from.

        const idx = (backtrack + 1 + i) % 8;
        const nx = cx + neighbors[idx].x;
        const ny = cy + neighbors[idx].y;

        if (isSolid(nx, ny)) {
          // Found next pixel P
          cx = nx;
          cy = ny;
          // New backtrack is the neighbor pointing back to current P from previous P?
          // No, backtrack is the empty neighbor immediately counter-clockwise from the new P.
          // In our loop, it's the previous index (idx - 1).
          backtrack = (idx + 4) % 8; // Actually, backtrack direction relative to New P is opposite?
          // Let's strictly follow Moore:
          // Entering P from direction D. Start scan from D-1 (or D+something).
          // Let's use the property:
          // We entered P from `idx`. The previous check `idx-1` was empty.
          // So for the next step, we can start checking from `idx-3` (approx 90 deg back) or `idx-2`.
          // Standard Moore: Backtrack = neighbor index that was empty previously.
          // Here, `idx` is the direction FROM old P TO new P.
          // The direction FROM new P TO old P is `(idx + 4) % 8`.
          // We want to start scanning around new P.
          // We start scanning from the neighbor that is "Left" of the incoming edge.

          // Let's simplify: Start scanning from (EntryDirection + 5) % 8 ?
          // EntryDirection is (idx). Backwards is (idx+4).
          // We want to start from the white pixel we just passed.
          // That was `(idx - 1)`.
          // Direction FROM old P to (idx-1) is neighbors[idx-1].
          // We want direction FROM new P to that same white pixel? No.

          // Working Heuristic:
          // Next search starts from (current_incoming_direction + 4 + 1) ?
          // Let's set backtrack to point to the neighbor we entered from, then rotate CCW?
          // Let's use: start search from `(idx + 5) % 8`.
          // Why? idx is direction 0..7. Back is idx+4. +1 is clockwise.
          // We want counter-clockwise.

          backtrack = (idx + 4 + 1) % 8; // Start searching from neighbor "after" the one we came from (CCW)?
          // Wait, loop above is Clockwise.
          // To trace outer boundary counter-clockwise, we scan neighbors counter-clockwise?
          // Or trace outer boundary clockwise, scan neighbors clockwise.

          // Let's trace Clockwise.
          // Scan neighbors Clockwise.
          // Start scan from (IncomingDirection + 5) % 8. (Backwards + 1 CW).
          backtrack = (idx + 4 + 1) % 8; // Backwards + 1 step CW.

          // But wait, if we are tracing an 1-pixel line, we turn around (backtrack).
          // Let's try `(idx + 5) % 8` if neighbors are ordered CW.
          // neighbors[0] is Up. [2] is Right.
          // If we move Right (idx=2). Back is Left (6).
          // We want to check UpLeft (7), Up (0), UpRight (1)...
          // So start from 7? That is 6+1.
          // So `(idx + 4 + 1) % 8` seems correct.

          found = true;
          break;
        }
      }

      if (!found) {
        // Isolated pixel
        break;
      }

      steps++;
    } while ((cx !== startX || cy !== startY) && steps < maxSteps);

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
      // Check if closed loop?
      // If closed loop, we shouldn't simplify start/end connection too much?
      // Douglas-Peucker works on segments.
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

  private static scalePoints(
    points: Point[],
    targetWidth: number,
    targetHeight: number,
  ): Point[] {
    if (points.length === 0) return points;

    // Find bounds
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    const srcW = maxX - minX;
    const srcH = maxY - minY;

    if (srcW === 0 || srcH === 0) return points;

    const scaleX = targetWidth / srcW;
    const scaleY = targetHeight / srcH;

    // Scale and center? Or just scale?
    // User usually wants to fit the shape into the box.
    // Let's just scale and align top-left to 0,0 for now, or center it?
    // Dieline usually expects centered shape?
    // geometry.ts createBaseShape aligns path.position = center.
    // So the path data coordinates should probably be relative to 0,0 or centered.
    // Paper.js Path(pathData) creates path in original coordinates.
    // If we return points in 0..targetWidth, 0..targetHeight, paper will create it there.
    // geometry.ts will then center it.

    return points.map((p) => ({
      x: (p.x - minX) * scaleX,
      y: (p.y - minY) * scaleY,
    }));
  }

  private static pointsToSVG(points: Point[]): string {
    if (points.length === 0) return "";
    const head = points[0];
    const tail = points.slice(1);

    return (
      `M ${head.x} ${head.y} ` +
      tail.map((p) => `L ${p.x} ${p.y}`).join(" ") +
      " Z"
    );
  }
}
