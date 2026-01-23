import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
} from "@pooder/core";
import { FabricImage as Image, filters } from "fabric";
import CanvasService from "./CanvasService";

export class WhiteInkTool implements Extension {
  id = "pooder.kit.white-ink";

  public metadata = {
    name: "WhiteInkTool",
  };

  private customMask: string = "";
  private opacity: number = 1;
  private enableClip: boolean = false;

  private canvasService?: CanvasService;
  private syncHandler: ((e: any) => void) | undefined;
  private _loadingUrl: string | null = null;

  constructor(
    options?: Partial<{
      customMask: string;
      opacity: number;
      enableClip: boolean;
    }>,
  ) {
    if (options) {
      Object.assign(this, options);
    }
  }

  activate(context: ExtensionContext) {
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    if (!this.canvasService) {
      console.warn("CanvasService not found for WhiteInkTool");
      return;
    }

    const configService = context.services.get<any>("ConfigurationService");
    if (configService) {
      // Load initial config
      this.customMask = configService.get(
        "whiteInk.customMask",
        this.customMask,
      );
      this.opacity = configService.get("whiteInk.opacity", this.opacity);
      this.enableClip = configService.get(
        "whiteInk.enableClip",
        this.enableClip,
      );

      // Listen for changes
      configService.onAnyChange((e: { key: string; value: any }) => {
        if (e.key.startsWith("whiteInk.")) {
          const prop = e.key.split(".")[1];
          console.log(
            `[WhiteInkTool] Config change detected: ${e.key} -> ${e.value}`,
          );
          if (prop && prop in this) {
            (this as any)[prop] = e.value;
            this.updateWhiteInk();
          }
        }
      });
    }

    this.setup();
    this.updateWhiteInk();
  }

  deactivate(context: ExtensionContext) {
    this.teardown();
    this.canvasService = undefined;
  }

  contribute() {
    return {
      [ContributionPointIds.CONFIGURATIONS]: [
        {
          id: "whiteInk.customMask",
          type: "string",
          label: "Custom Mask URL",
          default: "",
        },
        {
          id: "whiteInk.opacity",
          type: "number",
          label: "Opacity",
          min: 0,
          max: 1,
          step: 0.01,
          default: 1,
        },
        {
          id: "whiteInk.enableClip",
          type: "boolean",
          label: "Enable Clip",
          default: false,
        },
      ] as ConfigurationContribution[],
      [ContributionPointIds.COMMANDS]: [
        {
          command: "setWhiteInkImage",
          title: "Set White Ink Image",
          handler: (
            customMask: string,
            opacity: number,
            enableClip: boolean = true,
          ) => {
            if (
              this.customMask === customMask &&
              this.opacity === opacity &&
              this.enableClip === enableClip
            )
              return true;

            this.customMask = customMask;
            this.opacity = opacity;
            this.enableClip = enableClip;

            this.updateWhiteInk();
            return true;
          },
        },
      ] as CommandContribution[],
    };
  }

  private setup() {
    if (!this.canvasService) return;
    const canvas = this.canvasService.canvas;

    let userLayer = this.canvasService.getLayer("user");
    if (!userLayer) {
      userLayer = this.canvasService.createLayer("user", {
        width: canvas.width,
        height: canvas.height,
        left: 0,
        top: 0,
        originX: "left",
        originY: "top",
        selectable: false,
        evented: true,
        subTargetCheck: true,
        interactive: true,
      });
      canvas.add(userLayer);
    }

    if (!this.syncHandler) {
      this.syncHandler = (e: any) => {
        const target = e.target;
        if (target && target.data?.id === "user-image") {
          this.syncWithUserImage();
        }
      };

      canvas.on("object:moving", this.syncHandler);
      canvas.on("object:scaling", this.syncHandler);
      canvas.on("object:rotating", this.syncHandler);
      canvas.on("object:modified", this.syncHandler);
    }
  }

  private teardown() {
    if (!this.canvasService) return;
    const canvas = this.canvasService.canvas;

    if (this.syncHandler) {
      canvas.off("object:moving", this.syncHandler);
      canvas.off("object:scaling", this.syncHandler);
      canvas.off("object:rotating", this.syncHandler);
      canvas.off("object:modified", this.syncHandler);
      this.syncHandler = undefined;
    }

    const layer = this.canvasService.getLayer("user");
    if (layer) {
      const whiteInk = this.canvasService.getObject("white-ink", "user");
      if (whiteInk) {
        layer.remove(whiteInk);
      }
    }

    const userImage = this.canvasService.getObject("user-image", "user") as any;
    if (userImage && userImage.clipPath) {
      userImage.set({ clipPath: undefined });
    }

    this.canvasService.requestRenderAll();
  }

