import {
  CONFIGURATION_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_BOUNDS_SERVICE,
  SCENE_EXPORT_SERVICE,
  sceneContentRect,
  type ConfigurationService,
  type ExtensionContext,
  type ExtensionContributions,
  type ExtensionDefinition,
  type RenderIntentService,
  type SceneBoundsService,
  type SceneExportOutputMask,
  type SceneExportService,
  type SceneExportSourceSelector,
} from "@pooder/core";
import {
  createExportCapabilityDefinition,
  defaultSourceForPurpose,
  EXPORT_CAPABILITY_ID,
  resolveDefaultOutputMask,
  resolveExportCrop,
  type ExportCapabilityApi,
  type ExportCapabilityOptions,
  type ExportImageOptions,
  type ExportImageResult,
} from "./capability";

export interface ExportCapabilityExtensionOptions extends ExportCapabilityOptions {
  id?: string;
}

export class ExportCapability implements ExtensionDefinition {
  id: string;
  public metadata = {
    name: "ExportCapability",
  };
  activation = {
    requiresServices: [
      CONFIGURATION_SERVICE,
      RENDER_INTENT_SERVICE,
      SCENE_BOUNDS_SERVICE,
      SCENE_EXPORT_SERVICE,
    ],
  };

  private exportService?: SceneExportService;
  private sceneBoundsService?: SceneBoundsService;
  private configService?: ConfigurationService;
  private renderIntentService?: RenderIntentService;
  private readonly capabilityId: string;

  constructor(options: ExportCapabilityExtensionOptions = {}) {
    this.id =
      String(options.id || EXPORT_CAPABILITY_ID).trim() || EXPORT_CAPABILITY_ID;
    this.capabilityId = options.capabilityId || EXPORT_CAPABILITY_ID;
  }

  activate(context: ExtensionContext) {
    this.exportService =
      context.services.getOrThrow<SceneExportService>(SCENE_EXPORT_SERVICE);
    this.sceneBoundsService =
      context.services.getOrThrow<SceneBoundsService>(SCENE_BOUNDS_SERVICE);
    this.configService =
      context.services.getOrThrow<ConfigurationService>(CONFIGURATION_SERVICE);
    this.renderIntentService =
      context.services.getOrThrow<RenderIntentService>(RENDER_INTENT_SERVICE);
  }

  deactivate() {
    this.exportService = undefined;
    this.sceneBoundsService = undefined;
    this.configService = undefined;
    this.renderIntentService = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createExportCapabilityDefinition(this.getFacade(), {
          capabilityId: this.capabilityId,
        }),
      ],
      configurations: [
        {
          id: "export.cutMode",
          type: "select",
          label: "Export cut mode",
          default: "trim",
          options: ["trim", "outset", "inset"],
        },
        {
          id: "export.cutMarginMm",
          type: "number",
          label: "Export cut margin (mm)",
          default: 0,
          min: 0,
        },
      ],
    };
  }

  async exportImage(options: ExportImageOptions): Promise<ExportImageResult> {
    if (
      !this.exportService ||
      !this.sceneBoundsService ||
      !this.configService ||
      !this.renderIntentService
    ) {
      throw new Error("export-not-initialized");
    }

    const sceneId = String(options.sceneId || "").trim();
    if (!sceneId) throw new Error("export-scene-required");
    if (options.purpose !== "design" && options.purpose !== "mockup") {
      throw new Error("export-purpose-required");
    }

    const sceneBounds = this.sceneBoundsService.getBounds(sceneId);
    if (!sceneBounds) throw new Error("export-frame-unavailable");

    const source: SceneExportSourceSelector =
      options.source ?? defaultSourceForPurpose(options.purpose);
    const outputMask: SceneExportOutputMask | undefined =
      resolveDefaultOutputMask(
        options.purpose,
        this.collectOutputMaskKeys(sceneId),
        options.outputMask,
      );

    try {
      const result = await this.exportService.exportImage({
        sceneId,
        format: options.format,
        multiplier: options.multiplier,
        preserveClipPaths: options.preserveClipPaths ?? true,
        ...(outputMask ? { format: "png" as const, outputMask } : {}),
        crop: resolveExportCrop({
          purpose: options.purpose,
          content: sceneContentRect(sceneBounds),
          crop: options.crop,
          cutMode: this.configService.get("export.cutMode"),
          cutMarginMm: this.configService.get("export.cutMarginMm", 0),
          minMm: this.configService.get("size.minMm", 0.1),
        }),
        source,
      });
      return {
        url: result.url,
        width: result.width,
        height: result.height,
        format: result.format,
        multiplier: result.multiplier,
        source: result.source,
        crop: result.crop,
        sceneId: result.sceneId,
      };
    } catch (error) {
      throw mapExportError(error);
    }
  }

  private collectOutputMaskKeys(sceneId: string): string[] {
    const graph = this.renderIntentService?.getDocumentGraph();
    if (!graph) return [];
    const keys: string[] = [];
    for (const layer of graph.layers) {
      if (layer.sceneId !== sceneId) continue;
      for (const node of layer.nodes) {
        const raw = node.data.outputMaskKeys;
        if (!Array.isArray(raw)) continue;
        for (const value of raw) {
          const key = String(value || "").trim();
          if (key && !keys.includes(key)) keys.push(key);
        }
      }
    }
    return keys;
  }

  private getFacade(): ExportCapabilityApi {
    return {
      exportImage: (options) => this.exportImage(options),
    };
  }
}

function mapExportError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error("export-failed");
  }
  if (error.message === "browser-scene-export-empty") {
    return new Error("export-empty");
  }
  if (error.message === "browser-scene-export-browser-required") {
    return new Error("export-browser-required");
  }
  if (
    error.message === "browser-scene-export-crop-unavailable" ||
    error.message === "browser-scene-export-bounds-unavailable"
  ) {
    return new Error("export-frame-unavailable");
  }
  if (error.message === "browser-scene-export-failed") {
    return new Error("export-failed");
  }
  if (error.message.startsWith("browser-scene-export-output-mask-")) {
    return new Error(
      error.message.replace(
        "browser-scene-export-output-mask-",
        "export-output-mask-",
      ),
    );
  }
  return error;
}
