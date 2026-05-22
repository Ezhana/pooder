import {
  ExtensionContext,
  ExtensionContributions,
  ExtensionDefinition,
} from "@pooder/core";
import {
  SCENE_EXPORT_SERVICE,
  type SceneExportOutputMaskMode,
  type SceneExportService,
} from "@pooder/core";
import {
  createMockupExportCapabilityDefinition,
  MOCKUP_EXPORT_CAPABILITY_ID,
  normalizeMockupExportIds,
  type MockupExportCapabilityApi,
  type MockupExportCapabilityOptions,
  type MockupExportOptions,
  type MockupExportResult,
} from "./capability";

const MOCKUP_EXPORT_OUTPUT_MASK_MODES = new Set([
  "alpha",
  "outline",
  "shape",
]);

export interface MockupExportCapabilityExtensionOptions
  extends MockupExportCapabilityOptions {
  id?: string;
}

export class MockupExportCapabilityExtension implements ExtensionDefinition {
  id: string;
  metadata = {
    name: "MockupExportCapabilityExtension",
  };
  activation = {
    requiresServices: [SCENE_EXPORT_SERVICE],
  };

  private exportService?: SceneExportService;
  private readonly capabilityId: string;

  constructor(options: MockupExportCapabilityExtensionOptions = {}) {
    this.id = String(options.id || MOCKUP_EXPORT_CAPABILITY_ID).trim() ||
      MOCKUP_EXPORT_CAPABILITY_ID;
    this.capabilityId = options.capabilityId || MOCKUP_EXPORT_CAPABILITY_ID;
  }

  activate(context: ExtensionContext) {
    this.exportService = context.services.getOrThrow<SceneExportService>(
      SCENE_EXPORT_SERVICE,
    );
  }

  deactivate() {
    this.exportService = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createMockupExportCapabilityDefinition(this.getFacade(), {
          capabilityId: this.capabilityId,
        }),
      ],
    };
  }

  async exportMockup(
    options: MockupExportOptions = {},
  ): Promise<MockupExportResult> {
    if (!this.exportService) {
      throw new Error("mockup-export-not-initialized");
    }

    const sourceLayerIds = normalizeMockupExportIds(options.sourceLayerIds);
    const sourceElementIds = normalizeMockupExportIds(options.sourceElementIds);
    const outputMask = this.normalizeOutputMask(options.outputMask);
    const format = outputMask ? "png" : options.format;

    try {
      const result = await this.exportService.exportImage({
        ...options,
        format,
        crop: options.crop ?? { type: "frame", frame: "cut" },
        ...(outputMask ? { outputMask } : {}),
        preserveClipPaths: options.preserveClipPaths ?? true,
        sourceLayerIds,
        sourceElementIds,
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
          throw new Error("mockup-export-empty");
        }
        if (error.message === "browser-scene-export-browser-required") {
          throw new Error("mockup-export-browser-required");
        }
        if (
          error.message === "browser-scene-export-frame-unavailable" ||
          error.message === "browser-scene-export-crop-unavailable"
        ) {
          throw new Error("mockup-export-frame-unavailable");
        }
        if (error.message === "browser-scene-export-failed") {
          throw new Error("mockup-export-failed");
        }
        if (error.message.startsWith("browser-scene-export-output-mask-")) {
          throw new Error(
            error.message.replace(
              "browser-scene-export-output-mask-",
              "mockup-export-output-mask-",
            ),
          );
        }
      }
      throw error;
    }
  }

  private normalizeOutputMask(
    value: MockupExportOptions["outputMask"],
  ): MockupExportOptions["outputMask"] | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    const sourceKey = String(value.sourceKey || "").trim();
    if (!sourceKey) {
      throw new Error("mockup-export-output-mask-source-key-required");
    }

    const mode = String(value.mode || "alpha").trim();
    return {
      sourceKey,
      mode: MOCKUP_EXPORT_OUTPUT_MASK_MODES.has(mode)
        ? mode as SceneExportOutputMaskMode
        : "alpha",
    };
  }

  private getFacade(): MockupExportCapabilityApi {
    return {
      exportMockup: (options) => this.exportMockup(options),
    };
  }
}
