import type { GeometryPoint, GeometryRect } from "./interaction";

export interface ObjectSize {
  width: number;
  height: number;
}

export interface ObjectRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ObjectTransform = Record<string, unknown>;
export type ObjectStyle = Record<string, unknown>;

export type ObjectSource =
  | {
      kind: "url";
      url: string;
      mimeType?: string;
      intrinsicSize?: ObjectSize;
    }
  | {
      kind: "data-url";
      dataUrl: string;
      mimeType?: string;
      intrinsicSize?: ObjectSize;
    }
  | {
      kind: "blob-url";
      url: string;
      transient: true;
      intrinsicSize?: ObjectSize;
    }
  | {
      kind: "path";
      pathData: string;
      sourceBounds?: ObjectRect;
      sourceSize?: ObjectSize;
    }
  | {
      kind: "shape";
      shape: "rect" | "circle" | "ellipse" | "heart";
      params: Record<string, unknown>;
    };

export type ConstraintStrategy =
  | "path"
  | "edge"
  | "inside"
  | "lowest-tangent";

export type ObjectEffect =
  | { type: "clip-source"; targetIds: string[] }
  | {
      type: "boolean";
      targetId: string;
      operation: "add" | "subtract" | "intersect" | "exclude";
      participation?: "preview" | "export" | "both";
    }
  | {
      type: "constraint";
      targetId: string;
      strategy: ConstraintStrategy;
      params?: Record<string, unknown>;
    }
  | {
      type: "interactive";
      enabled: boolean;
      session?: boolean;
      groupId?: string;
    }
  | { type: "guide"; role: "cut" | "bleed" | "safe-area"; style?: ObjectStyle };

export interface EditorObject {
  id: string;
  type: "object";
  source: ObjectSource;
  frame?: ObjectRect;
  transform?: ObjectTransform;
  style?: ObjectStyle;
  effects?: ObjectEffect[];
  metadata?: Record<string, unknown>;
}

export interface ResolvedVisual {
  source: ObjectSource;
  pathData?: string;
  imageUrl?: string;
  bounds?: GeometryRect;
  contentBounds?: GeometryRect;
  intrinsicSize?: ObjectSize;
  mimeType?: string;
}

export interface GeometryResolver {
  resolve(source: ObjectSource): ResolvedVisual | null;
  hitTest(source: ObjectSource, point: GeometryPoint): boolean;
}

export class DefaultGeometryResolver implements GeometryResolver {
  resolve(source: ObjectSource): ResolvedVisual | null {
    if (source.kind === "path") {
      const pathData = source.pathData.trim();
      if (!pathData) return null;
      const contentBounds =
        rectToBounds(source.sourceBounds) ?? inferPathBounds(pathData) ?? undefined;
      return {
        source,
        pathData,
        bounds: source.sourceSize
          ? sizeToBounds(source.sourceSize)
          : contentBounds,
        contentBounds,
        intrinsicSize: source.sourceSize,
      };
    }

    if (source.kind !== "shape") return null;
    const resolved = resolveShapeSource(source);
    return resolved ? { source, ...resolved } : null;
  }

  hitTest(source: ObjectSource, point: GeometryPoint): boolean {
    const visual = this.resolve(source);
    if (!visual?.bounds) return false;
    return containsPoint(visual.bounds, point);
  }
}

export class SourceResolver {
  constructor(private readonly geometryResolver: GeometryResolver = new DefaultGeometryResolver()) {}

  resolve(source: ObjectSource): ResolvedVisual | null {
    switch (source.kind) {
      case "url":
        return {
          source,
          imageUrl: source.url,
          mimeType: source.mimeType,
          intrinsicSize: source.intrinsicSize,
          bounds: source.intrinsicSize ? sizeToBounds(source.intrinsicSize) : undefined,
        };
      case "data-url":
        return {
          source,
          imageUrl: source.dataUrl,
          mimeType: source.mimeType,
          intrinsicSize: source.intrinsicSize,
          bounds: source.intrinsicSize ? sizeToBounds(source.intrinsicSize) : undefined,
        };
      case "blob-url":
        return {
          source,
          imageUrl: source.url,
          intrinsicSize: source.intrinsicSize,
          bounds: source.intrinsicSize ? sizeToBounds(source.intrinsicSize) : undefined,
        };
      case "path":
      case "shape":
        return this.geometryResolver.resolve(source);
      default:
        return null;
    }
  }
}

export interface BooleanCompositionInput {
  objects: readonly EditorObject[];
  targetId: string;
  participation?: "preview" | "export";
}

export interface BooleanCompositionStep {
  objectId: string;
  operation: "add" | "subtract" | "intersect" | "exclude";
  participation: "preview" | "export" | "both";
  pathData: string;
}

export interface BooleanCompositionResult {
  targetId: string;
  basePathData: string;
  pathData: string;
  steps: BooleanCompositionStep[];
  fillRule?: "nonzero" | "evenodd";
}

