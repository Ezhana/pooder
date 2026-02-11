/**
 * Image Tracer Utility
 * Converts raster images (URL/Base64) to SVG Path Data using Marching Squares algorithm.
 */

import paper from "paper";
import {
  circularMorphology,
  createMask,
  fillHoles,
  findMinimalConnectRadius,
  polygonSignedArea,
  type MaskMode,
} from "./maskOps";

interface Point {
  x: number;
  y: number;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
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
      simplifyTolerance?: number; // default 2.5
      scale?: number; // Scale factor for the processing canvas, default 1.0
      scaleToWidth?: number;
      scaleToHeight?: number;
      morphologyRadius?: number; // Default 10.
      connectRadiusMax?: number;
      maskMode?: MaskMode;
      whiteThreshold?: number;
      alphaOpaqueCutoff?: number;
      expand?: number; // Expansion radius in pixels. Default 0.
      noChannels?: boolean;
      smoothing?: boolean; // Use Paper.js smoothing (curve fitting). Default true.
    } = {},
  ): Promise<string> {
    const { pathData } = await this.traceWithBounds(imageUrl, options);
    return pathData;
  }

  public static async traceWithBounds(
    imageUrl: string,
    options: {
      threshold?: number;
      simplifyTolerance?: number;
      scale?: number;
      scaleToWidth?: number;
      scaleToHeight?: number;
      morphologyRadius?: number;
      connectRadiusMax?: number;
      maskMode?: MaskMode;
      whiteThreshold?: number;
      alphaOpaqueCutoff?: number;
      expand?: number;
      noChannels?: boolean;
      smoothing?: boolean;
    } = {},
  ): Promise<{ pathData: string; baseBounds: Bounds; bounds: Bounds }> {
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
    const expand = options.expand ?? 0;
    const noChannels = options.noChannels !== false;

    // Add padding to the processing canvas to avoid edge clipping during dilation
    // Padding should be at least the radius + expansion size
    const padding = radius + expand + 2;
    const paddedWidth = width + padding * 2;
    const paddedHeight = height + padding * 2;

    let mask = createMask(imageData, {
      threshold,
      padding,
      paddedWidth,
      paddedHeight,
      maskMode: options.maskMode,
      whiteThreshold: options.whiteThreshold,
      alphaOpaqueCutoff: options.alphaOpaqueCutoff,
    });

    const connectRadiusMax =
      options.connectRadiusMax ?? Math.max(10, Math.floor(Math.max(width, height) * 0.12));

    const rConnect = findMinimalConnectRadius(
      mask,
      paddedWidth,
      paddedHeight,
      connectRadiusMax,
    );

    if (rConnect > 0) {
      mask = circularMorphology(mask, paddedWidth, paddedHeight, rConnect, "closing");
    }

    if (radius > 0) {
      mask = circularMorphology(mask, paddedWidth, paddedHeight, radius, "closing");
    }

    if (noChannels) {
      mask = fillHoles(mask, paddedWidth, paddedHeight);
    }

    if (radius > 0) {
      const smoothRadius = Math.max(2, Math.floor(radius * 0.3));
      mask = circularMorphology(mask, paddedWidth, paddedHeight, smoothRadius, "closing");
    }

    const baseMask = mask;
    const baseContour = this.pickPrimaryContour(
      this.traceAllContours(baseMask, paddedWidth, paddedHeight),
    );

    if (!baseContour) {
      // Fallback: Return a rectangular outline matching dimensions
      const w = options.scaleToWidth ?? width;
      const h = options.scaleToHeight ?? height;
      return {
        pathData: `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`,
        baseBounds: { x: 0, y: 0, width: w, height: h },
        bounds: { x: 0, y: 0, width: w, height: h },
      };
    }

    const baseUnpadded = baseContour.map(p => ({
      x: p.x - padding,
      y: p.y - padding,
    }));
    let baseBounds = this.boundsFromPoints(baseUnpadded);

    let maskExpanded = baseMask;
    if (expand > 0) {
      maskExpanded = circularMorphology(baseMask, paddedWidth, paddedHeight, expand, "dilate");
    }

    const expandedContour = this.pickPrimaryContour(
      this.traceAllContours(maskExpanded, paddedWidth, paddedHeight),
    );
    if (!expandedContour) {
      return {
        pathData: `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`,
        baseBounds,
        bounds: baseBounds,
      };
    }

    const expandedUnpadded = expandedContour.map(p => ({
      x: p.x - padding,
      y: p.y - padding,
    }));
    let globalBounds = this.boundsFromPoints(expandedUnpadded);

    // 9. Post-processing (Scale)
    let finalPoints = expandedUnpadded;
    if (options.scaleToWidth && options.scaleToHeight) {
      finalPoints = this.scalePoints(
        expandedUnpadded,
        options.scaleToWidth,
        options.scaleToHeight,
        globalBounds,
      );
      globalBounds = this.boundsFromPoints(finalPoints);

      const baseScaled = this.scalePoints(
        baseUnpadded,
        options.scaleToWidth,
        options.scaleToHeight,
        baseBounds,
      );
      baseBounds = this.boundsFromPoints(baseScaled);
    }

    // 10. Simplify and Generate SVG
    const useSmoothing = options.smoothing !== false; // Default true
    
    if (useSmoothing) {
      return {
        pathData: this.pointsToSVGPaper(finalPoints, options.simplifyTolerance ?? 2.5),
        baseBounds,
        bounds: globalBounds,
      };
    } else {
      const simplifiedPoints = this.douglasPeucker(
        finalPoints,
        options.simplifyTolerance ?? 2.0,
      );
      return {
        pathData: this.pointsToSVG(simplifiedPoints),
        baseBounds,
        bounds: globalBounds,
      };
    }
  }

  private static pickPrimaryContour(contours: Point[][]): Point[] | null {
    if (contours.length === 0) return null;
    return contours.reduce((best, cur) => {
      if (!best) return cur;
      const bestArea = Math.abs(polygonSignedArea(best));
      const curArea = Math.abs(polygonSignedArea(cur));
      if (curArea !== bestArea) return curArea > bestArea ? cur : best;
      return cur.length > best.length ? cur : best;
    }, contours[0]);
  }

  private static boundsFromPoints(points: Point[]): Bounds {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  private static createMask(
    imageData: ImageData,
    threshold: number,
    padding: number,
    paddedWidth: number,
    paddedHeight: number,
  ): Uint8Array {
    const { width, height, data } = imageData;
    const mask = new Uint8Array(paddedWidth * paddedHeight);

    // 1. Detect if the image has transparency (any pixel with alpha < 255)
    let hasTransparency = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        hasTransparency = true;
        break;
      }
    }

    // 2. Binarize based on alpha or luminance
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 4;
        const r = data[srcIdx];
        const g = data[srcIdx + 1];
        const b = data[srcIdx + 2];
        const a = data[srcIdx + 3];

        const destIdx = (y + padding) * paddedWidth + (x + padding);

        if (hasTransparency) {
          if (a > threshold) {
            mask[destIdx] = 1;
          }
        } else {
          if (!(r > 240 && g > 240 && b > 240)) {
            mask[destIdx] = 1;
          }
        }
      }
    }
    return mask;
  }

  /**
   * Fast circular morphology using a distance-transform inspired separable approach.
   * O(N * R) complexity, where R is the radius.
   */
  private static circularMorphology(
    mask: Uint8Array,
    width: number,
    height: number,
    radius: number,
    op: "dilate" | "erode" | "closing" | "opening",
  ): Uint8Array {
    const dilate = (m: Uint8Array, r: number) => {
      const horizontalDist = new Int32Array(width * height);
      // Horizontal pass: dist to nearest solid pixel in row
      for (let y = 0; y < height; y++) {
        let lastSolid = -r * 2;
        for (let x = 0; x < width; x++) {
          if (m[y * width + x]) lastSolid = x;
          horizontalDist[y * width + x] = x - lastSolid;
        }
        lastSolid = width + r * 2;
        for (let x = width - 1; x >= 0; x--) {
          if (m[y * width + x]) lastSolid = x;
          horizontalDist[y * width + x] = Math.min(
            horizontalDist[y * width + x],
            lastSolid - x,
          );
        }
      }

      const result = new Uint8Array(width * height);
      const r2 = r * r;
      // Vertical pass: check Euclidean distance using precomputed horizontal distances
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          let found = false;
          const minY = Math.max(0, y - r);
          const maxY = Math.min(height - 1, y + r);
          for (let dy = minY; dy <= maxY; dy++) {
            const dY = dy - y;
            const hDist = horizontalDist[dy * width + x];
            if (hDist * hDist + dY * dY <= r2) {
              found = true;
              break;
            }
          }
          if (found) result[y * width + x] = 1;
        }
      }
      return result;
    };

    const erode = (m: Uint8Array, r: number) => {
      // Erosion is dilation of the inverted mask
      const inverted = new Uint8Array(m.length);
      for (let i = 0; i < m.length; i++) inverted[i] = m[i] ? 0 : 1;
      const dilatedInverted = dilate(inverted, r);
      const result = new Uint8Array(m.length);
      for (let i = 0; i < m.length; i++) result[i] = dilatedInverted[i] ? 0 : 1;
      return result;
    };

    switch (op) {
      case "dilate":
        return dilate(mask, radius);
      case "erode":
        return erode(mask, radius);
      case "closing":
        return erode(dilate(mask, radius), radius);
      case "opening":
        return dilate(erode(mask, radius), radius);
      default:
        return mask;
    }
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
    bounds: { x: number; y: number; width: number; height: number },
  ): Point[] {
    if (points.length === 0) return points;

    if (bounds.width === 0 || bounds.height === 0) return points;

    const scaleX = targetWidth / bounds.width;
    const scaleY = targetHeight / bounds.height;

    return points.map((p) => ({
      x: (p.x - bounds.x) * scaleX,
      y: (p.y - bounds.y) * scaleY,
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

  private static ensurePaper() {
    if (!paper.project) {
      paper.setup(new paper.Size(100, 100));
    }
  }

  private static pointsToSVGPaper(points: Point[], tolerance: number): string {
    if (points.length < 3) return this.pointsToSVG(points);
    
    this.ensurePaper();
    
    // Create Path
    const path = new paper.Path({
      segments: points.map(p => [p.x, p.y]),
      closed: true
    });
    
    // Simplify
    path.simplify(tolerance);
    
    const data = path.pathData;
    path.remove();
    
    return data;
  }
}
