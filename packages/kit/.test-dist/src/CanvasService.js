"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fabric_1 = require("fabric");
const ViewportSystem_1 = require("./ViewportSystem");
class CanvasService {
    constructor(el, options) {
        if (el instanceof fabric_1.Canvas) {
            this.canvas = el;
        }
        else {
            this.canvas = new fabric_1.Canvas(el, {
                preserveObjectStacking: true,
                ...options,
            });
        }
        this.viewport = new ViewportSystem_1.ViewportSystem();
        if (this.canvas.width !== undefined && this.canvas.height !== undefined) {
            this.viewport.updateContainer(this.canvas.width, this.canvas.height);
        }
        if (options?.eventBus) {
            this.setEventBus(options.eventBus);
        }
    }
    setEventBus(eventBus) {
        this.eventBus = eventBus;
        this.setupEvents();
    }
    setupEvents() {
        if (!this.eventBus)
            return;
        const bus = this.eventBus;
        const forward = (name) => (e) => bus.emit(name, e);
        this.canvas.on("selection:created", forward("selection:created"));
        this.canvas.on("selection:updated", forward("selection:updated"));
        this.canvas.on("selection:cleared", forward("selection:cleared"));
        this.canvas.on("object:modified", forward("object:modified"));
        this.canvas.on("object:added", forward("object:added"));
        this.canvas.on("object:removed", forward("object:removed"));
    }
    dispose() {
        this.canvas.dispose();
    }
    /**
     * Get a layer (Group) by its ID.
     * We assume layers are Groups directly on the canvas with a data.id property.
     */
    getLayer(id) {
        return this.canvas.getObjects().find((obj) => obj.data?.id === id);
    }
    /**
     * Create a layer (Group) with the given ID if it doesn't exist.
     */
    createLayer(id, options = {}) {
        let layer = this.getLayer(id);
        if (!layer) {
            const defaultOptions = {
                selectable: false,
                evented: false,
                ...options,
                data: { ...options.data, id },
            };
            layer = new fabric_1.Group([], defaultOptions);
            this.canvas.add(layer);
        }
        return layer;
    }
    /**
     * Find an object by ID, optionally within a specific layer.
     */
    getObject(id, layerId) {
        if (layerId) {
            const layer = this.getLayer(layerId);
            if (!layer)
                return undefined;
            return layer.getObjects().find((obj) => obj.data?.id === id);
        }
        return this.canvas.getObjects().find((obj) => obj.data?.id === id);
    }
    requestRenderAll() {
        this.canvas.requestRenderAll();
    }
}
exports.default = CanvasService;
