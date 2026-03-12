import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
  ConfigurationService,
  ToolSessionService,
  WorkbenchService,
} from "@pooder/core";
import {
  Canvas as FabricCanvas,
  Control,
  Image as FabricImage,
  Pattern,
  Point,
  controlsUtils,
} from "fabric";
import { CanvasService, RenderLayoutRect, RenderObjectSpec } from "../services";
import { isDielineShape, normalizeShapeStyle } from "./dielineShape";
import type { DielineShape, DielineShapeStyle } from "./dielineShape";
import { generateDielinePath, getPathBounds } from "./geometry";
import {
  buildSceneGeometry,
  computeSceneLayout,
  readSizeState,
} from "./sceneLayoutModel";

export interface ImageItem {
  id: string;
  url: string;
  opacity: number;
  scale?: number;
  angle?: number;
  left?: number;
  top?: number;
  sourceUrl?: string;
  committedUrl?: string;
}

interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SourceSize {
  width: number;
  height: number;
}

interface RenderImageState {
  src: string;
  left: number;
  top: number;
  scale: number;
  angle: number;
  opacity: number;
}

interface FrameVisualConfig {
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "hidden";
  dashLength: number;
  innerBackground: string;
  outerBackground: string;
}

interface ImageControlVisualConfig {
  cornerSize: number;
  touchCornerSize: number;
  cornerStyle: "rect" | "circle";
  cornerColor: string;
  cornerStrokeColor: string;
  transparentCorners: boolean;
  borderColor: string;
  borderScaleFactor: number;
  padding: number;
}

type ShapeOverlayShape = Exclude<DielineShape, "custom">;

interface SceneGeometryLike {
  shape: DielineShape;
  shapeStyle: DielineShapeStyle;
  radius: number;
  offset: number;
}

interface UpsertImageOptions {
  id?: string;
  mode?: "replace" | "add";
  addOptions?: Partial<ImageItem>;
  fitOnAdd?: boolean;
}

interface DielineFitArea {
  width: number;
  height: number;
  left: number;
  top: number;
}

interface UpdateImageOptions {
  target?: "auto" | "config" | "working";
}

interface ExportCroppedImageOptions {
  multiplier?: number;
  format?: "png" | "jpeg";
}

interface ExportUserCroppedImageOptions extends ExportCroppedImageOptions {
  imageIds?: string[];
}

interface ExportUserCroppedImageResult {
  url: string;
  width: number;
  height: number;
  multiplier: number;
  format: "png" | "jpeg";
  imageIds: string[];
}

const IMAGE_OBJECT_LAYER_ID = "image.user";
const IMAGE_OVERLAY_LAYER_ID = "image-overlay";
type ImageControlCapability = "rotate" | "scale" | "flipX" | "flipY";

interface ImageControlDescriptor {
  key: string;
  capability: ImageControlCapability;
  create: () => Control;
}

const IMAGE_DEFAULT_CONTROL_CAPABILITIES: ImageControlCapability[] = [
  "rotate",
  "scale",
];

const IMAGE_CONTROL_DESCRIPTORS: ImageControlDescriptor[] = [
  {
    key: "tl",
    capability: "rotate",
    create: () =>
      new Control({
        x: -0.5,
        y: -0.5,
        actionName: "rotate",
        actionHandler: controlsUtils.rotationWithSnapping,
        cursorStyleHandler: controlsUtils.rotationStyleHandler,
      }),
  },
  {
    key: "br",
    capability: "scale",
    create: () =>
      new Control({
        x: 0.5,
        y: 0.5,
        actionName: "scale",
        actionHandler: controlsUtils.scalingEqually,
        cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
      }),
  },
];

export class ImageTool implements Extension {
  id = "pooder.kit.image";

  metadata = {
    name: "ImageTool",
  };

  private items: ImageItem[] = [];
  private workingItems: ImageItem[] = [];
  private hasWorkingChanges = false;
  private loadResolvers: Map<string, () => void> = new Map();
  private sourceSizeBySrc: Map<string, SourceSize> = new Map();
  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private isUpdatingConfig = false;
  private isToolActive = false;
  private isImageSelectionActive = false;
  private focusedImageId: string | null = null;
  private renderSeq = 0;
  private dirtyTrackerDisposable?: { dispose(): void };
  private cropShapeHatchPattern?: Pattern;
  private cropShapeHatchPatternColor?: string;
  private cropShapeHatchPatternKey?: string;
  private imageSpecs: RenderObjectSpec[] = [];
  private overlaySpecs: RenderObjectSpec[] = [];
  private renderProducerDisposable?: { dispose: () => void };
  private imageControlsByCapabilityKey: Map<string, Record<string, Control>> =
    new Map();

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    if (!this.canvasService) {
      console.warn("CanvasService not found for ImageTool");
      return;
    }
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = this.canvasService.registerRenderProducer(
      this.id,
      () => ({
        passes: [
          {
            id: IMAGE_OBJECT_LAYER_ID,
            stack: 500,
            order: 0,
            visibility: {
              op: "not",
              expr: {
                op: "sessionActive",
                toolId: "pooder.kit.white-ink",
              },
            },
            objects: this.imageSpecs,
          },
          {
            id: IMAGE_OVERLAY_LAYER_ID,
            stack: 800,
            order: 0,
            visibility: {
              op: "not",
              expr: {
                op: "sessionActive",
                toolId: "pooder.kit.white-ink",
              },
            },
            objects: this.overlaySpecs,
          },
        ],
      }),
      { priority: 300 },
    );

    context.eventBus.on("tool:activated", this.onToolActivated);
    context.eventBus.on("object:modified", this.onObjectModified);
    context.eventBus.on("selection:created", this.onSelectionChanged);
    context.eventBus.on("selection:updated", this.onSelectionChanged);
    context.eventBus.on("selection:cleared", this.onSelectionCleared);
    context.eventBus.on("scene:layout:change", this.onSceneLayoutChanged);
    context.eventBus.on("scene:geometry:change", this.onSceneGeometryChanged);

    const configService = context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (configService) {
      this.items = this.normalizeItems(
        configService.get("image.items", []) || [],
      );
      this.workingItems = this.cloneItems(this.items);
      this.hasWorkingChanges = false;

      configService.onAnyChange((e: { key: string; value: any }) => {
        if (this.isUpdatingConfig) return;

        if (e.key === "image.items") {
          this.items = this.normalizeItems(e.value || []);
          if (!this.isToolActive || !this.hasWorkingChanges) {
            this.workingItems = this.cloneItems(this.items);
            this.hasWorkingChanges = false;
          }
          this.updateImages();
          return;
        }

        if (
          e.key.startsWith("size.") ||
          e.key.startsWith("image.frame.") ||
          e.key.startsWith("image.control.")
        ) {
          if (e.key.startsWith("image.control.")) {
            this.imageControlsByCapabilityKey.clear();
          }
          this.updateImages();
        }
      });
    }

    const toolSessionService =
      context.services.get<ToolSessionService>("ToolSessionService");
    this.dirtyTrackerDisposable = toolSessionService?.registerDirtyTracker(
      this.id,
      () => this.hasWorkingChanges,
    );

