import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
  ConfigurationService,
} from "@pooder/core";
import { Image, Point, Rect, util, Object as FabricObject } from "fabric";
import CanvasService from "./CanvasService";
import { Coordinate } from "./coordinate";

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
  private objectMap: Map<string, FabricObject> = new Map();
  private loadResolvers: Map<string, () => void> = new Map();
  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private isUpdatingConfig = false;
  private isToolActive = false;
  private dielineFrameRect?: FabricObject;

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    if (!this.canvasService) {
      console.warn("CanvasService not found for ImageTool");
      return;
    }

    // Listen to tool activation
    context.eventBus.on("tool:activated", this.onToolActivated);

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

    this.ensureLayer();
    this.updateImages();
  }

  deactivate(context: ExtensionContext) {
    context.eventBus.off("tool:activated", this.onToolActivated);
    
    if (this.canvasService) {
      const userLayer = this.canvasService.getLayer("user");
      if (userLayer) {
        this.objectMap.forEach((obj) => {
          userLayer.remove(obj);
        });
        this.objectMap.clear();
        this.canvasService.requestRenderAll();
      }
      this.hideDielineFrameRect();
      this.canvasService = undefined;
      this.context = undefined;
    }
  }

  private onToolActivated = (event: { id: string }) => {
    const nextActive = event.id === this.id;
    if (this.isToolActive && !nextActive) {
      if (this.hasWorkingChanges) {
        this.workingItems = this.cloneItems(this.items);
        this.hasWorkingChanges = false;
      }
      this.hideDielineFrameRect();
    }
    this.isToolActive = nextActive;
    this.updateInteractivity();
    this.updateImages();
  };

  private updateInteractivity() {
    this.objectMap.forEach((obj) => {
      obj.set({
        selectable: this.isToolActive,
        evented: this.isToolActive,
        hasControls: this.isToolActive,
        hasBorders: this.isToolActive,
      });
    });
    this.canvasService?.requestRenderAll();
  }

  contribute() {
    return {
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
            const item = this.items.find((i) => i.id === id);
            const obj = this.objectMap.get(id);
            if (item && obj && obj.width && obj.height) {
              const scale = Math.max(
                area.width / obj.width,
                area.height / obj.height,
              );
              this.updateImageInConfig(id, {
                scale,
                left: area.left ?? 0.5,
                top: area.top ?? 0.5,
              });
            }
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
        width: this.canvasService.canvas.width,
        height: this.canvasService.canvas.height,
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
    if (!this.canvasService) return;
    const userLayer = this.canvasService.getLayer("user");
    if (!userLayer) {
      console.warn("[ImageTool] User layer not found");
      return;
    }

    const renderItems = this.isToolActive ? this.workingItems : this.items;

    // 1. Remove objects that are no longer in items
    const currentIds = new Set(renderItems.map((i) => i.id));
    for (const [id, obj] of this.objectMap) {
      if (!currentIds.has(id)) {
        userLayer.remove(obj);
        this.objectMap.delete(id);
      }
    }

    // 2. Add or Update objects
    const layout = this.getLayoutInfo();

    renderItems.forEach((item, index) => {
      let obj = this.objectMap.get(item.id);

      // Check if URL changed, if so remove object to force reload
      // We assume Fabric object has getSrc() or we check data.url if we stored it
      // Since we don't store url on object easily accessible without casting, 
      // let's rely on checking if we need to reload.
      // Actually, standard Fabric Image doesn't expose src easily on type without casting to any.
      if (obj && (obj as any).getSrc) {
         const currentSrc = (obj as any).getSrc();
         if (currentSrc !== item.url) {
            userLayer.remove(obj);
            this.objectMap.delete(item.id);
            obj = undefined;
         }
      }

      if (!obj) {
        // New object, load it
        this.loadImage(item, userLayer, layout);
      } else {
        // Existing object, update properties
        // We remove and re-add to ensure coordinates are correctly converted 
        // from absolute (updateObjectProperties) to relative (layer.add)
        userLayer.remove(obj);
        this.updateObjectProperties(obj, item, layout);
        userLayer.add(obj);
      }
    });

    if (this.isToolActive) {
      this.syncDielineFrameRect();
    }

    userLayer.dirty = true;
    this.canvasService.requestRenderAll();
  }

  private updateObjectProperties(
    obj: FabricObject,
    item: ImageItem,
    layout: any,
  ) {
    const {
      layoutScale,
      layoutOffsetX,
      layoutOffsetY,
      visualWidth,
      visualHeight,
    } = layout;
    const updates: any = {};

    // Opacity
    if (obj.opacity !== item.opacity) updates.opacity = item.opacity;

    // Angle
    if (item.angle !== undefined && obj.angle !== item.angle)
      updates.angle = item.angle;

    // Position (Normalized -> Absolute)
    if (item.left !== undefined) {
      const globalLeft = layoutOffsetX + item.left * visualWidth;
      if (Math.abs(obj.left - globalLeft) > 1) updates.left = globalLeft;
    }
    if (item.top !== undefined) {
      const globalTop = layoutOffsetY + item.top * visualHeight;
      if (Math.abs(obj.top - globalTop) > 1) updates.top = globalTop;
    }

    // Scale
    if (item.scale !== undefined) {
      const targetScale = item.scale * layoutScale;
      if (Math.abs(obj.scaleX - targetScale) > 0.001) {
        updates.scaleX = targetScale;
        updates.scaleY = targetScale;
      }
    }

    // Center origin if not set
    if (obj.originX !== "center") {
      updates.originX = "center";
      updates.originY = "center";
      // Adjust position because origin changed (Fabric logic)
      // For simplicity, we just set it, next cycle will fix pos if needed,
      // or we can calculate the shift. Ideally we set origin on creation.
    }

    if (Object.keys(updates).length > 0) {
      obj.set(updates);
      obj.setCoords();
    }
  }

  private loadImage(item: ImageItem, layer: any, layout: any) {
    Image.fromURL(item.url, { crossOrigin: "anonymous" })
      .then((image) => {
        // Double check if item still exists
        if (!this.items.find((i) => i.id === item.id)) return;

        image.set({
          originX: "center",
          originY: "center",
          data: { id: item.id },
          uniformScaling: true,
          lockScalingFlip: true,
          selectable: this.isToolActive,
          evented: this.isToolActive,
          hasControls: this.isToolActive,
          hasBorders: this.isToolActive,
        });

        image.setControlsVisibility({
          mt: false,
          mb: false,
          ml: false,
          mr: false,
        });

        // Initial Layout
        let { scale, left, top } = item;

        if (scale === undefined) {
          scale = 1; // Default scale if not provided and not fitted yet
          item.scale = scale;
        }

        if (left === undefined && top === undefined) {
          left = 0.5;
          top = 0.5;
          item.left = left;
          item.top = top;
        }

        // Apply Props
        this.updateObjectProperties(image, item, layout);

        layer.add(image);
        this.objectMap.set(item.id, image);

        // Notify addImage that load is complete
        const resolver = this.loadResolvers.get(item.id);
        if (resolver) {
          resolver();
          this.loadResolvers.delete(item.id);
        }

        // Bind Events
        image.on("modified", (e: any) => {
          this.handleObjectModified(item.id, image);
        });

        layer.dirty = true;
        this.canvasService?.requestRenderAll();

        // Save defaults if we set them
        if (item.scale !== scale || item.left !== left || item.top !== top) {
          this.updateImageInConfig(item.id, { scale, left, top }, true);
        }
      })
      .catch((err) => {
        console.error("Failed to load image", item.url, err);
      });
  }

  private handleObjectModified(id: string, image: FabricObject) {
    if (!this.isToolActive) return;
    const layout = this.getLayoutInfo();
    const {
      layoutScale,
      layoutOffsetX,
      layoutOffsetY,
      visualWidth,
      visualHeight,
    } = layout;

    const matrix = image.calcTransformMatrix();
    const globalPoint = util.transformPoint(new Point(0, 0), matrix);

    const updates: Partial<ImageItem> = {};

    // Normalize Position
    updates.left = (globalPoint.x - layoutOffsetX) / visualWidth;
    updates.top = (globalPoint.y - layoutOffsetY) / visualHeight;
    updates.angle = image.angle;

    // Scale
    updates.scale = image.scaleX / layoutScale;

    this.updateImageInWorking(id, updates);
  }

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

  private ensureDielineFrameRect() {
    if (!this.canvasService) return;
    if (this.dielineFrameRect) return;
    const rect = new Rect({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
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
    });
    this.canvasService.canvas.add(rect);
    this.dielineFrameRect = rect;
  }

  private hideDielineFrameRect() {
    if (!this.canvasService) return;
    if (this.dielineFrameRect) {
      this.canvasService.canvas.remove(this.dielineFrameRect);
      this.dielineFrameRect = undefined;
      this.canvasService.requestRenderAll();
    }
  }

  private syncDielineFrameRect() {
    if (!this.isToolActive) return;
    if (!this.canvasService) return;
    const dielineWidth = this.getConfig<number>("dieline.width", 0) || 0;
    const dielineHeight = this.getConfig<number>("dieline.height", 0) || 0;
    if (!dielineWidth || !dielineHeight) {
      this.hideDielineFrameRect();
      return;
    }

    const canvasW = this.canvasService.canvas.width || 0;
    const canvasH = this.canvasService.canvas.height || 0;
    this.canvasService.viewport.updateContainer(canvasW, canvasH);
    this.canvasService.viewport.updatePhysical(dielineWidth, dielineHeight);
    const layout = this.canvasService.viewport.layout;

    this.ensureDielineFrameRect();
    if (!this.dielineFrameRect) return;

    this.dielineFrameRect.set({
      left: layout.offsetX + layout.width / 2,
      top: layout.offsetY + layout.height / 2,
      width: layout.width,
      height: layout.height,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
    } as any);
    this.dielineFrameRect.setCoords();
    this.canvasService.canvas.bringObjectToFront(this.dielineFrameRect);
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
