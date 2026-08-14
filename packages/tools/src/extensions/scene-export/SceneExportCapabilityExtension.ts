import {
  type ExtensionContext,
  type ExtensionContributions,
  type ExtensionDefinition,
  SCENE_EXPORT_SERVICE,
  type SceneExportOptions,
  type SceneExportService,
} from "@pooder/core";
import {
  createSceneExportCapabilityDefinition,
  SCENE_EXPORT_CAPABILITY_ID,
  type SceneExportCapabilityApi,
  type SceneExportCapabilityOptions,
  type SceneExportCapabilityResult,
} from "./capability";

export interface SceneExportCapabilityExtensionOptions extends SceneExportCapabilityOptions {
  id?: string;
}

export class SceneExportCapabilityExtension implements ExtensionDefinition {
  id: string;
  metadata = {
    name: "SceneExportCapabilityExtension",
  };
  activation = {
    requiresServices: [SCENE_EXPORT_SERVICE],
  };

  private exportService?: SceneExportService;
  private readonly capabilityId: string;

  constructor(options: SceneExportCapabilityExtensionOptions = {}) {
    this.id =
      String(options.id || SCENE_EXPORT_CAPABILITY_ID).trim() ||
      SCENE_EXPORT_CAPABILITY_ID;
    this.capabilityId = options.capabilityId || SCENE_EXPORT_CAPABILITY_ID;
  }

  activate(context: ExtensionContext) {
    this.exportService =
      context.services.getOrThrow<SceneExportService>(SCENE_EXPORT_SERVICE);
  }

  deactivate() {
    this.exportService = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createSceneExportCapabilityDefinition(this.getFacade(), {
          capabilityId: this.capabilityId,
        }),
      ],
    };
  }

  async exportImage(
    options: SceneExportOptions = {},
  ): Promise<SceneExportCapabilityResult> {
    if (!this.exportService) {
      throw new Error("scene-export-not-initialized");
    }

    try {
      const result = await this.exportService.exportImage({
        ...options,
        crop: options.crop ?? { type: "frame", frame: "cut" },
        preserveClipPaths: options.preserveClipPaths ?? true,
        ...(options.outputMask ? { format: "png" as const } : {}),
      });

      return {
        url: result.url,
        width: result.width,
        height: result.height,
        format: result.format,
        multiplier: result.multiplier,
        source: result.source,
        crop: result.crop,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "browser-scene-export-empty") {
          throw new Error("scene-export-empty");
        }
        if (error.message === "browser-scene-export-browser-required") {
          throw new Error("scene-export-browser-required");
        }
        if (
          error.message === "browser-scene-export-frame-unavailable" ||
          error.message === "browser-scene-export-crop-unavailable"
        ) {
          throw new Error("scene-export-frame-unavailable");
        }
        if (error.message === "browser-scene-export-failed") {
          throw new Error("scene-export-failed");
        }
        if (error.message.startsWith("browser-scene-export-output-mask-")) {
          throw new Error(
            error.message.replace(
              "browser-scene-export-output-mask-",
              "scene-export-output-mask-",
            ),
          );
        }
      }
      throw error;
    }
  }

  private getFacade(): SceneExportCapabilityApi {
    return {
      exportImage: (options) => this.exportImage(options),
    };
  }
}
