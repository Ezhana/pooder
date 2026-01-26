export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Unit = "px" | "mm" | "cm" | "in";

export interface Layout {
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export class Coordinate {
  /**
   * Calculate layout to fit content within container while preserving aspect ratio.
   */
  static calculateLayout(
    container: Size,
    content: Size,
    padding: number = 0,
  ): Layout {
    const availableWidth = Math.max(0, container.width - padding * 2);
    const availableHeight = Math.max(0, container.height - padding * 2);

    if (content.width === 0 || content.height === 0) {
      return { scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 };
    }

    const scaleX = availableWidth / content.width;
    const scaleY = availableHeight / content.height;
    const scale = Math.min(scaleX, scaleY);

    const width = content.width * scale;
    const height = content.height * scale;

    const offsetX = (container.width - width) / 2;
    const offsetY = (container.height - height) / 2;

    return { scale, offsetX, offsetY, width, height };
  }

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
