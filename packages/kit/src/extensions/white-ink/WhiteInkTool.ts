import {
  CONFIGURATION_SERVICE,
  ExtensionContext,
  ExtensionContributions,
  ExtensionDefinition,
  ConfigurationService,
  TOOL_SESSION_SERVICE,
  ToolSessionService,
  WORKBENCH_SERVICE,
  WorkbenchService,
} from "@pooder/core";
import {
  CANVAS_SERVICE,
  CanvasService,
  RenderLayoutRect,
  RenderObjectSpec,
} from "../../services";
import {
  type FrameRect,
  resolveCutFrameRect,
  toLayoutSceneRect as toSceneLayoutRect,
} from "../../shared/scene/frame";
import {
  createSourceSizeCache,
  getCoverScale as getCoverScaleFromRect,
  type SourceSize,
} from "../../shared/imaging/sourceSizeCache";
import { SubscriptionBag } from "../../shared/runtime/subscriptions";
import {
  applyCommittedSnapshot,
  runDeferredConfigUpdate,
} from "../../shared/runtime/sessionState";
import {
  IMAGE_OBJECT_LAYER_ID,
  WHITE_INK_COVER_LAYER_ID,
  WHITE_INK_OBJECT_LAYER_ID,
  WHITE_INK_OVERLAY_LAYER_ID,
} from "../../shared/constants/layers";
import { createWhiteInkCommands } from "./commands";
import { createWhiteInkConfigurations } from "./config";

export interface WhiteInkItem {
  id: string;
  sourceUrl?: string;
  url?: string;
  opacity: number;
}

interface MaskTint {
  r: number;
  g: number;
  b: number;
  key: string;
}

interface ImageSnapshot {
  id: string;
  src: string;
  element: any;
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  originX: string;
  originY: string;
  flipX: boolean;
  flipY: boolean;
  skewX: number;
  skewY: number;
  width: number;
  height: number;
}

interface ImagePlacementState {
  id: string;
  sourceUrl: string;
  committedUrl: string;
  left: number;
  top: number;
  scale: number;
  angle: number;
}

interface RenderSources {
  whiteSrc: string;
  coverSrc: string;
  whiteScaleAdjustX: number;
  whiteScaleAdjustY: number;
}

interface UpsertWhiteInkOptions {
  id?: string;
  mode?: "auto" | "replace" | "add";
  createIfMissing?: boolean;
  addOptions?: Partial<WhiteInkItem>;
}

interface UpdateWhiteInkOptions {
  target?: "auto" | "config" | "working";
}

const WHITE_INK_DEBUG_KEY = "whiteInk.debug";
const WHITE_INK_PREVIEW_IMAGE_VISIBLE_KEY = "whiteInk.previewImageVisible";
const WHITE_INK_DEFAULT_OPACITY = 0.85;
const WHITE_INK_AUTO_ITEM_ID = "white-ink-auto";

const WHITE_INK_COVER_OPACITY_FACTOR = 0.45;
const WHITE_INK_COVER_OPACITY_MIN = 0.15;
const WHITE_INK_COVER_OPACITY_MAX = 0.65;
const WHITE_MASK_TINT: MaskTint = { r: 255, g: 255, b: 255, key: "white" };
const COVER_MASK_TINT: MaskTint = { r: 52, g: 136, b: 255, key: "blue" };

export class WhiteInkTool implements ExtensionDefinition {
  id = "pooder.kit.white-ink";

  metadata = {
    name: "WhiteInkTool",
  };
  activation = {
    requiresExtensions: ["pooder.kit.image"],
    requiresServices: [
      CANVAS_SERVICE,
      CONFIGURATION_SERVICE,
      TOOL_SESSION_SERVICE,
      WORKBENCH_SERVICE,
    ],
  };

  private items: WhiteInkItem[] = [];
  private workingItems: WhiteInkItem[] = [];
  private hasWorkingChanges = false;

