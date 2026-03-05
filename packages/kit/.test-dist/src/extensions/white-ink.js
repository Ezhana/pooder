"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhiteInkTool = void 0;
const core_1 = require("@pooder/core");
const sceneLayoutModel_1 = require("./sceneLayoutModel");
const WHITE_INK_OBJECT_LAYER_ID = "white-ink.user";
const WHITE_INK_COVER_LAYER_ID = "white-ink.cover";
const WHITE_INK_OVERLAY_LAYER_ID = "white-ink.overlay";
const IMAGE_OBJECT_LAYER_ID = "image.user";
const IMAGE_OVERLAY_LAYER_ID = "image-overlay";
const WHITE_INK_DEBUG_KEY = "whiteInk.debug";
const WHITE_INK_PREVIEW_IMAGE_VISIBLE_KEY = "whiteInk.previewImageVisible";
const WHITE_INK_DEFAULT_OPACITY = 0.85;
const WHITE_INK_AUTO_ITEM_ID = "white-ink-auto";
const WHITE_INK_COVER_OPACITY_FACTOR = 0.45;
const WHITE_INK_COVER_OPACITY_MIN = 0.15;
const WHITE_INK_COVER_OPACITY_MAX = 0.65;
const WHITE_MASK_TINT = { r: 255, g: 255, b: 255, key: "white" };
const COVER_MASK_TINT = { r: 52, g: 136, b: 255, key: "blue" };
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
        this.onObjectAdded = (e) => {
            const layerId = e?.target?.data?.layerId;
            if (layerId !== IMAGE_OBJECT_LAYER_ID)
                return;
            this.updateWhiteInks();
        };
        this.onObjectModified = (e) => {
            const layerId = e?.target?.data?.layerId;
            if (layerId !== IMAGE_OBJECT_LAYER_ID)
                return;
            this.updateWhiteInks();
        };
        this.onObjectRemoved = (e) => {
            const layerId = e?.target?.data?.layerId;
            if (layerId !== IMAGE_OBJECT_LAYER_ID)
                return;
            this.updateWhiteInks();
        };
        this.onImageWorkingChanged = () => {
            this.updateWhiteInks();
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
        context.eventBus.on("object:modified", this.onObjectModified);
        context.eventBus.on("object:removed", this.onObjectRemoved);
        context.eventBus.on("image:working:change", this.onImageWorkingChanged);
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
                if (e.key === "image.items") {
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
        context.eventBus.off("object:modified", this.onObjectModified);
        context.eventBus.off("object:removed", this.onObjectRemoved);
        context.eventBus.off("image:working:change", this.onImageWorkingChanged);
        this.dirtyTrackerDisposable?.dispose();
        this.dirtyTrackerDisposable = undefined;
        this.clearRenderedWhiteInks();
        this.applyImageVisibilityForWhiteInk(false);
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
                    label: "Show Cover During White Ink Preview",
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
                        const first = this.getEffectiveWhiteInkItem(this.items);
                        const primarySource = this.getPrimaryImageSource();
                        const sourceUrl = this.resolveSourceUrl(first) || primarySource;
                        return {
                            id: first?.id || null,
                            url: sourceUrl,
                            sourceUrl,
                            opacity: WHITE_INK_DEFAULT_OPACITY,
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
                    title: "Set White Ink Cover Visible",
                    handler: (visible) => {
                        this.previewImageVisible = !!visible;
                        const configService = this.context?.services.get("ConfigurationService");
                        configService?.update(WHITE_INK_PREVIEW_IMAGE_VISIBLE_KEY, this.previewImageVisible);
                        this.updateWhiteInks();
                        return { ok: true };
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
                    handler: async (url) => {
                        if (!url) {
                            this.clearWhiteInks();
                            return { ok: true };
                        }
                        const targetId = this.resolveReplaceTargetId(null);
                        const upsertResult = await this.upsertWhiteInkEntry(url, {
                            id: targetId || undefined,
                            mode: targetId ? "replace" : "add",
                            createIfMissing: true,
                            addOptions: {},
                        });
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
        const item = this.normalizeItem({
            id: this.generateId(),
            sourceUrl: legacyMask,
            opacity: WHITE_INK_DEFAULT_OPACITY,
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
    normalizeItem(item) {
        const sourceUrl = this.resolveSourceUrl(item);
        return {
            id: String(item.id || this.generateId()),
            sourceUrl,
            url: sourceUrl,
            opacity: WHITE_INK_DEFAULT_OPACITY,
        };
    }
    normalizeItems(items) {
        return (items || [])
            .map((item) => this.normalizeItem(item))
            .filter((item) => !!item.id);
    }
    cloneItems(items) {
        return this.normalizeItems((items || []).map((item) => ({ ...item })));
    }
    getEffectiveWhiteInkItem(items) {
        const normalized = this.cloneItems(items || []);
        if (normalized.length > 0) {
            return normalized[0];
        }
        if (!this.getPrimaryImageSource()) {
            return null;
        }
        return {
            id: WHITE_INK_AUTO_ITEM_ID,
            opacity: WHITE_INK_DEFAULT_OPACITY,
        };
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
    getImageObjects() {
        if (!this.canvasService)
            return [];
        return this.canvasService.canvas.getObjects().filter((obj) => {
            return obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID;
        });
    }
    getPrimaryImageObject() {
        return this.getImageObjects()[0];
    }
    getPrimaryImageSource() {
        return this.getCurrentSrc(this.getPrimaryImageObject()) || "";
    }
    getCurrentSrc(obj) {
        if (!obj)
            return undefined;
        if (typeof obj.getSrc === "function")
            return obj.getSrc();
        return obj?._originalElement?.src;
    }
    getImageSnapshot(obj) {
        if (!obj)
            return null;
        const src = this.getCurrentSrc(obj);
        if (!src)
            return null;
        const element = this.getImageElementFromObject(obj);
        const width = Number(obj?.width || 0);
        const height = Number(obj?.height || 0);
        this.rememberSourceSize(src, { width, height });
        return {
            id: String(obj?.data?.id || "image"),
            src,
            element,
            left: Number.isFinite(obj?.left) ? Number(obj.left) : 0,
            top: Number.isFinite(obj?.top) ? Number(obj.top) : 0,
            scaleX: Number.isFinite(obj?.scaleX) ? Number(obj.scaleX) : 1,
            scaleY: Number.isFinite(obj?.scaleY) ? Number(obj.scaleY) : 1,
            angle: Number.isFinite(obj?.angle) ? Number(obj.angle) : 0,
            originX: typeof obj?.originX === "string" ? obj.originX : "center",
            originY: typeof obj?.originY === "string" ? obj.originY : "center",
            flipX: !!obj?.flipX,
            flipY: !!obj?.flipY,
            skewX: Number.isFinite(obj?.skewX) ? Number(obj.skewX) : 0,
            skewY: Number.isFinite(obj?.skewY) ? Number(obj.skewY) : 0,
            width,
            height,
        };
    }
    getImagePlacementState(id) {
        const rawItems = this.getConfig("image.items", []);
        if (!Array.isArray(rawItems) || rawItems.length === 0)
            return null;
        const matched = (id
            ? rawItems.find((item) => item &&
                typeof item === "object" &&
                typeof item.id === "string" &&
                item.id === id)
            : undefined) || rawItems[0];
        if (!matched || typeof matched !== "object")
            return null;
        const sourceUrl = typeof matched.sourceUrl === "string" && matched.sourceUrl.length > 0
            ? matched.sourceUrl
            : typeof matched.url === "string"
                ? matched.url
                : "";
        const committedUrl = typeof matched.committedUrl === "string" ? matched.committedUrl : "";
        return {
            id: typeof matched.id === "string" && matched.id.length > 0
                ? matched.id
                : id || "image",
            sourceUrl,
            committedUrl,
            left: Number.isFinite(matched.left) ? Number(matched.left) : 0.5,
            top: Number.isFinite(matched.top) ? Number(matched.top) : 0.5,
            scale: Number.isFinite(matched.scale) ? Math.max(0.05, matched.scale) : 1,
            angle: Number.isFinite(matched.angle) ? matched.angle : 0,
        };
    }
    shouldRestoreSnapshotToSource(snapshot, placement) {
        if (!placement.sourceUrl || !placement.committedUrl)
            return false;
        if (placement.sourceUrl === placement.committedUrl)
            return false;
        return snapshot.src === placement.committedUrl;
    }
    getCoverScale(frame, source) {
        const frameW = Math.max(1, frame.width);
        const frameH = Math.max(1, frame.height);
        const sourceW = Math.max(1, source.width);
        const sourceH = Math.max(1, source.height);
        return Math.max(frameW / sourceW, frameH / sourceH);
    }
    async ensureSourceSize(sourceUrl) {
        if (!sourceUrl)
            return null;
        const cached = this.getSourceSize(sourceUrl);
        if (cached)
            return cached;
        try {
            const image = await this.loadImageElement(sourceUrl);
            const size = this.getElementSize(image);
            if (!size)
                return null;
            this.rememberSourceSize(sourceUrl, size);
            return {
                width: size.width,
                height: size.height,
            };
        }
        catch {
            return null;
        }
    }
    async resolveAlignedImageSnapshot(snapshot) {
        const placement = this.getImagePlacementState(snapshot.id);
        if (!placement)
            return snapshot;
        if (!this.shouldRestoreSnapshotToSource(snapshot, placement)) {
            return snapshot;
        }
        const frame = this.getFrameRect();
        if (frame.width <= 0 || frame.height <= 0) {
            return snapshot;
        }
        const sourceSize = await this.ensureSourceSize(placement.sourceUrl);
        if (!sourceSize)
            return snapshot;
        const coverScale = this.getCoverScale(frame, sourceSize);
        return {
            ...snapshot,
            src: placement.sourceUrl,
            element: undefined,
            left: frame.left + placement.left * frame.width,
            top: frame.top + placement.top * frame.height,
            scaleX: coverScale * placement.scale,
            scaleY: coverScale * placement.scale,
            angle: placement.angle,
            originX: "center",
            originY: "center",
            width: sourceSize.width,
            height: sourceSize.height,
        };
    }
    getImageElementFromObject(obj) {
        if (!obj)
            return null;
        if (typeof obj.getElement === "function") {
            return obj.getElement();
        }
        return obj?._element || obj?._originalElement || null;
    }
    rememberSourceSize(src, size) {
        if (!src)
            return;
        if (!Number.isFinite(size.width) || !Number.isFinite(size.height))
            return;
        if (size.width <= 0 || size.height <= 0)
            return;
        this.sourceSizeBySrc.set(src, {
            width: size.width,
            height: size.height,
        });
    }
    getSourceSize(src) {
        if (!src)
            return null;
        const cached = this.sourceSizeBySrc.get(src);
        if (!cached)
            return null;
        return {
            width: cached.width,
            height: cached.height,
        };
    }
    computeWhiteScaleAdjust(baseSource, whiteSource) {
        if (!baseSource || !whiteSource || baseSource === whiteSource) {
            return { x: 1, y: 1 };
        }
        const baseSize = this.getSourceSize(baseSource);
        const whiteSize = this.getSourceSize(whiteSource);
        if (!baseSize || !whiteSize) {
            return { x: 1, y: 1 };
        }
        if (whiteSize.width <= 0 || whiteSize.height <= 0) {
            return { x: 1, y: 1 };
        }
        return {
            x: baseSize.width / whiteSize.width,
            y: baseSize.height / whiteSize.height,
        };
    }
    computeCoverOpacity() {
        const raw = WHITE_INK_DEFAULT_OPACITY * WHITE_INK_COVER_OPACITY_FACTOR;
        return Math.max(WHITE_INK_COVER_OPACITY_MIN, Math.min(WHITE_INK_COVER_OPACITY_MAX, raw));
    }
    buildCloneImageSpec(id, snapshot, src, opacity, layerId, type, scaleAdjustX = 1, scaleAdjustY = 1) {
        return {
            id,
            type: "image",
            src,
            data: {
                id,
                layerId,
                type,
                imageId: snapshot.id,
            },
            props: {
                left: snapshot.left,
                top: snapshot.top,
                originX: snapshot.originX,
                originY: snapshot.originY,
                angle: snapshot.angle,
                scaleX: snapshot.scaleX * scaleAdjustX,
                scaleY: snapshot.scaleY * scaleAdjustY,
                flipX: snapshot.flipX,
                flipY: snapshot.flipY,
                skewX: snapshot.skewX,
                skewY: snapshot.skewY,
                selectable: false,
                evented: false,
                hasControls: false,
                hasBorders: false,
                uniformScaling: true,
                lockScalingFlip: true,
                opacity: Math.max(0, Math.min(1, Number(opacity))),
                excludeFromExport: true,
            },
        };
    }
    buildFrameSpecs(frame) {
        if (!this.isToolActive || !this.canvasService)
            return [];
        if (frame.width <= 0 || frame.height <= 0)
            return [];
        const canvasW = this.canvasService.canvas.width || 0;
        const canvasH = this.canvasService.canvas.height || 0;
        const strokeColor = this.getConfig("image.frame.strokeColor", "#808080") || "#808080";
        const strokeWidthRaw = Number(this.getConfig("image.frame.strokeWidth", 2) ?? 2);
        const dashLengthRaw = Number(this.getConfig("image.frame.dashLength", 8) ?? 8);
        const outerBackground = this.getConfig("image.frame.outerBackground", "#f5f5f5") ||
            "#f5f5f5";
        const innerBackground = this.getConfig("image.frame.innerBackground", "rgba(0,0,0,0)") ||
            "rgba(0,0,0,0)";
        const strokeWidth = Number.isFinite(strokeWidthRaw)
            ? Math.max(0, strokeWidthRaw)
            : 2;
        const dashLength = Number.isFinite(dashLengthRaw)
            ? Math.max(1, dashLengthRaw)
            : 8;
        const frameLeft = Math.max(0, Math.min(canvasW, frame.left));
        const frameTop = Math.max(0, Math.min(canvasH, frame.top));
        const frameRight = Math.max(frameLeft, Math.min(canvasW, frame.left + frame.width));
        const frameBottom = Math.max(frameTop, Math.min(canvasH, frame.top + frame.height));
        const visibleFrameH = Math.max(0, frameBottom - frameTop);
        const topH = frameTop;
        const bottomH = Math.max(0, canvasH - frameBottom);
        const leftW = frameLeft;
        const rightW = Math.max(0, canvasW - frameRight);
        const maskSpecs = [
            {
                id: "white-ink.cropMask.top",
                type: "rect",
                data: {
                    id: "white-ink.cropMask.top",
                    layerId: WHITE_INK_OVERLAY_LAYER_ID,
                    type: "white-ink-mask",
                },
                props: {
                    left: canvasW / 2,
                    top: topH / 2,
                    width: canvasW,
                    height: topH,
                    originX: "center",
                    originY: "center",
                    fill: outerBackground,
                    selectable: false,
                    evented: false,
                    excludeFromExport: true,
                },
            },
            {
                id: "white-ink.cropMask.bottom",
                type: "rect",
                data: {
                    id: "white-ink.cropMask.bottom",
                    layerId: WHITE_INK_OVERLAY_LAYER_ID,
                    type: "white-ink-mask",
                },
                props: {
                    left: canvasW / 2,
                    top: frameBottom + bottomH / 2,
                    width: canvasW,
                    height: bottomH,
                    originX: "center",
                    originY: "center",
                    fill: outerBackground,
                    selectable: false,
                    evented: false,
                    excludeFromExport: true,
                },
            },
            {
                id: "white-ink.cropMask.left",
                type: "rect",
                data: {
                    id: "white-ink.cropMask.left",
                    layerId: WHITE_INK_OVERLAY_LAYER_ID,
                    type: "white-ink-mask",
                },
                props: {
                    left: leftW / 2,
                    top: frameTop + visibleFrameH / 2,
                    width: leftW,
                    height: visibleFrameH,
                    originX: "center",
                    originY: "center",
                    fill: outerBackground,
                    selectable: false,
                    evented: false,
                    excludeFromExport: true,
                },
            },
            {
                id: "white-ink.cropMask.right",
                type: "rect",
                data: {
                    id: "white-ink.cropMask.right",
                    layerId: WHITE_INK_OVERLAY_LAYER_ID,
                    type: "white-ink-mask",
                },
                props: {
                    left: frameRight + rightW / 2,
                    top: frameTop + visibleFrameH / 2,
                    width: rightW,
                    height: visibleFrameH,
                    originX: "center",
                    originY: "center",
                    fill: outerBackground,
                    selectable: false,
                    evented: false,
                    excludeFromExport: true,
                },
            },
        ];
        return [
            ...maskSpecs,
            {
                id: "white-ink.cropFrame",
                type: "rect",
                data: {
                    id: "white-ink.cropFrame",
                    layerId: WHITE_INK_OVERLAY_LAYER_ID,
                    type: "white-ink-frame",
                },
                props: {
                    left: frame.left + frame.width / 2,
                    top: frame.top + frame.height / 2,
                    width: frame.width,
                    height: frame.height,
                    originX: "center",
                    originY: "center",
                    fill: innerBackground,
                    stroke: strokeColor,
                    strokeWidth,
                    strokeDashArray: [dashLength, dashLength],
                    selectable: false,
                    evented: false,
                    excludeFromExport: true,
                },
            },
        ];
    }
    applyImageVisibilityForWhiteInk(previewActive) {
        if (!this.canvasService)
            return;
        const visible = !previewActive;
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
    resolveRenderItems() {
        if (this.isToolActive) {
            return this.cloneItems(this.workingItems);
        }
        return this.cloneItems(this.items);
    }
    async resolveRenderSources(snapshot, item) {
        const imageSource = snapshot.src;
        if (!imageSource)
            return null;
        const whiteSource = this.resolveSourceUrl(item) || imageSource;
        const imageElement = snapshot.element;
        const whiteElement = whiteSource === imageSource ? imageElement : undefined;
        const [whiteMaskSrc, coverMaskSrc] = await Promise.all([
            this.getPreviewMaskSource(whiteSource, WHITE_MASK_TINT, whiteElement),
            this.getPreviewMaskSource(imageSource, COVER_MASK_TINT, imageElement),
        ]);
        const scaleAdjust = this.computeWhiteScaleAdjust(imageSource, whiteSource);
        return {
            whiteSrc: whiteMaskSrc || "",
            coverSrc: coverMaskSrc || "",
            whiteScaleAdjustX: scaleAdjust.x,
            whiteScaleAdjustY: scaleAdjust.y,
        };
    }
    resolveDefaultInsertIndex(objects) {
        if (!this.canvasService)
            return 0;
        const backgroundLayer = this.canvasService.getLayer("background");
        if (!backgroundLayer)
            return 0;
        const bgIndex = objects.indexOf(backgroundLayer);
        if (bgIndex < 0)
            return 0;
        return bgIndex + 1;
    }
    syncZOrder() {
        if (!this.canvasService)
            return;
        const canvas = this.canvasService.canvas;
        const whiteObjects = this.canvasService.getRootLayerObjects(WHITE_INK_OBJECT_LAYER_ID);
        const coverObjects = this.canvasService.getRootLayerObjects(WHITE_INK_COVER_LAYER_ID);
        const frameObjects = this.canvasService.getRootLayerObjects(WHITE_INK_OVERLAY_LAYER_ID);
        const currentObjects = canvas.getObjects();
        const imageIndexes = currentObjects
            .map((obj, index) => obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID ? index : -1)
            .filter((index) => index >= 0);
        let whiteInsertIndex = imageIndexes.length
            ? Math.min(...imageIndexes)
            : this.resolveDefaultInsertIndex(currentObjects);
        whiteObjects.forEach((obj) => {
            canvas.moveObjectTo(obj, whiteInsertIndex);
            whiteInsertIndex += 1;
        });
        const afterWhiteObjects = canvas.getObjects();
        const afterImageIndexes = afterWhiteObjects
            .map((obj, index) => obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID ? index : -1)
            .filter((index) => index >= 0);
        let coverInsertIndex = afterImageIndexes.length
            ? Math.max(...afterImageIndexes) + 1
            : whiteInsertIndex;
        coverObjects.forEach((obj) => {
            canvas.moveObjectTo(obj, coverInsertIndex);
            coverInsertIndex += 1;
        });
        frameObjects.forEach((obj) => canvas.bringObjectToFront(obj));
        canvas
            .getObjects()
            .filter((obj) => obj?.data?.layerId === IMAGE_OVERLAY_LAYER_ID)
            .forEach((obj) => canvas.bringObjectToFront(obj));
        const dielineOverlay = this.canvasService.getLayer("dieline-overlay");
        if (dielineOverlay) {
            canvas.bringObjectToFront(dielineOverlay);
        }
        const rulerOverlay = this.canvasService.getLayer("ruler-overlay");
        if (rulerOverlay) {
            canvas.bringObjectToFront(rulerOverlay);
        }
    }
    clearRenderedWhiteInks() {
        if (!this.canvasService)
            return;
        void this.canvasService.applyObjectSpecsToRootLayer(WHITE_INK_OBJECT_LAYER_ID, []);
        void this.canvasService.applyObjectSpecsToRootLayer(WHITE_INK_COVER_LAYER_ID, []);
        void this.canvasService.applyObjectSpecsToRootLayer(WHITE_INK_OVERLAY_LAYER_ID, []);
    }
    purgeSourceCaches(item) {
        const sourceUrl = this.resolveSourceUrl(item);
        if (!sourceUrl)
            return;
        this.sourceSizeBySrc.delete(sourceUrl);
        const prefix = `${sourceUrl}::`;
        Array.from(this.previewMaskBySource.keys()).forEach((cacheKey) => {
            if (cacheKey.startsWith(prefix)) {
                this.previewMaskBySource.delete(cacheKey);
            }
        });
        Array.from(this.pendingPreviewMaskBySource.keys()).forEach((cacheKey) => {
            if (cacheKey.startsWith(prefix)) {
                this.pendingPreviewMaskBySource.delete(cacheKey);
            }
        });
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
        this.applyImageVisibilityForWhiteInk(previewActive);
        const frame = this.getFrameRect();
        const frameSpecs = this.buildFrameSpecs(frame);
        let whiteSpecs = [];
        let coverSpecs = [];
        if (previewActive) {
            const baseSnapshot = this.getImageSnapshot(this.getPrimaryImageObject());
            const item = this.getEffectiveWhiteInkItem(this.resolveRenderItems());
            if (baseSnapshot && item) {
                const snapshot = await this.resolveAlignedImageSnapshot(baseSnapshot);
                if (seq !== this.renderSeq)
                    return;
                const sources = await this.resolveRenderSources(snapshot, item);
                if (seq !== this.renderSeq)
                    return;
                if (sources?.whiteSrc) {
                    whiteSpecs = [
                        this.buildCloneImageSpec("white-ink.main", snapshot, sources.whiteSrc, WHITE_INK_DEFAULT_OPACITY, WHITE_INK_OBJECT_LAYER_ID, "white-ink", sources.whiteScaleAdjustX, sources.whiteScaleAdjustY),
                    ];
                }
                if (this.previewImageVisible && sources?.coverSrc) {
                    coverSpecs = [
                        this.buildCloneImageSpec("white-ink.cover", snapshot, sources.coverSrc, this.computeCoverOpacity(), WHITE_INK_COVER_LAYER_ID, "white-ink-cover"),
                    ];
                }
            }
        }
        await this.canvasService.applyObjectSpecsToRootLayer(WHITE_INK_OBJECT_LAYER_ID, whiteSpecs);
        if (seq !== this.renderSeq)
            return;
        await this.canvasService.applyObjectSpecsToRootLayer(WHITE_INK_COVER_LAYER_ID, coverSpecs);
        if (seq !== this.renderSeq)
            return;
        await this.canvasService.applyObjectSpecsToRootLayer(WHITE_INK_OVERLAY_LAYER_ID, frameSpecs);
        if (seq !== this.renderSeq)
            return;
        this.syncZOrder();
        this.canvasService.requestRenderAll();
    }
    getMaskCacheKey(sourceUrl, tint) {
        return `${sourceUrl}::${tint.key}`;
    }
    async getPreviewMaskSource(sourceUrl, tint = WHITE_MASK_TINT, fallbackElement) {
        if (!sourceUrl)
            return "";
        if (typeof document === "undefined" || typeof Image === "undefined") {
            return "";
        }
        const cacheKey = this.getMaskCacheKey(sourceUrl, tint);
        const cached = this.previewMaskBySource.get(cacheKey);
        if (cached)
            return cached;
        const pending = this.pendingPreviewMaskBySource.get(cacheKey);
        if (pending) {
            const loaded = await pending;
            return loaded || "";
        }
        const task = this.createOpaqueMaskSource(sourceUrl, tint, fallbackElement);
        this.pendingPreviewMaskBySource.set(cacheKey, task);
        const loaded = await task;
        this.pendingPreviewMaskBySource.delete(cacheKey);
        if (!loaded)
            return "";
        this.previewMaskBySource.set(cacheKey, loaded);
        return loaded;
    }
    getElementSize(element) {
        if (!element)
            return null;
        const width = Number(element?.naturalWidth || element?.videoWidth || element?.width || 0);
        const height = Number(element?.naturalHeight || element?.videoHeight || element?.height || 0);
        if (!Number.isFinite(width) || !Number.isFinite(height))
            return null;
        if (width <= 0 || height <= 0)
            return null;
        return { width, height };
    }
    async createOpaqueMaskSource(sourceUrl, tint = WHITE_MASK_TINT, fallbackElement) {
        try {
            const element = fallbackElement || (await this.loadImageElement(sourceUrl));
            const size = this.getElementSize(element);
            if (!size)
                return null;
            const width = Math.max(1, size.width);
            const height = Math.max(1, size.height);
            this.rememberSourceSize(sourceUrl, { width, height });
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx)
                return null;
            ctx.drawImage(element, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const alpha = data[i + 3];
                data[i] = tint.r;
                data[i + 1] = tint.g;
                data[i + 2] = tint.b;
                data[i + 3] = alpha;
            }
            ctx.putImageData(imageData, 0, 0);
            return canvas.toDataURL("image/png");
        }
        catch (error) {
            this.debug("mask:extract:failed", { sourceUrl, tint: tint.key, error });
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
