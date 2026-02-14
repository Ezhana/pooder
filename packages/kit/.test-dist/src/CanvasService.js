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
    async applyLayerSpec(spec) {
        const layer = this.createLayer(spec.id, spec.props || {});
        await this.applyObjectSpecsToContainer(layer, spec.objects);
    }
    async applyObjectSpecsToLayer(layerId, objects) {
        const layer = this.createLayer(layerId, {});
        await this.applyObjectSpecsToContainer(layer, objects);
    }
    getRootLayerObjects(layerId) {
        return this.canvas
            .getObjects()
            .filter((obj) => obj?.data?.layerId === layerId);
    }
    async applyObjectSpecsToRootLayer(layerId, specs) {
        const desiredIds = new Set(specs.map((s) => s.id));
        const existing = this.getRootLayerObjects(layerId);
        existing.forEach((obj) => {
            const id = obj?.data?.id;
            if (typeof id === "string" && !desiredIds.has(id)) {
                this.canvas.remove(obj);
            }
        });
        const byId = new Map();
        this.getRootLayerObjects(layerId).forEach((obj) => {
            const id = obj?.data?.id;
            if (typeof id === "string")
                byId.set(id, obj);
        });
        for (let index = 0; index < specs.length; index += 1) {
            const spec = specs[index];
            let current = byId.get(spec.id);
            if (current &&
                spec.type === "image" &&
                spec.src &&
                current.getSrc &&
                current.getSrc() !== spec.src) {
                this.canvas.remove(current);
                byId.delete(spec.id);
                current = undefined;
            }
            if (!current) {
                const created = await this.createFabricObject(spec);
                if (!created)
                    continue;
                this.patchFabricObject(created, spec, { layerId });
                this.canvas.add(created);
                byId.set(spec.id, created);
                continue;
            }
            this.patchFabricObject(current, spec, { layerId });
        }
        this.requestRenderAll();
    }
    async applyObjectSpecsToContainer(container, specs) {
        const desiredIds = new Set(specs.map((s) => s.id));
        const existing = container.getObjects();
        existing.forEach((obj) => {
            const id = obj?.data?.id;
            if (typeof id === "string" && !desiredIds.has(id)) {
                container.remove(obj);
            }
        });
        const byId = new Map();
        container.getObjects().forEach((obj) => {
            const id = obj?.data?.id;
            if (typeof id === "string")
                byId.set(id, obj);
        });
        for (let index = 0; index < specs.length; index += 1) {
            const spec = specs[index];
            let current = byId.get(spec.id);
            if (current &&
                spec.type === "image" &&
                spec.src &&
                current.getSrc &&
                current.getSrc() !== spec.src) {
                container.remove(current);
                byId.delete(spec.id);
                current = undefined;
            }
            if (!current) {
                const created = await this.createFabricObject(spec);
                if (!created)
                    continue;
                container.add(created);
                current = created;
                byId.set(spec.id, current);
            }
            else {
                this.patchFabricObject(current, spec);
            }
            this.moveObjectInContainer(container, current, index);
        }
        container.dirty = true;
        this.requestRenderAll();
    }
    patchFabricObject(obj, spec, extraData) {
        const nextData = {
            ...(obj.data || {}),
            ...(spec.data || {}),
            ...(extraData || {}),
            id: spec.id,
        };
        obj.set({ ...(spec.props || {}), data: nextData });
        obj.setCoords();
    }
    moveObjectInContainer(container, obj, index) {
        if (!obj)
            return;
        const moveObjectTo = container.moveObjectTo;
        if (typeof moveObjectTo === "function") {
            moveObjectTo.call(container, obj, index);
            return;
        }
        const list = container._objects;
        if (!Array.isArray(list))
            return;
        const from = list.indexOf(obj);
        if (from < 0 || from === index)
            return;
        list.splice(from, 1);
        const target = Math.max(0, Math.min(index, list.length));
        list.splice(target, 0, obj);
        if (typeof container._onStackOrderChanged === "function") {
            container._onStackOrderChanged();
        }
    }
    async createFabricObject(spec) {
        if (spec.type === "rect") {
            const rect = new fabric_1.Rect({
                ...(spec.props || {}),
                data: { ...(spec.data || {}), id: spec.id },
            });
            rect.setCoords();
            return rect;
        }
        if (spec.type === "path") {
            const pathData = spec.props?.path || spec.props?.pathData;
            if (!pathData)
                return undefined;
            const path = new fabric_1.Path(pathData, {
                ...(spec.props || {}),
                data: { ...(spec.data || {}), id: spec.id },
            });
            path.setCoords();
            return path;
        }
        if (spec.type === "image") {
            if (!spec.src)
                return undefined;
            const image = await fabric_1.Image.fromURL(spec.src, { crossOrigin: "anonymous" });
            image.set({
                ...(spec.props || {}),
                data: { ...(spec.data || {}), id: spec.id },
            });
            image.setCoords();
            return image;
        }
        return undefined;
    }
}
exports.default = CanvasService;
