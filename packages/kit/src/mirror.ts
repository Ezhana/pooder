import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
} from "@pooder/core";
import CanvasService from "./CanvasService";

export class MirrorTool implements Extension {
  public metadata = { name: "MirrorTool" };
  private _enabled = false;

  private canvasService?: CanvasService;

  toJSON() {
    return {
      enabled: this._enabled,
    };
  }

  loadFromJSON(json: any) {
    this._enabled = json.enabled;
  }

  activate(context: ExtensionContext) {
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    if (!this.canvasService) {
      console.warn("CanvasService not found for MirrorTool");
      return;
    }

    // Initialize with current state (if enabled was persisted)
    if (this._enabled) {
      this.applyMirror(true);
    }
  }

  deactivate(context: ExtensionContext) {
    this.applyMirror(false);
    this.canvasService = undefined;
  }

  contribute() {
    return {
      [ContributionPointIds.CONFIGURATIONS]: [
        {
          id: "mirror.enabled",
          type: "boolean",
          label: "Enable Mirror",
          default: false,
        },
      ] as ConfigurationContribution[],
      [ContributionPointIds.COMMANDS]: [
        {
          command: "setMirror",
          title: "Set Mirror",
          handler: (enabled: boolean) => {
            this.applyMirror(enabled);
            return true;
          },
        },
      ] as CommandContribution[],
    };
  }

  private applyMirror(enabled: boolean) {
    if (!this.canvasService) return;
    const canvas = this.canvasService.canvas;
    if (!canvas) return;

    const width = canvas.width || 800;

    // Fabric.js v6+ uses viewportTransform property
    let vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    // Create a copy to avoid mutating the reference directly before setting
    vpt = [...vpt];

    // If we are enabling and currently not flipped (scaleX > 0)
    // Or disabling and currently flipped (scaleX < 0)
    const isFlipped = vpt[0] < 0;

    if (enabled && !isFlipped) {
      // Flip scale X
      vpt[0] = -vpt[0]; // Flip scale
      vpt[4] = width - vpt[4]; // Adjust pan X

      canvas.setViewportTransform(vpt as any);
      canvas.requestRenderAll();
      this._enabled = true;
    } else if (!enabled && isFlipped) {
      // Restore
      vpt[0] = -vpt[0]; // Unflip scale
      vpt[4] = width - vpt[4]; // Restore pan X

      canvas.setViewportTransform(vpt as any);
      canvas.requestRenderAll();
      this._enabled = false;
    }
  }
}
