"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FilmTool = void 0;
const core_1 = require("@pooder/core");
const fabric_1 = require("fabric");
class FilmTool {
    constructor(options) {
        this.id = "pooder.kit.film";
        this.metadata = {
            name: "FilmTool",
        };
        this.url = "";
        this.opacity = 0.5;
        if (options) {
            Object.assign(this, options);
        }
    }
    activate(context) {
        this.canvasService = context.services.get("CanvasService");
        if (!this.canvasService) {
            console.warn("CanvasService not found for FilmTool");
            return;
        }
        const configService = context.services.get("ConfigurationService");
        if (configService) {
            // Load initial config
            this.url = configService.get("film.url", this.url);
            this.opacity = configService.get("film.opacity", this.opacity);
            // Listen for changes
            configService.onAnyChange((e) => {
                if (e.key.startsWith("film.")) {
                    const prop = e.key.split(".")[1];
                    console.log(`[FilmTool] Config change detected: ${e.key} -> ${e.value}`);
                    if (prop && prop in this) {
                        this[prop] = e.value;
                        this.updateFilm();
                    }
                }
            });
        }
        this.initLayer();
        this.updateFilm();
    }
    deactivate(context) {
        if (this.canvasService) {
            const layer = this.canvasService.getLayer("overlay");
            if (layer) {
                const img = this.canvasService.getObject("film-image", "overlay");
                if (img) {
                    layer.remove(img);
                    this.canvasService.requestRenderAll();
                }
            }
            this.canvasService = undefined;
        }
    }
    contribute() {
        return {
            [core_1.ContributionPointIds.CONFIGURATIONS]: [
                {
                    id: "film.url",
                    type: "string",
                    label: "Film Image URL",
                    default: "",
                },
                {
                    id: "film.opacity",
                    type: "number",
                    label: "Opacity",
                    min: 0,
                    max: 1,
                    step: 0.1,
                    default: 0.5,
                },
            ],
            [core_1.ContributionPointIds.COMMANDS]: [
                {
                    command: "setFilmImage",
                    title: "Set Film Image",
                    handler: (url, opacity) => {
                        if (this.url === url && this.opacity === opacity)
                            return true;
                        this.url = url;
                        this.opacity = opacity;
                        this.updateFilm();
                        return true;
                    },
                },
            ],
        };
    }
    initLayer() {
        if (!this.canvasService)
            return;
        let overlayLayer = this.canvasService.getLayer("overlay");
        if (!overlayLayer) {
            const width = this.canvasService.canvas.width || 800;
            const height = this.canvasService.canvas.height || 600;
            const layer = this.canvasService.createLayer("overlay", {
                width,
                height,
                left: 0,
                top: 0,
                originX: "left",
                originY: "top",
                selectable: false,
                evented: false,
                subTargetCheck: false,
                interactive: false,
            });
            this.canvasService.canvas.bringObjectToFront(layer);
        }
    }
    async updateFilm() {
        if (!this.canvasService)
            return;
        const layer = this.canvasService.getLayer("overlay");
        if (!layer) {
            console.warn("[FilmTool] Overlay layer not found");
            return;
        }
        const { url, opacity } = this;
        if (!url) {
            const img = this.canvasService.getObject("film-image", "overlay");
            if (img) {
                layer.remove(img);
                this.canvasService.requestRenderAll();
            }
            return;
        }
        const width = this.canvasService.canvas.width || 800;
        const height = this.canvasService.canvas.height || 600;
        let img = this.canvasService.getObject("film-image", "overlay");
        try {
            if (img) {
                if (img.getSrc() !== url) {
                    await img.setSrc(url);
                }
                img.set({ opacity });
            }
            else {
                img = await fabric_1.FabricImage.fromURL(url, { crossOrigin: "anonymous" });
                img.scaleToWidth(width);
                if (img.getScaledHeight() < height)
                    img.scaleToHeight(height);
                img.set({
                    originX: "left",
                    originY: "top",
                    left: 0,
                    top: 0,
                    opacity,
                    selectable: false,
                    evented: false,
                    data: { id: "film-image" },
                });
                layer.add(img);
            }
            this.canvasService.requestRenderAll();
        }
        catch (error) {
            console.error("[FilmTool] Failed to load film image", url, error);
        }
        layer.dirty = true;
        this.canvasService.requestRenderAll();
    }
}
exports.FilmTool = FilmTool;
