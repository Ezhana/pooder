export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export class Coordinate {
  /**
   * Convert an absolute value to a normalized value (0-1).
   * @param value Absolute value (e.g., pixels)
   * @param total Total dimension size (e.g., canvas width)
   */
  static toNormalized(value: number, total: number): number {
    return total === 0 ? 0 : value / total;
  }

  /**
   * Convert a normalized value (0-1) to an absolute value.
   * @param normalized Normalized value (0-1)
   * @param total Total dimension size (e.g., canvas width)
   */
  static toAbsolute(normalized: number, total: number): number {
    return normalized * total;
  }

  /**
   * Normalize a point's coordinates.
   */
  static normalizePoint(point: Point, size: Size): Point {
    return {
      x: this.toNormalized(point.x, size.width),
      y: this.toNormalized(point.y, size.height),
    };
  }

  /**
   * Denormalize a point's coordinates to absolute pixels.
   */
  static denormalizePoint(point: Point, size: Size): Point {
    return {
      x: this.toAbsolute(point.x, size.width),
      y: this.toAbsolute(point.y, size.height),
    };
  }
}
