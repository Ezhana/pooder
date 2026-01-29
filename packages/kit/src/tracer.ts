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
      threshold?: number; // 0-255, default 10
      simplifyTolerance?: number; // default 2.0 (Balanced)
      scale?: number; // Scale factor for the processing canvas, default 1.0
      scaleToWidth?: number;
      scaleToHeight?: number;
      morphologyRadius?: number; // Default 10.
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

    // 2. Morphology processing
    const threshold = options.threshold ?? 10;
    // Adaptive radius: 3% of the image's largest dimension, at least 5px
    const adaptiveRadius = Math.max(
      5,
      Math.floor(Math.max(width, height) * 0.02),
    );
    const radius = options.morphologyRadius ?? adaptiveRadius;

    let mask = this.createMask(imageData, threshold);
    if (radius > 0) {
      // Closing operation: Dilation followed by Erosion to merge parts and smooth
      mask = this.dilate(mask, width, height, radius);
      mask = this.erode(mask, width, height, radius);
      // Fill internal holes to ensure we only get the overall outer contour
      mask = this.fillHoles(mask, width, height);
    }

    // 3. Trace contours from the unified mask
    const allContourPoints = this.traceAllContours(mask, width, height);

    if (allContourPoints.length === 0) {
      // Fallback: Return a rectangular outline matching dimensions
      const w = options.scaleToWidth ?? width;
      const h = options.scaleToHeight ?? height;
      return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
    }

    // 4. Select the largest contour to ensure a single, consistent overall shape
    const primaryContour = allContourPoints.sort(
      (a, b) => b.length - a.length,
    )[0];

    // 5. Find bounds for the selected contour
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const p of primaryContour) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    const globalBounds = {
      minX,
      minY,
      width: maxX - minX,
      height: maxY - minY,
    };

    // 6. Post-processing
    let finalPoints = primaryContour;
    if (options.scaleToWidth && options.scaleToHeight) {
      finalPoints = this.scalePoints(
        primaryContour,
        options.scaleToWidth,
        options.scaleToHeight,
        globalBounds,
      );
    }

    const simplifiedPoints = this.douglasPeucker(
      finalPoints,
      options.simplifyTolerance ?? 2.0,
    );

    return this.pointsToSVG(simplifiedPoints);
  }

  private static createMask(
    imageData: ImageData,
    threshold: number,
  ): Uint8Array {
    const { width, height, data } = imageData;
    const mask = new Uint8Array(width * height);

    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      // Alpha threshold + White background heuristic
      if (a > threshold && !(r > 240 && g > 240 && b > 240)) {
        mask[i] = 1;
      } else {
        mask[i] = 0;
      }
    }
    return mask;
  }

  /**
   * Fast 1D-separable Dilation
   */
  private static dilate(
    mask: Uint8Array,
    width: number,
    height: number,
    radius: number,
  ): Uint8Array {
    const horizontal = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      let count = 0;
      for (let x = -radius; x < width; x++) {
        if (x + radius < width && mask[y * width + x + radius]) count++;
        if (x - radius - 1 >= 0 && mask[y * width + x - radius - 1]) count--;
        if (x >= 0) horizontal[y * width + x] = count > 0 ? 1 : 0;
      }
    }

    const vertical = new Uint8Array(width * height);
    for (let x = 0; x < width; x++) {
      let count = 0;
      for (let y = -radius; y < height; y++) {
        if (y + radius < height && horizontal[(y + radius) * width + x])
          count++;
        if (y - radius - 1 >= 0 && horizontal[(y - radius - 1) * width + x])
          count--;
        if (y >= 0) vertical[y * width + x] = count > 0 ? 1 : 0;
      }
    }
    return vertical;
  }

  /**
   * Fast 1D-separable Erosion
   */
  private static erode(
    mask: Uint8Array,
    width: number,
    height: number,
    radius: number,
  ): Uint8Array {
    const horizontal = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      let count = 0;
      for (let x = -radius; x < width; x++) {
        if (x + radius < width && mask[y * width + x + radius]) count++;
        if (x - radius - 1 >= 0 && mask[y * width + x - radius - 1]) count--;
        if (x >= 0) {
          const winWidth =
            Math.min(x + radius, width - 1) - Math.max(x - radius, 0) + 1;
          horizontal[y * width + x] = count === winWidth ? 1 : 0;
        }
      }
    }

    const vertical = new Uint8Array(width * height);
    for (let x = 0; x < width; x++) {
      let count = 0;
      for (let y = -radius; y < height; y++) {
        if (y + radius < height && horizontal[(y + radius) * width + x])
          count++;
        if (y - radius - 1 >= 0 && horizontal[(y - radius - 1) * width + x])
          count--;
        if (y >= 0) {
          const winHeight =
            Math.min(y + radius, height - 1) - Math.max(y - radius, 0) + 1;
          vertical[y * width + x] = count === winHeight ? 1 : 0;
        }
      }
    }
    return vertical;
  }

  /**
   * Fills internal holes in the binary mask using flood fill from edges.
   */
  private static fillHoles(
    mask: Uint8Array,
    width: number,
    height: number,
  ): Uint8Array {
    const background = new Uint8Array(width * height);
    const queue: [number, number][] = [];

    // Add all edge pixels that are 0 to the queue
    for (let x = 0; x < width; x++) {
      if (mask[x] === 0) {
        background[x] = 1;
        queue.push([x, 0]);
      }
      const lastRow = (height - 1) * width + x;
      if (mask[lastRow] === 0) {
        background[lastRow] = 1;
        queue.push([x, height - 1]);
      }
    }
    for (let y = 1; y < height - 1; y++) {
      if (mask[y * width] === 0) {
        background[y * width] = 1;
        queue.push([0, y]);
      }
      if (mask[y * width + width - 1] === 0) {
        background[y * width + width - 1] = 1;
        queue.push([width - 1, y]);
      }
    }

    // Flood fill from the edges to find all background pixels
    const dirs = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];
    let head = 0;
    while (head < queue.length) {
      const [cx, cy] = queue[head++];
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nidx = ny * width + nx;
          if (mask[nidx] === 0 && background[nidx] === 0) {
            background[nidx] = 1;
            queue.push([nx, ny]);
          }
        }
      }
    }

    // Any pixel that is NOT reachable from the background is part of the "filled" mask
    const filledMask = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      filledMask[i] = background[i] === 0 ? 1 : 0;
    }

    return filledMask;
  }

  /**
   * Traces all contours in the mask with optimized start-point detection
   */
  private static traceAllContours(
    mask: Uint8Array,
    width: number,
    height: number,
  ): Point[][] {
    const visited = new Uint8Array(width * height);
    const allContours: Point[][] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (mask[idx] && !visited[idx]) {
          // Only start a new trace if it's a potential outer boundary (left edge)
          const isLeftEdge = x === 0 || mask[idx - 1] === 0;
          if (isLeftEdge) {
            const contour = this.marchingSquares(
              mask,
              visited,
              x,
              y,
              width,
              height,
            );
            if (contour.length > 2) {
              allContours.push(contour);
            }
          }
        }
      }
    }
    return allContours;
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
    mask: Uint8Array,
    visited: Uint8Array,
    startX: number,
    startY: number,
    width: number,
    height: number,
  ): Point[] {
    const isSolid = (x: number, y: number): boolean => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      return mask[y * width + x] === 1;
    };

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
      visited[cy * width + cx] = 1; // Mark as visited to avoid re-starting here

      // Search for next solid neighbor in clockwise order, starting from backtrack
      let found = false;

      for (let i = 0; i < 8; i++) {
        const idx = (backtrack + 1 + i) % 8;
        const nx = cx + neighbors[idx].x;
        const ny = cy + neighbors[idx].y;

        if (isSolid(nx, ny)) {
          cx = nx;
          cy = ny;
          backtrack = (idx + 4 + 1) % 8;
          found = true;
          break;
        }
      }

      if (!found) break;

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
    bounds: { minX: number; minY: number; width: number; height: number },
  ): Point[] {
    if (points.length === 0) return points;

    if (bounds.width === 0 || bounds.height === 0) return points;

    const scaleX = targetWidth / bounds.width;
    const scaleY = targetHeight / bounds.height;

    return points.map((p) => ({
      x: (p.x - bounds.minX) * scaleX,
      y: (p.y - bounds.minY) * scaleY,
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
