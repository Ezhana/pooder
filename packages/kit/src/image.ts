import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
  ConfigurationService,
  ToolSessionService,
} from "@pooder/core";
import { Point, util } from "fabric";
import CanvasService from "./CanvasService";
import type { RenderObjectSpec } from "./renderSpec";

export interface ImageItem {
  id: string;
  url: string;
  opacity: number;
  scale?: number;
  angle?: number;
  left?: number;
  top?: number;
}

export class ImageTool implements Extension {
  id = "pooder.kit.image";

  metadata = {
    name: "ImageTool",
  };

  private items: ImageItem[] = [];
  private workingItems: ImageItem[] = [];
  private hasWorkingChanges = false;
  private loadResolvers: Map<string, () => void> = new Map();
  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private isUpdatingConfig = false;
  private isToolActive = false;
  private renderSeq = 0;
  private dirtyTrackerDisposable?: { dispose(): void };

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    if (!this.canvasService) {
      console.warn("CanvasService not found for ImageTool");
      return;
    }

    // Listen to tool activation
    context.eventBus.on("tool:activated", this.onToolActivated);
    context.eventBus.on("object:modified", this.onObjectModified);

    const configService = context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (configService) {
      // Load initial config
      this.items = configService.get("image.items", []) || [];
      this.workingItems = this.cloneItems(this.items);
      this.hasWorkingChanges = false;

      // Listen for changes
      configService.onAnyChange((e: { key: string; value: any }) => {
        if (this.isUpdatingConfig) return;

        if (e.key === "image.items") {
          this.items = e.value || [];
          if (!this.isToolActive || !this.hasWorkingChanges) {
            this.workingItems = this.cloneItems(this.items);
            this.hasWorkingChanges = false;
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

    this.ensureLayer();
    this.updateImages();
  }

  deactivate(context: ExtensionContext) {
    context.eventBus.off("tool:activated", this.onToolActivated);
    context.eventBus.off("object:modified", this.onObjectModified);
    this.dirtyTrackerDisposable?.dispose();
    this.dirtyTrackerDisposable = undefined;
    
    if (this.canvasService) {
      void this.canvasService.applyObjectSpecsToLayer("image-overlay", []);
      void this.canvasService.applyObjectSpecsToLayer("user", []);
      this.canvasService = undefined;
      this.context = undefined;
    }
  }

  private onToolActivated = (event: { id: string }) => {
    this.isToolActive = event.id === this.id;
    this.updateImages();
  };

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
      ] as ConfigurationContribution[],
      [ContributionPointIds.COMMANDS]: [
        {
          command: "addImage",
          title: "Add Image",
          handler: async (url: string, options?: Partial<ImageItem>) => {
            const id = this.generateId();
            const newItem: ImageItem = {
              id,
              url,
              opacity: 1,
              ...options,
            };

            const promise = new Promise<string>((resolve) => {
              this.loadResolvers.set(id, () => resolve(id));
            });

            this.updateConfig([...this.items, newItem]);
            return promise;
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
          },
        },
        {
          command: "completeImages",
          title: "Complete Images",
          handler: () => {
            this.updateConfig(this.cloneItems(this.workingItems));
            this.hasWorkingChanges = false;
            return { ok: true };
          },
        },
        {
          command: "exportImageFrameUrl",
          title: "Export Image Frame Url",
          handler: async (
            options: { multiplier?: number; format?: "png" | "jpeg" } = {},
          ) => {
            return await this.exportImageFrameUrl(options);
          },
        },
        {
          command: "fitImageToArea",
          title: "Fit Image to Area",
          handler: (
            id: string,
            area: { width: number; height: number; left?: number; top?: number },
          ) => {
            const obj = this.canvasService?.getObject(id, "user") as any;
            if (!obj || !obj.width || !obj.height) return;
            const scale = Math.max(area.width / obj.width, area.height / obj.height);
            this.updateImageInConfig(id, {
              scale,
              left: area.left ?? 0.5,
              top: area.top ?? 0.5,
            });
          },
        },
        {
          command: "removeImage",
          title: "Remove Image",
          handler: (id: string) => {
            const newItems = this.items.filter((item) => item.id !== id);
            if (newItems.length !== this.items.length) {
              this.updateConfig(newItems);
            }
          },
        },
        {
          command: "updateImage",
          title: "Update Image",
          handler: (id: string, updates: Partial<ImageItem>) => {
            const index = this.items.findIndex((item) => item.id === id);
            if (index !== -1) {
              const newItems = [...this.items];
              newItems[index] = { ...newItems[index], ...updates };
              this.updateConfig(newItems);
            }
          },
        },
        {
          command: "clearImages",
          title: "Clear Images",
          handler: () => {
            this.updateConfig([]);
          },
        },
        {
          command: "bringToFront",
          title: "Bring Image to Front",
          handler: (id: string) => {
            const index = this.items.findIndex((item) => item.id === id);
            if (index !== -1 && index < this.items.length - 1) {
              const newItems = [...this.items];
              const [item] = newItems.splice(index, 1);
              newItems.push(item);
              this.updateConfig(newItems);
            }
          },
        },
        {
          command: "sendToBack",
          title: "Send Image to Back",
          handler: (id: string) => {
            const index = this.items.findIndex((item) => item.id === id);
            if (index > 0) {
              const newItems = [...this.items];
              const [item] = newItems.splice(index, 1);
              newItems.unshift(item);
              this.updateConfig(newItems);
            }
          },
        },
      ] as CommandContribution[],
    };
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 9);
  }

