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
  static calculateLayout(
    container: Size,
    content: Size,
    padding = 0,
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

  static toNormalized(value: number, total: number): number {
    return total === 0 ? 0 : value / total;
  }

  static toAbsolute(normalized: number, total: number): number {
    return normalized * total;
  }

  static normalizePoint(point: Point, size: Size): Point {
    return {
      x: this.toNormalized(point.x, size.width),
      y: this.toNormalized(point.y, size.height),
    };
  }

  static denormalizePoint(point: Point, size: Size): Point {
    return {
      x: this.toAbsolute(point.x, size.width),
      y: this.toAbsolute(point.y, size.height),
    };
  }

  static convertUnit(value: number, from: Unit, to: Unit): number {
    if (from === to) return value;

    const toMm: Record<Unit, number> = {
      px: 0.264583,
      mm: 1,
      cm: 10,
      in: 25.4,
    };

    const mmValue = value * (from === "px" ? toMm.px : toMm[from] || 1);

    if (to === "px") {
      return mmValue / toMm.px;
    }
    return mmValue / (toMm[to] || 1);
  }
}
