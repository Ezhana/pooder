import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
  ConfigurationService,
} from "@pooder/core";
import { Image, Point, util, Object as FabricObject } from "fabric";
import CanvasService from "./CanvasService";
import { Coordinate } from "./coordinate";

export interface ImageItem {
  id: string;
  url: string;
  opacity: number;
  width?: number;
  height?: number;
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
  private objectMap: Map<string, FabricObject> = new Map();
  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private isUpdatingConfig = false;

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    if (!this.canvasService) {
      console.warn("CanvasService not found for ImageTool");
      return;
    }

    const configService = context.services.get<ConfigurationService>("ConfigurationService");
    if (configService) {
      // Load initial config
      this.items = configService.get("image.items", []) || [];

      // Listen for changes
      configService.onAnyChange((e: { key: string; value: any }) => {
        if (this.isUpdatingConfig) return;

        let shouldUpdate = false;
        if (e.key === "image.items") {
          this.items = e.value || [];
          shouldUpdate = true;
        } else if (e.key.startsWith("dieline.") && e.key !== "dieline.holes") {
          // Dieline changes affect image layout/scale
          // Ignore dieline.holes as they don't affect layout and can cause jitter
          shouldUpdate = true;
        }

        if (shouldUpdate) {
          this.updateImages();
        }
      });
    }