  private cloneItems(items: ImageItem[]): ImageItem[] {
    return (items || []).map((i) => ({ ...i }));
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
    this.items = newItems;
    if (!this.isToolActive || !this.hasWorkingChanges) {
      this.workingItems = this.cloneItems(newItems);
      this.hasWorkingChanges = false;
    }
    const configService = this.context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (configService) {
      configService.update("image.items", newItems);
    }
    // Update canvas immediately to reflect changes locally before config event comes back
    // (Optional, but good for responsiveness)
    if (!skipCanvasUpdate) {
      this.updateImages();
    }

    // Reset flag after a short delay to allow config propagation
    setTimeout(() => {
      this.isUpdatingConfig = false;
    }, 50);
  }

  private ensureLayer() {
    if (!this.canvasService) return;
    let userLayer = this.canvasService.getLayer("user");
    if (!userLayer) {
      userLayer = this.canvasService.createLayer("user", {
        left: 0,
        top: 0,
        originX: "left",
        originY: "top",
        selectable: false,
        evented: true,
        subTargetCheck: true,
        interactive: true,
      });

      // Try to insert below dieline-overlay
      const dielineLayer = this.canvasService.getLayer("dieline-overlay");
      if (dielineLayer) {
        const index = this.canvasService.canvas
          .getObjects()
          .indexOf(dielineLayer);
        // If dieline is at 0, move user to 0 (dieline shifts to 1)
        if (index >= 0) {
          this.canvasService.canvas.moveObjectTo(userLayer, index);
        }
      } else {
        // Ensure background is behind
        const bgLayer = this.canvasService.getLayer("background");
        if (bgLayer) {
          this.canvasService.canvas.sendObjectToBack(bgLayer);
        }
      }
      this.canvasService.requestRenderAll();
    }

    let overlayLayer = this.canvasService.getLayer("image-overlay");
    if (!overlayLayer) {
      overlayLayer = this.canvasService.createLayer("image-overlay", {
        left: 0,
        top: 0,
        originX: "left",
        originY: "top",
        selectable: false,
        evented: false,
      });
    }

    const dielineLayer = this.canvasService.getLayer("dieline-overlay");
    const objects = this.canvasService.canvas.getObjects();
    const userIndex = objects.indexOf(userLayer);
    const overlayIndex = objects.indexOf(overlayLayer);
    const dielineIndex = dielineLayer ? objects.indexOf(dielineLayer) : -1;

    if (userIndex >= 0 && overlayIndex >= 0) {
      if (dielineLayer && dielineIndex >= 0) {
        const target = Math.max(userIndex + 1, dielineIndex);
        this.canvasService.canvas.moveObjectTo(overlayLayer, target);
      } else {
        this.canvasService.canvas.moveObjectTo(overlayLayer, userIndex + 1);
      }
    }
  }

  private getLayoutInfo() {
    const canvasW = this.canvasService?.canvas.width || 800;
    const canvasH = this.canvasService?.canvas.height || 600;

    return {
      layoutScale: 1,
      layoutOffsetX: 0,
      layoutOffsetY: 0,
      visualWidth: canvasW,
      visualHeight: canvasH,
    };
  }

  private updateImages() {
    void this.updateImagesAsync();
  }

