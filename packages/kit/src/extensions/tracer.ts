/**
 * Image Tracer Utility
 * Converts raster images (URL/Base64) to SVG Path Data using Marching Squares algorithm.
 */

import paper from "paper";
import {
  circularMorphology,
  createMask,
  fillHoles,
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

type ComponentMode = "largest" | "all";

interface ForceConnectResult {
  mask: Uint8Array;
  appliedRadius: number;
  reachedSingleContour: boolean;
  rawContourCount: number;
  selectedContourCount: number;
}

export interface ImageTraceOptions {
  threshold?: number;
  simplifyTolerance?: number;
  expand?: number;
  smoothing?: boolean;
  scaleToWidth?: number;
  scaleToHeight?: number;
  debug?: boolean;
}

export class ImageTracer {
  /**
   * Main entry point: Traces an image URL to an SVG path string.
   * @param imageUrl The URL or Base64 string of the image.
   * @param options Configuration options.
   */
  public static async trace(
    imageUrl: string,
    options: ImageTraceOptions = {},
  ): Promise<string> {
    const { pathData } = await this.traceWithBounds(imageUrl, options);
    return pathData;
  }

  public static async traceWithBounds(
    imageUrl: string,
    options: ImageTraceOptions = {},
  ): Promise<{ pathData: string; baseBounds: Bounds; bounds: Bounds }> {
    const img = await this.loadImage(imageUrl);
    const width = img.width;
    const height = img.height;
    const debug = options.debug === true;
    const debugLog = (message: string, payload?: Record<string, unknown>) => {
      if (!debug) return;
      if (payload) {
        console.info(`[ImageTracer] ${message}`, payload);
        return;
      }
      console.info(`[ImageTracer] ${message}`);
    };

    // 1. Draw to canvas and get pixel data
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context");

    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);

    // 2. Mask and contour strategy (single connected silhouette by default)
    const threshold = options.threshold ?? 10;
    const expand = Math.max(0, Math.floor(options.expand ?? 0));
    const componentMode: ComponentMode = "all";
    const minComponentArea = 0;
    const forceConnected = true;
    const fillChannels = true;
    const simplifyTolerance = options.simplifyTolerance ?? 2.5;
    const useSmoothing = options.smoothing !== false;
    const maxDim = Math.max(width, height);

    // Internal morphology strategy; not exposed externally.
    const maskMode: MaskMode = "auto";
    const whiteThreshold = 240;
    const alphaOpaqueCutoff = 250;
    const baseCloseRadius = Math.max(
      2,
      Math.floor(Math.max(maxDim * 0.012, expand * 0.35)),
    );
    const smoothCloseRadius = Math.max(1, Math.floor(baseCloseRadius * 0.25));
    const connectSearchStartRadius = Math.max(
      1,
      Math.floor(Math.max(maxDim * 0.006, expand * 0.2)),
    );
    const connectSearchMaxRadius = Math.max(
      connectSearchStartRadius,
      Math.floor(Math.max(maxDim * 0.2, expand * 2.5)),
    );

    debugLog("traceWithBounds:start", {
      width,
      height,
      threshold,
      expand,
      simplifyTolerance,
      smoothing: useSmoothing,
      strategy: {
        maskMode,
        fillChannels,
        forceConnected,
        baseCloseRadius,
        smoothCloseRadius,
        connectSearchStartRadius,
        connectSearchMaxRadius,
      },
    });

    // Padding must cover the largest possible morphology radius and expand.
    const padding = Math.max(baseCloseRadius, connectSearchMaxRadius, expand) + 2;
    const paddedWidth = width + padding * 2;
    const paddedHeight = height + padding * 2;
    const summarizeMaskContours = (m: Uint8Array) => {
      const contoursRaw = this.traceAllContours(m, paddedWidth, paddedHeight);
      return {
        rawContourCount: contoursRaw.length,
        modeSelectedCount: this.selectContours(
          contoursRaw,
          componentMode,
          minComponentArea,
        ).length,
        allSelectedCount: this.selectContours(contoursRaw, "all", minComponentArea)
          .length,
      };
    };

    let mask = createMask(imageData, {
      threshold,
      padding,
      paddedWidth,
      paddedHeight,
      maskMode,
      whiteThreshold,
      alphaOpaqueCutoff,
    });
    if (debug) {
      debugLog("traceWithBounds:mask:after-create", summarizeMaskContours(mask));
    }

    if (baseCloseRadius > 0) {
      mask = circularMorphology(
        mask,
        paddedWidth,
        paddedHeight,
        baseCloseRadius,
        "closing",
      );
    }
    if (debug && baseCloseRadius > 0) {
      debugLog("traceWithBounds:mask:after-main-close", {
        radius: baseCloseRadius,
        ...summarizeMaskContours(mask),
      });
    }

    if (fillChannels) {
      mask = fillHoles(mask, paddedWidth, paddedHeight);
    }
    if (debug && fillChannels) {
      debugLog("traceWithBounds:mask:after-fill-holes", summarizeMaskContours(mask));
    }

    if (smoothCloseRadius > 0) {
      mask = circularMorphology(
        mask,
        paddedWidth,
        paddedHeight,
        smoothCloseRadius,
        "closing",
      );
    }
    if (fillChannels && smoothCloseRadius > 0) {
      mask = fillHoles(mask, paddedWidth, paddedHeight);
    }
    if (debug && smoothCloseRadius > 0) {
      debugLog("traceWithBounds:mask:after-smooth-close", {
        smoothRadius: smoothCloseRadius,
        ...summarizeMaskContours(mask),
      });
    }

    if (forceConnected) {
      const beforeForceConnect = summarizeMaskContours(mask);
      if (beforeForceConnect.allSelectedCount > 1) {
        const forceConnectedResult = this.findForceConnectResult(
          mask,
          paddedWidth,
          paddedHeight,
          minComponentArea,
          fillChannels,
          connectSearchStartRadius,
          connectSearchMaxRadius,
        );
        if (debug) {
          debugLog("traceWithBounds:mask:force-connect", {
            before: beforeForceConnect,
            appliedRadius: forceConnectedResult.appliedRadius,
            reachedSingleContour: forceConnectedResult.reachedSingleContour,
            after: {
              rawContourCount: forceConnectedResult.rawContourCount,
              allSelectedCount: forceConnectedResult.selectedContourCount,
            },
          });
        }
        mask = forceConnectedResult.mask;
      } else if (debug) {
        debugLog("traceWithBounds:mask:force-connect-skipped", {
          reason: "already-single-component",
          before: beforeForceConnect,
        });
      }
    }

    const baseMask = mask;
    const baseContoursRaw = this.traceAllContours(
      baseMask,
      paddedWidth,
      paddedHeight,
    );
    const baseContours = this.selectContours(
      baseContoursRaw,
      componentMode,
      minComponentArea,
    );

    if (!baseContours.length) {
      // Fallback: Return a rectangular outline matching dimensions
      const w = options.scaleToWidth ?? width;
      const h = options.scaleToHeight ?? height;
      debugLog("fallback:no-base-contour", { width: w, height: h });
      return {
        pathData: `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`,
        baseBounds: { x: 0, y: 0, width: w, height: h },
        bounds: { x: 0, y: 0, width: w, height: h },
      };
    }

    const baseUnpaddedContours = baseContours
      .map((contour) =>
        this.clampPointsToImageBounds(
          contour.map((p) => ({
            x: p.x - padding,
            y: p.y - padding,
          })),
          width,
          height,
        ),
      )
      .filter((contour) => contour.length > 2);

    if (!baseUnpaddedContours.length) {
      const w = options.scaleToWidth ?? width;
      const h = options.scaleToHeight ?? height;
      debugLog("fallback:empty-base-contours", { width: w, height: h });
      return {
        pathData: `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`,
        baseBounds: { x: 0, y: 0, width: w, height: h },
        bounds: { x: 0, y: 0, width: w, height: h },
      };
    }

    let baseBounds = this.boundsFromPoints(
      this.flattenContours(baseUnpaddedContours),
    );

    let maskExpanded = baseMask;
    if (expand > 0) {
      maskExpanded = circularMorphology(
        baseMask,
        paddedWidth,
        paddedHeight,
        expand,
        "dilate",
      );
    }

    const expandedContoursRaw = this.traceAllContours(
      maskExpanded,
      paddedWidth,
      paddedHeight,
    );
    const expandedContours = this.selectContours(
      expandedContoursRaw,
      componentMode,
      minComponentArea,
    );
    if (!expandedContours.length) {
      debugLog("fallback:no-expanded-contour", {
        baseBounds,
        width,
        height,
        expand,
      });
      return {
        pathData: `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`,
        baseBounds,
        bounds: baseBounds,
      };
    }

    // Keep expanded coordinates in the unpadded space without clamping to
    // original image bounds. If the shape touches an edge, clamping would
    // drop one-sided expand distance (e.g. bottom/right expansion).
    const expandedUnpaddedContours = expandedContours
      .map((contour) =>
        contour.map((p) => ({
          x: p.x - padding,
          y: p.y - padding,
        })),
      )
      .filter((contour) => contour.length > 2);
    if (!expandedUnpaddedContours.length) {
      debugLog("fallback:empty-expanded-contours", {
        baseBounds,
        width,
        height,
        expand,
      });
      return {
        pathData: `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`,
        baseBounds,
        bounds: baseBounds,
      };
    }

    let globalBounds = this.boundsFromPoints(
      this.flattenContours(expandedUnpaddedContours),
    );

    // 9. Post-processing (Scale)
    let finalContours = expandedUnpaddedContours;
    if (options.scaleToWidth && options.scaleToHeight) {
      finalContours = this.scaleContours(
        expandedUnpaddedContours,
        options.scaleToWidth,
        options.scaleToHeight,
        globalBounds,
      );
      globalBounds = this.boundsFromPoints(this.flattenContours(finalContours));

      const baseScaledContours = this.scaleContours(
        baseUnpaddedContours,
        options.scaleToWidth,
        options.scaleToHeight,
        baseBounds,
      );
      baseBounds = this.boundsFromPoints(
        this.flattenContours(baseScaledContours),
      );
    }

    // 10. Simplify and Generate SVG
    debugLog("traceWithBounds:contours", {
      baseContourCount: baseContoursRaw.length,
      baseSelectedCount: baseContours.length,
      expandedContourCount: expandedContoursRaw.length,
      expandedSelectedCount: expandedContours.length,
      baseBounds,
      expandedBounds: globalBounds,
      expandedDeltaX: globalBounds.width - baseBounds.width,
      expandedDeltaY: globalBounds.height - baseBounds.height,
      expandedMayOverflowImageBounds: expand > 0,
      useSmoothing,
      componentMode,
    });

    if (useSmoothing) {
      return {
        pathData: this.contoursToSVGPaper(
          finalContours,
          simplifyTolerance,
        ),
        baseBounds,
        bounds: globalBounds,
      };
    } else {
      const simplifiedContours = finalContours
        .map((points) => this.douglasPeucker(points, simplifyTolerance))
        .filter((points) => points.length > 2);
      const pathData =
        this.contoursToSVG(simplifiedContours) ||
        this.contoursToSVG(finalContours);
      return {
        pathData,
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

  private static flattenContours(contours: Point[][]): Point[] {
    return contours.flatMap((contour) => contour);
  }

  private static contourCentroid(points: Point[]): Point {
    if (!points.length) return { x: 0, y: 0 };
    const sum = points.reduce(
      (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
      { x: 0, y: 0 },
    );
    return {
      x: sum.x / points.length,
      y: sum.y / points.length,
    };
  }

  private static pointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;
    const { x, y } = point;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      const intersects =
        yi > y !== yj > y &&
        x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  private static keepOutermostContours(contours: Point[][]): Point[][] {
    if (contours.length <= 1) return contours;

    const sorted = [...contours].sort(
      (a, b) => Math.abs(polygonSignedArea(b)) - Math.abs(polygonSignedArea(a)),
    );
    const selected: Point[][] = [];
    for (const contour of sorted) {
      const centroid = this.contourCentroid(contour);
      const isNested = selected.some((outer) =>
        this.pointInPolygon(centroid, outer),
      );
      if (!isNested) {
        selected.push(contour);
      }
    }
    return selected;
  }

  private static summarizeAllContours(
    mask: Uint8Array,
    width: number,
    height: number,
    minComponentArea: number,
  ): { rawCount: number; selectedCount: number } {
    const raw = this.traceAllContours(mask, width, height);
    const selected = this.selectContours(raw, "all", minComponentArea);
    return {
      rawCount: raw.length,
      selectedCount: selected.length,
    };
  }

  private static closeMaskForConnectivity(
    sourceMask: Uint8Array,
    width: number,
    height: number,
    radius: number,
    fillChannels: boolean,
  ): Uint8Array {
    let closed = circularMorphology(sourceMask, width, height, radius, "closing");
    if (fillChannels) {
      closed = fillHoles(closed, width, height);
    }
    return closed;
  }

  private static findForceConnectResult(
    sourceMask: Uint8Array,
    width: number,
    height: number,
    minComponentArea: number,
    fillChannels: boolean,
    startRadius: number,
    maxRadius: number,
  ): ForceConnectResult {
    const initial = this.summarizeAllContours(
      sourceMask,
      width,
      height,
      minComponentArea,
    );
    if (initial.selectedCount <= 1) {
      return {
        mask: sourceMask,
        appliedRadius: 0,
        reachedSingleContour: true,
        rawContourCount: initial.rawCount,
        selectedContourCount: initial.selectedCount,
      };
    }

    const normalizedStart = Math.max(1, Math.floor(startRadius));
    const normalizedMax = Math.max(normalizedStart, Math.floor(maxRadius));
    const evaluate = (radius: number) => {
      const mask = this.closeMaskForConnectivity(
        sourceMask,
        width,
        height,
        radius,
        fillChannels,
      );
      const summary = this.summarizeAllContours(
        mask,
        width,
        height,
        minComponentArea,
      );
      return {
        radius,
        mask,
        rawCount: summary.rawCount,
        selectedCount: summary.selectedCount,
      };
    };

    let low = normalizedStart - 1;
    let high = normalizedStart;
    let highResult = evaluate(high);
    while (high < normalizedMax && highResult.selectedCount > 1) {
      low = high;
      high = Math.min(normalizedMax, Math.max(high + 1, Math.floor(high * 1.6)));
      highResult = evaluate(high);
    }

    if (highResult.selectedCount > 1) {
      return {
        mask: highResult.mask,
        appliedRadius: highResult.radius,
        reachedSingleContour: false,
        rawContourCount: highResult.rawCount,
        selectedContourCount: highResult.selectedCount,
      };
    }

    let best = highResult;
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      const midResult = evaluate(mid);
      if (midResult.selectedCount <= 1) {
        best = midResult;
        high = mid;
      } else {
        low = mid;
      }
    }

    return {
      mask: best.mask,
      appliedRadius: best.radius,
      reachedSingleContour: true,
      rawContourCount: best.rawCount,
      selectedContourCount: best.selectedCount,
    };
  }

  private static selectContours(
    contours: Point[][],
    mode: ComponentMode,
    minComponentArea: number,
  ): Point[][] {
    if (!contours.length) return [];
    if (mode === "largest") {
      const primary = this.pickPrimaryContour(contours);
      return primary ? [primary] : [];
    }

    const threshold = Math.max(0, minComponentArea);
    if (threshold <= 0) {
      return this.keepOutermostContours(contours);
    }

    const filtered = contours.filter(
      (contour) => Math.abs(polygonSignedArea(contour)) >= threshold,
    );
    if (filtered.length > 0) {
      return this.keepOutermostContours(filtered);
    }

    const primary = this.pickPrimaryContour(contours);
    return primary ? [primary] : [];
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

  private static scaleContours(
    contours: Point[][],
    targetWidth: number,
    targetHeight: number,
    bounds: { x: number; y: number; width: number; height: number },
  ): Point[][] {
    return contours.map((points) =>
      this.scalePoints(points, targetWidth, targetHeight, bounds),
    );
  }

  private static clampPointsToImageBounds(
    points: Point[],
    width: number,
    height: number,
  ): Point[] {
    const maxX = Math.max(0, width);
    const maxY = Math.max(0, height);
    return points.map((p) => ({
      x: Math.max(0, Math.min(maxX, p.x)),
      y: Math.max(0, Math.min(maxY, p.y)),
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

  private static contoursToSVG(contours: Point[][]): string {
    return contours
      .filter((points) => points.length > 2)
      .map((points) => this.pointsToSVG(points))
      .join(" ")
      .trim();
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
      segments: points.map((p) => [p.x, p.y]),
      closed: true,
    });

    // Simplify
    path.simplify(tolerance);

    const data = path.pathData;
    path.remove();

    return data;
  }

  private static contoursToSVGPaper(
    contours: Point[][],
    tolerance: number,
  ): string {
    const normalizedContours = contours.filter((points) => points.length > 2);
    if (!normalizedContours.length) return "";
    if (normalizedContours.length === 1) {
      return this.pointsToSVGPaper(normalizedContours[0], tolerance);
    }

    this.ensurePaper();
    const compound = new paper.CompoundPath({ insert: false });
    for (const points of normalizedContours) {
      const child = new paper.Path({
        segments: points.map((p) => [p.x, p.y]),
        closed: true,
        insert: false,
      });
      child.simplify(tolerance);
      compound.addChild(child);
    }

    const data = compound.pathData || this.contoursToSVG(normalizedContours);
    compound.remove();
    return data;
  }
}
