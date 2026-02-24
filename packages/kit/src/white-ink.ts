import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
  ConfigurationService,
  ToolSessionService,
  WorkbenchService,
} from "@pooder/core";
import { Image as FabricImage } from "fabric";
import CanvasService from "./CanvasService";
import { parseLengthToMm } from "./units";

export interface WhiteInkItem {
  id: string;
  url: string;
  opacity: number;
  scale?: number;
  angle?: number;
  left?: number;
  top?: number;
}

interface SourceSize {
  width: number;
  height: number;
}

interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface RenderWhiteInkState {
  src: string;
  left: number;
  top: number;
  scale: number;
  angle: number;
  opacity: number;
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

const WHITE_INK_OBJECT_LAYER_ID = "white-ink.user";
const WHITE_INK_DEBUG_KEY = "whiteInk.debug";

export class WhiteInkTool implements Extension {
  id = "pooder.kit.white-ink";

  metadata = {
    name: "WhiteInkTool",
  };

  private items: WhiteInkItem[] = [];
  private workingItems: WhiteInkItem[] = [];
  private hasWorkingChanges = false;
  private loadResolvers: Map<string, () => void> = new Map();
  private sourceSizeBySrc: Map<string, SourceSize> = new Map();
  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private isUpdatingConfig = false;
  private isToolActive = false;
  private isSelectionActive = false;
  private focusedItemId: string | null = null;
  private printWithWhiteInk = true;
  private renderSeq = 0;
  private dirtyTrackerDisposable?: { dispose(): void };

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService = context.services.get<CanvasService>("CanvasService");
    if (!this.canvasService) {
      console.warn("CanvasService not found for WhiteInkTool");
      return;
    }

    context.eventBus.on("tool:activated", this.onToolActivated);
    context.eventBus.on("object:modified", this.onObjectModified);
    context.eventBus.on("selection:created", this.onSelectionChanged);
    context.eventBus.on("selection:updated", this.onSelectionChanged);
    context.eventBus.on("selection:cleared", this.onSelectionCleared);
    context.eventBus.on(
      "dieline:geometry:change",
      this.onDielineGeometryChanged,
    );

    const configService = context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (configService) {
      this.items = this.normalizeItems(
        configService.get("whiteInk.items", []) || [],
      );
      this.workingItems = this.cloneItems(this.items);
      this.hasWorkingChanges = false;
      this.printWithWhiteInk = !!configService.get(
        "whiteInk.printWithWhiteInk",
        true,
      );

      this.migrateLegacyConfigIfNeeded(configService);

      configService.onAnyChange((e: { key: string; value: any }) => {
        if (this.isUpdatingConfig) return;

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

        if (e.key === WHITE_INK_DEBUG_KEY) {
          return;
        }

        if (e.key === "dieline.width" || e.key === "dieline.height") {
          this.updateWhiteInks();
        }
      });
    }

    const toolSessionService =
      context.services.get<ToolSessionService>("ToolSessionService");
    this.dirtyTrackerDisposable = toolSessionService?.registerDirtyTracker(
      this.id,
      () => this.hasWorkingChanges,
    );

    this.updateWhiteInks();
  }

  deactivate(context: ExtensionContext) {
    context.eventBus.off("tool:activated", this.onToolActivated);
    context.eventBus.off("object:modified", this.onObjectModified);
    context.eventBus.off("selection:created", this.onSelectionChanged);
    context.eventBus.off("selection:updated", this.onSelectionChanged);
    context.eventBus.off("selection:cleared", this.onSelectionCleared);
    context.eventBus.off(
      "dieline:geometry:change",
      this.onDielineGeometryChanged,
    );

    this.dirtyTrackerDisposable?.dispose();
    this.dirtyTrackerDisposable = undefined;
    this.clearRenderedWhiteInks();
    this.canvasService = undefined;
    this.context = undefined;
  }

  contribute() {
    return {
      [ContributionPointIds.TOOLS]: [
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
      [ContributionPointIds.CONFIGURATIONS]: [
        {
          id: "whiteInk.items",
          type: "array",
          label: "White Ink Images",
          default: [],
        },
        {
          id: "whiteInk.printWithWhiteInk",
          type: "boolean",
          label: "Print with White Ink",
          default: true,
        },
        {
          id: WHITE_INK_DEBUG_KEY,
          type: "boolean",
          label: "White Ink Debug Log",
          default: false,
        },
      ] as ConfigurationContribution[],
      [ContributionPointIds.COMMANDS]: [
        {
          command: "addWhiteInk",
          title: "Add White Ink",
          handler: async (url: string, options?: Partial<WhiteInkItem>) => {
            return await this.addWhiteInkEntry(url, options);
          },
        },
        {
          command: "upsertWhiteInk",
          title: "Upsert White Ink",
          handler: async (
            url: string,
            options: UpsertWhiteInkOptions = {},
          ) => {
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
            return {
              id: first?.id || null,
              url: first?.url || "",
              printWithWhiteInk: this.printWithWhiteInk,
            };
          },
        },
        {
          command: "setWhiteInkPrintEnabled",
          title: "Set White Ink Print Enabled",
          handler: (enabled: boolean) => {
            this.printWithWhiteInk = !!enabled;
            const configService = this.context?.services.get<ConfigurationService>(
              "ConfigurationService",
            );
            configService?.update(
              "whiteInk.printWithWhiteInk",
              this.printWithWhiteInk,
            );
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
          handler: (id: string, updates: Partial<WhiteInkItem>) => {
            this.updateWhiteInkInWorking(id, updates);
          },
        },
        {
          command: "updateWhiteInk",
          title: "Update White Ink",
          handler: async (
            id: string,
            updates: Partial<WhiteInkItem>,
            options: UpdateWhiteInkOptions = {},
          ) => {
            await this.updateWhiteInkItem(id, updates, options);
          },
        },
        {
          command: "removeWhiteInk",
          title: "Remove White Ink",
          handler: (id: string) => {
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
          handler: async (url: string, opacity?: number) => {
            if (!url) {
              this.clearWhiteInks();
              return { ok: true };
            }

            const resolvedOpacity = Number.isFinite(opacity as any)
              ? Number(opacity)
              : 1;
            const targetId = this.resolveReplaceTargetId(null);
            const upsertResult = await this.upsertWhiteInkEntry(url, {
              id: targetId || undefined,
              mode: targetId ? "replace" : "add",
              createIfMissing: true,
              addOptions: {
                opacity: resolvedOpacity,
              },
            });
            await this.updateWhiteInkItem(
              upsertResult.id,
              { opacity: resolvedOpacity },
              { target: "config" },
            );
            return { ok: true, id: upsertResult.id };
          },
        },
      ] as CommandContribution[],
    };
  }

  private onToolActivated = (event: {
    id: string | null;
    previous?: string | null;
  }) => {
    const before = this.isToolActive;
    this.syncToolActiveFromWorkbench(event.id);
    if (!this.isToolActive) {
      this.isSelectionActive = false;
      this.focusedItemId = null;
    }
    this.debug("tool:activated", {
      id: event.id,
      previous: event.previous,
      before,
      isToolActive: this.isToolActive,
    });
    this.updateWhiteInks();
  };

  private onSelectionChanged = (e: any) => {
    const list: any[] = [];
    if (Array.isArray(e?.selected)) list.push(...e.selected);
    if (Array.isArray(e?.target?._objects)) list.push(...e.target._objects);
    if (e?.target && !Array.isArray(e?.target?._objects)) {
      list.push(e.target);
    }

    const selectedItem = list.find(
      (obj: any) => obj?.data?.layerId === WHITE_INK_OBJECT_LAYER_ID,
    );
    this.isSelectionActive = !!selectedItem;
    if (selectedItem?.data?.id) {
      this.focusedItemId = selectedItem.data.id;
    } else if (list.length > 0) {
      this.focusedItemId = null;
    }
    this.updateWhiteInks();
  };

  private onSelectionCleared = () => {
    this.isSelectionActive = false;
    this.focusedItemId = null;
    this.updateWhiteInks();
  };

  private onDielineGeometryChanged = () => {
    this.updateWhiteInks();
  };

  private onObjectModified = (e: any) => {
    const target = e?.target as any;
    if (!target || target?.data?.layerId !== WHITE_INK_OBJECT_LAYER_ID) return;
    if (typeof target?.data?.id !== "string") return;

    const id = target.data.id as string;
    const frame = this.getFrameRect();
    if (frame.width <= 0 || frame.height <= 0) return;

    const center = target.getCenterPoint ? target.getCenterPoint() : undefined;
    const centerX = Number(center?.x ?? target.left ?? 0);
    const centerY = Number(center?.y ?? target.top ?? 0);
    const scaleX = Number(target.scaleX ?? 1);
    const sourceWidth = Number(target.width ?? 1);
    const sourceHeight = Number(target.height ?? 1);
    const coverScale = this.getCoverScale(frame, {
      width: Math.max(1, sourceWidth),
      height: Math.max(1, sourceHeight),
    });
    const updates: Partial<WhiteInkItem> = {
      left: this.clampNormalized(
        (centerX - frame.left) / Math.max(1, frame.width),
      ),
      top: this.clampNormalized(
        (centerY - frame.top) / Math.max(1, frame.height),
      ),
      scale: Math.max(0.05, scaleX / Math.max(0.0001, coverScale)),
      angle: Number(target.angle ?? 0),
      opacity: Math.max(0, Math.min(1, Number(target.opacity ?? 1))),
    };

    this.syncToolActiveFromWorkbench();
    if (this.isToolActive) {
      this.updateWhiteInkInWorking(id, updates);
    } else {
      this.updateWhiteInkInConfig(id, updates);
    }
  };

  private migrateLegacyConfigIfNeeded(configService: ConfigurationService) {
    if (this.items.length > 0) return;
    const legacyMask = configService.get("whiteInk.customMask", "");
    if (typeof legacyMask !== "string" || legacyMask.length === 0) return;

    const legacyOpacityRaw = configService.get("whiteInk.opacity", 1);
    const legacyOpacity = Number(legacyOpacityRaw);
    const item = this.normalizeItem({
      id: this.generateId(),
      url: legacyMask,
      opacity: Number.isFinite(legacyOpacity) ? legacyOpacity : 1,
    } as WhiteInkItem);

    this.items = [item];
    this.workingItems = this.cloneItems(this.items);
    this.isUpdatingConfig = true;
    configService.update("whiteInk.items", this.items);
    setTimeout(() => {
      this.isUpdatingConfig = false;
    }, 0);
  }

  private syncToolActiveFromWorkbench(fallbackId?: string | null) {
    const wb = this.context?.services.get<WorkbenchService>("WorkbenchService");
    const activeId = wb?.activeToolId;
    if (typeof activeId === "string" || activeId === null) {
      this.isToolActive = activeId === this.id;
      return;
    }
    this.isToolActive = fallbackId === this.id;
  }

  private isWhiteInkEditingVisible(): boolean {
    return this.isToolActive || this.isSelectionActive || !!this.focusedItemId;
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

  private normalizeItem(item: WhiteInkItem): WhiteInkItem {
    return {
      ...item,
      id: String(item.id || this.generateId()),
      url: typeof item.url === "string" ? item.url : "",
      opacity: Number.isFinite(item.opacity as any)
        ? Math.max(0, Math.min(1, item.opacity))
        : 1,
      scale: Number.isFinite(item.scale as any) ? Math.max(0.05, item.scale!) : 1,
      angle: Number.isFinite(item.angle as any) ? item.angle : 0,
      left: Number.isFinite(item.left as any) ? item.left : 0.5,
      top: Number.isFinite(item.top as any) ? item.top : 0.5,
    };
  }

  private normalizeItems(items: WhiteInkItem[]): WhiteInkItem[] {
    return (items || [])
      .filter((item) => !!item?.url)
      .map((item) => this.normalizeItem(item));
  }

  private cloneItems(items: WhiteInkItem[]): WhiteInkItem[] {
    return this.normalizeItems((items || []).map((item) => ({ ...item })));
  }

  private generateId(): string {
    return `white-ink-${Math.random().toString(36).slice(2, 9)}`;
  }

  private getConfig<T>(key: string, fallback?: T): T | undefined {
    if (!this.context) return fallback;
    const configService = this.context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (!configService) return fallback;
    return (configService.get(key, fallback) as T) ?? fallback;
  }

  private getWhiteInkIdFromActiveObject(): string | null {
    const active = this.canvasService?.canvas.getActiveObject() as any;
    if (
      active?.data?.layerId === WHITE_INK_OBJECT_LAYER_ID &&
      typeof active?.data?.id === "string"
    ) {
      return active.data.id;
    }
    return null;
  }

  private resolveReplaceTargetId(explicitId?: string | null): string | null {
    const has = (id: string | null | undefined) =>
      !!id && this.items.some((item) => item.id === id);

    if (has(explicitId)) return explicitId as string;
    if (has(this.focusedItemId)) return this.focusedItemId as string;

    const activeId = this.getWhiteInkIdFromActiveObject();
    if (has(activeId)) return activeId;
    if (this.items.length === 1) return this.items[0].id;
    return null;
  }

  private updateConfig(newItems: WhiteInkItem[], skipCanvasUpdate = false) {
    if (!this.context) return;

    this.isUpdatingConfig = true;
    this.items = this.normalizeItems(newItems);
    if (!this.isToolActive || !this.hasWorkingChanges) {
      this.workingItems = this.cloneItems(this.items);
      this.hasWorkingChanges = false;
    }

    const configService = this.context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    configService?.update("whiteInk.items", this.items);

    if (!skipCanvasUpdate) {
      this.updateWhiteInks();
    }

    setTimeout(() => {
      this.isUpdatingConfig = false;
    }, 50);
  }

  private async addWhiteInkEntry(
    url: string,
    options?: Partial<WhiteInkItem>,
  ): Promise<string> {
    const id = this.generateId();
    const item = this.normalizeItem({
      id,
      url,
      opacity: 1,
      ...options,
    } as WhiteInkItem);

    this.focusedItemId = id;
    this.isSelectionActive = true;
    const sessionDirtyBeforeAdd = this.isToolActive && this.hasWorkingChanges;
    const waitLoaded = this.waitWhiteInkLoaded(id);
    this.updateConfig([...this.items, item]);
    this.addItemToWorkingSessionIfNeeded(item, sessionDirtyBeforeAdd);
    const loaded = await waitLoaded;
    if (loaded) this.focusWhiteInkSelection(id);
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

  private waitWhiteInkLoaded(id: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const onLoaded = () => {
        if (settled) return;
        settled = true;
        if (this.loadResolvers.get(id) === onLoaded) {
          this.loadResolvers.delete(id);
        }
        resolve(true);
      };
      this.loadResolvers.set(id, onLoaded);
      setTimeout(() => {
        if (settled) return;
        settled = true;
        if (this.loadResolvers.get(id) === onLoaded) {
          this.loadResolvers.delete(id);
        }
        resolve(false);
      }, 3000);
    });
  }

  private focusWhiteInkSelection(id: string) {
    if (!this.canvasService) return;
    const obj = this.getWhiteInkObject(id);
    if (!obj) return;
    this.canvasService.canvas.setActiveObject(obj);
    this.canvasService.requestRenderAll();
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
      return this.normalizeItem({ ...item, ...updates });
    });
    if (!changed) return;

    this.workingItems = this.cloneItems(next);
    this.focusedItemId = id;
    this.hasWorkingChanges = true;
    this.updateWhiteInks();
  }

  private updateWhiteInkInConfig(id: string, updates: Partial<WhiteInkItem>) {
    let changed = false;
    const next = this.items.map((item) => {
      if (item.id !== id) return item;
      changed = true;
      return this.normalizeItem({ ...item, ...updates });
    });
    if (!changed) return;

    this.focusedItemId = id;
    this.updateConfig(next);
  }

  private removeWhiteInk(id: string) {
    const removed = this.items.find((item) => item.id === id);
    const next = this.items.filter((item) => item.id !== id);
    if (next.length === this.items.length) return;

    this.purgeSourceSizeCacheForItem(removed);
    if (this.focusedItemId === id) {
      this.focusedItemId = null;
      this.isSelectionActive = false;
    }
    this.updateConfig(next);
  }

  private clearWhiteInks() {
    this.sourceSizeBySrc.clear();
    this.focusedItemId = null;
    this.isSelectionActive = false;
    this.updateConfig([]);
  }

  private async completeWhiteInks() {
    this.updateConfig(this.cloneItems(this.workingItems));
    this.hasWorkingChanges = false;
    return { ok: true };
  }

  private getFrameRect(): FrameRect {
    if (!this.canvasService) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }

    const canvasW = this.canvasService.canvas.width || 0;
    const canvasH = this.canvasService.canvas.height || 0;
    const rawW = this.getConfig<any>("dieline.width", 0) ?? 0;
    const rawH = this.getConfig<any>("dieline.height", 0) ?? 0;
    const dielineWidth = parseLengthToMm(rawW, "mm");
    const dielineHeight = parseLengthToMm(rawH, "mm");

    if (
      !Number.isFinite(dielineWidth) ||
      !Number.isFinite(dielineHeight) ||
      dielineWidth <= 0 ||
      dielineHeight <= 0
    ) {
      return { left: 0, top: 0, width: canvasW, height: canvasH };
    }

    this.canvasService.viewport.updateContainer(canvasW, canvasH);
    this.canvasService.viewport.updatePhysical(dielineWidth, dielineHeight);
    const layout = this.canvasService.viewport.layout;
    if (
      !Number.isFinite(layout.offsetX) ||
      !Number.isFinite(layout.offsetY) ||
      !Number.isFinite(layout.width) ||
      !Number.isFinite(layout.height) ||
      layout.width <= 0 ||
      layout.height <= 0
    ) {
      return { left: 0, top: 0, width: canvasW, height: canvasH };
    }

    return {
      left: layout.offsetX,
      top: layout.offsetY,
      width: layout.width,
      height: layout.height,
    };
  }

  private clampNormalized(value: number): number {
    return Math.max(-1, Math.min(2, value));
  }

  private getWhiteInkObjects(): any[] {
    if (!this.canvasService) return [];
    return this.canvasService.canvas.getObjects().filter((obj: any) => {
      return obj?.data?.layerId === WHITE_INK_OBJECT_LAYER_ID;
    }) as any[];
  }

  private getWhiteInkObject(id: string): any | undefined {
    return this.getWhiteInkObjects().find((obj: any) => obj?.data?.id === id);
  }

  private clearRenderedWhiteInks() {
    if (!this.canvasService) return;
    const canvas = this.canvasService.canvas;
    this.getWhiteInkObjects().forEach((obj) => canvas.remove(obj));
    this.canvasService.requestRenderAll();
  }

  private purgeSourceSizeCacheForItem(item?: WhiteInkItem) {
    if (!item?.url) return;
    this.sourceSizeBySrc.delete(item.url);
  }

  private rememberSourceSize(src: string, obj: any) {
    const width = Number(obj?.width || 0);
    const height = Number(obj?.height || 0);
    if (src && width > 0 && height > 0) {
      this.sourceSizeBySrc.set(src, { width, height });
    }
  }

  private getSourceSize(src: string, obj?: any): SourceSize {
    const cached = src ? this.sourceSizeBySrc.get(src) : undefined;
    if (cached) return cached;

    const width = Number(obj?.width || 0);
    const height = Number(obj?.height || 0);
    if (src && width > 0 && height > 0) {
      const size = { width, height };
      this.sourceSizeBySrc.set(src, size);
      return size;
    }

    return { width: 1, height: 1 };
  }

  private getCoverScale(frame: FrameRect, size: SourceSize): number {
    const sw = Math.max(1, size.width);
    const sh = Math.max(1, size.height);
    const fw = Math.max(1, frame.width);
    const fh = Math.max(1, frame.height);
    return Math.max(fw / sw, fh / sh);
  }

  private resolveRenderState(item: WhiteInkItem): RenderWhiteInkState {
    return {
      src: item.url,
      left: Number.isFinite(item.left as any) ? (item.left as number) : 0.5,
      top: Number.isFinite(item.top as any) ? (item.top as number) : 0.5,
      scale: Math.max(0.05, item.scale ?? 1),
      angle: Number.isFinite(item.angle as any) ? (item.angle as number) : 0,
      opacity: Math.max(0, Math.min(1, item.opacity)),
    };
  }

  private computeCanvasProps(
    render: RenderWhiteInkState,
    size: SourceSize,
    frame: FrameRect,
  ) {
    const centerX = frame.left + render.left * frame.width;
    const centerY = frame.top + render.top * frame.height;
    const scale = this.getCoverScale(frame, size) * render.scale;
    const editable = this.isWhiteInkEditingVisible();

    return {
      left: centerX,
      top: centerY,
      scaleX: scale,
      scaleY: scale,
      angle: render.angle,
      originX: "center" as const,
      originY: "center" as const,
      uniformScaling: true,
      lockScalingFlip: true,
      selectable: editable,
      evented: editable,
      hasControls: editable,
      hasBorders: editable,
      opacity: render.opacity,
    };
  }

  private getCurrentSrc(obj: any): string | undefined {
    if (!obj) return undefined;
    if (typeof obj.getSrc === "function") return obj.getSrc();
    return obj?._originalElement?.src;
  }

  private async upsertWhiteInkObject(
    item: WhiteInkItem,
    frame: FrameRect,
    seq: number,
  ) {
    if (!this.canvasService) return;
    const canvas = this.canvasService.canvas;
    const render = this.resolveRenderState(item);
    if (!render.src) return;

    let obj = this.getWhiteInkObject(item.id);
    const currentSrc = this.getCurrentSrc(obj);

    if (obj && currentSrc && currentSrc !== render.src) {
      canvas.remove(obj);
      obj = undefined;
    }

    if (!obj) {
      const created = await FabricImage.fromURL(render.src, {
        crossOrigin: "anonymous",
      });
      if (seq !== this.renderSeq) return;

      created.set({
        data: {
          id: item.id,
          layerId: WHITE_INK_OBJECT_LAYER_ID,
          type: "white-ink-item",
        },
      } as any);
      canvas.add(created as any);
      obj = created as any;
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

    const resolver = this.loadResolvers.get(item.id);
    if (resolver) {
      resolver();
      this.loadResolvers.delete(item.id);
    }
  }

  private syncZOrder(items: WhiteInkItem[]) {
    if (!this.canvasService) return;
    const canvas = this.canvasService.canvas;
    const objects = canvas.getObjects();
    let insertIndex = 0;

    const imageIndexes = objects
      .map((obj: any, index: number) =>
        obj?.data?.layerId === "image.user" ? index : -1,
      )
      .filter((index: number) => index >= 0);

    if (imageIndexes.length > 0) {
      insertIndex = Math.max(...imageIndexes) + 1;
    } else {
      const backgroundLayer = this.canvasService.getLayer("background");
      if (backgroundLayer) {
        const bgIndex = objects.indexOf(backgroundLayer as any);
        if (bgIndex >= 0) insertIndex = bgIndex + 1;
      }
    }

    items.forEach((item) => {
      const obj = this.getWhiteInkObject(item.id);
      if (!obj) return;
      canvas.moveObjectTo(obj, insertIndex);
      insertIndex += 1;
    });

    canvas
      .getObjects()
      .filter((obj: any) => obj?.data?.layerId === "image-overlay")
      .forEach((obj: any) => canvas.bringObjectToFront(obj));

    const dielineOverlay = this.canvasService.getLayer("dieline-overlay");
    if (dielineOverlay) {
      canvas.bringObjectToFront(dielineOverlay as any);
    }
  }

  private updateWhiteInks() {
    void this.updateWhiteInksAsync();
  }

  private async updateWhiteInksAsync() {
    if (!this.canvasService) return;
    this.syncToolActiveFromWorkbench();
    const seq = ++this.renderSeq;

    const renderItems = this.printWithWhiteInk
      ? this.isToolActive
        ? this.workingItems
        : this.items
      : [];
    const frame = this.getFrameRect();
    const desiredIds = new Set(renderItems.map((item) => item.id));

    if (this.focusedItemId && !desiredIds.has(this.focusedItemId)) {
      this.focusedItemId = null;
      this.isSelectionActive = false;
    }

    this.getWhiteInkObjects().forEach((obj: any) => {
      const id = obj?.data?.id;
      if (typeof id === "string" && !desiredIds.has(id)) {
        this.canvasService?.canvas.remove(obj);
      }
    });

    for (const item of renderItems) {
      if (seq !== this.renderSeq) return;
      await this.upsertWhiteInkObject(item, frame, seq);
    }
    if (seq !== this.renderSeq) return;

    this.syncZOrder(renderItems);
    this.canvasService.requestRenderAll();
  }
}
