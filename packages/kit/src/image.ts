import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
} from "@pooder/core";
import { FabricImage as Image, Point, util } from "fabric";
import CanvasService from "./CanvasService";

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
        if (e.key.startsWith("image.")) {
          const prop = e.key.split(".")[1];
          console.log(
            `[ImageTool] Config change detected: ${e.key} -> ${e.value}`,
          );
          if (prop && prop in this) {
            (this as any)[prop] = e.value;
            this.updateImage();
          }
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
          default: "",
        },
        {
          id: "image.opacity",
          type: "number",
          label: "Opacity",
          min: 0,
          max: 1,
          step: 0.1,
          default: 1,
        },
        {
          id: "image.width",
          type: "number",
          label: "Width",
          min: 0,
          max: 5000,
        },
        {
          id: "image.height",
          type: "number",
          label: "Height",
          min: 0,
          max: 5000,
        },
        {
          id: "image.angle",
          type: "number",
          label: "Rotation",
          min: 0,
          max: 360,
        },
        {
          id: "image.left",
          type: "number",
          label: "Left",
          min: 0,
          max: 1000,
        },
        {
          id: "image.top",
          type: "number",
          label: "Top",
          min: 0,
          max: 1000,
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

      // CanvasService.createLayer already adds it to the canvas (at the top).
      // Now we adjust its position if needed.

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
        const centerX = canvasW / 2;
        const centerY = canvasH / 2;

        if (userImage.opacity !== opacity) updates.opacity = opacity;
        if (angle !== undefined && userImage.angle !== angle)
          updates.angle = angle;

        if (left !== undefined) {
          const localLeft = left - centerX;
          if (Math.abs(userImage.left - localLeft) > 1)
            updates.left = localLeft;
        }

        if (top !== undefined) {
          const localTop = top - centerY;
          if (Math.abs(userImage.top - localTop) > 1) updates.top = localTop;
        }

        if (width !== undefined && userImage.width)
          updates.scaleX = width / userImage.width;
        if (height !== undefined && userImage.height)
          updates.scaleY = height / userImage.height;

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
    this._loadingUrl = url;

    Image.fromURL(url)
      .then((image) => {
        if (this._loadingUrl !== url) return;
        this._loadingUrl = null;

        let { opacity, width, height, angle, left, top } = this;

        // Auto-scale and center if not set
        if (this.context) {
          const configService =
            this.context.services.get<any>("ConfigurationService");
          const dielineWidth = configService?.get("dieline.width", 300) ?? 300;
          const dielineHeight =
            configService?.get("dieline.height", 300) ?? 300;

          if (width === undefined && height === undefined) {
            // Scale to fit dieline
            const scale = Math.min(
              dielineWidth / (image.width || 1),
              dielineHeight / (image.height || 1),
            );
            width = (image.width || 1) * scale;
            height = (image.height || 1) * scale;
            this.width = width;
            this.height = height;
          }

          if (left === undefined && top === undefined) {
            const canvasW = this.canvasService?.canvas.width || 800;
            const canvasH = this.canvasService?.canvas.height || 600;
            left = canvasW / 2;
            top = canvasH / 2;
            this.left = left;
            this.top = top;
          }
        }

        const existingImage = this.canvasService!.getObject(
          "user-image",
          "user",
        ) as any;

        if (existingImage) {
          const defaultLeft = existingImage.left;
          const defaultTop = existingImage.top;
          const defaultAngle = existingImage.angle;
          const defaultScaleX = existingImage.scaleX;
          const defaultScaleY = existingImage.scaleY;

          // existingImage is likely in local coordinates if updateImage logic is correct.
          // But here we are dealing with global coordinates for `left` and `top`.
          // We need to convert global to local if we are setting it directly,
          // OR rely on the fact that existingImage.left IS the local coordinate.
          // Wait, if we use `left` (global) directly, it might be wrong if the layer is offset.
          // Let's check the layer offset logic again.
          const canvasW = this.canvasService?.canvas.width || 800;
          const canvasH = this.canvasService?.canvas.height || 600;
          const centerX = canvasW / 2;
          const centerY = canvasH / 2;

          let targetLeft = left !== undefined ? left : defaultLeft;
          let targetTop = top !== undefined ? top : defaultTop;

          // If the layer expects local coordinates relative to center (as implied by updateImage)
          // we should adjust. However, loadImage historically used `left` directly.
          // If we changed `left` to be explicitly centered (global), we might need to subtract centerX.
          // Let's assume consistent behavior with updateImage:
          if (left !== undefined) targetLeft = left - centerX;
          if (top !== undefined) targetTop = top - centerY;
          
          // Wait, if existingImage.left is already local, and `left` is undefined, we use defaultLeft.
          // If `left` IS defined (global), we subtract centerX.
          // But wait, if `left` was undefined, `targetLeft` = `defaultLeft` (local).
          // If `left` IS defined, `targetLeft` = `left - centerX` (local).
          // This looks correct IF `left` is indeed global.
          
          // BUT, I previously saw: `if (left !== undefined) image.left = left;`
          // This implies the OLD code assumed `left` was correct as-is.
          // If `left` was global, and layer is at (0,0), then it's global.
          // Why did updateImage subtract centerX?
          // `localLeft = left - centerX`.
          // If `ensureLayer` makes a full-canvas layer at (0,0), then `left` (global) should be correct.
          // UNLESS `updateImage` is correcting for something else.
          // Maybe the layer origin IS center?
          // If I assume `updateImage` is correct, then `loadImage` WAS WRONG.
          // I will fix it to be consistent with `updateImage`.

          image.set({
            left: targetLeft,
            top: targetTop,
            angle: angle !== undefined ? angle : defaultAngle,
            scaleX:
              width !== undefined && image.width
                ? width / image.width
                : defaultScaleX,
            scaleY:
              height !== undefined && image.height
                ? height / image.height
                : defaultScaleY,
          });

          layer.remove(existingImage);
        } else {
          // New image
          if (width !== undefined && image.width)
            image.scaleX = width / image.width;
          if (height !== undefined && image.height)
            image.scaleY = height / image.height;
          if (angle !== undefined) image.angle = angle;

          const canvasW = this.canvasService?.canvas.width || 800;
          const canvasH = this.canvasService?.canvas.height || 600;
          const centerX = canvasW / 2;
          const centerY = canvasH / 2;

          if (left !== undefined) image.left = left - centerX;
          if (top !== undefined) image.top = top - centerY;
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

          this.left = globalPoint.x;
          this.top = globalPoint.y;
          this.angle = e.target.angle;

          if (image.width)
            this.width = e.target.width * e.target.scaleX;
          if (image.height)
            this.height = e.target.height * e.target.scaleY;

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
