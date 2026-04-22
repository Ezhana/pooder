import {
  CONFIGURATION_SERVICE,
  ExtensionContributions,
  ExtensionDefinition,
  ExtensionContext,
  ConfigurationService,
} from "@pooder/core";
import { CanvasService, RenderObjectSpec } from "../../services";
import {
  buildSceneGeometry,
  computeSceneLayout,
  fromMm,
  readSizeState,
} from "../../shared/scene/sceneLayoutModel";
import type { Unit } from "../../coordinate";
import { RULER_LAYER_ID } from "../../shared/constants/layers";
const EXTENSION_LINE_LENGTH = 5;
const MIN_ARROW_SIZE = 4;
const THICKNESS_TO_STROKE_WIDTH_RATIO = 20;

const DEFAULT_THICKNESS = 20;
const DEFAULT_GAP = 65;
const DEFAULT_FONT_SIZE = 10;
const DEFAULT_BACKGROUND_COLOR = "#f0f0f0";
const DEFAULT_TEXT_COLOR = "#333333";
const DEFAULT_LINE_COLOR = "#999999";
const RULER_DEBUG_KEY = "ruler.debug";

const RULER_THICKNESS_MIN = 10;
const RULER_THICKNESS_MAX = 100;
const RULER_GAP_MIN = 0;
const RULER_GAP_MAX = 100;
const RULER_FONT_SIZE_MIN = 8;
const RULER_FONT_SIZE_MAX = 24;

type Point = { x: number; y: number };

export class RulerTool implements ExtensionDefinition {
  id = "pooder.kit.ruler";

  public metadata = {
    name: "RulerTool",
  };
  activation = {
    requiresServices: ["CanvasService", CONFIGURATION_SERVICE],
  };

  private thickness = DEFAULT_THICKNESS;
  private gap = DEFAULT_GAP;
  private backgroundColor = DEFAULT_BACKGROUND_COLOR;
  private textColor = DEFAULT_TEXT_COLOR;
  private lineColor = DEFAULT_LINE_COLOR;
  private fontSize = DEFAULT_FONT_SIZE;
  private debugEnabled = false;
  private renderSeq = 0;
  private readonly numericProps = new Set(["thickness", "gap", "fontSize"]);
  private specs: RenderObjectSpec[] = [];
  private renderProducerDisposable?: { dispose: () => void };

  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private onCanvasResized = () => {
    this.updateRuler();
  };

  constructor(
    options?: Partial<{
      thickness: number;
      backgroundColor: string;
      textColor: string;
      lineColor: string;
      fontSize: number;
      gap: number;
    }>,
  ) {
    if (options) {
      Object.assign(this, options);
    }
  }

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService =
      context.services.getOrThrow<CanvasService>("CanvasService");
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = this.canvasService.registerRenderProducer(
      this.id,
      () => ({
        passes: [
          {
            id: RULER_LAYER_ID,
            stack: 950,
            order: 0,
            replace: true,
            visibility: {
              op: "not",
              expr: {
                op: "activeToolIn",
                ids: ["pooder.kit.white-ink"],
              },
            },
            objects: this.specs,
          },
        ],
      }),
      { priority: 400 },
    );

    const configService = context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (configService) {
      this.syncConfig(configService);
      configService.onAnyChange((e: { key: string; value: any }) => {
        let shouldUpdate = false;
        if (e.key === RULER_DEBUG_KEY) {
          this.debugEnabled = e.value === true;
          this.log("config:update", {
            key: e.key,
            raw: e.value,
            normalized: this.debugEnabled,
          });
        } else if (e.key.startsWith("ruler.")) {
          const prop = e.key.split(".")[1];
          if (prop && prop in this) {
            if (this.numericProps.has(prop)) {
              (this as any)[prop] = this.toFiniteNumber(
                e.value,
                (this as any)[prop],
              );
            } else {
              (this as any)[prop] = e.value;
            }
            shouldUpdate = true;
            this.log("config:update", {
              key: e.key,
              raw: e.value,
              normalized: (this as any)[prop],
            });
          }
        } else if (e.key.startsWith("size.")) {
          shouldUpdate = true;
          this.log("size:update", { key: e.key, value: e.value });
        }

        if (shouldUpdate) {
          this.updateRuler();
        }
      });
    }

