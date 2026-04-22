import {
  CONFIGURATION_SERVICE,
  ExtensionContributions,
  ExtensionDefinition,
  ExtensionContext,
  ConfigurationService,
} from "@pooder/core";
import { Canvas as FabricCanvas, Path, Pattern } from "fabric";
import { CanvasService, RenderEffectSpec, RenderObjectSpec } from "../../services";
import { generateDielinePath } from "../geometry";
import { normalizeShapeStyle, normalizeDielineShape } from "../dielineShape";
import {
  buildSceneGeometry,
  computeSceneLayout,
  readSizeState,
} from "../../shared/scene/sceneLayoutModel";
import {
  DIELINE_LAYER_ID,
  IMAGE_OBJECT_LAYER_ID,
} from "../../shared/constants/layers";
import { createDielineCommands } from "./commands";
import { createDielineConfigurations } from "./config";
import {
  createDefaultDielineState,
  DielineGeometry,
  DielineState,
  readDielineState,
} from "./model";
import { buildDielineRenderBundle } from "./renderBuilder";
import {
  projectPlacedFeatures,
  resolveFeaturePlacements,
} from "../featurePlacement";

export class DielineTool implements ExtensionDefinition {
  id = "pooder.kit.dieline";
  public metadata = {
    name: "DielineTool",
  };
  activation = {
    requiresServices: ["CanvasService", CONFIGURATION_SERVICE],
  };

  private state: DielineState = createDefaultDielineState();

  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private specs: RenderObjectSpec[] = [];
  private effects: RenderEffectSpec[] = [];
  private renderSeq = 0;
  private renderProducerDisposable?: { dispose: () => void };
  private onCanvasResized = () => {
    this.updateDieline();
  };