    this.updateImages();
  }

  deactivate(context: ExtensionContext) {
    context.eventBus.off("tool:activated", this.onToolActivated);
    context.eventBus.off("object:modified", this.onObjectModified);
    context.eventBus.off("selection:created", this.onSelectionChanged);
    context.eventBus.off("selection:updated", this.onSelectionChanged);
    context.eventBus.off("selection:cleared", this.onSelectionCleared);
    context.eventBus.off("scene:layout:change", this.onSceneLayoutChanged);
    context.eventBus.off("scene:geometry:change", this.onSceneGeometryChanged);
    this.dirtyTrackerDisposable?.dispose();
    this.dirtyTrackerDisposable = undefined;
    this.cropShapeHatchPattern = undefined;
    this.cropShapeHatchPatternColor = undefined;
    this.cropShapeHatchPatternKey = undefined;
    this.imageSpecs = [];
    this.overlaySpecs = [];
    this.imageControlsByCapabilityKey.clear();

    this.clearRenderedImages();
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = undefined;
    if (this.canvasService) {
      void this.canvasService.flushRenderFromProducers();
      this.canvasService = undefined;
    }
    this.context = undefined;
  }

  private onToolActivated = (event: {
    id: string | null;
    previous?: string | null;
    reason?: string;
  }) => {
    const before = this.isToolActive;
    this.syncToolActiveFromWorkbench(event.id);
    if (!this.isToolActive) {
      this.setImageFocus(null, {
        syncCanvasSelection: true,
        skipRender: true,
      });
    }
    this.debug("tool:activated", {
      id: event.id,
      previous: event.previous,
      reason: event.reason,
      before,
      isToolActive: this.isToolActive,
      focusedImageId: this.focusedImageId,
    });
    if (!this.isToolActive && this.isDebugEnabled()) {
      console.trace("[ImageTool] tool deactivated trace");
    }
    this.updateImages();
  };

  private onSelectionChanged = (e: any) => {
    const list: any[] = [];
    if (Array.isArray(e?.selected)) {
      list.push(...e.selected);
    }
    if (Array.isArray(e?.target?._objects)) {
      list.push(...e.target._objects);
    }
    if (e?.target && !Array.isArray(e?.target?._objects)) {
      list.push(e.target);
    }

    const selectedImage = list.find(
      (obj: any) => obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID,
    );
    this.isImageSelectionActive = !!selectedImage;
    if (selectedImage?.data?.id) {
      this.focusedImageId = selectedImage.data.id;
    } else if (list.length > 0) {
      this.focusedImageId = null;
    }
    this.debug("selection:changed", {
      listSize: list.length,
      isImageSelectionActive: this.isImageSelectionActive,
      focusedImageId: this.focusedImageId,
    });
    this.updateImages();
  };

  private onSelectionCleared = () => {
    this.setImageFocus(null, {
      syncCanvasSelection: false,
      skipRender: true,
    });
    this.debug("selection:cleared applied");
    this.updateImages();
  };

  private onSceneLayoutChanged = () => {
    this.updateImages();
  };

  private onSceneGeometryChanged = () => {
    this.updateImages();
  };

  private syncToolActiveFromWorkbench(fallbackId?: string | null) {
    const wb = this.context?.services.get<WorkbenchService>("WorkbenchService");
    const activeId = wb?.activeToolId;
    if (typeof activeId === "string" || activeId === null) {
      this.isToolActive = activeId === this.id;
      return;
    }
    this.isToolActive = fallbackId === this.id;
  }

  private isImageEditingVisible(): boolean {
    return (
      this.isToolActive || this.isImageSelectionActive || !!this.focusedImageId
    );
  }

  private getEnabledImageControlCapabilities(): ImageControlCapability[] {
    return IMAGE_DEFAULT_CONTROL_CAPABILITIES;
  }

  private getImageControls(
    capabilities: ImageControlCapability[],
  ): Record<string, Control> {
    const normalized = [...new Set(capabilities)].sort();
    const cacheKey = normalized.join("|");
    const cached = this.imageControlsByCapabilityKey.get(cacheKey);
    if (cached) {
      return cached;
    }

    const enabled = new Set(normalized);
    const controls: Record<string, Control> = {};
    IMAGE_CONTROL_DESCRIPTORS.forEach((descriptor) => {
      if (!enabled.has(descriptor.capability)) return;
      controls[descriptor.key] = descriptor.create();
    });

    this.imageControlsByCapabilityKey.set(cacheKey, controls);
    return controls;
  }

  private getImageControlVisualConfig(): ImageControlVisualConfig {
    const cornerSizeRaw = Number(
      this.getConfig<number>("image.control.cornerSize", 14) ?? 14,
    );
    const touchCornerSizeRaw = Number(
      this.getConfig<number>("image.control.touchCornerSize", 24) ?? 24,
    );
    const borderScaleFactorRaw = Number(
      this.getConfig<number>("image.control.borderScaleFactor", 1.5) ?? 1.5,
    );
    const paddingRaw = Number(
      this.getConfig<number>("image.control.padding", 0) ?? 0,
    );
    const cornerStyleRaw = (this.getConfig<string>(
      "image.control.cornerStyle",
      "circle",
    ) || "circle") as string;
    const cornerStyle: "rect" | "circle" =
      cornerStyleRaw === "rect" ? "rect" : "circle";

    return {
      cornerSize: Number.isFinite(cornerSizeRaw)
        ? Math.max(4, Math.min(64, cornerSizeRaw))
        : 14,
      touchCornerSize: Number.isFinite(touchCornerSizeRaw)
        ? Math.max(8, Math.min(96, touchCornerSizeRaw))
        : 24,
      cornerStyle,
      cornerColor:
        this.getConfig<string>("image.control.cornerColor", "#ffffff") ||
        "#ffffff",
      cornerStrokeColor:
        this.getConfig<string>("image.control.cornerStrokeColor", "#1677ff") ||
        "#1677ff",
      transparentCorners: !!this.getConfig<boolean>(
        "image.control.transparentCorners",
        false,
      ),
      borderColor:
        this.getConfig<string>("image.control.borderColor", "#1677ff") ||
        "#1677ff",
      borderScaleFactor: Number.isFinite(borderScaleFactorRaw)
        ? Math.max(0.5, Math.min(8, borderScaleFactorRaw))
        : 1.5,
      padding: Number.isFinite(paddingRaw)
        ? Math.max(0, Math.min(64, paddingRaw))
        : 0,
    };
  }

  private applyImageObjectInteractionState(obj: any) {
    if (!obj) return;
    const visible = this.isImageEditingVisible();
    const visual = this.getImageControlVisualConfig();
    obj.set({
      selectable: visible,
      evented: visible,
      hasControls: visible,
      hasBorders: visible,
      lockScalingFlip: true,
      cornerSize: visual.cornerSize,
      touchCornerSize: visual.touchCornerSize,
      cornerStyle: visual.cornerStyle,
      cornerColor: visual.cornerColor,
      cornerStrokeColor: visual.cornerStrokeColor,
      transparentCorners: visual.transparentCorners,
      borderColor: visual.borderColor,
      borderScaleFactor: visual.borderScaleFactor,
      padding: visual.padding,
    });
    obj.controls = this.getImageControls(
      this.getEnabledImageControlCapabilities(),
    );
    obj.setCoords?.();
  }

  private refreshImageObjectInteractionState() {
    this.getImageObjects().forEach((obj) =>
      this.applyImageObjectInteractionState(obj),
    );
  }

  private isDebugEnabled(): boolean {
    return !!this.getConfig<boolean>("image.debug", false);
  }

  private debug(message: string, payload?: any) {
    if (!this.isDebugEnabled()) return;
    if (payload === undefined) {
      console.log(`[ImageTool] ${message}`);
      return;
    }
    console.log(`[ImageTool] ${message}`, payload);
  }

  contribute() {
    return {
      [ContributionPointIds.TOOLS]: [
        {
          id: this.id,
          name: "Image",
          interaction: "session",
          commands: {
            begin: "resetWorkingImages",
            commit: "completeImages",
            rollback: "resetWorkingImages",
          },
          session: {
            autoBegin: true,
            leavePolicy: "block",
          },
        },
      ],
      [ContributionPointIds.CONFIGURATIONS]: [
        {
          id: "image.items",
          type: "array",
          label: "Images",
          default: [],
        },
        {
          id: "image.debug",
          type: "boolean",
          label: "Image Debug Log",
          default: false,
        },
        {
          id: "image.control.cornerSize",
          type: "number",
          label: "Image Control Corner Size",
          min: 4,
          max: 64,
          step: 1,
          default: 14,
        },
        {
          id: "image.control.touchCornerSize",
          type: "number",
          label: "Image Control Touch Corner Size",
          min: 8,
          max: 96,
          step: 1,
          default: 24,
        },
        {
          id: "image.control.cornerStyle",
          type: "select",
          label: "Image Control Corner Style",
          options: ["circle", "rect"],
          default: "circle",
        },
        {
          id: "image.control.cornerColor",
          type: "color",
          label: "Image Control Corner Color",
          default: "#ffffff",
        },
        {
          id: "image.control.cornerStrokeColor",
          type: "color",
          label: "Image Control Corner Stroke Color",
          default: "#1677ff",
        },
        {
          id: "image.control.transparentCorners",
          type: "boolean",
          label: "Image Control Transparent Corners",
          default: false,
        },
        {
          id: "image.control.borderColor",
          type: "color",
          label: "Image Control Border Color",
          default: "#1677ff",
        },
        {
          id: "image.control.borderScaleFactor",
          type: "number",
          label: "Image Control Border Width",
          min: 0.5,
          max: 8,
          step: 0.1,
          default: 1.5,
        },
        {
          id: "image.control.padding",
          type: "number",
          label: "Image Control Padding",
          min: 0,
          max: 64,
          step: 1,
          default: 0,
        },
        {
          id: "image.frame.strokeColor",
          type: "color",
          label: "Image Frame Stroke Color",
          default: "#808080",
        },
        {
          id: "image.frame.strokeWidth",
          type: "number",
          label: "Image Frame Stroke Width",
          min: 0,
          max: 20,
          step: 0.5,
          default: 2,
        },
        {
          id: "image.frame.strokeStyle",
          type: "select",
          label: "Image Frame Stroke Style",
          options: ["solid", "dashed", "hidden"],
          default: "dashed",
        },
        {
          id: "image.frame.dashLength",
          type: "number",
          label: "Image Frame Dash Length",
          min: 1,
          max: 40,
          step: 1,
          default: 8,
        },
        {
          id: "image.frame.innerBackground",
          type: "color",
          label: "Image Frame Inner Background",
          default: "rgba(0,0,0,0)",
        },
        {
          id: "image.frame.outerBackground",
          type: "color",
          label: "Image Frame Outer Background",
          default: "#f5f5f5",
        },
      ] as ConfigurationContribution[],
      [ContributionPointIds.COMMANDS]: [
        {
          command: "addImage",
          title: "Add Image",
          handler: async (url: string, options?: Partial<ImageItem>) => {
            const result = await this.upsertImageEntry(url, {
              mode: "add",
              addOptions: options,
            });
            return result.id;
          },
        },
        {
          command: "upsertImage",
          title: "Upsert Image",
          handler: async (url: string, options: UpsertImageOptions = {}) => {
            return await this.upsertImageEntry(url, options);
          },
        },
        {
          command: "getWorkingImages",
          title: "Get Working Images",
          handler: () => {
            return this.cloneItems(this.workingItems);
          },
        },
        {
          command: "setWorkingImage",
          title: "Set Working Image",
          handler: (id: string, updates: Partial<ImageItem>) => {
            this.updateImageInWorking(id, updates);
          },
        },
        {
          command: "resetWorkingImages",
          title: "Reset Working Images",
          handler: () => {
            this.workingItems = this.cloneItems(this.items);
            this.hasWorkingChanges = false;
            this.updateImages();
            this.emitWorkingChange();
          },
        },
        {
          command: "completeImages",
          title: "Complete Images",
          handler: async () => {
            return await this.commitWorkingImagesAsCropped();
          },
        },
        {
          command: "exportUserCroppedImage",
          title: "Export User Cropped Image",
          handler: async (options: ExportUserCroppedImageOptions = {}) => {
            return await this.exportUserCroppedImage(options);
          },
        },
        {
          command: "fitImageToArea",
          title: "Fit Image to Area",
          handler: async (
            id: string,
            area: {
              width: number;
              height: number;
              left?: number;
              top?: number;
            },
          ) => {
            await this.fitImageToArea(id, area);
          },
        },
        {
          command: "fitImageToDefaultArea",
          title: "Fit Image to Default Area",
          handler: async (id: string) => {
            await this.fitImageToDefaultArea(id);
          },
        },
        {
          command: "focusImage",
          title: "Focus Image",
          handler: (
            id: string | null,
            options: { syncCanvasSelection?: boolean } = {},
          ) => {
            return this.setImageFocus(id, options);
          },
        },
        {
          command: "removeImage",
          title: "Remove Image",
          handler: (id: string) => {
            const removed = this.items.find((item) => item.id === id);
            const next = this.items.filter((item) => item.id !== id);
            if (next.length !== this.items.length) {
              this.purgeSourceSizeCacheForItem(removed);
              if (this.focusedImageId === id) {
                this.setImageFocus(null, {
                  syncCanvasSelection: true,
                  skipRender: true,
                });
              }
              this.updateConfig(next);
            }
          },
        },
        {
          command: "updateImage",
          title: "Update Image",
          handler: async (
            id: string,
            updates: Partial<ImageItem>,
            options: UpdateImageOptions = {},
          ) => {
            await this.updateImage(id, updates, options);
          },
        },
        {
          command: "clearImages",
          title: "Clear Images",
          handler: () => {
            this.sourceSizeBySrc.clear();
            this.setImageFocus(null, {
              syncCanvasSelection: true,
              skipRender: true,
            });
            this.updateConfig([]);
          },
        },
        {
          command: "bringToFront",
          title: "Bring Image to Front",
          handler: (id: string) => {
            const index = this.items.findIndex((item) => item.id === id);
            if (index !== -1 && index < this.items.length - 1) {
              const next = [...this.items];
              const [item] = next.splice(index, 1);
              next.push(item);
              this.updateConfig(next);
            }
          },
        },
        {
          command: "sendToBack",
          title: "Send Image to Back",
          handler: (id: string) => {
            const index = this.items.findIndex((item) => item.id === id);
            if (index > 0) {
              const next = [...this.items];
              const [item] = next.splice(index, 1);
              next.unshift(item);
              this.updateConfig(next);
            }
          },
        },
      ] as CommandContribution[],
    };
  }

  private normalizeItem(item: ImageItem): ImageItem {
    const url = typeof item.url === "string" ? item.url : "";
    const sourceUrl =
      typeof item.sourceUrl === "string" && item.sourceUrl.length > 0
        ? item.sourceUrl
        : url;
    const committedUrl =
      typeof item.committedUrl === "string" && item.committedUrl.length > 0
        ? item.committedUrl
        : undefined;

    return {
      ...item,
      url: url || sourceUrl,
      sourceUrl,
      committedUrl,
      opacity: Number.isFinite(item.opacity as any) ? item.opacity : 1,
      scale: Number.isFinite(item.scale as any) ? item.scale : 1,
      angle: Number.isFinite(item.angle as any) ? item.angle : 0,
      left: Number.isFinite(item.left as any) ? item.left : 0.5,
      top: Number.isFinite(item.top as any) ? item.top : 0.5,
    };
  }

  private normalizeItems(items: ImageItem[]): ImageItem[] {
    return (items || []).map((item) => this.normalizeItem(item));
  }

  private cloneItems(items: ImageItem[]): ImageItem[] {
    return this.normalizeItems((items || []).map((i) => ({ ...i })));
  }

  private emitWorkingChange(changedId: string | null = null) {
    this.context?.eventBus.emit("image:working:change", {
      changedId,
      items: this.cloneItems(this.workingItems),
    });
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 9);
  }

  private hasImageItem(id: string): boolean {
    return (
      this.items.some((item) => item.id === id) ||
      this.workingItems.some((item) => item.id === id)
    );
  }

  private setImageFocus(
    id: string | null,
    options: { syncCanvasSelection?: boolean; skipRender?: boolean } = {},
  ) {
    const syncCanvasSelection = options.syncCanvasSelection !== false;

    if (id && !this.hasImageItem(id)) {
      return { ok: false, reason: "image-not-found" as const };
    }

    this.focusedImageId = id;
    this.isImageSelectionActive = !!id;

    if (syncCanvasSelection && this.canvasService) {
      const canvas = this.canvasService.canvas;
      if (!id) {
        canvas.discardActiveObject();
      } else {
        const obj = this.getImageObject(id);
        if (obj) {
          this.applyImageObjectInteractionState(obj);
          canvas.setActiveObject(obj);
        }
      }
      this.canvasService.requestRenderAll();
    }

    if (!options.skipRender) {
      this.updateImages();
    }

    return { ok: true, id };
  }

  private async addImageEntry(
    url: string,
    options?: Partial<ImageItem>,
    fitOnAdd = true,
  ): Promise<string> {
    const id = this.generateId();
    const newItem = this.normalizeItem({
      id,
      url,
      opacity: 1,
      ...options,
    } as ImageItem);

    const sessionDirtyBeforeAdd = this.isToolActive && this.hasWorkingChanges;
    const waitLoaded = this.waitImageLoaded(id, true);
    this.updateConfig([...this.items, newItem]);
    this.addItemToWorkingSessionIfNeeded(newItem, sessionDirtyBeforeAdd);
    const loaded = await waitLoaded;
    if (loaded && fitOnAdd) {
      await this.fitImageToDefaultArea(id);
    }
    if (loaded) {
      this.setImageFocus(id);
    }
    return id;
  }

  private async upsertImageEntry(
    url: string,
    options: UpsertImageOptions = {},
  ): Promise<{ id: string; mode: "replace" | "add" }> {
    const mode = options.mode || (options.id ? "replace" : "add");
    const fitOnAdd = options.fitOnAdd !== false;
    if (mode === "replace") {
      if (!options.id) {
        throw new Error("replace-target-id-required");
      }
      const targetId = options.id;
      if (!this.hasImageItem(targetId)) {
        throw new Error("replace-target-not-found");
      }
      await this.updateImageInConfig(targetId, { url });
      return { id: targetId, mode: "replace" };
    }

    const id = await this.addImageEntry(url, options.addOptions, fitOnAdd);
    return { id, mode: "add" };
  }

  private addItemToWorkingSessionIfNeeded(
    item: ImageItem,
    sessionDirtyBeforeAdd: boolean,
  ) {
    if (!sessionDirtyBeforeAdd || !this.isToolActive) return;
    if (this.workingItems.some((existing) => existing.id === item.id)) return;
    this.workingItems = this.cloneItems([...this.workingItems, item]);
    this.updateImages();
    this.emitWorkingChange(item.id);
  }

  private async updateImage(
    id: string,
    updates: Partial<ImageItem>,
    options: UpdateImageOptions = {},
  ) {
    this.syncToolActiveFromWorkbench();
    const target = options.target || "auto";

    if (target === "working" || (target === "auto" && this.isToolActive)) {
      this.updateImageInWorking(id, updates);
      return;
    }

    await this.updateImageInConfig(id, updates);
  }

  private getConfig<T>(key: string, fallback?: T): T | undefined {
    if (!this.context) return fallback;
    const configService = this.context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (!configService) return fallback;
    return (configService.get(key, fallback) as T) ?? fallback;
  }

  private updateConfig(newItems: ImageItem[], skipCanvasUpdate = false) {
    if (!this.context) return;

    this.isUpdatingConfig = true;
    this.items = this.normalizeItems(newItems);
    if (!this.isToolActive || !this.hasWorkingChanges) {
      this.workingItems = this.cloneItems(this.items);
      this.hasWorkingChanges = false;
    }

    const configService = this.context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    configService?.update("image.items", this.items);

    if (!skipCanvasUpdate) {
      this.updateImages();
    }

    setTimeout(() => {
      this.isUpdatingConfig = false;
    }, 50);
  }

  private getFrameRect(): FrameRect {
    if (!this.canvasService) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
    const configService = this.context?.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (!configService) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }

    const sizeState = readSizeState(configService);
    const layout = computeSceneLayout(this.canvasService, sizeState);
    if (!layout) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }

    return this.canvasService.toSceneRect({
      left: layout.cutRect.left,
      top: layout.cutRect.top,
      width: layout.cutRect.width,
      height: layout.cutRect.height,
    });
  }

  private getFrameRectScreen(frame?: FrameRect): FrameRect {
    if (!this.canvasService) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
    return this.canvasService.toScreenRect(frame || this.getFrameRect());
  }

  private toLayoutSceneRect(rect: FrameRect): RenderLayoutRect {
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      space: "scene",
    };
  }

  private async resolveDefaultFitArea(): Promise<DielineFitArea | null> {
    if (!this.canvasService) return null;
    const frame = this.getFrameRect();
    if (frame.width <= 0 || frame.height <= 0) return null;
    return {
      width: Math.max(1, frame.width),
      height: Math.max(1, frame.height),
      left: frame.left + frame.width / 2,
      top: frame.top + frame.height / 2,
    };
  }

  private async fitImageToDefaultArea(id: string) {
    if (!this.canvasService) return;
    const area = await this.resolveDefaultFitArea();

    if (area) {
      await this.fitImageToArea(id, area);
      return;
    }

    const viewport = this.canvasService.getSceneViewportRect();
    const canvasW = Math.max(1, viewport.width || 0);
    const canvasH = Math.max(1, viewport.height || 0);
    await this.fitImageToArea(id, {
      width: canvasW,
      height: canvasH,
      left: viewport.left + canvasW / 2,
      top: viewport.top + canvasH / 2,
    });
  }

  private getImageObjects(): any[] {
    if (!this.canvasService) return [];
    return this.canvasService.canvas.getObjects().filter((obj: any) => {
      return obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID;
    }) as any[];
  }

  private getOverlayObjects(): any[] {
    if (!this.canvasService) return [];
    return this.canvasService.getPassObjects(IMAGE_OVERLAY_LAYER_ID) as any[];
  }

  private getImageObject(id: string): any | undefined {
    return this.getImageObjects().find((obj: any) => obj?.data?.id === id);
  }

  private clearRenderedImages() {
    if (!this.canvasService) return;
    this.imageSpecs = [];
    this.overlaySpecs = [];
    this.canvasService.requestRenderFromProducers();
  }

  private purgeSourceSizeCacheForItem(item?: ImageItem) {
    if (!item) return;
    const sources = [item.url, item.sourceUrl, item.committedUrl].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    sources.forEach((src) => this.sourceSizeBySrc.delete(src));
  }

  private rememberSourceSize(src: string, obj: any) {
    const width = Number(obj?.width || 0);
    const height = Number(obj?.height || 0);
    if (src && width > 0 && height > 0) {
      this.sourceSizeBySrc.set(src, { width, height });
    }
  }

  private getSourceSize(src: string, obj?: any): SourceSize {
    const cached = src ? this.sourceSizeBySrc.get(src) : undefined;
    if (cached) return cached;

    const width = Number(obj?.width || 0);
    const height = Number(obj?.height || 0);
    if (src && width > 0 && height > 0) {
      const size = { width, height };
      this.sourceSizeBySrc.set(src, size);
      return size;
    }

    return { width: 1, height: 1 };
  }

  private async ensureSourceSize(src: string): Promise<SourceSize | null> {
    if (!src) return null;
    const cached = this.sourceSizeBySrc.get(src);
    if (cached) return cached;

    try {
      const image = await FabricImage.fromURL(src, {
        crossOrigin: "anonymous",
      });
      const width = Number(image?.width || 0);
      const height = Number(image?.height || 0);
      if (width > 0 && height > 0) {
        const size = { width, height };
        this.sourceSizeBySrc.set(src, size);
        return size;
      }
    } catch (error) {
      this.debug("image:size:load-failed", {
        src,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return null;
  }

  private getCoverScale(frame: FrameRect, size: SourceSize): number {
    const sw = Math.max(1, size.width);
    const sh = Math.max(1, size.height);
    const fw = Math.max(1, frame.width);
    const fh = Math.max(1, frame.height);
    return Math.max(fw / sw, fh / sh);
  }

  private getFrameVisualConfig(): FrameVisualConfig {
    const strokeStyleRaw = (this.getConfig<string>(
      "image.frame.strokeStyle",
      "dashed",
    ) || "dashed") as string;
    const strokeStyle: "solid" | "dashed" | "hidden" =
      strokeStyleRaw === "dashed" || strokeStyleRaw === "hidden"
        ? strokeStyleRaw
        : "dashed";

    const strokeWidth = Number(
      this.getConfig<number>("image.frame.strokeWidth", 2) ?? 2,
    );
    const dashLength = Number(
      this.getConfig<number>("image.frame.dashLength", 8) ?? 8,
    );

    return {
      strokeColor:
        this.getConfig<string>("image.frame.strokeColor", "#808080") ||
        "#808080",
      strokeWidth: Number.isFinite(strokeWidth) ? Math.max(0, strokeWidth) : 2,
      strokeStyle,
      dashLength: Number.isFinite(dashLength) ? Math.max(1, dashLength) : 8,
      innerBackground:
        this.getConfig<string>(
          "image.frame.innerBackground",
          "rgba(0,0,0,0)",
        ) || "rgba(0,0,0,0)",
      outerBackground:
        this.getConfig<string>("image.frame.outerBackground", "#f5f5f5") ||
        "#f5f5f5",
    };
  }

  private toSceneGeometryLike(raw: any): SceneGeometryLike | null {
    const shape = raw?.shape;
    if (!isDielineShape(shape)) {
      return null;
    }

    const radiusRaw = Number(raw?.radius);
    const offsetRaw = Number(raw?.offset);
    const unit = typeof raw?.unit === "string" ? raw.unit : "px";
    const radius =
      unit === "scene" || !this.canvasService
        ? radiusRaw
        : this.canvasService.toSceneLength(radiusRaw);
    const offset =
      unit === "scene" || !this.canvasService
        ? offsetRaw
        : this.canvasService.toSceneLength(offsetRaw);
    return {
      shape,
      shapeStyle: normalizeShapeStyle(raw?.shapeStyle),
      radius: Number.isFinite(radius) ? radius : 0,
      offset: Number.isFinite(offset) ? offset : 0,
    };
  }

  private async resolveSceneGeometryForOverlay(): Promise<SceneGeometryLike | null> {
    if (!this.context) return null;
    const commandService = this.context.services.get<any>("CommandService");
    if (commandService) {
      try {
        const raw = await Promise.resolve(
          commandService.executeCommand("getSceneGeometry"),
        );
        const geometry = this.toSceneGeometryLike(raw);
        if (geometry) {
          this.debug("overlay:sceneGeometry:command", geometry);
          return geometry;
        }
        this.debug("overlay:sceneGeometry:command:invalid", { raw });
      } catch (error) {
        this.debug("overlay:sceneGeometry:command:error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!this.canvasService) return null;
    const configService = this.context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (!configService) return null;

    const sizeState = readSizeState(configService);
    const layout = computeSceneLayout(this.canvasService, sizeState);
    if (!layout) {
      this.debug("overlay:sceneGeometry:fallback:missing-layout");
      return null;
    }

    const geometry = this.toSceneGeometryLike(
      buildSceneGeometry(configService, layout),
    );
    if (geometry) {
      this.debug("overlay:sceneGeometry:fallback", geometry);
    }
    return geometry;
  }

  private resolveCutShapeRadius(
    geometry: SceneGeometryLike,
    frame: FrameRect,
  ): number {
    const visualRadius = Number.isFinite(geometry.radius)
      ? Math.max(0, geometry.radius)
      : 0;
    const visualOffset = Number.isFinite(geometry.offset) ? geometry.offset : 0;
    const rawCutRadius =
      visualRadius === 0 ? 0 : Math.max(0, visualRadius + visualOffset);
    const maxRadius = Math.max(0, Math.min(frame.width, frame.height) / 2);
    return Math.max(0, Math.min(maxRadius, rawCutRadius));
  }

  private getCropShapeHatchPattern(
    color = "rgba(255, 0, 0, 0.6)",
  ): Pattern | undefined {
    if (typeof document === "undefined") return undefined;
    const sceneScale = this.canvasService?.getSceneScale() || 1;
    const cacheKey = `${color}::${sceneScale.toFixed(6)}`;
    if (
      this.cropShapeHatchPattern &&
      this.cropShapeHatchPatternColor === color &&
      this.cropShapeHatchPatternKey === cacheKey
    ) {
      return this.cropShapeHatchPattern;
    }

    const size = 16;
    const patternCanvas = document.createElement("canvas");
    patternCanvas.width = size;
    patternCanvas.height = size;
    const ctx = patternCanvas.getContext("2d");
    if (!ctx) return undefined;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "rgba(255, 0, 0, 0.08)";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-size, size);
    ctx.lineTo(size, -size);
    ctx.moveTo(-size / 2, size + size / 2);
    ctx.lineTo(size + size / 2, -size / 2);
    ctx.moveTo(0, size);
    ctx.lineTo(size, 0);
    ctx.moveTo(size / 2, size + size / 2);
    ctx.lineTo(size + size + size / 2, -size / 2);
    ctx.stroke();

    const pattern = new Pattern({
      source: patternCanvas,
      // @ts-ignore: Fabric Pattern accepts canvas source here.
      repetition: "repeat",
    });
    // Scene specs are scaled to screen by CanvasService; keep hatch density in screen pixels.
    (pattern as any).patternTransform = [
      1 / sceneScale,
      0,
      0,
      1 / sceneScale,
      0,
      0,
    ];
    this.cropShapeHatchPattern = pattern;
    this.cropShapeHatchPatternColor = color;
    this.cropShapeHatchPatternKey = cacheKey;
    return pattern;
  }

  private buildCropShapeOverlaySpecs(
    frame: FrameRect,
    sceneGeometry: SceneGeometryLike | null,
  ): RenderObjectSpec[] {
    if (!sceneGeometry) {
      this.debug("overlay:shape:skip", { reason: "scene-geometry-missing" });
      return [];
    }
    if (sceneGeometry.shape === "custom") {
      this.debug("overlay:shape:skip", { reason: "shape-custom" });
      return [];
    }

    const shape = sceneGeometry.shape as ShapeOverlayShape;
    const shapeStyle = sceneGeometry.shapeStyle;
    const inset = 0;
    const shapeWidth = Math.max(1, frame.width);
    const shapeHeight = Math.max(1, frame.height);
    const radius = this.resolveCutShapeRadius(sceneGeometry, frame);

    this.debug("overlay:shape:geometry", {
      shape,
      frameWidth: frame.width,
      frameHeight: frame.height,
      offset: sceneGeometry.offset,
      shapeStyle,
      inset,
      shapeWidth,
      shapeHeight,
      baseRadius: sceneGeometry.radius,
      radius,
    });

    const isSameAsFrame =
      Math.abs(shapeWidth - frame.width) <= 0.0001 &&
      Math.abs(shapeHeight - frame.height) <= 0.0001;
    if (shape === "rect" && radius <= 0.0001 && isSameAsFrame) {
      this.debug("overlay:shape:skip", {
        reason: "shape-rect-no-radius",
      });
      return [];
    }

    const baseOptions = {
      shape,
      width: shapeWidth,
      height: shapeHeight,
      radius,
      x: frame.width / 2,
      y: frame.height / 2,
      features: [],
      shapeStyle,
      canvasWidth: frame.width,
      canvasHeight: frame.height,
    };

    try {
      const shapePathData = generateDielinePath(baseOptions);
      const outerRectPathData = `M 0 0 L ${frame.width} 0 L ${frame.width} ${frame.height} L 0 ${frame.height} Z`;
      const hatchPathData = `${outerRectPathData} ${shapePathData}`;
      if (!shapePathData || !hatchPathData) {
        this.debug("overlay:shape:skip", {
          reason: "path-generation-empty",
          shape,
          radius,
        });
        return [];
      }

      const patternFill = this.getCropShapeHatchPattern();
      const hatchFill = patternFill || "rgba(255, 0, 0, 0.22)";
      const shapeBounds = getPathBounds(shapePathData);
      const hatchBounds = getPathBounds(hatchPathData);
      const frameRect = this.toLayoutSceneRect(frame);
      const hatchPathLength = hatchPathData.length;
      const shapePathLength = shapePathData.length;
      const specs: RenderObjectSpec[] = [
        {
          id: "image.cropShapeHatch",
          type: "path",
          data: { id: "image.cropShapeHatch", zIndex: 5 },
          layout: {
            reference: "custom",
            referenceRect: frameRect,
            alignX: "start",
            alignY: "start",
            offsetX: hatchBounds.x,
            offsetY: hatchBounds.y,
          },
          props: {
            pathData: hatchPathData,
            originX: "left",
            originY: "top",
            fill: hatchFill,
            opacity: patternFill ? 1 : 0.8,
            stroke: null,
            fillRule: "evenodd",
            selectable: false,
            evented: false,
            excludeFromExport: true,
            objectCaching: false,
          },
        },
        {
          id: "image.cropShapePath",
          type: "path",
          data: { id: "image.cropShapePath", zIndex: 6 },
          layout: {
            reference: "custom",
            referenceRect: frameRect,
            alignX: "start",
            alignY: "start",
            offsetX: shapeBounds.x,
            offsetY: shapeBounds.y,
          },
          props: {
            pathData: shapePathData,
            originX: "left",
            originY: "top",
            fill: "rgba(0,0,0,0)",
            stroke: "rgba(255, 0, 0, 0.9)",
            strokeWidth: this.canvasService?.toSceneLength(1) ?? 1,
            selectable: false,
            evented: false,
            excludeFromExport: true,
            objectCaching: false,
          },
        },
      ];
      this.debug("overlay:shape:built", {
        shape,
        radius,
        inset,
        shapeWidth,
        shapeHeight,
        fillRule: "evenodd",
        shapePathLength,
        hatchPathLength,
        shapeBounds,
        hatchBounds,
        hatchFillType:
          hatchFill && typeof hatchFill === "object" ? "pattern" : "color",
        ids: specs.map((spec) => spec.id),
      });
      return specs;
    } catch (error) {
      this.debug("overlay:shape:error", {
        shape,
        radius,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private resolveRenderImageState(item: ImageItem): RenderImageState {
    const active = this.isToolActive;
    const sourceUrl = item.sourceUrl || item.url;
    const committedUrl = item.committedUrl;

    if (!active && committedUrl) {
      return {
        src: committedUrl,
        left: 0.5,
        top: 0.5,
        scale: 1,
        angle: 0,
        opacity: item.opacity,
      };
    }

    return {
      src: sourceUrl || item.url,
      left: Number.isFinite(item.left as any) ? (item.left as number) : 0.5,
      top: Number.isFinite(item.top as any) ? (item.top as number) : 0.5,
      scale: Math.max(0.05, item.scale ?? 1),
      angle: Number.isFinite(item.angle as any) ? (item.angle as number) : 0,
      opacity: item.opacity,
    };
  }

  private computeCanvasProps(
    render: RenderImageState,
    size: SourceSize,
    frame: FrameRect,
  ) {
    const left = render.left;
    const top = render.top;
    const zoom = render.scale;
    const angle = render.angle;

    const centerX = frame.left + left * frame.width;
    const centerY = frame.top + top * frame.height;
    const scale = this.getCoverScale(frame, size) * zoom;

    return {
      left: centerX,
      top: centerY,
      scaleX: scale,
      scaleY: scale,
      angle,
      originX: "center" as const,
      originY: "center" as const,
      uniformScaling: true,
      lockScalingFlip: true,
      selectable: this.isImageEditingVisible(),
      evented: this.isImageEditingVisible(),
      hasControls: this.isImageEditingVisible(),
      hasBorders: this.isImageEditingVisible(),
      opacity: render.opacity,
    };
  }

  private toSceneObjectScale(value: number): number {
    if (!this.canvasService) return value;
    return value / this.canvasService.getSceneScale();
  }

  private getCurrentSrc(obj: any): string | undefined {
    if (!obj) return undefined;
    if (typeof obj.getSrc === "function") return obj.getSrc();
    return obj?._originalElement?.src;
  }

  private async buildImageSpecs(
    items: ImageItem[],
    frame: FrameRect,
  ): Promise<RenderObjectSpec[]> {
    const specs: RenderObjectSpec[] = [];

    for (const item of items) {
      const render = this.resolveRenderImageState(item);
      if (!render.src) continue;

      const ensured = await this.ensureSourceSize(render.src);
      const sourceSize = ensured || this.getSourceSize(render.src);
      const props = this.computeCanvasProps(render, sourceSize, frame);

      specs.push({
        id: item.id,
        type: "image",
        src: render.src,
        data: {
          id: item.id,
          layerId: IMAGE_OBJECT_LAYER_ID,
          type: "image-item",
        },
        props,
      });
    }

    return specs;
  }

  private buildOverlaySpecs(
    frame: FrameRect,
    sceneGeometry: SceneGeometryLike | null,
  ): RenderObjectSpec[] {
    const visible = this.isImageEditingVisible();
    if (
      !visible ||
      frame.width <= 0 ||
      frame.height <= 0 ||
      !this.canvasService
    ) {
      this.debug("overlay:hidden", {
        visible,
        frame,
        isToolActive: this.isToolActive,
        isImageSelectionActive: this.isImageSelectionActive,
        focusedImageId: this.focusedImageId,
      });
      return [];
    }

    const viewport = this.canvasService.getSceneViewportRect();
    const canvasW = viewport.width || 0;
    const canvasH = viewport.height || 0;
    const canvasLeft = viewport.left || 0;
    const canvasTop = viewport.top || 0;
    const visual = this.getFrameVisualConfig();
    const strokeWidthScene = this.canvasService.toSceneLength(
      visual.strokeWidth,
    );
    const dashLengthScene = this.canvasService.toSceneLength(visual.dashLength);

    const frameLeft = Math.max(
      canvasLeft,
      Math.min(canvasLeft + canvasW, frame.left),
    );
    const frameTop = Math.max(
      canvasTop,
      Math.min(canvasTop + canvasH, frame.top),
    );
    const frameRight = Math.max(
      frameLeft,
      Math.min(canvasLeft + canvasW, frame.left + frame.width),
    );
    const frameBottom = Math.max(
      frameTop,
      Math.min(canvasTop + canvasH, frame.top + frame.height),
    );
    const visibleFrameH = Math.max(0, frameBottom - frameTop);

    const topH = Math.max(0, frameTop - canvasTop);
    const bottomH = Math.max(0, canvasTop + canvasH - frameBottom);
    const leftW = Math.max(0, frameLeft - canvasLeft);
    const rightW = Math.max(0, canvasLeft + canvasW - frameRight);
    const viewportRect = this.toLayoutSceneRect({
      left: canvasLeft,
      top: canvasTop,
      width: canvasW,
      height: canvasH,
    });
    const visibleFrameBandRect = this.toLayoutSceneRect({
      left: canvasLeft,
      top: frameTop,
      width: canvasW,
      height: visibleFrameH,
    });
    const frameRect = this.toLayoutSceneRect(frame);
    const shapeOverlay = this.buildCropShapeOverlaySpecs(frame, sceneGeometry);

    const mask: RenderObjectSpec[] = [
      {
        id: "image.cropMask.top",
        type: "rect",
        data: { id: "image.cropMask.top", zIndex: 1 },
        layout: {
          reference: "custom",
          referenceRect: viewportRect,
          alignX: "start",
          alignY: "start",
          width: "100%",
          height: topH,
        },
        props: {
          originX: "left",
          originY: "top",
          fill: visual.outerBackground,
          selectable: false,
          evented: false,
        },
      },
      {
        id: "image.cropMask.bottom",
        type: "rect",
        data: { id: "image.cropMask.bottom", zIndex: 2 },
        layout: {
          reference: "custom",
          referenceRect: viewportRect,
          alignX: "start",
          alignY: "end",
          width: "100%",
          height: bottomH,
        },
        props: {
          originX: "left",
          originY: "top",
          fill: visual.outerBackground,
          selectable: false,
          evented: false,
        },
      },
      {
        id: "image.cropMask.left",
        type: "rect",
        data: { id: "image.cropMask.left", zIndex: 3 },
        layout: {
          reference: "custom",
          referenceRect: visibleFrameBandRect,
          alignX: "start",
          alignY: "start",
          width: leftW,
          height: "100%",
        },
        props: {
          originX: "left",
          originY: "top",
          fill: visual.outerBackground,
          selectable: false,
          evented: false,
        },
      },
      {
        id: "image.cropMask.right",
        type: "rect",
        data: { id: "image.cropMask.right", zIndex: 4 },
        layout: {
          reference: "custom",
          referenceRect: visibleFrameBandRect,
          alignX: "end",
          alignY: "start",
          width: rightW,
          height: "100%",
        },
        props: {
          originX: "left",
          originY: "top",
          fill: visual.outerBackground,
          selectable: false,
          evented: false,
        },
      },
    ];

    const frameSpec: RenderObjectSpec = {
      id: "image.cropFrame",
      type: "rect",
      data: { id: "image.cropFrame", zIndex: 7 },
      layout: {
        reference: "custom",
        referenceRect: frameRect,
        alignX: "start",
        alignY: "start",
        width: "100%",
        height: "100%",
      },
      props: {
        originX: "left",
        originY: "top",
        fill: visual.innerBackground,
        stroke:
          visual.strokeStyle === "hidden"
            ? "rgba(0,0,0,0)"
            : visual.strokeColor,
        strokeWidth: visual.strokeStyle === "hidden" ? 0 : strokeWidthScene,
        strokeDashArray:
          visual.strokeStyle === "dashed"
            ? [dashLengthScene, dashLengthScene]
            : undefined,
        selectable: false,
        evented: false,
      },
    };

    const specs =
      shapeOverlay.length > 0
        ? [...mask, ...shapeOverlay]
        : [...mask, ...shapeOverlay, frameSpec];
    this.debug("overlay:built", {
      frame,
      shape: sceneGeometry?.shape,
      overlayIds: specs.map((spec) => ({
        id: spec.id,
        zIndex: spec.data?.zIndex,
      })),
    });
    return specs;
  }

  private updateImages() {
    void this.updateImagesAsync();
  }

  private async updateImagesAsync() {
    if (!this.canvasService) return;
    this.syncToolActiveFromWorkbench();
    const seq = ++this.renderSeq;

    const renderItems = this.isToolActive ? this.workingItems : this.items;
    const frame = this.getFrameRect();
    const desiredIds = new Set(renderItems.map((item) => item.id));
    if (this.focusedImageId && !desiredIds.has(this.focusedImageId)) {
      this.setImageFocus(null, {
        syncCanvasSelection: false,
        skipRender: true,
      });
    }

    const imageSpecs = await this.buildImageSpecs(renderItems, frame);
    if (seq !== this.renderSeq) return;

    const sceneGeometry = await this.resolveSceneGeometryForOverlay();
    if (seq !== this.renderSeq) return;

    this.imageSpecs = imageSpecs;
    this.overlaySpecs = this.buildOverlaySpecs(frame, sceneGeometry);
    await this.canvasService.flushRenderFromProducers();
    if (seq !== this.renderSeq) return;
    this.refreshImageObjectInteractionState();

    renderItems.forEach((item) => {
      if (!this.getImageObject(item.id)) return;
      const resolver = this.loadResolvers.get(item.id);
      if (!resolver) return;
      resolver();
      this.loadResolvers.delete(item.id);
    });

    if (this.focusedImageId && this.isToolActive) {
      this.setImageFocus(this.focusedImageId, {
        syncCanvasSelection: true,
        skipRender: true,
      });
    }

    const overlayCanvasCount = this.getOverlayObjects().length;

    this.debug("render:done", {
      seq,
      renderCount: renderItems.length,
      overlayCount: this.overlaySpecs.length,
      overlayCanvasCount,
      isToolActive: this.isToolActive,
      isImageSelectionActive: this.isImageSelectionActive,
      focusedImageId: this.focusedImageId,
    });
    this.canvasService.requestRenderAll();
  }

  private clampNormalized(value: number): number {
    return Math.max(-1, Math.min(2, value));
  }

  private onObjectModified = (e: any) => {
    if (!this.isToolActive) return;
    const target = e?.target;
    const id = target?.data?.id;
    const layerId = target?.data?.layerId;
    if (typeof id !== "string" || layerId !== IMAGE_OBJECT_LAYER_ID) return;

    const frame = this.getFrameRect();
    if (!frame.width || !frame.height) return;

    const center = target.getCenterPoint
      ? target.getCenterPoint()
      : new Point(target.left ?? 0, target.top ?? 0);
    const centerScene = this.canvasService
      ? this.canvasService.toScenePoint({ x: center.x, y: center.y })
      : { x: center.x, y: center.y };

    const objectScale = Number.isFinite(target?.scaleX) ? target.scaleX : 1;
    const objectScaleScene = this.toSceneObjectScale(objectScale || 1);

    const workingItem = this.workingItems.find((item) => item.id === id);
    const sourceKey = workingItem?.sourceUrl || workingItem?.url || "";
    const sourceSize = this.getSourceSize(sourceKey, target);
    const coverScale = this.getCoverScale(frame, sourceSize);

    const updates: Partial<ImageItem> = {
      left: this.clampNormalized((centerScene.x - frame.left) / frame.width),
      top: this.clampNormalized((centerScene.y - frame.top) / frame.height),
      angle: Number.isFinite(target.angle) ? target.angle : 0,
      scale: Math.max(0.05, objectScaleScene / coverScale),
    };

    this.focusedImageId = id;
    this.updateImageInWorking(id, updates);
  };

  private updateImageInWorking(id: string, updates: Partial<ImageItem>) {
    const index = this.workingItems.findIndex((item) => item.id === id);
    if (index < 0) return;

    const next = [...this.workingItems];
    next[index] = this.normalizeItem({ ...next[index], ...updates });
    this.workingItems = next;
    this.hasWorkingChanges = true;
    this.setImageFocus(id, {
      syncCanvasSelection: false,
      skipRender: true,
    });
    if (this.isToolActive) {
      this.updateImages();
    }
    this.emitWorkingChange(id);
  }

  private async updateImageInConfig(id: string, updates: Partial<ImageItem>) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return;

    const replacingSource =
      typeof updates.url === "string" && updates.url.length > 0;
    const next = [...this.items];
    const base = next[index];
    const replacingUrl = replacingSource ? (updates.url as string) : undefined;

    next[index] = this.normalizeItem({
      ...base,
      ...updates,
      ...(replacingSource
        ? {
            url: replacingUrl,
            sourceUrl: replacingUrl,
            committedUrl: undefined,
            scale: updates.scale ?? 1,
            angle: updates.angle ?? 0,
            left: updates.left ?? 0.5,
            top: updates.top ?? 0.5,
          }
        : {}),
    });

    this.updateConfig(next);

    if (replacingSource) {
      this.debug("replace:image:begin", { id, replacingUrl });
      this.purgeSourceSizeCacheForItem(base);
      const loaded = await this.waitImageLoaded(id, true);
      this.debug("replace:image:loaded", { id, loaded });
      if (loaded) {
        await this.refitImageToFrame(id);
        this.setImageFocus(id);
      }
    }
  }

  private waitImageLoaded(id: string, forceWait = false): Promise<boolean> {
    if (!forceWait && this.getImageObject(id)) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.loadResolvers.delete(id);
        resolve(false);
      }, 4000);

      this.loadResolvers.set(id, () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
  }

  private async refitImageToFrame(id: string) {
    const obj = this.getImageObject(id);
    if (!obj || !this.canvasService) return;
    const current = this.items.find((item) => item.id === id);
    if (!current) return;
    const render = this.resolveRenderImageState(current);

    this.rememberSourceSize(render.src, obj);
    const source = this.getSourceSize(render.src, obj);
    const frame = this.getFrameRect();
    const coverScale = this.getCoverScale(frame, source);

    const currentScale = this.toSceneObjectScale(obj.scaleX || 1);
    const zoom = Math.max(0.05, currentScale / coverScale);

    const updated: Partial<ImageItem> = {
      scale: Number.isFinite(zoom) ? zoom : 1,
      angle: 0,
      left: 0.5,
      top: 0.5,
    };

    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return;

    const next = [...this.items];
    next[index] = this.normalizeItem({ ...next[index], ...updated });
    this.updateConfig(next);
    this.workingItems = this.cloneItems(next);
    this.hasWorkingChanges = false;
    this.updateImages();
    this.emitWorkingChange(id);
  }

  private async fitImageToArea(
    id: string,
    area: { width: number; height: number; left?: number; top?: number },
  ) {
    if (!this.canvasService) return;

    const loaded = await this.waitImageLoaded(id, false);
    if (!loaded) return;

    const obj = this.getImageObject(id);
    if (!obj) return;
    const renderItems = this.isToolActive ? this.workingItems : this.items;
    const current = renderItems.find((item) => item.id === id);
    if (!current) return;
    const render = this.resolveRenderImageState(current);

    this.rememberSourceSize(render.src, obj);
    const source = this.getSourceSize(render.src, obj);
    const frame = this.getFrameRect();
    const baseCover = this.getCoverScale(frame, source);

    const desiredScale = Math.max(
      Math.max(1, area.width) / Math.max(1, source.width),
      Math.max(1, area.height) / Math.max(1, source.height),
    );

    const viewport = this.canvasService.getSceneViewportRect();
    const canvasW = viewport.width || 1;
    const canvasH = viewport.height || 1;

    const areaLeftInput = area.left ?? 0.5;
    const areaTopInput = area.top ?? 0.5;

    const areaLeftPx =
      areaLeftInput <= 1.5
        ? viewport.left + areaLeftInput * canvasW
        : areaLeftInput;
    const areaTopPx =
      areaTopInput <= 1.5
        ? viewport.top + areaTopInput * canvasH
        : areaTopInput;

    const updates: Partial<ImageItem> = {
      scale: Math.max(0.05, desiredScale / baseCover),
      left: this.clampNormalized(
        (areaLeftPx - frame.left) / Math.max(1, frame.width),
      ),
      top: this.clampNormalized(
        (areaTopPx - frame.top) / Math.max(1, frame.height),
      ),
    };

    if (this.isToolActive) {
      this.updateImageInWorking(id, updates);
      return;
    }

    await this.updateImageInConfig(id, updates);
  }

  private async commitWorkingImagesAsCropped() {
    if (!this.canvasService) {
      return { ok: false, reason: "canvas-not-ready" };
    }

    await this.updateImagesAsync();

    const frame = this.getFrameRect();
    if (!frame.width || !frame.height) {
      return { ok: false, reason: "frame-not-ready" };
    }

    const next: ImageItem[] = [];
    for (const item of this.workingItems) {
      const exported = await this.exportCroppedImageByIds([item.id], {
        multiplier: 2,
        format: "png",
      });
      const url = exported.url;

      const sourceUrl = item.sourceUrl || item.url;
      const previousCommitted = item.committedUrl;
      next.push(
        this.normalizeItem({
          ...item,
          url,
          // Keep original source for next image-tool session editing,
          // and use committedUrl as non-image-tools render source.
          sourceUrl,
          committedUrl: url,
        }),
      );
      if (previousCommitted && previousCommitted !== url) {
        this.sourceSizeBySrc.delete(previousCommitted);
      }
    }

    this.hasWorkingChanges = false;
    this.workingItems = this.cloneItems(next);
    this.updateConfig(next);
    this.emitWorkingChange(this.focusedImageId);
    return { ok: true };
  }

  private async exportCroppedImageByIds(
    imageIds: string[],
    options: ExportCroppedImageOptions,
  ): Promise<ExportUserCroppedImageResult> {
    if (!this.canvasService) {
      throw new Error("CanvasService not initialized");
    }

    const normalizedIds = [...new Set(imageIds)].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    if (!normalizedIds.length) {
      throw new Error("image-ids-required");
    }

    const frameScene = this.getFrameRect();
    const frame = this.getFrameRectScreen(frameScene);
    const multiplier = Math.max(1, options.multiplier ?? 2);
    const format: "png" | "jpeg" = options.format === "jpeg" ? "jpeg" : "png";

    const width = Math.max(1, Math.round(frame.width * multiplier));
    const height = Math.max(1, Math.round(frame.height * multiplier));

    const el = document.createElement("canvas");
    const tempCanvas = new FabricCanvas(el, {
      renderOnAddRemove: false,
      selection: false,
      enableRetinaScaling: false,
      preserveObjectStacking: true,
    } as any);
    tempCanvas.setDimensions({ width, height });

    try {
      const idSet = new Set(normalizedIds);
      const sourceObjects = this.canvasService.canvas
        .getObjects()
        .filter((obj: any) => {
          return (
            obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID &&
            typeof obj?.data?.id === "string" &&
            idSet.has(obj.data.id)
          );
        });

      if (!sourceObjects.length) {
        throw new Error("image-objects-not-found");
      }

      for (const source of sourceObjects as any[]) {
        const clone = await source.clone();
        const center = source.getCenterPoint
          ? source.getCenterPoint()
          : new Point(source.left ?? 0, source.top ?? 0);

        clone.set({
          originX: "center",
          originY: "center",
          left: (center.x - frame.left) * multiplier,
          top: (center.y - frame.top) * multiplier,
          scaleX: (source.scaleX || 1) * multiplier,
          scaleY: (source.scaleY || 1) * multiplier,
          angle: source.angle || 0,
          selectable: false,
          evented: false,
        });
        clone.setCoords();
        tempCanvas.add(clone);
      }

      tempCanvas.renderAll();
      const blob = await tempCanvas.toBlob({ format, multiplier: 1 });
      if (!blob) {
        throw new Error("image-export-failed");
      }

      return {
        url: URL.createObjectURL(blob),
        width,
        height,
        multiplier,
        format,
        imageIds: (sourceObjects as any[])
          .map((obj: any) => obj?.data?.id)
          .filter((id: any): id is string => typeof id === "string"),
      };
    } finally {
      tempCanvas.dispose();
    }
  }

  private async exportUserCroppedImage(
    options: ExportUserCroppedImageOptions = {},
  ): Promise<ExportUserCroppedImageResult> {
    if (!this.canvasService) {
      throw new Error("CanvasService not initialized");
    }

    await this.updateImagesAsync();
    this.syncToolActiveFromWorkbench();

    const imageIds =
      options.imageIds && options.imageIds.length > 0
        ? options.imageIds
        : (this.isToolActive ? this.workingItems : this.items).map(
            (item) => item.id,
          );
    if (!imageIds.length) {
      throw new Error("no-images-to-export");
    }

    return await this.exportCroppedImageByIds(imageIds, options);
  }
}