export class BooleanComposer {
  constructor(private readonly sourceResolver = new SourceResolver()) {}

  compose(input: BooleanCompositionInput): BooleanCompositionResult | null {
    const target = input.objects.find((object) => object.id === input.targetId);
    const basePathData = target ? this.resolvePathData(target) : null;
    if (!target || !basePathData) return null;

    const steps = input.objects.flatMap((object) => {
      if (object.id === target.id) return [];
      return (object.effects ?? [])
        .filter((effect): effect is Extract<ObjectEffect, { type: "boolean" }> =>
          effect.type === "boolean" &&
          effect.targetId === target.id &&
          participates(effect.participation, input.participation),
        )
        .flatMap((effect) => {
          const pathData = this.resolvePathData(object);
          return pathData
            ? [{
                objectId: object.id,
                operation: effect.operation,
                participation: effect.participation ?? "both",
                pathData,
              }]
            : [];
        });
    });

    if (!steps.length) {
      return { targetId: target.id, basePathData, pathData: basePathData, steps };
    }

    return {
      targetId: target.id,
      basePathData,
      pathData: [basePathData, ...steps.map((step) => step.pathData)].join(" "),
      steps,
      fillRule: steps.some((step) => step.operation !== "add")
        ? "evenodd"
        : "nonzero",
    };
  }

  private resolvePathData(object: EditorObject): string | null {
    return this.sourceResolver.resolve(object.source)?.pathData ?? null;
  }
}

export class InteractionSession {
  private readonly committed = new Map<string, EditorObject>();
  private working: Map<string, EditorObject> | null = null;
  private activeIds = new Set<string>();

  constructor(objects: readonly EditorObject[] = []) {
    objects.forEach((object) => this.committed.set(object.id, cloneObject(object)));
  }

  beginSession(objectIds: readonly string[]): EditorObject[] {
    if (this.working) {
      throw new Error("Interaction session is already active.");
    }
    this.activeIds = new Set(objectIds.map((id) => String(id || "").trim()).filter(Boolean));
    this.working = cloneObjectMap(this.committed);
    return this.getWorkingObjects();
  }

  updateTransform(objectId: string, transform: ObjectTransform): EditorObject | null {
    return this.updateObject(objectId, (object) => ({
      ...object,
      transform: { ...(object.transform ?? {}), ...transform },
    }));
  }

  updateObjectSource(objectId: string, source: ObjectSource): EditorObject | null {
    return this.updateObject(objectId, (object) => ({ ...object, source }));
  }

  updateEffects(objectId: string, effects: readonly ObjectEffect[]): EditorObject | null {
    return this.updateObject(objectId, (object) => ({
      ...object,
      effects: effects.map(cloneEffect),
    }));
  }

  completeSession(): EditorObject[] {
    if (!this.working) return this.getCommittedObjects();
    this.committed.clear();
    this.working.forEach((object) => this.committed.set(object.id, cloneObject(object)));
    this.clearSession();
    return this.getCommittedObjects();
  }

  rollbackSession(): EditorObject[] {
    this.clearSession();
    return this.getCommittedObjects();
  }

  getObject(objectId: string): EditorObject | undefined {
    return cloneObject((this.working ?? this.committed).get(objectId));
  }

  getWorkingObjects(): EditorObject[] {
    return Array.from((this.working ?? this.committed).values()).map(cloneObject);
  }

  private updateObject(
    objectId: string,
    update: (object: EditorObject) => EditorObject,
  ): EditorObject | null {
    if (!this.working) {
      throw new Error("Interaction session is not active.");
    }
    if (!this.activeIds.has(objectId)) return null;
    const current = this.working.get(objectId);
    if (!current) return null;
    const next = cloneObject(update(cloneObject(current)));
    this.working.set(objectId, next);
    return cloneObject(next);
  }

  private getCommittedObjects(): EditorObject[] {
    return Array.from(this.committed.values()).map(cloneObject);
  }

  private clearSession() {
    this.working = null;
    this.activeIds.clear();
  }
}

export function resolveObjectSource(source: ObjectSource): ResolvedVisual | null {
  return new SourceResolver().resolve(source);
}