  private updateWhiteInk() {
    if (!this.canvasService) return;
    const { customMask, opacity, enableClip } = this;

    const layer = this.canvasService.getLayer("user");
    if (!layer) {
      console.warn("[WhiteInkTool] User layer not found");
      return;
    }

    const whiteInk = this.canvasService.getObject("white-ink", "user") as any;
    const userImage = this.canvasService.getObject("user-image", "user") as any;

    if (!customMask) {
      if (whiteInk) {
        layer.remove(whiteInk);
      }
      if (userImage && userImage.clipPath) {
        userImage.set({ clipPath: undefined });
      }
      layer.dirty = true;
      this.canvasService.requestRenderAll();
      return;
    }

    // Check if we need to load/reload white ink backing
    if (whiteInk) {
      const currentSrc = whiteInk.getSrc?.() || whiteInk._element?.src;
      if (currentSrc !== customMask) {
        this.loadWhiteInk(layer, customMask, opacity, enableClip, whiteInk);
      } else {
        if (whiteInk.opacity !== opacity) {
          whiteInk.set({ opacity });
          layer.dirty = true;
          this.canvasService.requestRenderAll();
        }
      }
    } else {
      this.loadWhiteInk(layer, customMask, opacity, enableClip);
    }

    // Handle Clip Path Toggle
    if (userImage) {
      if (enableClip) {
        if (!userImage.clipPath) {
          this.applyClipPath(customMask);
        }
      } else {
        if (userImage.clipPath) {
          userImage.set({ clipPath: undefined });
          layer.dirty = true;
          this.canvasService.requestRenderAll();
        }
      }
    }
  }

  private loadWhiteInk(
    layer: any,
    url: string,
    opacity: number,
    enableClip: boolean,
    oldImage?: any,
  ) {
    if (!this.canvasService) return;

    if (this._loadingUrl === url) return;
    this._loadingUrl = url;

    Image.fromURL(url, { crossOrigin: "anonymous" })
      .then((image) => {
        if (this._loadingUrl !== url) return;
        this._loadingUrl = null;

        if (oldImage) {
          layer.remove(oldImage);
        }

        image.filters?.push(
          new filters.BlendColor({
            color: "#FFFFFF",
            mode: "add",
          }),
        );
        image.applyFilters();

        image.set({
          opacity,
          selectable: false,
          evented: false,
          data: {
            id: "white-ink",
          },
        });

        // Add to layer
        layer.add(image);

        // Ensure white-ink is behind user-image
        const userImage = this.canvasService!.getObject("user-image", "user");
        if (userImage) {
          // Re-adding moves it to the top of the stack
          layer.remove(userImage);
          layer.add(userImage);
        }

        // Apply clip path to user-image if enabled
        if (enableClip) {
          this.applyClipPath(url);
        } else if (userImage) {
          userImage.set({ clipPath: undefined });
        }

        // Sync position immediately
        this.syncWithUserImage();

        layer.dirty = true;
        this.canvasService!.requestRenderAll();
      })
      .catch((err) => {
        console.error("Failed to load white ink mask", url, err);
        this._loadingUrl = null;
      });
  }

  private applyClipPath(url: string) {
    if (!this.canvasService) return;
    const userImage = this.canvasService.getObject("user-image", "user") as any;
    if (!userImage) return;

    Image.fromURL(url, { crossOrigin: "anonymous" })
      .then((maskImage) => {
        // Configure clipPath
        maskImage.set({
          originX: "center",
          originY: "center",
          left: 0,
          top: 0,
          // Scale to fit userImage if dimensions differ
          scaleX: userImage.width / maskImage.width,
          scaleY: userImage.height / maskImage.height,
        });

        userImage.set({ clipPath: maskImage });
        const layer = this.canvasService!.getLayer("user");
        if (layer) layer.dirty = true;
        this.canvasService!.requestRenderAll();
      })
      .catch((err) => {
        console.error("Failed to load clip path", url, err);
      });
  }

  private syncWithUserImage() {
    if (!this.canvasService) return;
    const userImage = this.canvasService.getObject("user-image", "user");
    const whiteInk = this.canvasService.getObject("white-ink", "user");

    if (userImage && whiteInk) {
      whiteInk.set({
        left: userImage.left,
        top: userImage.top,
        scaleX: userImage.scaleX,
        scaleY: userImage.scaleY,
        angle: userImage.angle,
        skewX: userImage.skewX,
        skewY: userImage.skewY,
        flipX: userImage.flipX,
        flipY: userImage.flipY,
        originX: userImage.originX,
        originY: userImage.originY,
      });
    }
  }
}
