import {
  ExtensionContext,
  ExtensionContributions,
  ExtensionDefinition,
} from "@pooder/core";
import {
  BROWSER_SCENE_EXPORT_SERVICE,
  BrowserSceneExportService,
} from "@pooder/platform-browser";
import { KIT_LEGACY_LAYER_PRESET } from "../../shared/constants/layers";
import {
  createDesignExportCapabilityDefinition,
  DESIGN_EXPORT_CAPABILITY_ID,
  normalizeDesignExportLayerIds,
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

const DEFAULT_EXPORT_LAYER_IDS = [
  KIT_LEGACY_LAYER_PRESET.imageObject,
  KIT_LEGACY_LAYER_PRESET.whiteInkObject,
] as const;

export interface DesignExportExtensionOptions
  extends DesignExportCapabilityOptions {
  id?: string;
  contributeCommands?: boolean;
}

export class DesignExportExtension implements ExtensionDefinition {
  id: string;
  public metadata = {
    name: "DesignExportExtension",
  };
  activation = {
    requiresServices: [BROWSER_SCENE_EXPORT_SERVICE],
  };

  private exportService?: BrowserSceneExportService;
  private readonly capabilityId: string;
  private readonly defaultLayerIds: readonly string[];
  private readonly contributeLegacyCommands: boolean;

  constructor(options: DesignExportExtensionOptions = {}) {
    this.id = String(options.id || DESIGN_EXPORT_CAPABILITY_ID).trim() ||
      DESIGN_EXPORT_CAPABILITY_ID;
    this.capabilityId = options.capabilityId || DESIGN_EXPORT_CAPABILITY_ID;
    this.defaultLayerIds = options.layers?.sourceLayerIds ||
      DEFAULT_EXPORT_LAYER_IDS;
    this.contributeLegacyCommands = options.contributeCommands !== false;
  }

  activate(context: ExtensionContext) {
    this.exportService = context.services.getOrThrow<BrowserSceneExportService>(
      BROWSER_SCENE_EXPORT_SERVICE,
    );
  }

  contribute(): ExtensionContributions {
    const contributions: ExtensionContributions = {
      capabilities: [
        createDesignExportCapabilityDefinition(this.getDesignExportFacade(), {
          capabilityId: this.capabilityId,
          layers: {
            sourceLayerIds: this.defaultLayerIds,
          },
        }),
      ],
    };

    if (this.contributeLegacyCommands) {
      contributions.commands = createDesignExportCommands(this);
    }

    return contributions;
  }

  async exportImage(
    options: ExportImageOptions = {},
  ): Promise<ExportImageResult> {
    if (!this.exportService) {
      throw new Error("design-export-not-initialized");
    }

    const layerIds = normalizeDesignExportLayerIds(
      options.sourceLayerIds ?? options.layerIds,
      this.defaultLayerIds,
    );
    try {
      const result = await this.exportService.exportImage({
        ...options,
        crop: options.crop ?? { type: "frame", frame: "cut" },
        includeHidden: options.includeHidden ?? true,
        sourceLayerIds: layerIds,
      });

      return {
        url: result.url,
        width: result.width,
        height: result.height,
        format: result.format,
        multiplier: result.multiplier,
        layerIds: result.sourceLayerIds,
        sourceElementIds: result.sourceElementIds,
        crop: result.crop,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "browser-scene-export-empty") {
          throw new Error("no-design-objects-to-export");
        }
        if (error.message === "browser-scene-export-browser-required") {
          throw new Error("design-export-browser-required");
        }
        if (
          error.message === "browser-scene-export-frame-unavailable" ||
          error.message === "browser-scene-export-crop-unavailable"
        ) {
          throw new Error("design-export-frame-unavailable");
        }
        if (error.message === "browser-scene-export-failed") {
          throw new Error("design-export-failed");
        }
      }
      throw error;
    }
  }

  private getDesignExportFacade(): DesignExportCapabilityApi {
    return {
      exportImage: (options) => this.exportImage(options),
    };
  }
}
