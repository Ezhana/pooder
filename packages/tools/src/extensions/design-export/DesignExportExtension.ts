import {
  ExtensionContext,
  ExtensionContributions,
  ExtensionDefinition,
} from "@pooder/core";
import {
  SCENE_EXPORT_SERVICE,
  SCENE_FRAME_SERVICE,
  SCENE_SERVICE,
  SceneFrameService,
  SceneService,
  SceneExportService,
  type SceneExportResult,
  type SceneExportSourceSelector,
} from "@pooder/core";
import {
  createDesignExportCapabilityDefinition,
  DESIGN_EXPORT_CAPABILITY_ID,
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
      SCENE_EXPORT_SERVICE,
      SCENE_FRAME_SERVICE,
      SCENE_SERVICE,
    ],
  };

  private exportService?: SceneExportService;
  private sceneFrameService?: SceneFrameService;
  private sceneService?: SceneService;
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
    this.sceneFrameService =
      context.services.getOrThrow<SceneFrameService>(SCENE_FRAME_SERVICE);
    this.sceneService =
      context.services.getOrThrow<SceneService>(SCENE_SERVICE);
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
    if (!this.exportService || !this.sceneFrameService || !this.sceneService) {
      throw new Error("design-export-not-initialized");
    }

    try {
      const results: SceneExportResult[] = [];
      for (const sceneId of this.sceneService.listDocumentSceneIds()) {
        const frames = this.sceneFrameService.getFrames(sceneId);
        if (!frames) throw new Error("design-export-frame-unavailable");
        const frame = frames.export ?? frames.production;
        results.push(
          await this.exportService.exportImage({
            ...options,
            sceneId,
            crop: {
              type: "sceneRect",
              rect: {
                left: frame.xMm,
                top: frame.yMm,
                width: frame.widthMm,
                height: frame.heightMm,
                space: "scene",
              },
            },
            includeHidden: options.includeHidden ?? true,
            source: options.source ?? this.resolveDefaultSource(),
          }),
        );
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

  private getDesignExportFacade(): DesignExportCapabilityApi {
    return {
      exportImage: (options) => this.exportImage(options),
    };
  }
}