  constructor(options?: Partial<DielineState>) {
    if (options) {
      // Deep merge for styles to avoid overwriting defaults with partial objects
      if (options.mainLine) {
        Object.assign(this.state.mainLine, options.mainLine);
        delete options.mainLine;
      }
      if (options.offsetLine) {
        Object.assign(this.state.offsetLine, options.offsetLine);
        delete options.offsetLine;
      }
      if (options.shapeStyle) {
        this.state.shapeStyle = normalizeShapeStyle(
          options.shapeStyle,
          this.state.shapeStyle,
        );
        delete options.shapeStyle;
      }
      Object.assign(this.state, options);
      this.state.shape = normalizeDielineShape(options.shape, this.state.shape);
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
            id: DIELINE_LAYER_ID,
            stack: 700,
            order: 0,
            replace: true,
            visibility: {
              op: "not",
              expr: {
                op: "activeToolIn",
                ids: ["pooder.kit.image", "pooder.kit.white-ink"],
              },
            },
            effects: this.effects,
            objects: this.specs,
          },
        ],
      }),
      { priority: 250 },
    );

    const configService = context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (configService) {
      Object.assign(this.state, readDielineState(configService, this.state));

      // Listen for changes
      configService.onAnyChange((e: { key: string; value: any }) => {
        if (e.key.startsWith("size.") || e.key.startsWith("dieline.")) {
          Object.assign(this.state, readDielineState(configService, this.state));
          this.updateDieline();
        }
      });
    }

    context.eventBus.on("canvas:resized", this.onCanvasResized);
    this.updateDieline();
  }

  deactivate(context: ExtensionContext) {
    context.eventBus.off("canvas:resized", this.onCanvasResized);
    this.renderSeq += 1;
    this.specs = [];
    this.effects = [];
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = undefined;
    if (this.canvasService) {
      void this.canvasService.flushRenderFromProducers();
    }
    this.canvasService = undefined;
    this.context = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      tools: [
        {
          id: this.id,
          name: "Dieline",
          interaction: "session",
          session: {
            autoBegin: false,
            leavePolicy: "block",
          },
        },
      ],
      configurations: createDielineConfigurations(this.state),
      commands: createDielineCommands(this, this.state),
    };
  }

  private createHatchPattern(color: string = "rgba(0, 0, 0, 0.3)") {
    if (typeof document === "undefined") {
      return undefined;
    }
    const size = 20;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Transparent background
      ctx.clearRect(0, 0, size, size);

      // Draw diagonal /
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, size);
      ctx.lineTo(size, 0);
      ctx.stroke();
    }
    // @ts-ignore
    return new Pattern({ source: canvas, repetition: "repeat" });
  }

  private getConfigService(): ConfigurationService | undefined {
    return this.context?.services.get<ConfigurationService>(
      "ConfigurationService",
    );
  }

  private hasImageItems(): boolean {
    const configService = this.getConfigService();
    if (!configService) return false;
    const items = configService.get("image.items", []) as unknown;
    return Array.isArray(items) && items.length > 0;
  }

  private buildDielineSpecs(
    sceneLayout: NonNullable<ReturnType<typeof computeSceneLayout>>,
  ): RenderObjectSpec[] {
    const hasImages = this.hasImageItems();
    return buildDielineRenderBundle({
      state: this.state,
      sceneLayout,
      canvasWidth: sceneLayout.canvasWidth || this.canvasService?.canvas.width || 800,
      canvasHeight:
        sceneLayout.canvasHeight || this.canvasService?.canvas.height || 600,
      hasImages,
      createHatchPattern: (color) => this.createHatchPattern(color),
      includeImageClipEffect: false,
    }).specs;
  }

  private buildImageClipEffects(
    sceneLayout: NonNullable<ReturnType<typeof computeSceneLayout>>,
  ): RenderEffectSpec[] {
    return buildDielineRenderBundle({
      state: this.state,
      sceneLayout,
      canvasWidth: sceneLayout.canvasWidth || this.canvasService?.canvas.width || 800,
      canvasHeight:
        sceneLayout.canvasHeight || this.canvasService?.canvas.height || 600,
      hasImages: this.hasImageItems(),
      includeImageClipEffect: true,
      clipTargetPassIds: [IMAGE_OBJECT_LAYER_ID],
      clipVisibility: {
        op: "not",
        expr: { op: "anySessionActive" },
      },
    }).effects;
  }

  public updateDieline(_emitEvent: boolean = true) {
    void this.updateDielineAsync();
  }

  private async updateDielineAsync() {
    if (!this.canvasService) return;
    const configService = this.getConfigService();
    if (!configService) return;
    const seq = ++this.renderSeq;

    Object.assign(this.state, readDielineState(configService, this.state));
    const sceneLayout = computeSceneLayout(
      this.canvasService,
      readSizeState(configService),
    );
    if (!sceneLayout) {
      if (seq !== this.renderSeq) return;
      this.specs = [];
      this.effects = [];
      await this.canvasService.flushRenderFromProducers();
      return;
    }

    const nextSpecs = this.buildDielineSpecs(sceneLayout);
    const nextEffects = this.buildImageClipEffects(sceneLayout);
    if (seq !== this.renderSeq) return;
    this.specs = nextSpecs;
    this.effects = nextEffects;
    await this.canvasService.flushRenderFromProducers();
    if (seq !== this.renderSeq) return;
    this.canvasService.requestRenderAll();
  }

  public getGeometry(): DielineGeometry | null {
    if (!this.canvasService) return null;
    const configService = this.getConfigService();
    if (!configService) return null;
    const sceneLayout = computeSceneLayout(
      this.canvasService,
      readSizeState(configService),
    );
    if (!sceneLayout) return null;
    const sceneGeometry = buildSceneGeometry(configService, sceneLayout);
    return {
      ...sceneGeometry,
      strokeWidth: this.state.mainLine.width,
      pathData: this.state.pathData,
      customSourceWidthPx: this.state.customSourceWidthPx,
      customSourceHeightPx: this.state.customSourceHeightPx,
    } as DielineGeometry;
  }

  public async exportCutImage(options?: { debug?: boolean }) {
    const debug = options?.debug === true;

    if (!this.canvasService) {
      console.warn(
        "[DielineTool] exportCutImage returned null: canvas-not-ready",
      );
      return null;
    }
    const configService = this.getConfigService();
    if (!configService) {
      console.warn(
        "[DielineTool] exportCutImage returned null: config-service-not-ready",
      );
      return null;
    }

    this.state = readDielineState(configService, this.state);
    const sceneLayout = computeSceneLayout(
      this.canvasService,
      readSizeState(configService),
    );
    if (!sceneLayout) {
      console.warn(
        "[DielineTool] exportCutImage returned null: scene-layout-null",
      );
      return null;
    }

    const { shape, shapeStyle, radius, features, pathData } = this.state;
    const canvasW =
      sceneLayout.canvasWidth || this.canvasService.canvas.width || 800;
    const canvasH =
      sceneLayout.canvasHeight || this.canvasService.canvas.height || 600;
    const scale = sceneLayout.scale;
    const cx = sceneLayout.trimRect.centerX;
    const cy = sceneLayout.trimRect.centerY;
    const cutW = sceneLayout.cutRect.width;
    const cutH = sceneLayout.cutRect.height;
    const visualRadius = radius * scale;
    const visualOffset = (cutW - sceneLayout.trimRect.width) / 2;
    const cutR =
      visualRadius === 0 ? 0 : Math.max(0, visualRadius + visualOffset);

    const placements = resolveFeaturePlacements(features || [], {
      shape,
      shapeStyle,
      pathData,
      customSourceWidthPx: this.state.customSourceWidthPx,
      customSourceHeightPx: this.state.customSourceHeightPx,
      canvasWidth: canvasW,
      canvasHeight: canvasH,
      x: cx,
      y: cy,
      width: sceneLayout.trimRect.width,
      height: sceneLayout.trimRect.height,
      radius: visualRadius,
      scale,
    });
    const cutFeatures = projectPlacedFeatures(
      placements.filter((placement) => !placement.feature.skipCut),
      {
        x: cx,
        y: cy,
        width: cutW,
        height: cutH,
      },
      scale,
    );

    const generatedPathData = generateDielinePath({
      shape,
      width: cutW,
      height: cutH,
      radius: cutR,
      x: cx,
      y: cy,
      features: cutFeatures,
      shapeStyle,
      pathData,
      customSourceWidthPx: this.state.customSourceWidthPx,
      customSourceHeightPx: this.state.customSourceHeightPx,
      canvasWidth: canvasW,
      canvasHeight: canvasH,
    });

    const clipPath = new Path(generatedPathData, {
      originX: "center",
      originY: "center",
      left: cx,
      top: cy,
      absolutePositioned: true,
    });
    const pathOffsetX = Number((clipPath as any)?.pathOffset?.x);
    const pathOffsetY = Number((clipPath as any)?.pathOffset?.y);
    const centerX = Number.isFinite(pathOffsetX) ? pathOffsetX : cx;
    const centerY = Number.isFinite(pathOffsetY) ? pathOffsetY : cy;
    clipPath.set({
      originX: "center",
      originY: "center",
      left: centerX,
      top: centerY,
      absolutePositioned: true,
    });
    clipPath.setCoords();

    const pathBounds = clipPath.getBoundingRect();
    if (
      !Number.isFinite(pathBounds.left) ||
      !Number.isFinite(pathBounds.top) ||
      !Number.isFinite(pathBounds.width) ||
      !Number.isFinite(pathBounds.height) ||
      pathBounds.width <= 0 ||
      pathBounds.height <= 0
    ) {
      console.warn(
        "[DielineTool] exportCutImage returned null: invalid-cut-bounds",
        {
          bounds: pathBounds,
        },
      );
      return null;
    }
    const exportBounds = pathBounds;

    const sourceImages = this.canvasService.canvas
      .getObjects()
      .filter((obj: any) => {
        return obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID;
      });
    if (!sourceImages.length) {
      console.warn(
        "[DielineTool] exportCutImage returned null: no-image-objects-on-canvas",
      );
      return null;
    }

    const sourceCanvasWidth = Number(
      this.canvasService.canvas.width || sceneLayout.canvasWidth || canvasW,
    );
    const sourceCanvasHeight = Number(
      this.canvasService.canvas.height || sceneLayout.canvasHeight || canvasH,
    );

    const el = document.createElement("canvas");
    const exportCanvas = new FabricCanvas(el, {
      renderOnAddRemove: false,
      selection: false,
      enableRetinaScaling: false,
      preserveObjectStacking: true,
    } as any);
    exportCanvas.setDimensions({
      width: Math.max(1, sourceCanvasWidth),
      height: Math.max(1, sourceCanvasHeight),
    });

    try {
      for (const source of sourceImages as any[]) {
        const clone = await source.clone();
        clone.set({
          selectable: false,
          evented: false,
        });
        clone.setCoords();
        exportCanvas.add(clone);
      }

      exportCanvas.clipPath = clipPath;
      exportCanvas.renderAll();

      const dataUrl = exportCanvas.toDataURL({
        format: "png",
        multiplier: 2,
        left: exportBounds.left,
        top: exportBounds.top,
        width: exportBounds.width,
        height: exportBounds.height,
      });

      if (debug) {
        console.info("[DielineTool] exportCutImage success", {
          sourceCount: sourceImages.length,
          bounds: exportBounds,
          rawPathBounds: pathBounds,
          pathOffset: {
            x: Number.isFinite(pathOffsetX) ? pathOffsetX : null,
            y: Number.isFinite(pathOffsetY) ? pathOffsetY : null,
          },
          clipPathCenter: {
            x: centerX,
            y: centerY,
          },
          cutRect: sceneLayout.cutRect,
          canvasSize: {
            width: Math.max(1, sourceCanvasWidth),
            height: Math.max(1, sourceCanvasHeight),
          },
        });
      }

      return dataUrl;
    } finally {
      exportCanvas.dispose();
    }
  }
}
