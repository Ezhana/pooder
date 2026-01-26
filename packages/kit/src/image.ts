import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
  ConfigurationService,
} from "@pooder/core";
import { Image, Point, util } from "fabric";
import CanvasService from "./CanvasService";
import { Coordinate } from "./coordinate";

export class ImageTool implements Extension {
  id = "pooder.kit.image";

  metadata = {
    name: "ImageTool",
  };
  private _loadingUrl: string | null = null;

  private url: string = "";
  private opacity: number = 1;
  private width?: number;
  private height?: number;
  private angle?: number;
  private left?: number;
  private top?: number;

  private canvasService?: CanvasService;
  private context?: ExtensionContext;

  constructor(
    options?: Partial<{
      url: string;
      opacity: number;
      width: number;
      height: number;
      angle: number;
      left: number;
      top: number;
    }>,
  ) {
    if (options) {
      Object.assign(this, options);
    }
  }

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    if (!this.canvasService) {
      console.warn("CanvasService not found for ImageTool");
      return;
    }

    const configService = context.services.get<any>("ConfigurationService");
    if (configService) {
      // Load initial config
      this.url = configService.get("image.url", this.url);
      this.opacity = configService.get("image.opacity", this.opacity);
      this.width = configService.get("image.width", this.width);
      this.height = configService.get("image.height", this.height);
      this.angle = configService.get("image.angle", this.angle);
      this.left = configService.get("image.left", this.left);
      this.top = configService.get("image.top", this.top);

      // Listen for changes
      configService.onAnyChange((e: { key: string; value: any }) => {
        let shouldUpdate = false;
        if (e.key.startsWith("image.")) {
          const prop = e.key.split(".")[1];
          console.log(
            `[ImageTool] Config change detected: ${e.key} -> ${e.value}`,
          );
          if (prop && prop in this) {
            (this as any)[prop] = e.value;
            shouldUpdate = true;
          }
        } else if (e.key.startsWith("dieline.")) {
          // Dieline changes affect image layout/scale
          shouldUpdate = true;
        }

        if (shouldUpdate) {
          this.updateImage();
        }
      });
    }

