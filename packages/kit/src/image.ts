import {
  CommandContribution,
  ConfigurationContribution,
  ConfigurationService,
  ContributionPointIds,
  Extension,
  ExtensionContext,
} from "@pooder/core";
import { FabricImage as Image, Point, util } from "fabric";
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
        const centerX = canvasW / 2;
        const centerY = canvasH / 2;

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
          const globalLeft = Coordinate.toAbsolute(left, canvasW);
          const localLeft = globalLeft - centerX;
          if (Math.abs(userImage.left - localLeft) > 1)
            updates.left = localLeft;
        }

        if (top !== undefined) {
          const globalTop = Coordinate.toAbsolute(top, canvasH);
          const localTop = globalTop - centerY;
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
    if (!url) return; // Don't load if empty
    this._loadingUrl = url;

    Image.fromURL(url, { crossOrigin: "anonymous" })
      .then((image) => {
        if (this._loadingUrl !== url) return;
        this._loadingUrl = null;

        let { opacity, width, height, angle, left, top } = this;

        // Auto-scale and center if not set
        if (this.context) {
          const configService = this.context.services.get<ConfigurationService>(
            "ConfigurationService",
          )!;
          const dielineWidth = configService.get("dieline.width");
          const dielineHeight = configService.get("dieline.height");

          console.log(
            "[ImageTool] Dieline config debug:",
            {
              widthVal: dielineWidth,
              heightVal: dielineHeight,
              // Debug: dump all keys to see what is available
              allKeys: Array.from(
                (configService as any).configValues?.keys() || [],
              ),
            },
            configService,
          );

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
            // Default to Dieline Position if available, otherwise Center (0.5)
            const dielinePos = configService?.get("dieline.position");
            if (dielinePos) {
              this.left = dielinePos.x;
              this.top = dielinePos.y;
            } else {
              this.left = 0.5;
              this.top = 0.5;
            }
            left = this.left;
            top = this.top;
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

          const canvasW = this.canvasService?.canvas.width || 800;
          const canvasH = this.canvasService?.canvas.height || 600;
          const centerX = canvasW / 2;
          const centerY = canvasH / 2;

          let targetLeft = left !== undefined ? left : defaultLeft;
          let targetTop = top !== undefined ? top : defaultTop;

          // Log for debugging
          const configService = this.context?.services.get<any>(
            "ConfigurationService",
          );
          console.log("[ImageTool] Loading EXISTING image...", {
            canvasW,
            canvasH,
            centerX,
            centerY,
            incomingLeft: left,
            incomingTop: top,
            dielinePos: configService?.get("dieline.position"),
            existingImage: !!existingImage,
          });

          if (left !== undefined) {
            const globalLeft = Coordinate.toAbsolute(left, canvasW);
            targetLeft = globalLeft; // Layer is absolute, do not subtract center
            console.log("[ImageTool] Calculated targetLeft", {
              globalLeft,
              targetLeft,
            });
          }
          if (top !== undefined) {
            const globalTop = Coordinate.toAbsolute(top, canvasH);
            targetTop = globalTop; // Layer is absolute, do not subtract center
            console.log("[ImageTool] Calculated targetTop", {
              globalTop,
              targetTop,
            });
          }

          image.set({
            originX: "center", // Use center origin for easier positioning
            originY: "center",
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
          image.set({
            originX: "center",
            originY: "center",
          });

          if (width !== undefined && image.width)
            image.scaleX = width / image.width;
          if (height !== undefined && image.height)
            image.scaleY = height / image.height;
          if (angle !== undefined) image.angle = angle;

          const canvasW = this.canvasService?.canvas.width || 800;
          const canvasH = this.canvasService?.canvas.height || 600;
          const centerX = canvasW / 2;
          const centerY = canvasH / 2;

          if (left !== undefined) {
            image.left = Coordinate.toAbsolute(left, canvasW); // Layer is absolute
          } else {
            image.left = centerX; // Default to center of canvas
          }

          if (top !== undefined) {
            image.top = Coordinate.toAbsolute(top, canvasH); // Layer is absolute
          } else {
            image.top = centerY; // Default to center of canvas
          }
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
          const canvasW = this.canvasService?.canvas.width || 800;
          const canvasH = this.canvasService?.canvas.height || 600;

          this.left = Coordinate.toNormalized(globalPoint.x, canvasW);
          this.top = Coordinate.toNormalized(globalPoint.y, canvasH);
          this.angle = e.target.angle;

          if (image.width) this.width = e.target.width * e.target.scaleX;
          if (image.height) this.height = e.target.height * e.target.scaleY;

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