  private async updateImagesAsync() {
    const seq = ++this.renderSeq;
    if (!this.canvasService) return;

    this.ensureLayer();

    const renderItems = this.isToolActive ? this.workingItems : this.items;
    const layout = this.getLayoutInfo();
    const {
      layoutScale,
      layoutOffsetX,
      layoutOffsetY,
      visualWidth,
      visualHeight,
    } = layout;

    const imageSpecs: RenderObjectSpec[] = renderItems.map((item) => {
      const scale = item.scale ?? 1;
      const left = item.left ?? 0.5;
      const top = item.top ?? 0.5;

      const globalLeft = layoutOffsetX + left * visualWidth;
      const globalTop = layoutOffsetY + top * visualHeight;
      const targetScale = scale * layoutScale;

      return {
        id: item.id,
        type: "image",
        src: item.url,
        data: { id: item.id },
        props: {
          originX: "center",
          originY: "center",
          uniformScaling: true,
          lockScalingFlip: true,
          selectable: this.isToolActive,
          evented: this.isToolActive,
          hasControls: this.isToolActive,
          hasBorders: this.isToolActive,
          opacity: item.opacity,
          angle: item.angle ?? 0,
          left: globalLeft,
          top: globalTop,
          scaleX: targetScale,
          scaleY: targetScale,
        },
      };
    });

    await this.canvasService.applyObjectSpecsToLayer("user", imageSpecs);
    if (seq !== this.renderSeq) return;

    imageSpecs.forEach((s) => {
      const resolver = this.loadResolvers.get(s.id);
      if (!resolver) return;
      const obj = this.canvasService?.getObject(s.id, "user");
      if (obj) {
        resolver();
        this.loadResolvers.delete(s.id);
      }
    });

    const dielineWidth = this.isToolActive
      ? this.getConfig<number>("dieline.width", 0) || 0
      : 0;
    const dielineHeight = this.isToolActive
      ? this.getConfig<number>("dieline.height", 0) || 0
      : 0;

    if (!this.isToolActive || !dielineWidth || !dielineHeight) {
      await this.canvasService.applyObjectSpecsToLayer("image-overlay", []);
      return;
    }

    const canvasW = this.canvasService.canvas.width || 0;
    const canvasH = this.canvasService.canvas.height || 0;
    this.canvasService.viewport.updateContainer(canvasW, canvasH);
    this.canvasService.viewport.updatePhysical(dielineWidth, dielineHeight);
    const frameLayout = this.canvasService.viewport.layout;

    const frameSpec: RenderObjectSpec = {
      id: "image.dielineFrame",
      type: "rect",
      data: { id: "image.dielineFrame" },
      props: {
        left: frameLayout.offsetX + frameLayout.width / 2,
        top: frameLayout.offsetY + frameLayout.height / 2,
        width: frameLayout.width,
        height: frameLayout.height,
        originX: "center",
        originY: "center",
        fill: "rgba(0,0,0,0)",
        stroke: "#666",
        strokeWidth: 1,
        strokeDashArray: [8, 6],
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
      },
    };

    await this.canvasService.applyObjectSpecsToLayer("image-overlay", [frameSpec]);
  }

  private onObjectModified = (e: any) => {
    if (!this.isToolActive) return;
    const target = e?.target;
    const id = target?.data?.id;
    if (typeof id !== "string") return;
    if (!this.workingItems.find((i) => i.id === id)) return;

    const layout = this.getLayoutInfo();
    const {
      layoutScale,
      layoutOffsetX,
      layoutOffsetY,
      visualWidth,
      visualHeight,
    } = layout;

    const matrix = target.calcTransformMatrix();
    const globalPoint = util.transformPoint(new Point(0, 0), matrix);

    const updates: Partial<ImageItem> = {};
    updates.left = (globalPoint.x - layoutOffsetX) / visualWidth;
    updates.top = (globalPoint.y - layoutOffsetY) / visualHeight;
    updates.angle = target.angle;
    updates.scale = target.scaleX / layoutScale;

    this.updateImageInWorking(id, updates);
  };

  private updateImageInWorking(id: string, updates: Partial<ImageItem>) {
    const index = this.workingItems.findIndex((i) => i.id === id);
    if (index !== -1) {
      const next = [...this.workingItems];
      next[index] = { ...next[index], ...updates };
      this.workingItems = next;
      this.hasWorkingChanges = true;
      if (this.isToolActive) {
        this.updateImages();
      }
    }
  }

  private updateImageInConfig(
    id: string,
    updates: Partial<ImageItem>,
    skipCanvasUpdate = false,
  ) {
    const index = this.items.findIndex((i) => i.id === id);
    if (index !== -1) {
      const newItems = [...this.items];
      newItems[index] = { ...newItems[index], ...updates };
      this.updateConfig(newItems, skipCanvasUpdate);
    }
  }

  private async exportImageFrameUrl(
    options: { multiplier?: number; format?: "png" | "jpeg" } = {},
  ): Promise<{ url: string }> {
    if (!this.canvasService) {
      throw new Error("CanvasService not initialized");
    }

    const dielineWidth = this.getConfig<number>("dieline.width", 0) || 0;
    const dielineHeight = this.getConfig<number>("dieline.height", 0) || 0;
    if (!dielineWidth || !dielineHeight) {
      throw new Error("dieline.width/height is required for exportImageFrameUrl");
    }

    const userLayer = this.canvasService.getLayer("user");
    if (!userLayer) {
      throw new Error("User layer not found");
    }

    const canvasW = this.canvasService.canvas.width || 0;
    const canvasH = this.canvasService.canvas.height || 0;
    this.canvasService.viewport.updateContainer(canvasW, canvasH);
    this.canvasService.viewport.updatePhysical(dielineWidth, dielineHeight);
    const layout = this.canvasService.viewport.layout;

    const left = layout.offsetX;
    const top = layout.offsetY;
    const width = layout.width;
    const height = layout.height;

    const clonedLayer = await (userLayer as any).clone();
    const dataUrl: string = clonedLayer.toDataURL({
      left,
      top,
      width,
      height,
      multiplier: options.multiplier ?? 2,
      format: options.format ?? "png",
    });

    const blob = await (await fetch(dataUrl)).blob();
    const url = URL.createObjectURL(blob);
    return { url };
  }
}
