import {
  ExtensionContext,
  ExtensionContributions,
  ExtensionDefinition,
} from "@pooder/core";
import {
  CONFIGURATION_SERVICE,
  SCENE_BOUNDS_SERVICE,
  SCENE_EXPORT_SERVICE,
  SCENE_SERVICE,
  sceneContentRect,
  type ConfigurationService,
  type CoordinateRect,
  type RectMm,
  type SceneBoundsService,
  SceneService,
  SceneExportService,
  type SceneExportResult,
  type SceneExportSourceSelector,
} from "@pooder/core";
import {
  applyCutMarginToRect,
  createDesignExportCapabilityDefinition,
  DESIGN_EXPORT_CAPABILITY_ID,
  normalizeCutMode,
  sceneCropFromRectMm,
  type DesignExportCapabilityApi,
  type DesignExportCapabilityOptions,
  type ExportImageOptions,
  type ExportImageResult,
} from "./capability";
import { createDesignExportCommands } from "./commands";

export type {
  ExportImageFormat,
  ExportImageOptions,
  ExportImageResult,
} from "./capability";

const DEFAULT_DESIGN_EXPORT_TAGS = ["export:design"] as const;

export interface DesignExportExtensionOptions extends DesignExportCapabilityOptions {
  id?: string;
  contributeCommands?: boolean;
}

export class DesignExportExtension implements ExtensionDefinition {
  id: string;
  public metadata = {
    name: "DesignExportExtension",
  };
  activation = {
    requiresServices: [
      CONFIGURATION_SERVICE,
      SCENE_BOUNDS_SERVICE,
      SCENE_EXPORT_SERVICE,
      SCENE_SERVICE,
    ],
  };

  private exportService?: SceneExportService;
  private sceneBoundsService?: SceneBoundsService;
  private sceneService?: SceneService;
  private configService?: ConfigurationService;
  private readonly capabilityId: string;
  private readonly configuredSource?: SceneExportSourceSelector;
  private readonly contributeLegacyCommands: boolean;

  constructor(options: DesignExportExtensionOptions = {}) {
    this.id =
      String(options.id || DESIGN_EXPORT_CAPABILITY_ID).trim() ||
      DESIGN_EXPORT_CAPABILITY_ID;
    this.capabilityId = options.capabilityId || DESIGN_EXPORT_CAPABILITY_ID;
    this.configuredSource = options.source;
    this.contributeLegacyCommands = options.contributeCommands !== false;
  }

  activate(context: ExtensionContext) {
    this.exportService =
      context.services.getOrThrow<SceneExportService>(SCENE_EXPORT_SERVICE);
    this.sceneBoundsService =
      context.services.getOrThrow<SceneBoundsService>(SCENE_BOUNDS_SERVICE);
    this.sceneService =
      context.services.getOrThrow<SceneService>(SCENE_SERVICE);
    this.configService =
      context.services.getOrThrow<ConfigurationService>(CONFIGURATION_SERVICE);
  }

  contribute(): ExtensionContributions {
    const contributions: ExtensionContributions = {
      capabilities: [
        createDesignExportCapabilityDefinition(this.getDesignExportFacade(), {
          capabilityId: this.capabilityId,
          source: this.resolveDefaultSource(),
        }),
      ],
    };

    if (this.contributeLegacyCommands) {
      contributions.commands = createDesignExportCommands(this);
    }

    return contributions;
  }

  private resolveDefaultSource(): SceneExportSourceSelector {
    if (this.configuredSource) return this.configuredSource;
    return {
      tags: DEFAULT_DESIGN_EXPORT_TAGS,
    };
  }

  async exportImage(
    options: ExportImageOptions = {},
  ): Promise<ExportImageResult[]> {
    if (
      !this.exportService ||
      !this.sceneBoundsService ||
      !this.sceneService ||
      !this.configService
    ) {
      throw new Error("design-export-not-initialized");
    }

    const { crop: requestedCrop, ...exportOptions } = options;

    try {
      const results: SceneExportResult[] = [];
      for (const sceneId of this.listExportSceneIds(requestedCrop)) {
        const sceneBounds = this.sceneBoundsService.getBounds(sceneId);
        if (!sceneBounds) throw new Error("design-export-frame-unavailable");
        const cropRect =
          requestedCrop ??
          this.resolveDefaultCrop(sceneContentRect(sceneBounds));
        try {
          results.push(
            await this.exportService.exportImage({
              ...exportOptions,
              sceneId,
              crop: {
                type: "sceneRect",
                rect: cropRect,
              },
              includeHidden: options.includeHidden ?? true,
              source: options.source ?? this.resolveDefaultSource(),
            }),
          );
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "browser-scene-export-empty"
          ) {
            continue;
          }
          throw error;
        }
      }

      if (!results.length) {
        throw new Error("no-design-objects-to-export");
      }

      return results.map((result) => ({
        url: result.url,
        width: result.width,
        height: result.height,
        format: result.format,
        multiplier: result.multiplier,
        source: result.source,
        crop: result.crop,
        sceneId: result.sceneId,
      }));
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "browser-scene-export-empty") {
          throw new Error("no-design-objects-to-export");
        }
        if (error.message === "browser-scene-export-browser-required") {
          throw new Error("design-export-browser-required");
        }
        if (error.message === "browser-scene-export-crop-unavailable") {
          throw new Error("design-export-frame-unavailable");
        }
        if (error.message === "browser-scene-export-failed") {
          throw new Error("design-export-failed");
        }
      }
      throw error;
    }
  }

  private listExportSceneIds(
    requestedCrop: CoordinateRect<"scene"> | undefined,
  ): string[] {
    const sceneIds = this.sceneService?.listDocumentSceneIds() ?? [];
    if (!requestedCrop) return sceneIds;
    const activeId = this.sceneService?.getActiveRoot()?.id;
    const currentId =
      activeId && sceneIds.includes(activeId) ? activeId : sceneIds[0];
    return currentId ? [currentId] : [];
  }

  private resolveDefaultCrop(content: RectMm): CoordinateRect<"scene"> {
    const cutMode = normalizeCutMode(this.configService?.get("size.cutMode"));
    const cutMarginMm = Math.max(
      0,
      Number(this.configService?.get("size.cutMarginMm", 0)) || 0,
    );
    const minMm = Math.max(
      0.1,
      Number(this.configService?.get("size.minMm", 0.1)) || 0.1,
    );
    return sceneCropFromRectMm(
      applyCutMarginToRect(content, cutMode, cutMarginMm, minMm),
    );
  }

  private getDesignExportFacade(): DesignExportCapabilityApi {
    return {
      exportImage: (options) => this.exportImage(options),
    };
  }
}

