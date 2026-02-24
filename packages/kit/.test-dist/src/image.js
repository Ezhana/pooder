"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageTool = void 0;
const core_1 = require("@pooder/core");
const fabric_1 = require("fabric");
const sceneLayoutModel_1 = require("./sceneLayoutModel");
const IMAGE_OBJECT_LAYER_ID = "image.user";
const IMAGE_OVERLAY_LAYER_ID = "image-overlay";
const IMAGE_REPLACE_GUARD_MS = 2500;
const IMAGE_DETECT_EXPAND_DEFAULT = 30;
const IMAGE_DETECT_SIMPLIFY_TOLERANCE_DEFAULT = 2;
const IMAGE_DETECT_MULTIPLIER_DEFAULT = 2;
class ImageTool {
    constructor() {
        this.id = "pooder.kit.image";
        this.metadata = {
            name: "ImageTool",
        };
        this.items = [];
        this.workingItems = [];
        this.hasWorkingChanges = false;
        this.loadResolvers = new Map();
        this.sourceSizeBySrc = new Map();
        this.isUpdatingConfig = false;
        this.isToolActive = false;
        this.isImageSelectionActive = false;
        this.focusedImageId = null;
        this.suppressSelectionClearUntil = 0;
        this.renderSeq = 0;
        this.onToolActivated = (event) => {
            const before = this.isToolActive;
            this.syncToolActiveFromWorkbench(event.id);
            if (!this.isToolActive) {
                const now = Date.now();
                const inGuardWindow = now <= this.suppressSelectionClearUntil && !!this.focusedImageId;
                if (!inGuardWindow) {
                    this.isImageSelectionActive = false;
                    this.focusedImageId = null;
                }
            }
            this.debug("tool:activated", {
                id: event.id,
                previous: event.previous,
                reason: event.reason,
                before,
                isToolActive: this.isToolActive,
                focusedImageId: this.focusedImageId,
                suppressSelectionClearUntil: this.suppressSelectionClearUntil,
            });
            if (!this.isToolActive && this.isDebugEnabled()) {
                console.trace("[ImageTool] tool deactivated trace");
            }
            this.updateImages();
        };
        this.onSelectionChanged = (e) => {
            const list = [];
            if (Array.isArray(e?.selected)) {
                list.push(...e.selected);
            }
            if (Array.isArray(e?.target?._objects)) {
                list.push(...e.target._objects);
            }
            if (e?.target && !Array.isArray(e?.target?._objects)) {
                list.push(e.target);
            }
            const selectedImage = list.find((obj) => obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID);
            this.isImageSelectionActive = !!selectedImage;
            if (selectedImage?.data?.id) {
                this.focusedImageId = selectedImage.data.id;
            }
            else if (list.length > 0) {
                this.focusedImageId = null;
            }
            this.debug("selection:changed", {
                listSize: list.length,
                isImageSelectionActive: this.isImageSelectionActive,
                focusedImageId: this.focusedImageId,
            });
            this.updateImages();
        };
        this.onSelectionCleared = () => {
            const now = Date.now();
            if (now <= this.suppressSelectionClearUntil && this.focusedImageId) {
                this.debug("selection:cleared ignored", {
                    suppressUntil: this.suppressSelectionClearUntil,
                    focusedImageId: this.focusedImageId,
                });
                return;
            }
            this.isImageSelectionActive = false;
            this.focusedImageId = null;
            this.debug("selection:cleared applied");
            this.updateImages();
        };
        this.onSceneLayoutChanged = () => {
            this.updateImages();
        };
        this.onObjectModified = (e) => {
            if (!this.isToolActive)
                return;
            const target = e?.target;
            const id = target?.data?.id;
            const layerId = target?.data?.layerId;
            if (typeof id !== "string" || layerId !== IMAGE_OBJECT_LAYER_ID)
                return;
            const frame = this.getFrameRect();
            if (!frame.width || !frame.height)
                return;
            const center = target.getCenterPoint
                ? target.getCenterPoint()
                : new fabric_1.Point(target.left ?? 0, target.top ?? 0);
            const objectScale = Number.isFinite(target?.scaleX) ? target.scaleX : 1;
            const workingItem = this.workingItems.find((item) => item.id === id);
            const sourceKey = workingItem?.sourceUrl || workingItem?.url || "";
            const sourceSize = this.getSourceSize(sourceKey, target);
            const coverScale = this.getCoverScale(frame, sourceSize);
            const updates = {
                left: this.clampNormalized((center.x - frame.left) / frame.width),
                top: this.clampNormalized((center.y - frame.top) / frame.height),
                angle: Number.isFinite(target.angle) ? target.angle : 0,
                scale: Math.max(0.05, (objectScale || 1) / coverScale),
            };
            this.focusedImageId = id;
            this.updateImageInWorking(id, updates);
        };
    }
    activate(context) {
        this.context = context;
        this.canvasService = context.services.get("CanvasService");
        if (!this.canvasService) {
            console.warn("CanvasService not found for ImageTool");
            return;
        }
        context.eventBus.on("tool:activated", this.onToolActivated);
        context.eventBus.on("object:modified", this.onObjectModified);
        context.eventBus.on("selection:created", this.onSelectionChanged);
        context.eventBus.on("selection:updated", this.onSelectionChanged);
        context.eventBus.on("selection:cleared", this.onSelectionCleared);
        context.eventBus.on("scene:layout:change", this.onSceneLayoutChanged);
        const configService = context.services.get("ConfigurationService");
        if (configService) {
            this.items = this.normalizeItems(configService.get("image.items", []) || []);
            this.workingItems = this.cloneItems(this.items);
            this.hasWorkingChanges = false;
            configService.onAnyChange((e) => {
                if (this.isUpdatingConfig)
                    return;
                if (e.key === "image.items") {
                    this.items = this.normalizeItems(e.value || []);
                    if (!this.isToolActive || !this.hasWorkingChanges) {
                        this.workingItems = this.cloneItems(this.items);
                        this.hasWorkingChanges = false;
                    }
                    this.updateImages();
                    return;
                }
                if (e.key.startsWith("size.") || e.key.startsWith("image.frame.")) {
                    this.updateImages();
                }
            });
        }
        const toolSessionService = context.services.get("ToolSessionService");
        this.dirtyTrackerDisposable = toolSessionService?.registerDirtyTracker(this.id, () => this.hasWorkingChanges);
        this.updateImages();
    }
    deactivate(context) {
        context.eventBus.off("tool:activated", this.onToolActivated);
        context.eventBus.off("object:modified", this.onObjectModified);
        context.eventBus.off("selection:created", this.onSelectionChanged);
        context.eventBus.off("selection:updated", this.onSelectionChanged);
        context.eventBus.off("selection:cleared", this.onSelectionCleared);
        context.eventBus.off("scene:layout:change", this.onSceneLayoutChanged);
        this.dirtyTrackerDisposable?.dispose();
        this.dirtyTrackerDisposable = undefined;
        this.clearRenderedImages();
        if (this.canvasService) {
            void this.canvasService.applyObjectSpecsToRootLayer(IMAGE_OVERLAY_LAYER_ID, []);
            this.canvasService = undefined;
        }
        this.context = undefined;
    }
    syncToolActiveFromWorkbench(fallbackId) {
        const wb = this.context?.services.get("WorkbenchService");
        const activeId = wb?.activeToolId;
        if (typeof activeId === "string" || activeId === null) {
            this.isToolActive = activeId === this.id;
            return;
        }
        this.isToolActive = fallbackId === this.id;
    }
    isImageEditingVisible() {
        return (this.isToolActive || this.isImageSelectionActive || !!this.focusedImageId);
    }
    isDebugEnabled() {
        return !!this.getConfig("image.debug", false);
    }
    debug(message, payload) {
        if (!this.isDebugEnabled())
            return;
        if (payload === undefined) {
            console.log(`[ImageTool] ${message}`);
            return;
        }
        console.log(`[ImageTool] ${message}`, payload);
    }
    contribute() {
        return {
            [core_1.ContributionPointIds.TOOLS]: [
                {
                    id: this.id,
                    name: "Image",
                    interaction: "session",
                    commands: {
                        begin: "resetWorkingImages",
                        commit: "completeImages",
                        rollback: "resetWorkingImages",
                    },
                    session: {
                        autoBegin: true,
                        leavePolicy: "block",
                    },
                },
            ],
            [core_1.ContributionPointIds.CONFIGURATIONS]: [
                {
                    id: "image.items",
                    type: "array",
                    label: "Images",
                    default: [],
                },
                {
                    id: "image.debug",
                    type: "boolean",
                    label: "Image Debug Log",
                    default: false,
                },
                {
                    id: "image.frame.strokeColor",
                    type: "color",
                    label: "Image Frame Stroke Color",
                    default: "#FF0000",
                },
                {
                    id: "image.frame.strokeWidth",
                    type: "number",
                    label: "Image Frame Stroke Width",
                    min: 0,
                    max: 20,
                    step: 0.5,
                    default: 2,
                },
                {
                    id: "image.frame.strokeStyle",
                    type: "select",
                    label: "Image Frame Stroke Style",
                    options: ["solid", "dashed", "hidden"],
                    default: "solid",
                },
                {
                    id: "image.frame.dashLength",
                    type: "number",
                    label: "Image Frame Dash Length",
                    min: 1,
                    max: 40,
                    step: 1,
                    default: 8,
                },
                {
                    id: "image.frame.innerBackground",
                    type: "color",
                    label: "Image Frame Inner Background",
                    default: "rgba(0,0,0,0)",
                },
                {
                    id: "image.frame.outerBackground",
                    type: "color",
                    label: "Image Frame Outer Background",
                    default: "rgba(0,0,0,0.18)",
                },
            ],
            [core_1.ContributionPointIds.COMMANDS]: [
                {
                    command: "addImage",
                    title: "Add Image",
                    handler: async (url, options) => {
                        const result = await this.upsertImageEntry(url, {
                            mode: "add",
                            addOptions: options,
                        });
                        return result.id;
                    },
                },
                {
                    command: "upsertImage",
                    title: "Upsert Image",
                    handler: async (url, options = {}) => {
                        return await this.upsertImageEntry(url, options);
                    },
                },
                {
                    command: "getWorkingImages",
                    title: "Get Working Images",
                    handler: () => {
                        return this.cloneItems(this.workingItems);
                    },
                },
                {
                    command: "setWorkingImage",
                    title: "Set Working Image",
                    handler: (id, updates) => {
                        this.updateImageInWorking(id, updates);
                    },
                },
                {
                    command: "resetWorkingImages",
                    title: "Reset Working Images",
                    handler: () => {
                        this.workingItems = this.cloneItems(this.items);
                        this.hasWorkingChanges = false;
                        this.updateImages();
                    },
                },
                {
                    command: "completeImages",
                    title: "Complete Images",
                    handler: async () => {
                        return await this.commitWorkingImagesAsCropped();
                    },
                },
                {
                    command: "exportImageFrameUrl",
                    title: "Export Image Frame Url",
                    handler: async (options = {}) => {
                        return await this.exportImageFrameUrl(options);
                    },
                },
                {
                    command: "fitImageToArea",
                    title: "Fit Image to Area",
                    handler: async (id, area) => {
                        await this.fitImageToArea(id, area);
                    },
                },
                {
                    command: "fitImageToDefaultArea",
                    title: "Fit Image to Default Area",
                    handler: async (id) => {
                        await this.fitImageToDefaultArea(id);
                    },
                },
                {
                    command: "removeImage",
                    title: "Remove Image",
                    handler: (id) => {
                        const removed = this.items.find((item) => item.id === id);
                        const next = this.items.filter((item) => item.id !== id);
                        if (next.length !== this.items.length) {
                            this.purgeSourceSizeCacheForItem(removed);
                            if (this.focusedImageId === id) {
                                this.focusedImageId = null;
                                this.isImageSelectionActive = false;
                            }
                            this.updateConfig(next);
                        }
                    },
                },
                {
                    command: "updateImage",
                    title: "Update Image",
                    handler: async (id, updates, options = {}) => {
                        await this.updateImage(id, updates, options);
                    },
                },
                {
                    command: "clearImages",
                    title: "Clear Images",
                    handler: () => {
                        this.sourceSizeBySrc.clear();
                        this.focusedImageId = null;
                        this.isImageSelectionActive = false;
                        this.updateConfig([]);
                    },
                },
                {
                    command: "bringToFront",
                    title: "Bring Image to Front",
                    handler: (id) => {
                        const index = this.items.findIndex((item) => item.id === id);
                        if (index !== -1 && index < this.items.length - 1) {
                            const next = [...this.items];
                            const [item] = next.splice(index, 1);
                            next.push(item);
                            this.updateConfig(next);
                        }
                    },
                },
                {
                    command: "sendToBack",
                    title: "Send Image to Back",
                    handler: (id) => {
                        const index = this.items.findIndex((item) => item.id === id);
                        if (index > 0) {
                            const next = [...this.items];
                            const [item] = next.splice(index, 1);
                            next.unshift(item);
                            this.updateConfig(next);
                        }
                    },
                },
            ],
        };
    }
    normalizeItem(item) {
        const url = typeof item.url === "string" ? item.url : "";
        const sourceUrl = typeof item.sourceUrl === "string" && item.sourceUrl.length > 0
            ? item.sourceUrl
            : url;
        const committedUrl = typeof item.committedUrl === "string" && item.committedUrl.length > 0
            ? item.committedUrl
            : undefined;
        return {
            ...item,
            url: url || sourceUrl,
            sourceUrl,
            committedUrl,
            opacity: Number.isFinite(item.opacity) ? item.opacity : 1,
            scale: Number.isFinite(item.scale) ? item.scale : 1,
            angle: Number.isFinite(item.angle) ? item.angle : 0,
            left: Number.isFinite(item.left) ? item.left : 0.5,
            top: Number.isFinite(item.top) ? item.top : 0.5,
        };
    }
    normalizeItems(items) {
        return (items || []).map((item) => this.normalizeItem(item));
    }
    cloneItems(items) {
        return this.normalizeItems((items || []).map((i) => ({ ...i })));
    }
    generateId() {
        return Math.random().toString(36).substring(2, 9);
    }
    getImageIdFromActiveObject() {
        const active = this.canvasService?.canvas.getActiveObject();
        if (active?.data?.layerId === IMAGE_OBJECT_LAYER_ID &&
            typeof active?.data?.id === "string") {
            return active.data.id;
        }
        return null;
    }
    resolveReplaceTargetId(explicitId) {
        const has = (id) => !!id && this.items.some((item) => item.id === id);
        if (has(explicitId))
            return explicitId;
        if (has(this.focusedImageId))
            return this.focusedImageId;
        const activeId = this.getImageIdFromActiveObject();
        if (has(activeId))
            return activeId;
        if (this.items.length === 1)
            return this.items[0].id;
        return null;
    }
    async addImageEntry(url, options, fitOnAdd = true) {
        const id = this.generateId();
        const newItem = this.normalizeItem({
            id,
            url,
            opacity: 1,
            ...options,
        });
        this.focusedImageId = id;
        this.isImageSelectionActive = true;
        this.suppressSelectionClearUntil = Date.now() + IMAGE_REPLACE_GUARD_MS;
        const sessionDirtyBeforeAdd = this.isToolActive && this.hasWorkingChanges;
        const waitLoaded = this.waitImageLoaded(id, true);
        this.updateConfig([...this.items, newItem]);
        this.addItemToWorkingSessionIfNeeded(newItem, sessionDirtyBeforeAdd);
        const loaded = await waitLoaded;
        if (loaded && fitOnAdd) {
            await this.fitImageToDefaultArea(id);
        }
        if (loaded) {
            this.focusImageSelection(id);
        }
        return id;
    }
    async upsertImageEntry(url, options = {}) {
        const mode = options.mode || "auto";
        const fitOnAdd = options.fitOnAdd !== false;
        if (mode === "add") {
            const id = await this.addImageEntry(url, options.addOptions, fitOnAdd);
            return { id, mode: "add" };
        }
        const targetId = this.resolveReplaceTargetId(options.id ?? null);
        if (targetId) {
            await this.updateImageInConfig(targetId, { url });
            return { id: targetId, mode: "replace" };
        }
        if (mode === "replace" || options.createIfMissing === false) {
            throw new Error("replace-target-not-found");
        }
        const id = await this.addImageEntry(url, options.addOptions, fitOnAdd);
        return { id, mode: "add" };
    }
    addItemToWorkingSessionIfNeeded(item, sessionDirtyBeforeAdd) {
        if (!sessionDirtyBeforeAdd || !this.isToolActive)
            return;
        if (this.workingItems.some((existing) => existing.id === item.id))
            return;
        this.workingItems = this.cloneItems([...this.workingItems, item]);
        this.updateImages();
    }
    async updateImage(id, updates, options = {}) {
        this.syncToolActiveFromWorkbench();
        const target = options.target || "auto";
        if (target === "working" || (target === "auto" && this.isToolActive)) {
            this.updateImageInWorking(id, updates);
            return;
        }
        await this.updateImageInConfig(id, updates);
    }
    getConfig(key, fallback) {
        if (!this.context)
            return fallback;
        const configService = this.context.services.get("ConfigurationService");
        if (!configService)
            return fallback;
        return configService.get(key, fallback) ?? fallback;
    }
    updateConfig(newItems, skipCanvasUpdate = false) {
        if (!this.context)
            return;
        this.isUpdatingConfig = true;
        this.items = this.normalizeItems(newItems);
        if (!this.isToolActive || !this.hasWorkingChanges) {
            this.workingItems = this.cloneItems(this.items);
            this.hasWorkingChanges = false;
        }
        const configService = this.context.services.get("ConfigurationService");
        configService?.update("image.items", this.items);
        if (!skipCanvasUpdate) {
            this.updateImages();
        }
        setTimeout(() => {
            this.isUpdatingConfig = false;
        }, 50);
    }
    getFrameRect() {
        if (!this.canvasService) {
            return { left: 0, top: 0, width: 0, height: 0 };
        }
        const configService = this.context?.services.get("ConfigurationService");
        if (!configService) {
            return { left: 0, top: 0, width: 0, height: 0 };
        }
        const sizeState = (0, sceneLayoutModel_1.readSizeState)(configService);
        const layout = (0, sceneLayoutModel_1.computeSceneLayout)(this.canvasService, sizeState);
        if (!layout) {
            return { left: 0, top: 0, width: 0, height: 0 };
        }
        return {
            left: layout.cutRect.left,
            top: layout.cutRect.top,
            width: layout.cutRect.width,
            height: layout.cutRect.height,
        };
    }
    async resolveDefaultFitArea() {
        if (!this.context || !this.canvasService)
            return null;
        const commandService = this.context.services.get("CommandService");
        if (!commandService)
            return null;
        try {
            const layout = await Promise.resolve(commandService.executeCommand("getSceneLayout"));
            const cutRect = layout?.cutRect;
            const width = Number(cutRect?.width);
            const height = Number(cutRect?.height);
            const left = Number(cutRect?.left);
            const top = Number(cutRect?.top);
            if (!Number.isFinite(width) ||
                !Number.isFinite(height) ||
                !Number.isFinite(left) ||
                !Number.isFinite(top)) {
                return null;
            }
            return {
                width: Math.max(1, width),
                height: Math.max(1, height),
                left: left + width / 2,
                top: top + height / 2,
            };
        }
        catch {
            return null;
        }
    }
    async fitImageToDefaultArea(id) {
        if (!this.canvasService)
            return;
        const area = await this.resolveDefaultFitArea();
        if (area) {
            await this.fitImageToArea(id, area);
            return;
        }
        const canvasW = Math.max(1, this.canvasService.canvas.width || 0);
        const canvasH = Math.max(1, this.canvasService.canvas.height || 0);
        await this.fitImageToArea(id, {
            width: canvasW,
            height: canvasH,
            left: canvasW / 2,
            top: canvasH / 2,
        });
    }
    getImageObjects() {
        if (!this.canvasService)
            return [];
        return this.canvasService.canvas.getObjects().filter((obj) => {
            return obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID;
        });
    }
    getOverlayObjects() {
        if (!this.canvasService)
            return [];
        return this.canvasService.getRootLayerObjects(IMAGE_OVERLAY_LAYER_ID);
    }
    getImageObject(id) {
        return this.getImageObjects().find((obj) => obj?.data?.id === id);
    }
    clearRenderedImages() {
        if (!this.canvasService)
            return;
        const canvas = this.canvasService.canvas;
        this.getImageObjects().forEach((obj) => canvas.remove(obj));
        this.canvasService.requestRenderAll();
    }
    purgeSourceSizeCacheForItem(item) {
        if (!item)
            return;
        const sources = [item.url, item.sourceUrl, item.committedUrl].filter((value) => typeof value === "string" && value.length > 0);
        sources.forEach((src) => this.sourceSizeBySrc.delete(src));
    }
    rememberSourceSize(src, obj) {
        const width = Number(obj?.width || 0);
        const height = Number(obj?.height || 0);
        if (src && width > 0 && height > 0) {
            this.sourceSizeBySrc.set(src, { width, height });
        }
    }
    getSourceSize(src, obj) {
        const cached = src ? this.sourceSizeBySrc.get(src) : undefined;
        if (cached)
            return cached;
        const width = Number(obj?.width || 0);
        const height = Number(obj?.height || 0);
        if (src && width > 0 && height > 0) {
            const size = { width, height };
            this.sourceSizeBySrc.set(src, size);
            return size;
        }
        return { width: 1, height: 1 };
    }
    getCoverScale(frame, size) {
        const sw = Math.max(1, size.width);
        const sh = Math.max(1, size.height);
        const fw = Math.max(1, frame.width);
        const fh = Math.max(1, frame.height);
        return Math.max(fw / sw, fh / sh);
    }
    getFrameVisualConfig() {
        const strokeStyleRaw = (this.getConfig("image.frame.strokeStyle", "solid") || "solid");
        const strokeStyle = strokeStyleRaw === "dashed" || strokeStyleRaw === "hidden"
            ? strokeStyleRaw
            : "solid";
        const strokeWidth = Number(this.getConfig("image.frame.strokeWidth", 2) ?? 2);
        const dashLength = Number(this.getConfig("image.frame.dashLength", 8) ?? 8);
        return {
            strokeColor: this.getConfig("image.frame.strokeColor", "#FF0000") ||
                "#FF0000",
            strokeWidth: Number.isFinite(strokeWidth) ? Math.max(0, strokeWidth) : 2,
            strokeStyle,
            dashLength: Number.isFinite(dashLength) ? Math.max(1, dashLength) : 8,
            innerBackground: this.getConfig("image.frame.innerBackground", "rgba(0,0,0,0)") || "rgba(0,0,0,0)",
            outerBackground: this.getConfig("image.frame.outerBackground", "rgba(0,0,0,0.18)") || "rgba(0,0,0,0.18)",
        };
    }
    resolveRenderImageState(item) {
        const active = this.isToolActive;
        const sourceUrl = item.sourceUrl || item.url;
        const committedUrl = item.committedUrl;
        if (!active && committedUrl) {
            return {
                src: committedUrl,
                left: 0.5,
                top: 0.5,
                scale: 1,
                angle: 0,
                opacity: item.opacity,
            };
        }
        return {
            src: sourceUrl || item.url,
            left: Number.isFinite(item.left) ? item.left : 0.5,
            top: Number.isFinite(item.top) ? item.top : 0.5,
            scale: Math.max(0.05, item.scale ?? 1),
            angle: Number.isFinite(item.angle) ? item.angle : 0,
            opacity: item.opacity,
        };
    }
    computeCanvasProps(render, size, frame) {
        const left = render.left;
        const top = render.top;
        const zoom = render.scale;
        const angle = render.angle;
        const centerX = frame.left + left * frame.width;
        const centerY = frame.top + top * frame.height;
        const scale = this.getCoverScale(frame, size) * zoom;
        return {
            left: centerX,
            top: centerY,
            scaleX: scale,
            scaleY: scale,
            angle,
            originX: "center",
            originY: "center",
            uniformScaling: true,
            lockScalingFlip: true,
            selectable: this.isImageEditingVisible(),
            evented: this.isImageEditingVisible(),
            hasControls: this.isImageEditingVisible(),
            hasBorders: this.isImageEditingVisible(),
            opacity: render.opacity,
        };
    }
    getCurrentSrc(obj) {
        if (!obj)
            return undefined;
        if (typeof obj.getSrc === "function")
            return obj.getSrc();
        return obj?._originalElement?.src;
    }
    async upsertImageObject(item, frame, seq) {
        if (!this.canvasService)
            return;
        const canvas = this.canvasService.canvas;
        const render = this.resolveRenderImageState(item);
        if (!render.src)
            return;
        let obj = this.getImageObject(item.id);
        const currentSrc = this.getCurrentSrc(obj);
        if (obj && currentSrc && currentSrc !== render.src) {
            canvas.remove(obj);
            obj = undefined;
        }
        if (!obj) {
            const created = await fabric_1.Image.fromURL(render.src, {
                crossOrigin: "anonymous",
            });
            if (seq !== this.renderSeq)
                return;
            created.set({
                data: {
                    id: item.id,
                    layerId: IMAGE_OBJECT_LAYER_ID,
                    type: "image-item",
                },
            });
            canvas.add(created);
            obj = created;
        }
        this.rememberSourceSize(render.src, obj);
        const sourceSize = this.getSourceSize(render.src, obj);
        const props = this.computeCanvasProps(render, sourceSize, frame);
        obj.set({
            ...props,
            data: {
                ...(obj.data || {}),
                id: item.id,
                layerId: IMAGE_OBJECT_LAYER_ID,
                type: "image-item",
            },
        });
        obj.setCoords();
        const resolver = this.loadResolvers.get(item.id);
        if (resolver) {
            resolver();
            this.loadResolvers.delete(item.id);
        }
    }
    syncImageZOrder(items) {
        if (!this.canvasService)
            return;
        const canvas = this.canvasService.canvas;
        const objects = canvas.getObjects();
        let insertIndex = 0;
        const backgroundLayer = this.canvasService.getLayer("background");
        if (backgroundLayer) {
            const bgIndex = objects.indexOf(backgroundLayer);
            if (bgIndex >= 0)
                insertIndex = bgIndex + 1;
        }
        items.forEach((item) => {
            const obj = this.getImageObject(item.id);
            if (!obj)
                return;
            canvas.moveObjectTo(obj, insertIndex);
            insertIndex += 1;
        });
        const overlayObjects = this.getOverlayObjects().sort((a, b) => {
            const az = Number(a?.data?.zIndex ?? 0);
            const bz = Number(b?.data?.zIndex ?? 0);
            return az - bz;
        });
        overlayObjects.forEach((obj) => {
            canvas.bringObjectToFront(obj);
        });
    }
    buildOverlaySpecs(frame) {
        const visible = this.isImageEditingVisible();
        if (!visible ||
            frame.width <= 0 ||
            frame.height <= 0 ||
            !this.canvasService) {
            this.debug("overlay:hidden", {
                visible,
                frame,
                isToolActive: this.isToolActive,
                isImageSelectionActive: this.isImageSelectionActive,
                focusedImageId: this.focusedImageId,
            });
            return [];
        }
        const canvasW = this.canvasService.canvas.width || 0;
        const canvasH = this.canvasService.canvas.height || 0;
        const visual = this.getFrameVisualConfig();
        const topH = Math.max(0, frame.top);
        const bottomH = Math.max(0, canvasH - (frame.top + frame.height));
        const leftW = Math.max(0, frame.left);
        const rightW = Math.max(0, canvasW - (frame.left + frame.width));
        const mask = [
            {
                id: "image.cropMask.top",
                type: "rect",
                data: { id: "image.cropMask.top", zIndex: 1 },
                props: {
                    left: canvasW / 2,
                    top: topH / 2,
                    width: canvasW,
                    height: topH,
                    originX: "center",
                    originY: "center",
                    fill: visual.outerBackground,
                    selectable: false,
                    evented: false,
                },
            },
            {
                id: "image.cropMask.bottom",
                type: "rect",
                data: { id: "image.cropMask.bottom", zIndex: 2 },
                props: {
                    left: canvasW / 2,
                    top: frame.top + frame.height + bottomH / 2,
                    width: canvasW,
                    height: bottomH,
                    originX: "center",
                    originY: "center",
                    fill: visual.outerBackground,
                    selectable: false,
                    evented: false,
                },
            },
            {
                id: "image.cropMask.left",
                type: "rect",
                data: { id: "image.cropMask.left", zIndex: 3 },
                props: {
                    left: leftW / 2,
                    top: frame.top + frame.height / 2,
                    width: leftW,
                    height: frame.height,
                    originX: "center",
                    originY: "center",
                    fill: visual.outerBackground,
                    selectable: false,
                    evented: false,
                },
            },
            {
                id: "image.cropMask.right",
                type: "rect",
                data: { id: "image.cropMask.right", zIndex: 4 },
                props: {
                    left: frame.left + frame.width + rightW / 2,
                    top: frame.top + frame.height / 2,
                    width: rightW,
                    height: frame.height,
                    originX: "center",
                    originY: "center",
                    fill: visual.outerBackground,
                    selectable: false,
                    evented: false,
                },
            },
        ];
        const frameSpec = {
            id: "image.cropFrame",
            type: "rect",
            data: { id: "image.cropFrame", zIndex: 5 },
            props: {
                left: frame.left + frame.width / 2,
                top: frame.top + frame.height / 2,
                width: frame.width,
                height: frame.height,
                originX: "center",
                originY: "center",
                fill: visual.innerBackground,
                stroke: visual.strokeStyle === "hidden"
                    ? "rgba(0,0,0,0)"
                    : visual.strokeColor,
                strokeWidth: visual.strokeStyle === "hidden" ? 0 : visual.strokeWidth,
                strokeDashArray: visual.strokeStyle === "dashed"
                    ? [visual.dashLength, visual.dashLength]
                    : undefined,
                selectable: false,
                evented: false,
            },
        };
        return [...mask, frameSpec];
    }
    updateImages() {
        void this.updateImagesAsync();
    }
    async updateImagesAsync() {
        if (!this.canvasService)
            return;
        this.syncToolActiveFromWorkbench();
        const seq = ++this.renderSeq;
        const renderItems = this.isToolActive ? this.workingItems : this.items;
        const frame = this.getFrameRect();
        const desiredIds = new Set(renderItems.map((item) => item.id));
        if (this.focusedImageId && !desiredIds.has(this.focusedImageId)) {
            this.focusedImageId = null;
            this.isImageSelectionActive = false;
        }
        this.getImageObjects().forEach((obj) => {
            const id = obj?.data?.id;
            if (typeof id === "string" && !desiredIds.has(id)) {
                this.canvasService?.canvas.remove(obj);
            }
        });
        for (const item of renderItems) {
            if (seq !== this.renderSeq)
                return;
            await this.upsertImageObject(item, frame, seq);
        }
        if (seq !== this.renderSeq)
            return;
        this.syncImageZOrder(renderItems);
        const overlaySpecs = this.buildOverlaySpecs(frame);
        await this.canvasService.applyObjectSpecsToRootLayer(IMAGE_OVERLAY_LAYER_ID, overlaySpecs);
        this.syncImageZOrder(renderItems);
        const overlayCanvasCount = this.getOverlayObjects().length;
        this.debug("render:done", {
            seq,
            renderCount: renderItems.length,
            overlayCount: overlaySpecs.length,
            overlayCanvasCount,
            isToolActive: this.isToolActive,
            isImageSelectionActive: this.isImageSelectionActive,
            focusedImageId: this.focusedImageId,
        });
        this.canvasService.requestRenderAll();
    }
    clampNormalized(value) {
        return Math.max(-1, Math.min(2, value));
    }
    updateImageInWorking(id, updates) {
        const index = this.workingItems.findIndex((item) => item.id === id);
        if (index < 0)
            return;
        const next = [...this.workingItems];
        next[index] = this.normalizeItem({ ...next[index], ...updates });
        this.workingItems = next;
        this.hasWorkingChanges = true;
        this.isImageSelectionActive = true;
        this.focusedImageId = id;
        if (this.isToolActive) {
            this.updateImages();
        }
    }
    async updateImageInConfig(id, updates) {
        const index = this.items.findIndex((item) => item.id === id);
        if (index < 0)
            return;
        const replacingSource = typeof updates.url === "string" && updates.url.length > 0;
        const next = [...this.items];
        const base = next[index];
        const replacingUrl = replacingSource ? updates.url : undefined;
        next[index] = this.normalizeItem({
            ...base,
            ...updates,
            ...(replacingSource
                ? {
                    url: replacingUrl,
                    sourceUrl: replacingUrl,
                    committedUrl: undefined,
                    scale: updates.scale ?? 1,
                    angle: updates.angle ?? 0,
                    left: updates.left ?? 0.5,
                    top: updates.top ?? 0.5,
                }
                : {}),
        });
        this.updateConfig(next);
        if (replacingSource) {
            this.focusedImageId = id;
            this.isImageSelectionActive = true;
            this.suppressSelectionClearUntil = Date.now() + IMAGE_REPLACE_GUARD_MS;
            this.debug("replace:image:begin", { id, replacingUrl });
            this.purgeSourceSizeCacheForItem(base);
            const loaded = await this.waitImageLoaded(id, true);
            this.debug("replace:image:loaded", { id, loaded });
            if (loaded) {
                await this.refitImageToFrame(id);
                this.focusImageSelection(id);
            }
        }
    }
    waitImageLoaded(id, forceWait = false) {
        if (!forceWait && this.getImageObject(id)) {
            return Promise.resolve(true);
        }
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.loadResolvers.delete(id);
                resolve(false);
            }, 4000);
            this.loadResolvers.set(id, () => {
                clearTimeout(timeout);
                resolve(true);
            });
        });
    }
    async refitImageToFrame(id) {
        const obj = this.getImageObject(id);
        if (!obj || !this.canvasService)
            return;
        const current = this.items.find((item) => item.id === id);
        if (!current)
            return;
        const render = this.resolveRenderImageState(current);
        this.rememberSourceSize(render.src, obj);
        const source = this.getSourceSize(render.src, obj);
        const frame = this.getFrameRect();
        const coverScale = this.getCoverScale(frame, source);
        const currentScale = obj.scaleX || 1;
        const zoom = Math.max(0.05, currentScale / coverScale);
        const updated = {
            scale: Number.isFinite(zoom) ? zoom : 1,
            angle: 0,
            left: 0.5,
            top: 0.5,
        };
        const index = this.items.findIndex((item) => item.id === id);
        if (index < 0)
            return;
        const next = [...this.items];
        next[index] = this.normalizeItem({ ...next[index], ...updated });
        this.updateConfig(next);
        this.workingItems = this.cloneItems(next);
        this.hasWorkingChanges = false;
        this.isImageSelectionActive = true;
        this.focusedImageId = id;
        this.updateImages();
    }
    focusImageSelection(id) {
        if (!this.canvasService)
            return;
        const obj = this.getImageObject(id);
        if (!obj)
            return;
        this.isImageSelectionActive = true;
        this.focusedImageId = id;
        this.suppressSelectionClearUntil = Date.now() + 700;
        obj.set({
            selectable: true,
            evented: true,
            hasControls: true,
            hasBorders: true,
        });
        this.canvasService.canvas.setActiveObject(obj);
        this.debug("focus:image", { id });
        this.canvasService.requestRenderAll();
        this.updateImages();
    }
    async fitImageToArea(id, area) {
        if (!this.canvasService)
            return;
        const loaded = await this.waitImageLoaded(id, false);
        if (!loaded)
            return;
        const obj = this.getImageObject(id);
        if (!obj)
            return;
        const renderItems = this.isToolActive ? this.workingItems : this.items;
        const current = renderItems.find((item) => item.id === id);
        if (!current)
            return;
        const render = this.resolveRenderImageState(current);
        this.rememberSourceSize(render.src, obj);
        const source = this.getSourceSize(render.src, obj);
        const frame = this.getFrameRect();
        const baseCover = this.getCoverScale(frame, source);
        const desiredScale = Math.max(Math.max(1, area.width) / Math.max(1, source.width), Math.max(1, area.height) / Math.max(1, source.height));
        const canvasW = this.canvasService.canvas.width || 1;
        const canvasH = this.canvasService.canvas.height || 1;
        const areaLeftInput = area.left ?? 0.5;
        const areaTopInput = area.top ?? 0.5;
        const areaLeftPx = areaLeftInput <= 1.5 ? areaLeftInput * canvasW : areaLeftInput;
        const areaTopPx = areaTopInput <= 1.5 ? areaTopInput * canvasH : areaTopInput;
        const updates = {
            scale: Math.max(0.05, desiredScale / baseCover),
            left: this.clampNormalized((areaLeftPx - frame.left) / Math.max(1, frame.width)),
            top: this.clampNormalized((areaTopPx - frame.top) / Math.max(1, frame.height)),
        };
        if (this.isToolActive) {
            this.updateImageInWorking(id, updates);
            return;
        }
        await this.updateImageInConfig(id, updates);
    }
    async commitWorkingImagesAsCropped() {
        if (!this.canvasService) {
            return { ok: false, reason: "canvas-not-ready" };
        }
        await this.updateImagesAsync();
        const frame = this.getFrameRect();
        if (!frame.width || !frame.height) {
            return { ok: false, reason: "frame-not-ready" };
        }
        const focusId = this.resolveReplaceTargetId(this.focusedImageId) ||
            (this.workingItems.length === 1 ? this.workingItems[0].id : null);
        const next = [];
        for (const item of this.workingItems) {
            const url = await this.exportCroppedImageByIds([item.id], {
                multiplier: 2,
                format: "png",
            });
            const sourceUrl = item.sourceUrl || item.url;
            const previousCommitted = item.committedUrl;
            next.push(this.normalizeItem({
                ...item,
                url,
                sourceUrl,
                committedUrl: url,
            }));
            if (previousCommitted && previousCommitted !== url) {
                this.sourceSizeBySrc.delete(previousCommitted);
            }
        }
        this.hasWorkingChanges = false;
        this.workingItems = this.cloneItems(next);
        this.updateConfig(next);
        if (focusId) {
            this.focusedImageId = focusId;
            this.isImageSelectionActive = true;
            this.suppressSelectionClearUntil = Date.now() + IMAGE_REPLACE_GUARD_MS;
            this.focusImageSelection(focusId);
        }
        return { ok: true };
    }
    async exportCroppedImageByIds(imageIds, options) {
        if (!this.canvasService) {
            throw new Error("CanvasService not initialized");
        }
        const frame = this.getFrameRect();
        const multiplier = Math.max(1, options.multiplier ?? 2);
        const format = options.format ?? "png";
        const width = Math.max(1, Math.round(frame.width * multiplier));
        const height = Math.max(1, Math.round(frame.height * multiplier));
        const el = document.createElement("canvas");
        const tempCanvas = new fabric_1.Canvas(el, {
            renderOnAddRemove: false,
            selection: false,
            enableRetinaScaling: false,
            preserveObjectStacking: true,
        });
        tempCanvas.setDimensions({ width, height });
        const idSet = new Set(imageIds);
        const sourceObjects = this.canvasService.canvas
            .getObjects()
            .filter((obj) => {
            return (obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID &&
                typeof obj?.data?.id === "string" &&
                idSet.has(obj.data.id));
        });
        for (const source of sourceObjects) {
            const clone = await source.clone();
            const center = source.getCenterPoint
                ? source.getCenterPoint()
                : new fabric_1.Point(source.left ?? 0, source.top ?? 0);
            clone.set({
                originX: "center",
                originY: "center",
                left: (center.x - frame.left) * multiplier,
                top: (center.y - frame.top) * multiplier,
                scaleX: (source.scaleX || 1) * multiplier,
                scaleY: (source.scaleY || 1) * multiplier,
                angle: source.angle || 0,
                selectable: false,
                evented: false,
            });
            clone.setCoords();
            tempCanvas.add(clone);
        }
        tempCanvas.renderAll();
        const dataUrl = tempCanvas.toDataURL({ format, multiplier: 1 });
        tempCanvas.dispose();
        const blob = await (await fetch(dataUrl)).blob();
        return URL.createObjectURL(blob);
    }
    async exportImageFrameUrl(options = {}) {
        if (!this.canvasService) {
            throw new Error("CanvasService not initialized");
        }
        const imageIds = this.getImageObjects()
            .map((obj) => obj?.data?.id)
            .filter((id) => typeof id === "string");
        const url = await this.exportCroppedImageByIds(imageIds, options);
        return { url };
    }
}
exports.ImageTool = ImageTool;