    this.ensureLayer();
    this.updateImages();
  }

  deactivate(context: ExtensionContext) {
    if (this.canvasService) {
      const layer = this.canvasService.getLayer("user");
      if (layer) {
        this.objectMap.forEach((obj) => {
          layer.remove(obj);
        });
        this.objectMap.clear();
        this.canvasService.requestRenderAll();
      }
      this.canvasService = undefined;
      this.context = undefined;
    }
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
          handler: (url: string, options?: Partial<ImageItem>) => {
            const newItem: ImageItem = {
              id: this.generateId(),
              url,
              opacity: 1,
              ...options,
            };
            this.updateConfig([...this.items, newItem]);
            return newItem.id;
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

  private updateConfig(newItems: ImageItem[], skipCanvasUpdate = false) {
    if (!this.context) return;
    this.isUpdatingConfig = true;
    this.items = newItems;
    const configService = this.context.services.get<ConfigurationService>("ConfigurationService");
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
        const index = this.canvasService.canvas.getObjects().indexOf(dielineLayer);
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
    
    let layoutScale = 1;
    let layoutOffsetX = 0;
    let layoutOffsetY = 0;
    let visualWidth = canvasW;
    let visualHeight = canvasH;
    let dielinePhysicalWidth = 500;
    let dielinePhysicalHeight = 500;
    let bleedOffset = 0;

    if (this.context) {
      const configService = this.context.services.get<ConfigurationService>("ConfigurationService");
      if (configService) {
        dielinePhysicalWidth = configService.get("dieline.width") || 500;
        dielinePhysicalHeight = configService.get("dieline.height") || 500;
        bleedOffset = configService.get("dieline.offset") || 0;
        
        const paddingValue = configService.get("dieline.padding") || 40;
        let padding = 0;
        if (typeof paddingValue === "number") {
          padding = paddingValue;
        } else if (typeof paddingValue === "string") {
          if (paddingValue.endsWith("%")) {
            const percent = parseFloat(paddingValue) / 100;
            padding = Math.min(canvasW, canvasH) * percent;
          } else {
            padding = parseFloat(paddingValue) || 0;
          }
        }
        
        const layout = Coordinate.calculateLayout(
            { width: canvasW, height: canvasH },
            { width: dielinePhysicalWidth, height: dielinePhysicalHeight },
            padding
        );
        layoutScale = layout.scale;
        layoutOffsetX = layout.offsetX;
        layoutOffsetY = layout.offsetY;
        visualWidth = layout.width;
        visualHeight = layout.height;
      }
    }

    return {
      layoutScale,
      layoutOffsetX,
      layoutOffsetY,
      visualWidth,
      visualHeight,
      dielinePhysicalWidth,
      dielinePhysicalHeight,
      bleedOffset
    };
  }

  private updateImages() {
    if (!this.canvasService) return;
    const layer = this.canvasService.getLayer("user");
    if (!layer) {
      console.warn("[ImageTool] User layer not found");
      return;
    }

    // 1. Remove objects that are no longer in items
    const currentIds = new Set(this.items.map(i => i.id));
    for (const [id, obj] of this.objectMap) {
      if (!currentIds.has(id)) {
        layer.remove(obj);
        this.objectMap.delete(id);
      }
    }

    // 2. Add or Update objects
    const layout = this.getLayoutInfo();

    this.items.forEach((item, index) => {
      let obj = this.objectMap.get(item.id);

      if (!obj) {
        // New object, load it
        this.loadImage(item, layer, layout);
      } else {
        // Existing object, update properties
        this.updateObjectProperties(obj, item, layout);
        
        // Ensure Z-Index order
        // Note: layer.add() appends to end, so if we process in order, they should be roughly correct.
        // However, if we need strict ordering, we might need to verify index.
        // For simplicity, we rely on the fact that if it exists, it's already on canvas.
        // To enforce strict Z-order matching array order:
        // We can check if the object at layer._objects[index] is this object.
        // But Fabric's Group/Layer handling might be complex. 
        // A simple way is: remove and re-add if order is wrong, or use moveObjectTo.
        
        // Since we are iterating items in order, we can check if the object is at the expected visual index relative to other user images.
        // But for now, let's assume update logic is sufficient.
        // If we want to support reordering, we should probably just `moveTo`
        layer.remove(obj);
        layer.add(obj); // Move to top of layer stack, effectively reordering if we iterate in order
      }
    });
    
    layer.dirty = true;
    this.canvasService.requestRenderAll();
  }

  private updateObjectProperties(obj: FabricObject, item: ImageItem, layout: any) {
    const { layoutScale, layoutOffsetX, layoutOffsetY, visualWidth, visualHeight } = layout;
    const updates: any = {};

    // Opacity
    if (obj.opacity !== item.opacity) updates.opacity = item.opacity;
    
    // Angle
    if (item.angle !== undefined && obj.angle !== item.angle) updates.angle = item.angle;

    // Position (Normalized -> Absolute)
    if (item.left !== undefined) {
      const globalLeft = layoutOffsetX + item.left * visualWidth;
      if (Math.abs(obj.left - globalLeft) > 1) updates.left = globalLeft;
    }
    if (item.top !== undefined) {
      const globalTop = layoutOffsetY + item.top * visualHeight;
      if (Math.abs(obj.top - globalTop) > 1) updates.top = globalTop;
    }

    // Scale (Physical Dimensions -> Scale Factor)
    if (item.width !== undefined && obj.width) {
       const targetScaleX = (item.width * layoutScale) / obj.width;
       if (Math.abs(obj.scaleX - targetScaleX) > 0.001) updates.scaleX = targetScaleX;
    }
    if (item.height !== undefined && obj.height) {
       const targetScaleY = (item.height * layoutScale) / obj.height;
       if (Math.abs(obj.scaleY - targetScaleY) > 0.001) updates.scaleY = targetScaleY;
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
    }
  }

  private loadImage(item: ImageItem, layer: any, layout: any) {
    Image.fromURL(item.url, { crossOrigin: "anonymous" })
      .then((image) => {
        // Double check if item still exists
        if (!this.items.find(i => i.id === item.id)) return;

        image.set({
          originX: "center",
          originY: "center",
          data: { id: item.id },
          uniformScaling: true,
          lockScalingFlip: true,
        });

        image.setControlsVisibility({
          mt: false,
          mb: false,
          ml: false,
          mr: false,
        });

        // Initial Layout
        let { width, height, left, top } = item;
        const { layoutScale, layoutOffsetX, layoutOffsetY, visualWidth, visualHeight, dielinePhysicalWidth, dielinePhysicalHeight, bleedOffset } = layout;

        // Auto-scale if needed
        if (width === undefined && height === undefined) {
           // Calculate target dimensions including bleed
           const targetWidth = dielinePhysicalWidth + 2 * bleedOffset;
           const targetHeight = dielinePhysicalHeight + 2 * bleedOffset;
           
           // "适应最长边" (Fit to longest side) logic
           const targetMax = Math.max(targetWidth, targetHeight);
           const imageMax = Math.max(image.width || 1, image.height || 1);
           const scale = targetMax / imageMax;
           
           width = (image.width || 1) * scale;
           height = (image.height || 1) * scale;
           
           // Update item with defaults
           item.width = width;
           item.height = height;
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

        // Bind Events
        image.on("modified", (e: any) => {
          this.handleObjectModified(item.id, image);
        });

        layer.dirty = true;
        this.canvasService?.requestRenderAll();
        
        // Save defaults if we calculated them
        if (item.width !== width || item.height !== height || item.left !== left || item.top !== top) {
           this.updateImageInConfig(item.id, { width, height, left, top });
        }
      })
      .catch((err) => {
        console.error("Failed to load image", item.url, err);
      });
  }

  private handleObjectModified(id: string, image: FabricObject) {
    const layout = this.getLayoutInfo();
    const { layoutScale, layoutOffsetX, layoutOffsetY, visualWidth, visualHeight } = layout;

    const matrix = image.calcTransformMatrix();
    const globalPoint = util.transformPoint(new Point(0, 0), matrix);

    const updates: Partial<ImageItem> = {};

    // Normalize Position
    updates.left = (globalPoint.x - layoutOffsetX) / visualWidth;
    updates.top = (globalPoint.y - layoutOffsetY) / visualHeight;
    updates.angle = image.angle;

    // Physical Dimensions
    if (image.width) {
       const pixelWidth = image.width * image.scaleX;
       updates.width = pixelWidth / layoutScale;
    }
    if (image.height) {
       const pixelHeight = image.height * image.scaleY;
       updates.height = pixelHeight / layoutScale;
    }

    this.updateImageInConfig(id, updates);
  }

  private updateImageInConfig(id: string, updates: Partial<ImageItem>) {
    const index = this.items.findIndex(i => i.id === id);
    if (index !== -1) {
      const newItems = [...this.items];
      newItems[index] = { ...newItems[index], ...updates };
      this.updateConfig(newItems, true);
    }
  }
}