function resolveShapeSource(
  source: Extract<ObjectSource, { kind: "shape" }>,
): Omit<ResolvedVisual, "source"> | null {
  switch (source.shape) {
    case "rect": {
      const width = positiveNumber(source.params.width, 1);
      const height = positiveNumber(source.params.height, 1);
      return {
        pathData: `M0 0H${width}V${height}H0Z`,
        bounds: { left: 0, top: 0, width, height },
        intrinsicSize: { width, height },
      };
    }
    case "circle": {
      const radius = positiveNumber(source.params.radius, 1);
      return {
        pathData: circlePath(radius, radius, radius),
        bounds: { left: 0, top: 0, width: radius * 2, height: radius * 2 },
        intrinsicSize: { width: radius * 2, height: radius * 2 },
      };
    }
    case "ellipse": {
      const rx = positiveNumber(source.params.rx, positiveNumber(source.params.width, 2) / 2);
      const ry = positiveNumber(source.params.ry, positiveNumber(source.params.height, 2) / 2);
      return {
        pathData: ellipsePath(rx, ry, rx, ry),
        bounds: { left: 0, top: 0, width: rx * 2, height: ry * 2 },
        intrinsicSize: { width: rx * 2, height: ry * 2 },
      };
    }
    case "heart": {
      const width = positiveNumber(source.params.width, 100);
      const height = positiveNumber(source.params.height, 90);
      return {
        pathData: heartPath(width, height),
        bounds: { left: 0, top: 0, width, height },
        intrinsicSize: { width, height },
      };
    }
    default:
      return null;
  }
}

function circlePath(cx: number, cy: number, radius: number): string {
  return [
    `M${cx} ${cy - radius}`,
    `A${radius} ${radius} 0 1 1 ${cx} ${cy + radius}`,
    `A${radius} ${radius} 0 1 1 ${cx} ${cy - radius}`,
    "Z",
  ].join("");
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return [
    `M${cx} ${cy - ry}`,
    `A${rx} ${ry} 0 1 1 ${cx} ${cy + ry}`,
    `A${rx} ${ry} 0 1 1 ${cx} ${cy - ry}`,
    "Z",
  ].join("");
}

function heartPath(width: number, height: number): string {
  return [
    `M${width / 2} ${height}`,
    `C${width * 0.1} ${height * 0.65} 0 ${height * 0.35} ${width * 0.2} ${height * 0.15}`,
    `C${width * 0.35} 0 ${width / 2} ${height * 0.15} ${width / 2} ${height * 0.3}`,
    `C${width / 2} ${height * 0.15} ${width * 0.65} 0 ${width * 0.8} ${height * 0.15}`,
    `C${width} ${height * 0.35} ${width * 0.9} ${height * 0.65} ${width / 2} ${height}`,
    "Z",
  ].join("");
}

function inferPathBounds(pathData: string): GeometryRect | null {
  const numbers = pathData.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  const points: GeometryPoint[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    const x = numbers[index];
    const y = numbers[index + 1];
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    left,
    top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

function sizeToBounds(size: ObjectSize): GeometryRect {
  return {
    left: 0,
    top: 0,
    width: positiveNumber(size.width, 1),
    height: positiveNumber(size.height, 1),
  };
}

function rectToBounds(rect: ObjectRect | undefined): GeometryRect | null {
  if (!rect) return null;
  const left = Number(rect.x);
  const top = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { left, top, width, height };
}

function containsPoint(bounds: GeometryRect, point: GeometryPoint): boolean {
  return point.x >= bounds.left &&
    point.x <= bounds.left + bounds.width &&
    point.y >= bounds.top &&
    point.y <= bounds.top + bounds.height;
}

function participates(
  participation: "preview" | "export" | "both" | undefined,
  requested: "preview" | "export" | undefined,
): boolean {
  if (!requested || !participation || participation === "both") return true;
  return participation === requested;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cloneObject<T extends EditorObject | undefined>(object: T): T {
  if (!object) return object;
  return {
    ...object,
    source: cloneSource(object.source),
    frame: object.frame ? { ...object.frame } : undefined,
    transform: object.transform ? { ...object.transform } : undefined,
    style: object.style ? { ...object.style } : undefined,
    effects: object.effects?.map(cloneEffect),
    metadata: object.metadata ? { ...object.metadata } : undefined,
  } as T;
}

function cloneObjectMap(objects: Map<string, EditorObject>): Map<string, EditorObject> {
  return new Map(Array.from(objects.entries()).map(([id, object]) => [id, cloneObject(object)]));
}

function cloneSource(source: ObjectSource): ObjectSource {
  switch (source.kind) {
    case "url":
    case "data-url":
    case "blob-url":
      return {
        ...source,
        intrinsicSize: source.intrinsicSize ? { ...source.intrinsicSize } : undefined,
      };
    case "path":
      return {
        ...source,
        sourceBounds: source.sourceBounds ? { ...source.sourceBounds } : undefined,
        sourceSize: source.sourceSize ? { ...source.sourceSize } : undefined,
      };
    case "shape":
      return { ...source, params: { ...source.params } };
    default:
      return source;
  }
}

function cloneEffect(effect: ObjectEffect): ObjectEffect {
  switch (effect.type) {
    case "clip-source":
      return { ...effect, targetIds: effect.targetIds.slice() };
    case "constraint":
      return {
        ...effect,
        params: effect.params ? { ...effect.params } : undefined,
      };
    case "guide":
      return {
        ...effect,
        style: effect.style ? { ...effect.style } : undefined,
      };
    default:
      return { ...effect };
  }
}