    this.ensureLayer();
    this.updateImage();
  }

  deactivate(context: ExtensionContext) {
    if (this.canvasService) {
      const layer = this.canvasService.getLayer("user");
      if (layer) {
        const userImage = this.canvasService.getObject("user-image", "user");
        if (userImage) {
          layer.remove(userImage);
          this.canvasService.requestRenderAll();
        }
      }
      this.canvasService = undefined;
      this.context = undefined;
    }
  }

  contribute() {
    return {
      [ContributionPointIds.CONFIGURATIONS]: [
        {
          id: "image.url",
          type: "string",
          label: "Image URL",
          default: this.url,
        },
        {
          id: "image.opacity",
          type: "number",
          label: "Opacity",
          min: 0,
          max: 1,
          step: 0.1,
          default: this.opacity,
        },
        {
          id: "image.width",
          type: "number",
          label: "Width",
          min: 0,
          max: 5000,
          default: this.width,
        },
        {
          id: "image.height",
          type: "number",
          label: "Height",
          min: 0,
          max: 5000,
          default: this.height,
        },
        {
          id: "image.angle",
          type: "number",
          label: "Rotation",
          min: 0,
          max: 360,
          default: this.angle,
        },
        {
          id: "image.left",
          type: "number",
          label: "Left (Normalized)",
          min: 0,
          max: 1,
          default: this.left,
        },
        {
          id: "image.top",
          type: "number",
          label: "Top (Normalized)",
          min: 0,
          max: 1,
          default: this.top,
        },
      ] as ConfigurationContribution[],
      [ContributionPointIds.COMMANDS]: [
        {
          command: "setUserImage",
          title: "Set User Image",
          handler: (
            url: string,
            opacity: number,
            width?: number,
            height?: number,
            angle?: number,
            left?: number,
            top?: number,
          ) => {
            if (
              this.url === url &&
              this.opacity === opacity &&
              this.width === width &&
              this.height === height &&
              this.angle === angle &&
              this.left === left &&
              this.top === top
            )
              return true;

            this.url = url;
            this.opacity = opacity;
            this.width = width;
            this.height = height;
            this.angle = angle;
            this.left = left;
            this.top = top;

            // Direct update
            this.updateImage();

            return true;
          },
        },
      ] as CommandContribution[],
    };
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

  private updateImage() {
    if (!this.canvasService) return;
    let { url, opacity, width, height, angle, left, top } = this;

    const layer = this.canvasService.getLayer("user");
    if (!layer) {
      console.warn("[ImageTool] User layer not found");
      return;
    }

    const userImage = this.canvasService.getObject("user-image", "user") as any;

    if (this._loadingUrl === url) return;

    if (userImage) {
      const currentSrc = userImage.getSrc?.() || userImage._element?.src;

      if (currentSrc !== url) {
        this.loadImage(layer);
      } else {
        const updates: any = {};
        const canvasW = this.canvasService.canvas.width || 800;
        const canvasH = this.canvasService.canvas.height || 600;

        // Fetch Dieline Layout Info for physical positioning
        const configService = this.context?.services.get<any>("ConfigurationService");
        let layoutScale = 1;
        let layoutOffsetX = 0;
        let layoutOffsetY = 0;
        let visualWidth = canvasW;
        let visualHeight = canvasH;

        if (configService) {
          const dielineWidth = configService.get("dieline.width") || 500;
          const dielineHeight = configService.get("dieline.height") || 500;
          const borderLength = configService.get("dieline.borderLength") || 0;
          const padding = configService.get("dieline.padding") || 40;
          
          const layout = Coordinate.calculateLayout(
             { width: canvasW, height: canvasH },
             { width: dielineWidth, height: dielineHeight },
             borderLength + padding
          );
          layoutScale = layout.scale;
          layoutOffsetX = layout.offsetX;
          layoutOffsetY = layout.offsetY;
          visualWidth = layout.width;
          visualHeight = layout.height;
        }

        if (userImage.opacity !== opacity) updates.opacity = opacity;
        if (angle !== undefined && userImage.angle !== angle)
          updates.angle = angle;

        if (userImage.originX !== "center") {
          userImage.set({
            originX: "center",
            originY: "center",
            left: userImage.left + (userImage.width * userImage.scaleX) / 2,
            top: userImage.top + (userImage.height * userImage.scaleY) / 2,
          });
        }

        if (left !== undefined) {
          // left is normalized (0-1) relative to Dieline Content Area
          const globalLeft = layoutOffsetX + left * visualWidth;
          if (Math.abs(userImage.left - globalLeft) > 1)
            updates.left = globalLeft;
        }

        if (top !== undefined) {
           // top is normalized (0-1) relative to Dieline Content Area
          const globalTop = layoutOffsetY + top * visualHeight;
          if (Math.abs(userImage.top - globalTop) > 1) updates.top = globalTop;
        }

        if (width !== undefined && userImage.width)
          // width is physical units -> convert to pixels using layoutScale
          updates.scaleX = (width * layoutScale) / userImage.width;
        if (height !== undefined && userImage.height)
          updates.scaleY = (height * layoutScale) / userImage.height;

        if (Object.keys(updates).length > 0) {
          userImage.set(updates);
          layer.dirty = true;
          this.canvasService.requestRenderAll();
        }
      }
    } else {
      this.loadImage(layer);
    }
  }

  private loadImage(layer: any) {
    if (!this.canvasService) return;
    const { url } = this;
    if (!url) return; // Don't load if empty
    this._loadingUrl = url;

    Image.fromURL(url, { crossOrigin: "anonymous" })
      .then((image) => {
        if (this._loadingUrl !== url) return;
        this._loadingUrl = null;

        let { opacity, width, height, angle, left, top } = this;

        const canvasW = this.canvasService?.canvas.width || 800;
        const canvasH = this.canvasService?.canvas.height || 600;

        // Fetch Dieline Layout Info
        let layoutScale = 1;
        let layoutOffsetX = 0;
        let layoutOffsetY = 0;
        let visualWidth = canvasW;
        let visualHeight = canvasH;
        let dielinePhysicalWidth = 500;
        let dielinePhysicalHeight = 500;

        if (this.context) {
          const configService = this.context.services.get<ConfigurationService>(
            "ConfigurationService",
          )!;
          dielinePhysicalWidth = configService.get("dieline.width") || 500;
          dielinePhysicalHeight = configService.get("dieline.height") || 500;
          const borderLength = configService.get("dieline.borderLength") || 0;
          const padding = configService.get("dieline.padding") || 40;
          
          const layout = Coordinate.calculateLayout(
             { width: canvasW, height: canvasH },
             { width: dielinePhysicalWidth, height: dielinePhysicalHeight },
             borderLength + padding
          );
          layoutScale = layout.scale;
          layoutOffsetX = layout.offsetX;
          layoutOffsetY = layout.offsetY;
          visualWidth = layout.width;
          visualHeight = layout.height;
        }

        // Auto-scale and center if not set
        if (width === undefined && height === undefined) {
           // Default to full Dieline width (Physical)
           // If image aspect ratio differs, fit within dieline
           const imgAspect = (image.width || 1) / (image.height || 1);
           const dielineAspect = dielinePhysicalWidth / dielinePhysicalHeight;
           
           if (imgAspect > dielineAspect) {
             width = dielinePhysicalWidth;
             height = width / imgAspect;
           } else {
             height = dielinePhysicalHeight;
             width = height * imgAspect;
           }
           
           this.width = width;
           this.height = height;
        }

        if (left === undefined && top === undefined) {
          // Default to center (0.5)
          this.left = 0.5;
          this.top = 0.5;
          left = this.left;
          top = this.top;
        }

        const existingImage = this.canvasService!.getObject(
          "user-image",
          "user",
        ) as any;

        if (existingImage) {
           layer.remove(existingImage);
        }
        
        // New image
        image.set({
          originX: "center",
          originY: "center",
        });

        // Apply Physical Scale
        if (width !== undefined && image.width)
          image.scaleX = (width * layoutScale) / image.width;
        if (height !== undefined && image.height)
          image.scaleY = (height * layoutScale) / image.height;
        
        if (angle !== undefined) image.angle = angle;

        // Apply Position (Normalized relative to Dieline)
        if (left !== undefined) {
          image.left = layoutOffsetX + left * visualWidth;
        } else {
          image.left = layoutOffsetX + visualWidth / 2;
        }

        if (top !== undefined) {
          image.top = layoutOffsetY + top * visualHeight;
        } else {
          image.top = layoutOffsetY + visualHeight / 2;
        }

        image.set({
          opacity: opacity !== undefined ? opacity : 1,
          data: {
            id: "user-image",
          },
        });
        layer.add(image);

        // Bind events to keep options in sync
        image.on("modified", (e: any) => {
          const matrix = image.calcTransformMatrix();
          const globalPoint = util.transformPoint(new Point(0, 0), matrix);
          
          // Reverse calculation to get normalized position relative to Dieline
          // globalX = offsetX + normX * visualWidth
          // normX = (globalX - offsetX) / visualWidth
          this.left = (globalPoint.x - layoutOffsetX) / visualWidth;
          this.top = (globalPoint.y - layoutOffsetY) / visualHeight;
          this.angle = e.target.angle;

          // Width is physical: (scaleX * imgWidth) / layoutScale
          if (image.width) {
             const pixelWidth = e.target.width * e.target.scaleX;
             this.width = pixelWidth / layoutScale;
          }
          if (image.height) {
             const pixelHeight = e.target.height * e.target.scaleY;
             this.height = pixelHeight / layoutScale;
          }

          if (this.context) {
            this.context.eventBus.emit("update");
          }
        });

        layer.dirty = true;
        this.canvasService!.requestRenderAll();
      })
      .catch((err) => {
        if (this._loadingUrl === url) this._loadingUrl = null;
        console.error("Failed to load image", url, err);
      });
  }
}
