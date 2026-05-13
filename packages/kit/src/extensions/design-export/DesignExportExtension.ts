import {
  ExtensionContext,
  ExtensionContributions,
  ExtensionDefinition,
} from "@pooder/core";
import {
  SCENE_SERVICE,
  SCENE_EXPORT_SERVICE,
  type SceneLayer,
  SceneExportService,
  type SceneService,
} from "@pooder/core";
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

function isDefaultExportSceneLayer(layer: SceneLayer): boolean {
  const metadata = layer.metadata ?? {};
  if (metadata.exportable === false) return false;
  const role = typeof metadata.documentLayerRole === "string"
    ? metadata.documentLayerRole.trim()
    : "";
  return role !== "guide" && role !== "overlay";
}

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
    requiresServices: [SCENE_EXPORT_SERVICE],
  };

  private exportService?: SceneExportService;
  private sceneService?: SceneService;
  private readonly capabilityId: string;
  private readonly configuredLayerIds?: readonly string[];
  private readonly contributeLegacyCommands: boolean;

  constructor(options: DesignExportExtensionOptions = {}) {
    this.id = String(options.id || DESIGN_EXPORT_CAPABILITY_ID).trim() ||
      DESIGN_EXPORT_CAPABILITY_ID;
    this.capabilityId = options.capabilityId || DESIGN_EXPORT_CAPABILITY_ID;
    this.configuredLayerIds = options.layers?.sourceLayerIds;
    this.contributeLegacyCommands = options.contributeCommands !== false;
  }

  activate(context: ExtensionContext) {
    this.exportService = context.services.getOrThrow<SceneExportService>(
      SCENE_EXPORT_SERVICE,
    );
    this.sceneService = context.services.get<SceneService>(SCENE_SERVICE);
  }

  contribute(): ExtensionContributions {
    const contributions: ExtensionContributions = {
      capabilities: [
        createDesignExportCapabilityDefinition(this.getDesignExportFacade(), {
          capabilityId: this.capabilityId,
          layers: {
            sourceLayerIds: this.resolveDefaultLayerIds(),
          },
        }),
      ],
    };

    if (this.contributeLegacyCommands) {
      contributions.commands = createDesignExportCommands(this);
    }

    return contributions;
  }

  private resolveDefaultLayerIds(): readonly string[] {
    if (this.configuredLayerIds) return this.configuredLayerIds;
    const sceneLayerIds = this.sceneService
      ?.listLayers()
      .filter(isDefaultExportSceneLayer)
      .map((layer) => layer.id)
      .filter((id) => id.length > 0) ?? [];
    return sceneLayerIds.length > 0 ? sceneLayerIds : DEFAULT_EXPORT_LAYER_IDS;
  }

  async exportImage(
    options: ExportImageOptions = {},
  ): Promise<ExportImageResult> {
    if (!this.exportService) {
      throw new Error("design-export-not-initialized");
    }

    const layerIds = normalizeDesignExportLayerIds(
      options.sourceLayerIds ?? options.layerIds,
      this.resolveDefaultLayerIds(),
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
