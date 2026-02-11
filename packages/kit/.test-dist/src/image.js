"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageTool = void 0;
const core_1 = require("@pooder/core");
const fabric_1 = require("fabric");
class ImageTool {
    constructor() {
        this.id = "pooder.kit.image";
        this.metadata = {
            name: "ImageTool",
        };
        this.items = [];
        this.objectMap = new Map();
        this.loadResolvers = new Map();
        this.isUpdatingConfig = false;
        this.isToolActive = false;
        this.onToolActivated = (event) => {
            this.isToolActive = event.id === this.id;
            this.updateInteractivity();
        };
    }
    activate(context) {
        this.context = context;
        this.canvasService = context.services.get("CanvasService");
        if (!this.canvasService) {
            console.warn("CanvasService not found for ImageTool");
            return;
        }
        // Listen to tool activation
        context.eventBus.on("tool:activated", this.onToolActivated);
        const configService = context.services.get("ConfigurationService");
        if (configService) {
            // Load initial config
            this.items = configService.get("image.items", []) || [];
            // Listen for changes
            configService.onAnyChange((e) => {
                if (this.isUpdatingConfig)
                    return;
                if (e.key === "image.items") {
                    this.items = e.value || [];
                    this.updateImages();
                }
            });
        }
        this.ensureLayer();
        this.updateImages();
    }
    deactivate(context) {
        context.eventBus.off("tool:activated", this.onToolActivated);
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
    updateInteractivity() {
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
            [core_1.ContributionPointIds.CONFIGURATIONS]: [
                {
                    id: "image.items",
                    type: "array",
                    label: "Images",
                    default: [],
                },
            ],
            [core_1.ContributionPointIds.COMMANDS]: [
                {
                    command: "addImage",
                    title: "Add Image",
                    handler: async (url, options) => {
                        const id = this.generateId();
                        const newItem = {
                            id,
                            url,
                            opacity: 1,
                            ...options,
                        };
                        const promise = new Promise((resolve) => {
                            this.loadResolvers.set(id, () => resolve(id));
                        });
                        this.updateConfig([...this.items, newItem]);
                        return promise;
                    },
                },
                {
                    command: "fitImageToArea",
                    title: "Fit Image to Area",
                    handler: (id, area) => {
                        const item = this.items.find((i) => i.id === id);
                        const obj = this.objectMap.get(id);
                        if (item && obj && obj.width && obj.height) {
                            const scale = Math.max(area.width / obj.width, area.height / obj.height);
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
                    handler: (id) => {
                        const newItems = this.items.filter((item) => item.id !== id);
                        if (newItems.length !== this.items.length) {
                            this.updateConfig(newItems);
                        }
                    },
                },
                {
                    command: "updateImage",
                    title: "Update Image",
                    handler: (id, updates) => {
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
                    handler: (id) => {
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
                    handler: (id) => {
                        const index = this.items.findIndex((item) => item.id === id);
                        if (index > 0) {
                            const newItems = [...this.items];
                            const [item] = newItems.splice(index, 1);
                            newItems.unshift(item);
                            this.updateConfig(newItems);
                        }
                    },
                },
            ],
        };
    }
    generateId() {
        return Math.random().toString(36).substring(2, 9);
    }
    updateConfig(newItems, skipCanvasUpdate = false) {
        if (!this.context)
            return;
        this.isUpdatingConfig = true;
        this.items = newItems;
        const configService = this.context.services.get("ConfigurationService");
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
    ensureLayer() {
        if (!this.canvasService)
            return;
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
            }
            else {
                // Ensure background is behind
                const bgLayer = this.canvasService.getLayer("background");
                if (bgLayer) {
                    this.canvasService.canvas.sendObjectToBack(bgLayer);
                }
            }
            this.canvasService.requestRenderAll();
        }
    }
    getLayoutInfo() {
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
    updateImages() {
        if (!this.canvasService)
            return;
        const layer = this.canvasService.getLayer("user");
        if (!layer) {
            console.warn("[ImageTool] User layer not found");
            return;
        }
        // 1. Remove objects that are no longer in items
        const currentIds = new Set(this.items.map((i) => i.id));
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
            // Check if URL changed, if so remove object to force reload
            // We assume Fabric object has getSrc() or we check data.url if we stored it
            // Since we don't store url on object easily accessible without casting, 
            // let's rely on checking if we need to reload.
            // Actually, standard Fabric Image doesn't expose src easily on type without casting to any.
            if (obj && obj.getSrc) {
                const currentSrc = obj.getSrc();
                if (currentSrc !== item.url) {
                    layer.remove(obj);
                    this.objectMap.delete(item.id);
                    obj = undefined;
                }
            }
            if (!obj) {
                // New object, load it
                this.loadImage(item, layer, layout);
            }
            else {
                // Existing object, update properties
                // We remove and re-add to ensure coordinates are correctly converted 
                // from absolute (updateObjectProperties) to relative (layer.add)
                layer.remove(obj);
                this.updateObjectProperties(obj, item, layout);
                layer.add(obj);
            }
        });
        layer.dirty = true;
        this.canvasService.requestRenderAll();
    }
    updateObjectProperties(obj, item, layout) {
        const { layoutScale, layoutOffsetX, layoutOffsetY, visualWidth, visualHeight, } = layout;
        const updates = {};
        // Opacity
        if (obj.opacity !== item.opacity)
            updates.opacity = item.opacity;
        // Angle
        if (item.angle !== undefined && obj.angle !== item.angle)
            updates.angle = item.angle;
        // Position (Normalized -> Absolute)
        if (item.left !== undefined) {
            const globalLeft = layoutOffsetX + item.left * visualWidth;
            if (Math.abs(obj.left - globalLeft) > 1)
                updates.left = globalLeft;
        }
        if (item.top !== undefined) {
            const globalTop = layoutOffsetY + item.top * visualHeight;
            if (Math.abs(obj.top - globalTop) > 1)
                updates.top = globalTop;
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
    loadImage(item, layer, layout) {
        fabric_1.Image.fromURL(item.url, { crossOrigin: "anonymous" })
            .then((image) => {
            // Double check if item still exists
            if (!this.items.find((i) => i.id === item.id))
                return;
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
            image.on("modified", (e) => {
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
    handleObjectModified(id, image) {
        const layout = this.getLayoutInfo();
        const { layoutScale, layoutOffsetX, layoutOffsetY, visualWidth, visualHeight, } = layout;
        const matrix = image.calcTransformMatrix();
        const globalPoint = fabric_1.util.transformPoint(new fabric_1.Point(0, 0), matrix);
        const updates = {};
        // Normalize Position
        updates.left = (globalPoint.x - layoutOffsetX) / visualWidth;
        updates.top = (globalPoint.y - layoutOffsetY) / visualHeight;
        updates.angle = image.angle;
        // Scale
        updates.scale = image.scaleX / layoutScale;
        this.updateImageInConfig(id, updates, true);
    }
    updateImageInConfig(id, updates, skipCanvasUpdate = false) {
        const index = this.items.findIndex((i) => i.id === id);
        if (index !== -1) {
            const newItems = [...this.items];
            newItems[index] = { ...newItems[index], ...updates };
            this.updateConfig(newItems, skipCanvasUpdate);
        }
    }
}
exports.ImageTool = ImageTool;
