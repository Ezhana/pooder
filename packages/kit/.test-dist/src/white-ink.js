"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhiteInkTool = void 0;
const core_1 = require("@pooder/core");
const fabric_1 = require("fabric");
const sceneLayoutModel_1 = require("./sceneLayoutModel");
const WHITE_INK_OBJECT_LAYER_ID = "white-ink.user";
const IMAGE_OBJECT_LAYER_ID = "image.user";
const WHITE_INK_DEBUG_KEY = "whiteInk.debug";
const WHITE_INK_PREVIEW_IMAGE_VISIBLE_KEY = "whiteInk.previewImageVisible";
const WHITE_INK_DEFAULT_OPACITY = 0.85;
class WhiteInkTool {
    constructor() {
        this.id = "pooder.kit.white-ink";
        this.metadata = {
            name: "WhiteInkTool",
        };
        this.items = [];
        this.workingItems = [];
        this.hasWorkingChanges = false;
        this.sourceSizeBySrc = new Map();
        this.previewMaskBySource = new Map();
        this.pendingPreviewMaskBySource = new Map();
        this.isUpdatingConfig = false;
        this.isToolActive = false;
        this.printWithWhiteInk = true;
        this.previewImageVisible = true;
        this.renderSeq = 0;
        this.onToolActivated = (event) => {
            const before = this.isToolActive;
            this.syncToolActiveFromWorkbench(event.id);
            this.debug("tool:activated", {
                id: event.id,
                previous: event.previous,
                before,
                isToolActive: this.isToolActive,
            });
            this.updateWhiteInks();
        };
        this.onSceneLayoutChanged = () => {
            this.updateWhiteInks();
        };
        this.onObjectAdded = () => {
            this.applyImagePreviewVisibility(this.isPreviewActive());
        };
    }
    activate(context) {
        this.context = context;
        this.canvasService = context.services.get("CanvasService");
        if (!this.canvasService) {
            console.warn("CanvasService not found for WhiteInkTool");
            return;
        }
        context.eventBus.on("tool:activated", this.onToolActivated);
        context.eventBus.on("scene:layout:change", this.onSceneLayoutChanged);
        context.eventBus.on("object:added", this.onObjectAdded);
        const configService = context.services.get("ConfigurationService");
        if (configService) {
            this.items = this.normalizeItems(configService.get("whiteInk.items", []) || []);
            this.workingItems = this.cloneItems(this.items);
            this.hasWorkingChanges = false;
            this.printWithWhiteInk = !!configService.get("whiteInk.printWithWhiteInk", true);
            this.previewImageVisible = !!configService.get(WHITE_INK_PREVIEW_IMAGE_VISIBLE_KEY, true);
            this.migrateLegacyConfigIfNeeded(configService);
            configService.onAnyChange((e) => {
                if (this.isUpdatingConfig)
                    return;
                if (e.key === "whiteInk.items") {
                    this.items = this.normalizeItems(e.value || []);
                    if (!this.isToolActive || !this.hasWorkingChanges) {
                        this.workingItems = this.cloneItems(this.items);
                        this.hasWorkingChanges = false;
                    }
                    this.updateWhiteInks();
                    return;
                }
                if (e.key === "whiteInk.printWithWhiteInk") {
                    this.printWithWhiteInk = !!e.value;
                    this.updateWhiteInks();
                    return;
                }
                if (e.key === WHITE_INK_PREVIEW_IMAGE_VISIBLE_KEY) {
                    this.previewImageVisible = !!e.value;
                    this.updateWhiteInks();
                    return;
                }
                if (e.key === WHITE_INK_DEBUG_KEY) {
                    return;
                }
                if (e.key.startsWith("size.")) {
                    this.updateWhiteInks();
                }
            });
        }
        const toolSessionService = context.services.get("ToolSessionService");
        this.dirtyTrackerDisposable = toolSessionService?.registerDirtyTracker(this.id, () => this.hasWorkingChanges);
        this.updateWhiteInks();
    }
    deactivate(context) {
        context.eventBus.off("tool:activated", this.onToolActivated);
        context.eventBus.off("scene:layout:change", this.onSceneLayoutChanged);
        context.eventBus.off("object:added", this.onObjectAdded);
        this.dirtyTrackerDisposable?.dispose();
        this.dirtyTrackerDisposable = undefined;
        this.clearRenderedWhiteInks();
        this.applyImagePreviewVisibility(false);
        this.canvasService = undefined;
        this.context = undefined;
    }
    contribute() {
        return {
            [core_1.ContributionPointIds.TOOLS]: [
                {
                    id: this.id,
                    name: "White Ink",
                    interaction: "session",
                    commands: {
                        begin: "resetWorkingWhiteInks",
                        commit: "completeWhiteInks",
                        rollback: "resetWorkingWhiteInks",
                    },
                    session: {
                        autoBegin: true,
                        leavePolicy: "block",
                    },
                },
            ],
            [core_1.ContributionPointIds.CONFIGURATIONS]: [
                {
                    id: "whiteInk.items",
                    type: "array",
                    label: "White Ink Images",
                    default: [],
                },
                {
                    id: "whiteInk.printWithWhiteInk",
                    type: "boolean",
                    label: "Preview White Ink",
                    default: true,
                },
                {
                    id: WHITE_INK_PREVIEW_IMAGE_VISIBLE_KEY,
                    type: "boolean",
                    label: "Show Image During White Ink Preview",
                    default: true,
                },
                {
                    id: WHITE_INK_DEBUG_KEY,
                    type: "boolean",
                    label: "White Ink Debug Log",
                    default: false,
                },
            ],
            [core_1.ContributionPointIds.COMMANDS]: [
                {
                    command: "addWhiteInk",
                    title: "Add White Ink",
                    handler: async (url, options) => {
                        return await this.addWhiteInkEntry(url, options);
                    },
                },
                {
                    command: "upsertWhiteInk",
                    title: "Upsert White Ink",
                    handler: async (url, options = {}) => {
                        return await this.upsertWhiteInkEntry(url, options);
                    },
                },
                {
                    command: "getWhiteInks",
                    title: "Get White Inks",
                    handler: () => this.cloneItems(this.items),
                },
                {
                    command: "getWhiteInkSettings",
                    title: "Get White Ink Settings",
                    handler: () => {
                        const first = this.items[0] || null;
                        const sourceUrl = this.resolveSourceUrl(first);
                        return {
                            id: first?.id || null,
                            url: sourceUrl,
                            sourceUrl,
                            opacity: first?.opacity ?? WHITE_INK_DEFAULT_OPACITY,
                            printWithWhiteInk: this.printWithWhiteInk,
                            previewImageVisible: this.previewImageVisible,
                        };
                    },
                },
                {
                    command: "setWhiteInkPrintEnabled",
                    title: "Set White Ink Preview Enabled",
                    handler: (enabled) => {
                        this.printWithWhiteInk = !!enabled;
                        const configService = this.context?.services.get("ConfigurationService");
                        configService?.update("whiteInk.printWithWhiteInk", this.printWithWhiteInk);
                        this.updateWhiteInks();
                        return { ok: true };
                    },
                },
                {
                    command: "setWhiteInkPreviewImageVisible",
                    title: "Set White Ink Preview Image Visible",
                    handler: (visible) => {
                        this.previewImageVisible = !!visible;
                        const configService = this.context?.services.get("ConfigurationService");
                        configService?.update(WHITE_INK_PREVIEW_IMAGE_VISIBLE_KEY, this.previewImageVisible);
                        this.updateWhiteInks();
                        return { ok: true };
                    },
                },
                {
                    command: "setWhiteInkOpacity",
                    title: "Set White Ink Opacity",
                    handler: async (opacity) => {
                        const targetId = this.resolveReplaceTargetId(null);
                        if (!targetId) {
                            return { ok: false, reason: "no-white-ink-item" };
                        }
                        const nextOpacity = this.clampOpacity(opacity);
                        await this.updateWhiteInkItem(targetId, { opacity: nextOpacity }, { target: "config" });
                        return { ok: true, id: targetId, opacity: nextOpacity };
                    },
                },
                {
                    command: "getWorkingWhiteInks",
                    title: "Get Working White Inks",
                    handler: () => this.cloneItems(this.workingItems),
                },
                {
                    command: "setWorkingWhiteInk",
                    title: "Set Working White Ink",
                    handler: (id, updates) => {
                        this.updateWhiteInkInWorking(id, updates);
                    },
                },
                {
                    command: "updateWhiteInk",
                    title: "Update White Ink",
                    handler: async (id, updates, options = {}) => {
                        await this.updateWhiteInkItem(id, updates, options);
                    },
                },
                {
                    command: "removeWhiteInk",
                    title: "Remove White Ink",
                    handler: (id) => {
                        this.removeWhiteInk(id);
                    },
                },
                {
                    command: "clearWhiteInks",
                    title: "Clear White Inks",
                    handler: () => {
                        this.clearWhiteInks();
                    },
                },
                {
                    command: "resetWorkingWhiteInks",
                    title: "Reset Working White Inks",
                    handler: () => {
                        this.workingItems = this.cloneItems(this.items);
                        this.hasWorkingChanges = false;
                        this.updateWhiteInks();
                    },
                },
                {
                    command: "completeWhiteInks",
                    title: "Complete White Inks",
                    handler: async () => {
                        return await this.completeWhiteInks();
                    },
                },
                {
                    command: "setWhiteInkImage",
                    title: "Set White Ink Image",
                    handler: async (url, opacity) => {
                        if (!url) {
                            this.clearWhiteInks();
                            return { ok: true };
                        }
                        const resolvedOpacity = Number.isFinite(opacity)
                            ? this.clampOpacity(Number(opacity))
                            : WHITE_INK_DEFAULT_OPACITY;
                        const targetId = this.resolveReplaceTargetId(null);
                        const upsertResult = await this.upsertWhiteInkEntry(url, {
                            id: targetId || undefined,
                            mode: targetId ? "replace" : "add",
                            createIfMissing: true,
                            addOptions: {
                                opacity: resolvedOpacity,
                            },
                        });
                        await this.updateWhiteInkItem(upsertResult.id, { opacity: resolvedOpacity }, { target: "config" });
                        return { ok: true, id: upsertResult.id };
                    },
                },
            ],
        };
    }
    migrateLegacyConfigIfNeeded(configService) {
        if (this.items.length > 0)
            return;
        const legacyMask = configService.get("whiteInk.customMask", "");
        if (typeof legacyMask !== "string" || legacyMask.length === 0)
            return;
        const legacyOpacityRaw = configService.get("whiteInk.opacity", WHITE_INK_DEFAULT_OPACITY);
        const legacyOpacity = Number(legacyOpacityRaw);
        const item = this.normalizeItem({
            id: this.generateId(),
            sourceUrl: legacyMask,
            opacity: Number.isFinite(legacyOpacity)
                ? legacyOpacity
                : WHITE_INK_DEFAULT_OPACITY,
        });
        this.items = [item];
        this.workingItems = this.cloneItems(this.items);
        this.isUpdatingConfig = true;
        configService.update("whiteInk.items", this.items);
        setTimeout(() => {
            this.isUpdatingConfig = false;
        }, 0);
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
    isPreviewActive() {
        return this.isToolActive && this.printWithWhiteInk;
    }
    isDebugEnabled() {
        return !!this.getConfig(WHITE_INK_DEBUG_KEY, false);
    }
    debug(message, payload) {
        if (!this.isDebugEnabled())
            return;
        if (payload === undefined) {
            console.log(`[WhiteInkTool] ${message}`);
            return;
        }
        console.log(`[WhiteInkTool] ${message}`, payload);
    }
    resolveSourceUrl(item) {
        if (!item)
            return "";
        if (typeof item.sourceUrl === "string" && item.sourceUrl.length > 0) {
            return item.sourceUrl;
        }
        if (typeof item.url === "string" && item.url.length > 0) {
            return item.url;
        }
        return "";
    }
    clampOpacity(value) {
        if (!Number.isFinite(value))
            return WHITE_INK_DEFAULT_OPACITY;
        return Math.max(0, Math.min(1, Number(value)));
    }
    normalizeItem(item) {
        const sourceUrl = this.resolveSourceUrl(item);
        return {
            id: String(item.id || this.generateId()),
            sourceUrl,
            url: sourceUrl,
            opacity: this.clampOpacity(item.opacity),
        };
    }
    normalizeItems(items) {
        return (items || [])
            .map((item) => this.normalizeItem(item))
            .filter((item) => !!this.resolveSourceUrl(item));
    }
    cloneItems(items) {
        return this.normalizeItems((items || []).map((item) => ({ ...item })));
    }
    generateId() {
        return `white-ink-${Math.random().toString(36).slice(2, 9)}`;
    }
    getConfig(key, fallback) {
        if (!this.context)
            return fallback;
        const configService = this.context.services.get("ConfigurationService");
        if (!configService)
            return fallback;
        return configService.get(key, fallback) ?? fallback;
    }
    resolveReplaceTargetId(explicitId) {
        const has = (id) => !!id && this.items.some((item) => item.id === id);
        if (has(explicitId))
            return explicitId;
        if (this.items.length >= 1) {
            return this.items[0].id;
        }
        return null;
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
        configService?.update("whiteInk.items", this.items);
        if (!skipCanvasUpdate) {
            this.updateWhiteInks();
        }
        setTimeout(() => {
            this.isUpdatingConfig = false;
        }, 50);
    }
    async addWhiteInkEntry(url, options) {
        const id = this.generateId();
        const item = this.normalizeItem({
            id,
            sourceUrl: url,
            opacity: WHITE_INK_DEFAULT_OPACITY,
            ...options,
        });
        const sessionDirtyBeforeAdd = this.isToolActive && this.hasWorkingChanges;
        this.updateConfig([...this.items, item]);
        this.addItemToWorkingSessionIfNeeded(item, sessionDirtyBeforeAdd);
        return id;
    }
    async upsertWhiteInkEntry(url, options = {}) {
        const mode = options.mode || "auto";
        if (mode === "add") {
            const id = await this.addWhiteInkEntry(url, options.addOptions);
            return { id, mode: "add" };
        }
        const targetId = this.resolveReplaceTargetId(options.id ?? null);
        if (targetId) {
            this.updateWhiteInkInConfig(targetId, {
                ...(options.addOptions || {}),
                sourceUrl: url,
                url,
            });
            return { id: targetId, mode: "replace" };
        }
        if (mode === "replace" || options.createIfMissing === false) {
            throw new Error("replace-target-not-found");
        }
        const id = await this.addWhiteInkEntry(url, options.addOptions);
        return { id, mode: "add" };
    }
    addItemToWorkingSessionIfNeeded(item, sessionDirtyBeforeAdd) {
        if (!sessionDirtyBeforeAdd || !this.isToolActive)
            return;
        if (this.workingItems.some((existing) => existing.id === item.id))
            return;
        this.workingItems = this.cloneItems([...this.workingItems, item]);
        this.updateWhiteInks();
    }
    async updateWhiteInkItem(id, updates, options = {}) {
        this.syncToolActiveFromWorkbench();
        const target = options.target || "auto";
        if (target === "working" || (target === "auto" && this.isToolActive)) {
            this.updateWhiteInkInWorking(id, updates);
            return;
        }
        this.updateWhiteInkInConfig(id, updates);
    }
    updateWhiteInkInWorking(id, updates) {
        let changed = false;
        const next = this.workingItems.map((item) => {
            if (item.id !== id)
                return item;
            changed = true;
            return this.normalizeItem({
                ...item,
                ...updates,
            });
        });
        if (!changed)
            return;
        this.workingItems = this.cloneItems(next);
        this.hasWorkingChanges = true;
        this.updateWhiteInks();
    }
    updateWhiteInkInConfig(id, updates) {
        let changed = false;
        const next = this.items.map((item) => {
            if (item.id !== id)
                return item;
            changed = true;
            const merged = this.normalizeItem({
                ...item,
                ...updates,
            });
            if (this.resolveSourceUrl(item) !== this.resolveSourceUrl(merged)) {
                this.purgeSourceCaches(item);
            }
            return merged;
        });
        if (!changed)
            return;
        this.updateConfig(next);
    }
    removeWhiteInk(id) {
        const removed = this.items.find((item) => item.id === id);
        const next = this.items.filter((item) => item.id !== id);
        if (next.length === this.items.length)
            return;
        this.purgeSourceCaches(removed);
        this.updateConfig(next);
    }
    clearWhiteInks() {
        this.sourceSizeBySrc.clear();
        this.previewMaskBySource.clear();
        this.pendingPreviewMaskBySource.clear();
        this.updateConfig([]);
    }
    async completeWhiteInks() {
        this.updateConfig(this.cloneItems(this.workingItems));
        this.hasWorkingChanges = false;
        return { ok: true };
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
    getWhiteInkObjects() {
        if (!this.canvasService)
            return [];
        return this.canvasService.canvas.getObjects().filter((obj) => {
            return obj?.data?.layerId === WHITE_INK_OBJECT_LAYER_ID;
        });
    }
    getWhiteInkObject(id) {
        return this.getWhiteInkObjects().find((obj) => obj?.data?.id === id);
    }
    clearRenderedWhiteInks() {
        if (!this.canvasService)
            return;
        const canvas = this.canvasService.canvas;
        this.getWhiteInkObjects().forEach((obj) => canvas.remove(obj));
        this.canvasService.requestRenderAll();
    }
    purgeSourceCaches(item) {
        const sourceUrl = this.resolveSourceUrl(item);
        if (!sourceUrl)
            return;
        this.sourceSizeBySrc.delete(sourceUrl);
        this.previewMaskBySource.delete(sourceUrl);
        this.pendingPreviewMaskBySource.delete(sourceUrl);
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
    resolveRenderState(item, src) {
        return {
            src,
            opacity: this.clampOpacity(item.opacity),
        };
    }
    computeCanvasProps(render, size, frame) {
        const centerX = frame.left + frame.width / 2;
        const centerY = frame.top + frame.height / 2;
        const scale = this.getCoverScale(frame, size);
        return {
            left: centerX,
            top: centerY,
            scaleX: scale,
            scaleY: scale,
            angle: 0,
            originX: "center",
            originY: "center",
            uniformScaling: true,
            lockScalingFlip: true,
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
            opacity: render.opacity,
            excludeFromExport: true,
        };
    }
    getCurrentSrc(obj) {
        if (!obj)
            return undefined;
        if (typeof obj.getSrc === "function")
            return obj.getSrc();
        return obj?._originalElement?.src;
    }
    async upsertWhiteInkObject(item, frame, seq) {
        if (!this.canvasService)
            return;
        const canvas = this.canvasService.canvas;
        const sourceUrl = this.resolveSourceUrl(item);
        if (!sourceUrl)
            return;
        const previewSrc = await this.getPreviewMaskSource(sourceUrl);
        if (seq !== this.renderSeq)
            return;
        const render = this.resolveRenderState(item, previewSrc);
        if (!render.src)
            return;
        let obj = this.getWhiteInkObject(item.id);
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
                excludeFromExport: true,
                data: {
                    id: item.id,
                    layerId: WHITE_INK_OBJECT_LAYER_ID,
                    type: "white-ink-item",
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
                layerId: WHITE_INK_OBJECT_LAYER_ID,
                type: "white-ink-item",
            },
        });
        obj.setCoords();
    }
    syncZOrder(items) {
        if (!this.canvasService)
            return;
        const canvas = this.canvasService.canvas;
        const objects = canvas.getObjects();
        let insertIndex = 0;
        const imageIndexes = objects
            .map((obj, index) => obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID ? index : -1)
            .filter((index) => index >= 0);
        if (imageIndexes.length > 0) {
            insertIndex = Math.min(...imageIndexes);
        }
        else {
            const backgroundLayer = this.canvasService.getLayer("background");
            if (backgroundLayer) {
                const bgIndex = objects.indexOf(backgroundLayer);
                if (bgIndex >= 0)
                    insertIndex = bgIndex + 1;
            }
        }
        items.forEach((item) => {
            const obj = this.getWhiteInkObject(item.id);
            if (!obj)
                return;
            canvas.moveObjectTo(obj, insertIndex);
            insertIndex += 1;
        });
        canvas
            .getObjects()
            .filter((obj) => obj?.data?.layerId === "image-overlay")
            .forEach((obj) => canvas.bringObjectToFront(obj));
        const dielineOverlay = this.canvasService.getLayer("dieline-overlay");
        if (dielineOverlay) {
            canvas.bringObjectToFront(dielineOverlay);
        }
    }
    applyImagePreviewVisibility(previewActive) {
        if (!this.canvasService)
            return;
        const visible = previewActive ? this.previewImageVisible : true;
        let changed = false;
        this.canvasService.canvas.getObjects().forEach((obj) => {
            if (obj?.data?.layerId !== IMAGE_OBJECT_LAYER_ID)
                return;
            if (obj.visible === visible)
                return;
            obj.set({ visible });
            obj.setCoords?.();
            changed = true;
        });
        if (changed) {
            this.canvasService.requestRenderAll();
        }
    }
    updateWhiteInks() {
        void this.updateWhiteInksAsync();
    }
    async updateWhiteInksAsync() {
        if (!this.canvasService)
            return;
        this.syncToolActiveFromWorkbench();
        const seq = ++this.renderSeq;
        const previewActive = this.isPreviewActive();
        this.applyImagePreviewVisibility(previewActive);
        const renderItems = previewActive ? this.workingItems : [];
        const frame = this.getFrameRect();
        const desiredIds = new Set(renderItems.map((item) => item.id));
        this.getWhiteInkObjects().forEach((obj) => {
            const id = obj?.data?.id;
            if (typeof id === "string" && !desiredIds.has(id)) {
                this.canvasService?.canvas.remove(obj);
            }
        });
        for (const item of renderItems) {
            if (seq !== this.renderSeq)
                return;
            await this.upsertWhiteInkObject(item, frame, seq);
        }
        if (seq !== this.renderSeq)
            return;
        this.syncZOrder(renderItems);
        this.canvasService.requestRenderAll();
    }
    async getPreviewMaskSource(sourceUrl) {
        if (!sourceUrl)
            return "";
        if (typeof document === "undefined" || typeof Image === "undefined") {
            return sourceUrl;
        }
        const cached = this.previewMaskBySource.get(sourceUrl);
        if (cached)
            return cached;
        const pending = this.pendingPreviewMaskBySource.get(sourceUrl);
        if (pending) {
            const loaded = await pending;
            return loaded || sourceUrl;
        }
        const task = this.createOpaqueMaskSource(sourceUrl);
        this.pendingPreviewMaskBySource.set(sourceUrl, task);
        const loaded = await task;
        this.pendingPreviewMaskBySource.delete(sourceUrl);
        if (!loaded)
            return sourceUrl;
        this.previewMaskBySource.set(sourceUrl, loaded);
        return loaded;
    }
    async createOpaqueMaskSource(sourceUrl) {
        try {
            const img = await this.loadImageElement(sourceUrl);
            const width = Math.max(1, Number(img.naturalWidth || img.width || 0));
            const height = Math.max(1, Number(img.naturalHeight || img.height || 0));
            if (width <= 0 || height <= 0)
                return null;
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx)
                return null;
            ctx.drawImage(img, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const alpha = data[i + 3];
                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
                data[i + 3] = alpha;
            }
            ctx.putImageData(imageData, 0, 0);
            return canvas.toDataURL("image/png");
        }
        catch (error) {
            this.debug("mask:extract:failed", { sourceUrl, error });
            return null;
        }
    }
    loadImageElement(sourceUrl) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("white-ink-image-load-failed"));
            image.src = sourceUrl;
        });
    }
}
exports.WhiteInkTool = WhiteInkTool;