  private sourceSizeCache = createSourceSizeCache((src) =>
    this.loadImageSize(src),
  );
  private previewMaskBySource: Map<string, string> = new Map();
  private pendingPreviewMaskBySource: Map<string, Promise<string | null>> =
    new Map();

  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private isUpdatingConfig = false;
  private isToolActive = false;
  private printWithWhiteInk = true;
  private previewImageVisible = true;
  private renderSeq = 0;
  private dirtyTrackerDisposable?: { dispose(): void };
  private whiteSpecs: RenderObjectSpec[] = [];
  private coverSpecs: RenderObjectSpec[] = [];
  private overlaySpecs: RenderObjectSpec[] = [];
  private renderProducerDisposable?: { dispose: () => void };
  private readonly subscriptions = new SubscriptionBag();

  activate(context: ExtensionContext) {
    this.subscriptions.disposeAll();
    this.context = context;
    this.canvasService = context.services.getOrThrow<CanvasService>(
      CANVAS_SERVICE,
    );
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = this.canvasService.registerRenderProducer(
      this.id,
      () => ({
        passes: [
          {
            id: WHITE_INK_COVER_LAYER_ID,
            stack: 220,
            order: 0,
            objects: this.coverSpecs,
          },
          {
            id: WHITE_INK_OBJECT_LAYER_ID,
            stack: 221,
            order: 0,
            objects: this.whiteSpecs,
          },
          {
            id: WHITE_INK_OVERLAY_LAYER_ID,
            stack: 790,
            order: 0,
            objects: this.overlaySpecs,
          },
        ],
      }),
      { priority: 260 },
    );

    this.subscriptions.on(context.eventBus, "tool:activated", this.onToolActivated);
    this.subscriptions.on(
      context.eventBus,
      "scene:layout:change",
      this.onSceneLayoutChanged,
    );
    this.subscriptions.on(context.eventBus, "object:added", this.onObjectAdded);
    this.subscriptions.on(
      context.eventBus,
      "object:modified",
      this.onObjectModified,
    );
    this.subscriptions.on(
      context.eventBus,
      "object:removed",
      this.onObjectRemoved,
    );
    this.subscriptions.on(
      context.eventBus,
      "image:working:change",
      this.onImageWorkingChanged,
    );

    const configService = context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    this.applyCommittedItems(configService.get("whiteInk.items", []) || []);
    this.printWithWhiteInk = !!configService.get(
      "whiteInk.printWithWhiteInk",
      true,
    );
    this.previewImageVisible = !!configService.get(
      WHITE_INK_PREVIEW_IMAGE_VISIBLE_KEY,
      true,
    );

    this.migrateLegacyConfigIfNeeded(configService);

    this.subscriptions.onConfigChange(
      configService,
      (e: { key: string; value: any }) => {
        if (this.isUpdatingConfig) return;

        if (e.key === "whiteInk.items") {
          this.applyCommittedItems(e.value || []);
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
      },
    );

    const toolSessionService = context.services.getOrThrow<ToolSessionService>(
      TOOL_SESSION_SERVICE,
    );
    this.dirtyTrackerDisposable = toolSessionService.registerDirtyTracker(
      this.id,
      () => this.hasWorkingChanges,
    );

    this.updateWhiteInks();
  }

  deactivate(context: ExtensionContext) {
    this.subscriptions.disposeAll();

    this.dirtyTrackerDisposable?.dispose();
    this.dirtyTrackerDisposable = undefined;
    this.sourceSizeCache.clear();
    this.clearRenderedWhiteInks();
    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = undefined;
    if (this.canvasService) {
      void this.canvasService.flushRenderFromProducers();
    }

    this.canvasService = undefined;
    this.context = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      tools: [
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
      configurations: createWhiteInkConfigurations(),
      commands: createWhiteInkCommands(this),
    };
  }

  private onToolActivated = (event: {
    id: string | null;
    previous?: string | null;
  }) => {
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

  private onSceneLayoutChanged = () => {
    this.updateWhiteInks();
  };

  private onObjectAdded = (e: any) => {
    const layerId = e?.target?.data?.layerId;
    if (layerId !== IMAGE_OBJECT_LAYER_ID) return;
    this.updateWhiteInks();
  };

  private onObjectModified = (e: any) => {
    const layerId = e?.target?.data?.layerId;
    if (layerId !== IMAGE_OBJECT_LAYER_ID) return;
    this.updateWhiteInks();
  };

  private onObjectRemoved = (e: any) => {
    const layerId = e?.target?.data?.layerId;
    if (layerId !== IMAGE_OBJECT_LAYER_ID) return;
    this.updateWhiteInks();
  };

  private onImageWorkingChanged = () => {
    this.updateWhiteInks();
  };

  private migrateLegacyConfigIfNeeded(configService: ConfigurationService) {
    if (this.items.length > 0) return;
    const legacyMask = configService.get("whiteInk.customMask", "");
    if (typeof legacyMask !== "string" || legacyMask.length === 0) return;

    const item = this.normalizeItem({
      id: this.generateId(),
      sourceUrl: legacyMask,
      opacity: WHITE_INK_DEFAULT_OPACITY,
    });

    this.applyCommittedItems([item]);
    runDeferredConfigUpdate(this, () => {
      configService.update("whiteInk.items", this.items);
    });
  }

  private syncToolActiveFromWorkbench(fallbackId?: string | null) {
    const wb = this.context?.services.get<WorkbenchService>(WORKBENCH_SERVICE);
    const activeId = wb?.activeToolId;
    if (typeof activeId === "string" || activeId === null) {
      this.isToolActive = activeId === this.id;
      return;
    }
    this.isToolActive = fallbackId === this.id;
  }

  private isPreviewActive(): boolean {
    return this.isToolActive && this.printWithWhiteInk;
  }

  private isDebugEnabled(): boolean {
    return !!this.getConfig<boolean>(WHITE_INK_DEBUG_KEY, false);
  }

  private debug(message: string, payload?: any) {
    if (!this.isDebugEnabled()) return;
    if (payload === undefined) {
      console.log(`[WhiteInkTool] ${message}`);
      return;
    }
    console.log(`[WhiteInkTool] ${message}`, payload);
  }

  private resolveSourceUrl(item?: Partial<WhiteInkItem> | null): string {
    if (!item) return "";
    if (typeof item.sourceUrl === "string" && item.sourceUrl.length > 0) {
      return item.sourceUrl;
    }
    if (typeof item.url === "string" && item.url.length > 0) {
      return item.url;
    }
    return "";
  }

  private normalizeItem(item: Partial<WhiteInkItem>): WhiteInkItem {
    const sourceUrl = this.resolveSourceUrl(item);
    return {
      id: String(item.id || this.generateId()),
      sourceUrl,
      url: sourceUrl,
      opacity: WHITE_INK_DEFAULT_OPACITY,
    };
  }

  private normalizeItems(items: WhiteInkItem[]): WhiteInkItem[] {
    return (items || [])
      .map((item) => this.normalizeItem(item))
      .filter((item) => !!item.id);
  }

  private cloneItems(items: WhiteInkItem[]): WhiteInkItem[] {
    return this.normalizeItems((items || []).map((item) => ({ ...item })));
  }

  private getEffectiveWhiteInkItem(items: WhiteInkItem[]): WhiteInkItem | null {
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

  private generateId(): string {
    return `white-ink-${Math.random().toString(36).slice(2, 9)}`;
  }

  private getConfig<T>(key: string, fallback?: T): T | undefined {
    if (!this.context) return fallback;
    const configService = this.context.services.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    if (!configService) return fallback;
    return (configService.get(key, fallback) as T) ?? fallback;
  }

  private getConfigServiceOrThrow(): ConfigurationService {
    if (!this.context) {
      throw new Error("[WhiteInkTool] Extension context is not available.");
    }
    return this.context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
  }

  public setWhiteInkPrintEnabled(enabled: boolean) {
    this.printWithWhiteInk = !!enabled;
    this.getConfigServiceOrThrow().update(
      "whiteInk.printWithWhiteInk",
      this.printWithWhiteInk,
    );
    this.updateWhiteInks();
    return { ok: true };
  }

  public setWhiteInkPreviewImageVisible(visible: boolean) {
    this.previewImageVisible = !!visible;
    this.getConfigServiceOrThrow().update(
      WHITE_INK_PREVIEW_IMAGE_VISIBLE_KEY,
      this.previewImageVisible,
    );
    this.updateWhiteInks();
    return { ok: true };
  }

  private resolveReplaceTargetId(explicitId?: string | null): string | null {
    const has = (id: string | null | undefined) =>
      !!id && this.items.some((item) => item.id === id);
    if (has(explicitId)) return explicitId as string;
    if (this.items.length >= 1) {
      return this.items[0].id;
    }
    return null;
  }

  private applyCommittedItems(nextItems: WhiteInkItem[]) {
    const session = {
      committed: this.items,
      working: this.workingItems,
      hasWorkingChanges: this.hasWorkingChanges,
    };
    applyCommittedSnapshot(session, this.normalizeItems(nextItems), {
      clone: (items) => this.cloneItems(items),
      toolActive: this.isToolActive,
      preserveDirtyWorking: true,
    });
    this.items = session.committed;
    this.workingItems = session.working;
    this.hasWorkingChanges = session.hasWorkingChanges;
  }

  private updateConfig(newItems: WhiteInkItem[], skipCanvasUpdate = false) {
    if (!this.context) return;
    this.applyCommittedItems(newItems);
    runDeferredConfigUpdate(
      this,
      () => {
        const configService = this.context?.services.get<ConfigurationService>(
          CONFIGURATION_SERVICE,
        );
        configService?.update("whiteInk.items", this.items);

        if (!skipCanvasUpdate) {
          this.updateWhiteInks();
        }
      },
      50,
    );
  }

  private async addWhiteInkEntry(
    url: string,
    options?: Partial<WhiteInkItem>,
  ): Promise<string> {
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

  private async upsertWhiteInkEntry(
    url: string,
    options: UpsertWhiteInkOptions = {},
  ): Promise<{ id: string; mode: "replace" | "add" }> {
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

  private addItemToWorkingSessionIfNeeded(
    item: WhiteInkItem,
    sessionDirtyBeforeAdd: boolean,
  ) {
    if (!sessionDirtyBeforeAdd || !this.isToolActive) return;
    if (this.workingItems.some((existing) => existing.id === item.id)) return;
    this.workingItems = this.cloneItems([...this.workingItems, item]);
    this.updateWhiteInks();
  }

  private async updateWhiteInkItem(
    id: string,
    updates: Partial<WhiteInkItem>,
    options: UpdateWhiteInkOptions = {},
  ) {
    this.syncToolActiveFromWorkbench();
    const target = options.target || "auto";
    if (target === "working" || (target === "auto" && this.isToolActive)) {
      this.updateWhiteInkInWorking(id, updates);
      return;
    }

    this.updateWhiteInkInConfig(id, updates);
  }

  private updateWhiteInkInWorking(id: string, updates: Partial<WhiteInkItem>) {
    let changed = false;
    const next = this.workingItems.map((item) => {
      if (item.id !== id) return item;
      changed = true;
      return this.normalizeItem({
        ...item,
        ...updates,
      });
    });
    if (!changed) return;

    this.workingItems = this.cloneItems(next);
    this.hasWorkingChanges = true;
    this.updateWhiteInks();
  }

  private updateWhiteInkInConfig(id: string, updates: Partial<WhiteInkItem>) {
    let changed = false;
    const next = this.items.map((item) => {
      if (item.id !== id) return item;
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
    if (!changed) return;

    this.updateConfig(next);
  }

  private removeWhiteInk(id: string) {
    const removed = this.items.find((item) => item.id === id);
    const next = this.items.filter((item) => item.id !== id);
    if (next.length === this.items.length) return;

    this.purgeSourceCaches(removed);
    this.updateConfig(next);
  }

  private clearWhiteInks() {
    this.sourceSizeCache.clear();
    this.previewMaskBySource.clear();
    this.pendingPreviewMaskBySource.clear();
    this.updateConfig([]);
  }

  private async completeWhiteInks() {
    this.updateConfig(this.cloneItems(this.workingItems));
    this.hasWorkingChanges = false;
    return { ok: true };
  }

  private getFrameRect(): FrameRect {
      const configService = this.context?.services.get<ConfigurationService>(
        CONFIGURATION_SERVICE,
      );
    return resolveCutFrameRect(this.canvasService, configService);
  }

  private toLayoutSceneRect(rect: FrameRect): RenderLayoutRect {
    return toSceneLayoutRect(rect);
  }

  private getImageObjects(): any[] {
    if (!this.canvasService) return [];
    return this.canvasService.canvas.getObjects().filter((obj: any) => {
      return obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID;
    }) as any[];
  }

  private getPrimaryImageObject(): any | undefined {
    return this.getImageObjects()[0];
  }

  private getPrimaryImageSource(): string {
    return this.getCurrentSrc(this.getPrimaryImageObject()) || "";
  }

  private getCurrentSrc(obj: any): string | undefined {
    if (!obj) return undefined;
    if (typeof obj.getSrc === "function") return obj.getSrc();
    return obj?._originalElement?.src;
  }

  private getImageSnapshot(obj: any): ImageSnapshot | null {
    if (!obj) return null;

    const src = this.getCurrentSrc(obj);
    if (!src) return null;

    const element = this.getImageElementFromObject(obj);
    const width = Number(obj?.width || 0);
    const height = Number(obj?.height || 0);
    this.rememberSourceSize(src, { width, height });
    const sceneScale = this.canvasService?.getSceneScale() || 1;
    const leftScreen = Number.isFinite(obj?.left) ? Number(obj.left) : 0;
    const topScreen = Number.isFinite(obj?.top) ? Number(obj.top) : 0;
    const scenePoint = this.canvasService
      ? this.canvasService.toScenePoint({ x: leftScreen, y: topScreen })
      : { x: leftScreen, y: topScreen };

    return {
      id: String(obj?.data?.id || "image"),
      src,
      element,
      left: scenePoint.x,
      top: scenePoint.y,
      scaleX:
        (Number.isFinite(obj?.scaleX) ? Number(obj.scaleX) : 1) / sceneScale,
      scaleY:
        (Number.isFinite(obj?.scaleY) ? Number(obj.scaleY) : 1) / sceneScale,
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

  private getImagePlacementState(id?: string): ImagePlacementState | null {
    const rawItems = this.getConfig<any[]>("image.items", []);
    if (!Array.isArray(rawItems) || rawItems.length === 0) return null;

    const matched =
      (id
        ? rawItems.find(
            (item: any) =>
              item &&
              typeof item === "object" &&
              typeof item.id === "string" &&
              item.id === id,
          )
        : undefined) || rawItems[0];

    if (!matched || typeof matched !== "object") return null;

    const sourceUrl =
      typeof matched.sourceUrl === "string" && matched.sourceUrl.length > 0
        ? matched.sourceUrl
        : typeof matched.url === "string"
          ? matched.url
          : "";
    const committedUrl =
      typeof matched.committedUrl === "string" ? matched.committedUrl : "";

    return {
      id:
        typeof matched.id === "string" && matched.id.length > 0
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

  private shouldRestoreSnapshotToSource(
    snapshot: ImageSnapshot,
    placement: ImagePlacementState,
  ): boolean {
    if (!placement.sourceUrl || !placement.committedUrl) return false;
    if (placement.sourceUrl === placement.committedUrl) return false;
    return snapshot.src === placement.committedUrl;
  }

  private getCoverScale(frame: FrameRect, source: SourceSize): number {
    return getCoverScaleFromRect(frame, source);
  }

  private async ensureSourceSize(
    sourceUrl: string,
  ): Promise<SourceSize | null> {
    return this.sourceSizeCache.ensureImageSize(sourceUrl);
  }

  private async loadImageSize(sourceUrl: string): Promise<SourceSize | null> {
    try {
      const image = await this.loadImageElement(sourceUrl);
      const size = this.getElementSize(image);
      if (!size) return null;
      return {
        width: size.width,
        height: size.height,
      };
    } catch {
      return null;
    }
  }

  private async resolveAlignedImageSnapshot(
    snapshot: ImageSnapshot,
  ): Promise<ImageSnapshot> {
    const placement = this.getImagePlacementState(snapshot.id);
    if (!placement) return snapshot;
    if (!this.shouldRestoreSnapshotToSource(snapshot, placement)) {
      return snapshot;
    }

    const frame = this.getFrameRect();
    if (frame.width <= 0 || frame.height <= 0) {
      return snapshot;
    }

    const sourceSize = await this.ensureSourceSize(placement.sourceUrl);
    if (!sourceSize) return snapshot;

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
  private getImageElementFromObject(obj: any): any {
    if (!obj) return null;
    if (typeof obj.getElement === "function") {
      return obj.getElement();
    }
    return obj?._element || obj?._originalElement || null;
  }

  private rememberSourceSize(src: string, size: SourceSize) {
    this.sourceSizeCache.rememberSourceSize(src, size);
  }

  private getSourceSize(src: string): SourceSize | null {
    return this.sourceSizeCache.getSourceSize(src);
  }

  private computeWhiteScaleAdjust(
    baseSource: string,
    whiteSource: string,
  ): { x: number; y: number } {
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

  private computeCoverOpacity(): number {
    const raw = WHITE_INK_DEFAULT_OPACITY * WHITE_INK_COVER_OPACITY_FACTOR;
    return Math.max(
      WHITE_INK_COVER_OPACITY_MIN,
      Math.min(WHITE_INK_COVER_OPACITY_MAX, raw),
    );
  }

  private buildCloneImageSpec(
    id: string,
    snapshot: ImageSnapshot,
    src: string,
    opacity: number,
    layerId: string,
    type: "white-ink" | "white-ink-cover",
    scaleAdjustX = 1,
    scaleAdjustY = 1,
  ): RenderObjectSpec {
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

  private buildFrameSpecs(frame: FrameRect): RenderObjectSpec[] {
    if (!this.isToolActive || !this.canvasService) return [];
    if (frame.width <= 0 || frame.height <= 0) return [];

    const viewport = this.canvasService.getSceneViewportRect();
    const canvasW = viewport.width || 0;
    const canvasH = viewport.height || 0;
    const canvasLeft = viewport.left || 0;
    const canvasTop = viewport.top || 0;
    const strokeColor =
      this.getConfig<string>("image.frame.strokeColor", "#808080") || "#808080";
    const strokeWidthRaw = Number(
      this.getConfig<number>("image.frame.strokeWidth", 2) ?? 2,
    );
    const dashLengthRaw = Number(
      this.getConfig<number>("image.frame.dashLength", 8) ?? 8,
    );
    const outerBackground =
      this.getConfig<string>("image.frame.outerBackground", "#f5f5f5") ||
      "#f5f5f5";
    const innerBackground =
      this.getConfig<string>("image.frame.innerBackground", "rgba(0,0,0,0)") ||
      "rgba(0,0,0,0)";

    const strokeWidth = Number.isFinite(strokeWidthRaw)
      ? Math.max(0, strokeWidthRaw)
      : 2;
    const dashLength = Number.isFinite(dashLengthRaw)
      ? Math.max(1, dashLengthRaw)
      : 8;
    const strokeWidthScene = this.canvasService.toSceneLength(strokeWidth);
    const dashLengthScene = this.canvasService.toSceneLength(dashLength);

    const frameLeft = Math.max(
      canvasLeft,
      Math.min(canvasLeft + canvasW, frame.left),
    );
    const frameTop = Math.max(
      canvasTop,
      Math.min(canvasTop + canvasH, frame.top),
    );
    const frameRight = Math.max(
      frameLeft,
      Math.min(canvasLeft + canvasW, frame.left + frame.width),
    );
    const frameBottom = Math.max(
      frameTop,
      Math.min(canvasTop + canvasH, frame.top + frame.height),
    );
    const visibleFrameH = Math.max(0, frameBottom - frameTop);

    const topH = Math.max(0, frameTop - canvasTop);
    const bottomH = Math.max(0, canvasTop + canvasH - frameBottom);
    const leftW = Math.max(0, frameLeft - canvasLeft);
    const rightW = Math.max(0, canvasLeft + canvasW - frameRight);
    const viewportRect = this.toLayoutSceneRect({
      left: canvasLeft,
      top: canvasTop,
      width: canvasW,
      height: canvasH,
    });
    const visibleFrameBandRect = this.toLayoutSceneRect({
      left: canvasLeft,
      top: frameTop,
      width: canvasW,
      height: visibleFrameH,
    });
    const frameRect = this.toLayoutSceneRect(frame);

    const maskSpecs: RenderObjectSpec[] = [
      {
        id: "white-ink.cropMask.top",
        type: "rect",
        data: {
          id: "white-ink.cropMask.top",
          layerId: WHITE_INK_OVERLAY_LAYER_ID,
          type: "white-ink-mask",
        },
        layout: {
          reference: "custom",
          referenceRect: viewportRect,
          alignX: "start",
          alignY: "start",
          width: "100%",
          height: topH,
        },
        props: {
          originX: "left",
          originY: "top",
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
        layout: {
          reference: "custom",
          referenceRect: viewportRect,
          alignX: "start",
          alignY: "end",
          width: "100%",
          height: bottomH,
        },
        props: {
          originX: "left",
          originY: "top",
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
        layout: {
          reference: "custom",
          referenceRect: visibleFrameBandRect,
          alignX: "start",
          alignY: "start",
          width: leftW,
          height: "100%",
        },
        props: {
          originX: "left",
          originY: "top",
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
        layout: {
          reference: "custom",
          referenceRect: visibleFrameBandRect,
          alignX: "end",
          alignY: "start",
          width: rightW,
          height: "100%",
        },
        props: {
          originX: "left",
          originY: "top",
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
        layout: {
          reference: "custom",
          referenceRect: frameRect,
          alignX: "start",
          alignY: "start",
          width: "100%",
          height: "100%",
        },
        props: {
          originX: "left",
          originY: "top",
          fill: innerBackground,
          stroke: strokeColor,
          strokeWidth: strokeWidthScene,
          strokeDashArray: [dashLengthScene, dashLengthScene],
          selectable: false,
          evented: false,
          excludeFromExport: true,
        },
      },
    ];
  }
  private resolveRenderItems(): WhiteInkItem[] {
    if (this.isToolActive) {
      return this.cloneItems(this.workingItems);
    }
    return this.cloneItems(this.items);
  }

  private async resolveRenderSources(
    snapshot: ImageSnapshot,
    item: WhiteInkItem,
  ): Promise<RenderSources | null> {
    const imageSource = snapshot.src;
    if (!imageSource) return null;

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

  private clearRenderedWhiteInks() {
    if (!this.canvasService) return;
    this.whiteSpecs = [];
    this.coverSpecs = [];
    this.overlaySpecs = [];
    this.canvasService.requestRenderFromProducers();
  }

  private purgeSourceCaches(item?: WhiteInkItem) {
    const sourceUrl = this.resolveSourceUrl(item);
    if (!sourceUrl) return;
    this.sourceSizeCache.deleteSourceSize(sourceUrl);
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

  private updateWhiteInks() {
    void this.updateWhiteInksAsync();
  }

  private async updateWhiteInksAsync() {
    if (!this.canvasService) return;

    this.syncToolActiveFromWorkbench();
    const seq = ++this.renderSeq;

    const previewActive = this.isPreviewActive();

    const frame = this.getFrameRect();
    const frameSpecs = this.buildFrameSpecs(frame);

    let whiteSpecs: RenderObjectSpec[] = [];
    let coverSpecs: RenderObjectSpec[] = [];

    if (previewActive) {
      const baseSnapshot = this.getImageSnapshot(this.getPrimaryImageObject());
      const item = this.getEffectiveWhiteInkItem(this.resolveRenderItems());

      if (baseSnapshot && item) {
        const snapshot = await this.resolveAlignedImageSnapshot(baseSnapshot);
        if (seq !== this.renderSeq) return;
        const sources = await this.resolveRenderSources(snapshot, item);
        if (seq !== this.renderSeq) return;

        if (sources?.whiteSrc) {
          whiteSpecs = [
            this.buildCloneImageSpec(
              "white-ink.main",
              snapshot,
              sources.whiteSrc,
              WHITE_INK_DEFAULT_OPACITY,
              WHITE_INK_OBJECT_LAYER_ID,
              "white-ink",
              sources.whiteScaleAdjustX,
              sources.whiteScaleAdjustY,
            ),
          ];
        }

        if (this.previewImageVisible && sources?.coverSrc) {
          coverSpecs = [
            this.buildCloneImageSpec(
              "white-ink.cover",
              snapshot,
              sources.coverSrc,
              this.computeCoverOpacity(),
              WHITE_INK_COVER_LAYER_ID,
              "white-ink-cover",
            ),
          ];
        }
      }
    }

    this.whiteSpecs = whiteSpecs;
    if (seq !== this.renderSeq) return;

    this.coverSpecs = coverSpecs;
    if (seq !== this.renderSeq) return;

    this.overlaySpecs = frameSpecs;
    await this.canvasService.flushRenderFromProducers();
    if (seq !== this.renderSeq) return;
    this.canvasService.requestRenderAll();
  }

  private getMaskCacheKey(sourceUrl: string, tint: MaskTint): string {
    return `${sourceUrl}::${tint.key}`;
  }

  private async getPreviewMaskSource(
    sourceUrl: string,
    tint: MaskTint = WHITE_MASK_TINT,
    fallbackElement?: any,
  ): Promise<string> {
    if (!sourceUrl) return "";
    if (typeof document === "undefined" || typeof Image === "undefined") {
      return "";
    }

    const cacheKey = this.getMaskCacheKey(sourceUrl, tint);
    const cached = this.previewMaskBySource.get(cacheKey);
    if (cached) return cached;

    const pending = this.pendingPreviewMaskBySource.get(cacheKey);
    if (pending) {
      const loaded = await pending;
      return loaded || "";
    }

    const task = this.createOpaqueMaskSource(sourceUrl, tint, fallbackElement);
    this.pendingPreviewMaskBySource.set(cacheKey, task);
    const loaded = await task;
    this.pendingPreviewMaskBySource.delete(cacheKey);

    if (!loaded) return "";
    this.previewMaskBySource.set(cacheKey, loaded);
    return loaded;
  }

  private getElementSize(
    element: any,
  ): { width: number; height: number } | null {
    if (!element) return null;

    const width = Number(
      element?.naturalWidth || element?.videoWidth || element?.width || 0,
    );
    const height = Number(
      element?.naturalHeight || element?.videoHeight || element?.height || 0,
    );

    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width <= 0 || height <= 0) return null;

    return { width, height };
  }

  private async createOpaqueMaskSource(
    sourceUrl: string,
    tint: MaskTint = WHITE_MASK_TINT,
    fallbackElement?: any,
  ): Promise<string | null> {
    try {
      const element =
        fallbackElement || (await this.loadImageElement(sourceUrl));
      const size = this.getElementSize(element);
      if (!size) return null;
      const width = Math.max(1, size.width);
      const height = Math.max(1, size.height);

      this.rememberSourceSize(sourceUrl, { width, height });

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

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
    } catch (error) {
      this.debug("mask:extract:failed", { sourceUrl, tint: tint.key, error });
      return null;
    }
  }

  private loadImageElement(sourceUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("white-ink-image-load-failed"));
      image.src = sourceUrl;
    });
  }
}