    context.eventBus.on("canvas:resized", this.onCanvasResized);
    this.updateRuler();
  }

  deactivate(context: ExtensionContext) {
    context.eventBus.off("canvas:resized", this.onCanvasResized);
    this.specs = [];
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = undefined;
    if (this.canvasService) {
      void this.canvasService.flushRenderFromProducers();
    }
    this.canvasService = undefined;
    this.context = undefined;
    this.renderSeq = 0;
  }

  contribute(): ExtensionContributions {
    return {
      configurations: [
        {
          id: "ruler.thickness",
          type: "number",
          label: "Thickness",
          min: RULER_THICKNESS_MIN,
          max: RULER_THICKNESS_MAX,
          default: DEFAULT_THICKNESS,
        },
        {
          id: "ruler.gap",
          type: "number",
          label: "Gap",
          min: RULER_GAP_MIN,
          max: RULER_GAP_MAX,
          default: DEFAULT_GAP,
        },
        {
          id: "ruler.backgroundColor",
          type: "color",
          label: "Background Color",
          default: DEFAULT_BACKGROUND_COLOR,
        },
        {
          id: "ruler.textColor",
          type: "color",
          label: "Text Color",
          default: DEFAULT_TEXT_COLOR,
        },
        {
          id: "ruler.lineColor",
          type: "color",
          label: "Line Color",
          default: DEFAULT_LINE_COLOR,
        },
        {
          id: "ruler.fontSize",
          type: "number",
          label: "Font Size",
          min: RULER_FONT_SIZE_MIN,
          max: RULER_FONT_SIZE_MAX,
          default: DEFAULT_FONT_SIZE,
        },
        {
          id: RULER_DEBUG_KEY,
          type: "boolean",
          label: "Ruler Debug Log",
          default: false,
        },
      ],
      commands: [
        {
          id: "setTheme",
          command: "setTheme",
          title: "Set Ruler Theme",
          handler: (
            theme: Partial<{
              backgroundColor: string;
              textColor: string;
              lineColor: string;
              fontSize: number;
              thickness: number;
              gap: number;
            }>,
          ) => {
            const oldState = {
              backgroundColor: this.backgroundColor,
              textColor: this.textColor,
              lineColor: this.lineColor,
              fontSize: this.fontSize,
              thickness: this.thickness,
              gap: this.gap,
            };
            const newState = { ...oldState, ...theme };
            if (JSON.stringify(newState) === JSON.stringify(oldState)) {
              return true;
            }

            Object.assign(this, newState);
            this.thickness = this.toFiniteNumber(
              this.thickness,
              DEFAULT_THICKNESS,
            );
            this.gap = this.toFiniteNumber(this.gap, DEFAULT_GAP);
            this.fontSize = this.toFiniteNumber(
              this.fontSize,
              DEFAULT_FONT_SIZE,
            );
            this.updateRuler();
            return true;
          },
        },
      ],
    };
  }

  private isDebugEnabled(): boolean {
    return this.debugEnabled;
  }

  private log(step: string, payload?: Record<string, unknown>) {
    if (!this.isDebugEnabled()) return;
    if (payload) {
      console.debug(`[RulerTool] ${step}`, payload);
      return;
    }
    console.debug(`[RulerTool] ${step}`);
  }

  private syncConfig(configService: ConfigurationService) {
    this.thickness = this.toFiniteNumber(
      configService.get("ruler.thickness", this.thickness),
      DEFAULT_THICKNESS,
    );
    this.gap = Math.max(
      0,
      this.toFiniteNumber(
        configService.get("ruler.gap", this.gap),
        DEFAULT_GAP,
      ),
    );
    this.backgroundColor = configService.get(
      "ruler.backgroundColor",
      this.backgroundColor,
    );
    this.textColor = configService.get("ruler.textColor", this.textColor);
    this.lineColor = configService.get("ruler.lineColor", this.lineColor);
    this.fontSize = this.toFiniteNumber(
      configService.get("ruler.fontSize", this.fontSize),
      DEFAULT_FONT_SIZE,
    );
    this.debugEnabled =
      configService.get(RULER_DEBUG_KEY, this.debugEnabled) === true;

    this.log("config:loaded", {
      thickness: this.thickness,
      gap: this.gap,
      fontSize: this.fontSize,
      backgroundColor: this.backgroundColor,
      textColor: this.textColor,
      lineColor: this.lineColor,
    });
  }

  private toFiniteNumber(value: unknown, fallback: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  private toSceneDisplayLength(value: number): number {
    if (!this.canvasService) return value;
    return this.canvasService.toSceneLength(value);
  }

  private formatLengthMm(valueMm: number, unit: Unit): string {
    const converted = fromMm(valueMm, unit);
    const fractionDigits = unit === "in" ? 3 : 2;
    return Number(converted.toFixed(fractionDigits)).toString();
  }

  private buildLinePath(start: Point, end: Point): string {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    return `M 0 0 L ${dx} ${dy}`;
  }

  private buildStartArrowPath(size: number): string {
    return `M 0 0 L ${size} ${-size / 2} L ${size} ${size / 2} Z`;
  }

  private buildEndArrowPath(size: number): string {
    return `M 0 0 L ${-size} ${-size / 2} L ${-size} ${size / 2} Z`;
  }

  private createPathSpec(
    id: string,
    pathData: string,
    position: Point,
    options: {
      stroke?: string | null;
      fill?: string | null;
      strokeWidth?: number;
      originX?: "left" | "center" | "right";
      originY?: "top" | "center" | "bottom";
      angle?: number;
      strokeLineCap?: "butt" | "round" | "square";
    },
  ): RenderObjectSpec {
    return {
      id,
      type: "path",
      data: {
        id,
        type: "ruler",
      },
      props: {
        pathData,
        left: position.x,
        top: position.y,
        originX: options.originX ?? "left",
        originY: options.originY ?? "top",
        angle: options.angle ?? 0,
        stroke: options.stroke ?? null,
        fill: options.fill ?? null,
        strokeWidth: options.strokeWidth ?? 1,
        strokeLineCap: options.strokeLineCap ?? "butt",
        selectable: false,
        evented: false,
        excludeFromExport: true,
      },
    };
  }

  private createTextSpec(
    id: string,
    text: string,
    position: Point,
    angle: number = 0,
  ): RenderObjectSpec {
    return {
      id,
      type: "text",
      data: {
        id,
        type: "ruler",
      },
      props: {
        text,
        left: position.x,
        top: position.y,
        angle,
        fontSize: this.toSceneDisplayLength(this.fontSize),
        fill: this.textColor,
        fontFamily: "Arial",
        originX: "center",
        originY: "center",
        backgroundColor: this.backgroundColor,
        selectable: false,
        evented: false,
        excludeFromExport: true,
      },
    };
  }

  private buildRulerSpecs(input: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    widthLabel: string;
    heightLabel: string;
  }): RenderObjectSpec[] {
    const { left, top, right, bottom, widthLabel, heightLabel } = input;
    const gap = Math.max(
      0,
      this.toSceneDisplayLength(this.toFiniteNumber(this.gap, DEFAULT_GAP)),
    );
    const topY = top - gap;
    const leftX = left - gap;
    const arrowSize = Math.max(
      this.toSceneDisplayLength(MIN_ARROW_SIZE),
      this.toSceneDisplayLength(this.thickness * 0.3),
    );
    const strokeWidth = Math.max(
      this.toSceneDisplayLength(1),
      this.toSceneDisplayLength(
        this.thickness / THICKNESS_TO_STROKE_WIDTH_RATIO,
      ),
    );
    const extensionLength = this.toSceneDisplayLength(EXTENSION_LINE_LENGTH);
    const topLineAngleDeg = 0;
    const leftLineAngleDeg = 90;

    // Keep dimension line inside the arrow heads so it doesn't visually overflow.
    const topMidX = left + (right - left) / 2;
    const leftMidY = top + (bottom - top) / 2;
    const topLineStartX = Math.min(left + arrowSize, topMidX);
    const topLineEndX = Math.max(right - arrowSize, topMidX);
    const leftLineStartY = Math.min(top + arrowSize, leftMidY);
    const leftLineEndY = Math.max(bottom - arrowSize, leftMidY);

    const specs: RenderObjectSpec[] = [];

    specs.push(
      this.createPathSpec(
        "ruler.top.line",
        this.buildLinePath(
          { x: topLineStartX, y: topY },
          { x: topLineEndX, y: topY },
        ),
        { x: topLineStartX, y: topY },
        {
          stroke: this.lineColor,
          strokeWidth,
          strokeLineCap: "butt",
        },
      ),
      this.createPathSpec(
        "ruler.top.arrow.start",
        this.buildStartArrowPath(arrowSize),
        { x: left, y: topY },
        {
          fill: this.lineColor,
          stroke: this.lineColor,
          strokeWidth: this.toSceneDisplayLength(1),
          originX: "left",
          originY: "center",
          angle: topLineAngleDeg,
        },
      ),
      this.createPathSpec(
        "ruler.top.arrow.end",
        this.buildEndArrowPath(arrowSize),
        { x: right, y: topY },
        {
          fill: this.lineColor,
          stroke: this.lineColor,
          strokeWidth: this.toSceneDisplayLength(1),
          originX: "right",
          originY: "center",
          angle: topLineAngleDeg,
        },
      ),
      this.createPathSpec(
        "ruler.top.ext.start",
        this.buildLinePath(
          { x: left, y: topY - extensionLength },
          { x: left, y: topY + extensionLength },
        ),
        { x: left, y: topY - extensionLength },
        {
          stroke: this.lineColor,
          strokeWidth: this.toSceneDisplayLength(1),
        },
      ),
      this.createPathSpec(
        "ruler.top.ext.end",
        this.buildLinePath(
          { x: right, y: topY - extensionLength },
          { x: right, y: topY + extensionLength },
        ),
        { x: right, y: topY - extensionLength },
        {
          stroke: this.lineColor,
          strokeWidth: this.toSceneDisplayLength(1),
        },
      ),
      this.createTextSpec("ruler.top.label", widthLabel, {
        x: left + (right - left) / 2,
        y: topY,
      }),
    );

    specs.push(
      this.createPathSpec(
        "ruler.left.line",
        this.buildLinePath(
          { x: leftX, y: leftLineStartY },
          { x: leftX, y: leftLineEndY },
        ),
        { x: leftX, y: leftLineStartY },
        {
          stroke: this.lineColor,
          strokeWidth,
          strokeLineCap: "butt",
        },
      ),
      this.createPathSpec(
        "ruler.left.arrow.start",
        this.buildStartArrowPath(arrowSize),
        { x: leftX, y: top },
        {
          fill: this.lineColor,
          stroke: this.lineColor,
          strokeWidth: this.toSceneDisplayLength(1),
          originX: "left",
          originY: "center",
          angle: leftLineAngleDeg,
        },
      ),
      this.createPathSpec(
        "ruler.left.arrow.end",
        this.buildEndArrowPath(arrowSize),
        { x: leftX, y: bottom },
        {
          fill: this.lineColor,
          stroke: this.lineColor,
          strokeWidth: this.toSceneDisplayLength(1),
          originX: "right",
          originY: "center",
          angle: leftLineAngleDeg,
        },
      ),
      this.createPathSpec(
        "ruler.left.ext.start",
        this.buildLinePath(
          { x: leftX - extensionLength, y: top },
          { x: leftX + extensionLength, y: top },
        ),
        { x: leftX - extensionLength, y: top },
        {
          stroke: this.lineColor,
          strokeWidth: this.toSceneDisplayLength(1),
        },
      ),
      this.createPathSpec(
        "ruler.left.ext.end",
        this.buildLinePath(
          { x: leftX - extensionLength, y: bottom },
          { x: leftX + extensionLength, y: bottom },
        ),
        { x: leftX - extensionLength, y: bottom },
        {
          stroke: this.lineColor,
          strokeWidth: this.toSceneDisplayLength(1),
        },
      ),
      this.createTextSpec(
        "ruler.left.label",
        heightLabel,
        {
          x: leftX,
          y: top + (bottom - top) / 2,
        },
        -90,
      ),
    );

    return specs;
  }

  private updateRuler() {
    void this.updateRulerAsync();
  }

  private async updateRulerAsync() {
    if (!this.canvasService) return;
    const configService = this.context?.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (!configService) return;

    const seq = ++this.renderSeq;
    const sizeState = readSizeState(configService);
    const layout = computeSceneLayout(this.canvasService, sizeState);

    this.log("render:start", {
      seq,
      unit: sizeState.unit,
      gap: this.gap,
      thickness: this.thickness,
      fontSize: this.fontSize,
      hasLayout: !!layout,
      scale: layout?.scale ?? null,
    });

    if (!layout || layout.scale <= 0) {
      if (seq !== this.renderSeq) return;
      this.log("render:skip", { seq, reason: "invalid-layout" });
      this.specs = [];
      await this.canvasService.flushRenderFromProducers();
      return;
    }

    const geometry = buildSceneGeometry(configService, layout);
    if (geometry.unit !== "px") {
      console.warn("[RulerTool] Unexpected geometry unit.", geometry.unit);
    }
    const centerScene = this.canvasService.toScenePoint({
      x: geometry.x,
      y: geometry.y,
    });
    const widthScene = this.canvasService.toSceneLength(geometry.width);
    const heightScene = this.canvasService.toSceneLength(geometry.height);
    const rulerLeft = centerScene.x - widthScene / 2;
    const rulerTop = centerScene.y - heightScene / 2;
    const rulerRight = rulerLeft + widthScene;
    const rulerBottom = rulerTop + heightScene;

    const widthMm = widthScene;
    const heightMm = heightScene;
    const unit = sizeState.unit;
    const widthLabel = `${this.formatLengthMm(widthMm, unit)} ${unit}`;
    const heightLabel = `${this.formatLengthMm(heightMm, unit)} ${unit}`;
    const specs = this.buildRulerSpecs({
      left: rulerLeft,
      top: rulerTop,
      right: rulerRight,
      bottom: rulerBottom,
      widthLabel,
      heightLabel,
    });

    this.log("render:geometry", {
      seq,
      left: rulerLeft,
      top: rulerTop,
      right: rulerRight,
      bottom: rulerBottom,
      widthScene,
      heightScene,
      widthMm,
      heightMm,
      specCount: specs.length,
    });

    if (seq !== this.renderSeq) return;

    this.specs = specs;
    await this.canvasService.flushRenderFromProducers();
    if (seq !== this.renderSeq) return;
    this.canvasService.requestRenderAll();
    this.log("render:done", { seq });
  }
}
