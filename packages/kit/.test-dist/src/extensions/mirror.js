"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MirrorTool = void 0;
const core_1 = require("@pooder/core");
class MirrorTool {
    constructor(options) {
        this.id = "pooder.kit.mirror";
        this.metadata = {
            name: "MirrorTool",
        };
        this.enabled = false;
        if (options) {
            Object.assign(this, options);
        }
    }
    toJSON() {
        return {
            enabled: this.enabled,
        };
    }
    loadFromJSON(json) {
        this.enabled = json.enabled;
    }
    activate(context) {
        this.canvasService = context.services.get("CanvasService");
        if (!this.canvasService) {
            console.warn("CanvasService not found for MirrorTool");
            return;
        }
        const configService = context.services.get("ConfigurationService");
        if (configService) {
            // Load initial config
            this.enabled = configService.get("mirror.enabled", this.enabled);
            // Listen for changes
            configService.onAnyChange((e) => {
                if (e.key === "mirror.enabled") {
                    this.applyMirror(e.value);
                }
            });
        }
        // Initialize with current state (if enabled was persisted)
        if (this.enabled) {
            this.applyMirror(true);
        }
    }
    deactivate(context) {
        this.applyMirror(false);
        this.canvasService = undefined;
    }
    contribute() {
        return {
            [core_1.ContributionPointIds.CONFIGURATIONS]: [
                {
                    id: "mirror.enabled",
                    type: "boolean",
                    label: "Enable Mirror",
                    default: false,
                },
            ],
            [core_1.ContributionPointIds.COMMANDS]: [
                {
                    command: "setMirror",
                    title: "Set Mirror",
                    handler: (enabled) => {
                        this.applyMirror(enabled);
                        return true;
                    },
                },
            ],
        };
    }
    applyMirror(enabled) {
        if (!this.canvasService)
            return;
        const canvas = this.canvasService.canvas;
        if (!canvas)
            return;
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
            canvas.setViewportTransform(vpt);
            canvas.requestRenderAll();
            this.enabled = true;
        }
        else if (!enabled && isFlipped) {
            // Restore
            vpt[0] = -vpt[0]; // Unflip scale
            vpt[4] = width - vpt[4]; // Restore pan X
            canvas.setViewportTransform(vpt);
            canvas.requestRenderAll();
            this.enabled = false;
        }
    }
}
exports.MirrorTool = MirrorTool;
