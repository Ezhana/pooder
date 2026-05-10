import {
  COMMAND_SERVICE,
  CONFIGURATION_SERVICE,
  type CommandContribution,
  type CommandService,
  type ConfigurationService,
  type ExtensionContext,
  type ExtensionContributions,
  type ExtensionDefinition,
} from "@pooder/core";

export interface DetectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectEdgeResult {
  pathData: string;
  rawBounds?: DetectBounds;
  baseBounds?: DetectBounds;
  imageWidth?: number;
  imageHeight?: number;
}

export interface DetectFrameDiagnostics {
  sourceWidth: number;
  sourceHeight: number;
  detectedBounds: DetectBounds | null;
  centerOffsetX: number;
  centerOffsetY: number;
  coverageX: number;
  coverageY: number;
}

export interface DetectMarginDiagnostics {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DetectPostCommitDiagnostics {
  frame: DetectFrameDiagnostics;
  margin: DetectMarginDiagnostics | null;
  expectedExpand: number;
  marginDeltaFromExpected: DetectMarginDiagnostics | null;
  marginAsymmetry: { x: number; y: number } | null;
}

export interface DetectDielineOptions {
  expand?: number;
  smoothing?: boolean;
  simplifyTolerance?: number;
  threshold?: number;
  maxTraceDimension?: number;
  maskMode?: "auto" | "alpha" | "whitebg";
  debug?: boolean;
}

export interface ExportUserCroppedImageOptions {
  multiplier?: number;
  format?: "png" | "jpeg";
  imageIds?: string[];
}

export interface ExportUserCroppedImageResult {
  url: string;
  width: number;
  height: number;
  multiplier: number;
  format: "png" | "jpeg";
  imageIds: string[];
}

export interface DetectDielineFromFrameOptions {
  detect?: DetectDielineOptions;
  export?: ExportUserCroppedImageOptions;
  inspect?: {
    includeCroppedImage?: boolean;
    includeDiagnostics?: boolean;
  };
  commit?: boolean;
}

export interface DetectDielineFromFrameResult extends DetectEdgeResult {
  sourceImage?: ExportUserCroppedImageResult;
  diagnostics?: DetectFrameDiagnostics;
  postCommitDiagnostics?: DetectPostCommitDiagnostics | null;
}

export interface UploadAndDetectEdgeOptions {
  expand?: number;
  smoothing?: boolean;
  simplifyTolerance?: number;
  maxTraceDimension?: number;
}

export interface UploadAndDetectEdgeResult {
  imageId: string;
  url: string;
  pathData: string;
}

function isValidBounds(bounds?: DetectBounds | null): bounds is DetectBounds {
  return (
    !!bounds &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

function buildDetectFrameDiagnostics(
  result: DetectEdgeResult,
  sourceImage: ExportUserCroppedImageResult,
): DetectFrameDiagnostics {
  const bounds = result.rawBounds || result.baseBounds || null;
  if (!bounds) {
    return {
      sourceWidth: sourceImage.width,
      sourceHeight: sourceImage.height,
      detectedBounds: null,
      centerOffsetX: 0,
      centerOffsetY: 0,
      coverageX: 0,
      coverageY: 0,
    };
  }

  const sourceCenterX = sourceImage.width / 2;
  const sourceCenterY = sourceImage.height / 2;
  const boundsCenterX = bounds.x + bounds.width / 2;
  const boundsCenterY = bounds.y + bounds.height / 2;

  return {
    sourceWidth: sourceImage.width,
    sourceHeight: sourceImage.height,
    detectedBounds: bounds,
    centerOffsetX: boundsCenterX - sourceCenterX,
    centerOffsetY: boundsCenterY - sourceCenterY,
    coverageX: sourceImage.width > 0 ? bounds.width / sourceImage.width : 0,
    coverageY: sourceImage.height > 0 ? bounds.height / sourceImage.height : 0,
  };
}

function buildDetectMarginDiagnostics(
  result: DetectEdgeResult,
): DetectMarginDiagnostics | null {
  if (!isValidBounds(result.rawBounds) || !isValidBounds(result.baseBounds)) {
    return null;
  }

  const raw = result.rawBounds;
  const base = result.baseBounds;
  return {
    left: base.x - raw.x,
    top: base.y - raw.y,
    right: raw.x + raw.width - (base.x + base.width),
    bottom: raw.y + raw.height - (base.y + base.height),
  };
}

function buildDetectPostCommitDiagnostics(
  result: DetectEdgeResult,
  sourceImage: ExportUserCroppedImageResult,
  expectedExpand: number,
): DetectPostCommitDiagnostics {
  const frame = buildDetectFrameDiagnostics(result, sourceImage);
  const margin = buildDetectMarginDiagnostics(result);
  const marginDeltaFromExpected = margin
    ? {
        left: margin.left - expectedExpand,
        top: margin.top - expectedExpand,
        right: margin.right - expectedExpand,
        bottom: margin.bottom - expectedExpand,
      }
    : null;
  const marginAsymmetry = margin
    ? {
        x: margin.right - margin.left,
        y: margin.bottom - margin.top,
      }
    : null;

  return {
    frame,
    margin,
    expectedExpand,
    marginDeltaFromExpected,
    marginAsymmetry,
  };
}

function revokeObjectUrl(url: string | undefined) {
  if (
    !url ||
    !url.startsWith("blob:") ||
    typeof URL === "undefined" ||
    typeof URL.revokeObjectURL !== "function"
  ) {
    return;
  }

  URL.revokeObjectURL(url);
}

export class DielineWorkflowExtension implements ExtensionDefinition {
  id = "pooder.kit.dieline-workflow";

  metadata = {
    name: "DielineWorkflowExtension",
  };

  activation = {
    requiresExtensions: ["pooder.kit.image", "pooder.kit.dieline"],
    requiresServices: [COMMAND_SERVICE, CONFIGURATION_SERVICE],
  };

  private context?: ExtensionContext;

  activate(context: ExtensionContext) {
    this.context = context;
  }

  deactivate() {
    this.context = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      commands: this.createCommands(),
    };
  }

  private createCommands(): CommandContribution[] {
    return [
      {
        id: "detectDielineFromFrame",
        command: "detectDielineFromFrame",
        title: "Detect Dieline From Frame",
        handler: async (
          options?: DetectDielineFromFrameOptions,
        ): Promise<DetectDielineFromFrameResult | null> => {
          return await this.detectDielineFromFrame(options);
        },
      },
      {
        id: "uploadAndDetectEdge",
        command: "uploadAndDetectEdge",
        title: "Upload And Detect Edge",
        handler: async (
          url: string,
          options?: UploadAndDetectEdgeOptions,
        ): Promise<UploadAndDetectEdgeResult | null> => {
          return await this.uploadAndDetectEdge(url, options);
        },
      },
    ];
  }

  private getCommandService(): CommandService {
    return this.context?.services.getOrThrow<CommandService>(
      COMMAND_SERVICE,
      "[DielineWorkflowExtension] CommandService is required.",
    ) as CommandService;
  }

  private getConfigService(): ConfigurationService {
    return this.context?.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
      "[DielineWorkflowExtension] ConfigurationService is required.",
    ) as ConfigurationService;
  }

  private async executeCommand<T = unknown>(
    id: string,
    ...args: any[]
  ): Promise<T> {
    return await this.getCommandService().executeCommand<T>(id, ...args);
  }

  private applyDetectedDielineConfig(
    result: DetectEdgeResult,
    sourceImage?: { width?: number; height?: number },
  ) {
    const configService = this.getConfigService();
    configService.update("dieline.shape", "custom");
    configService.update("dieline.pathData", result.pathData);

    const sourceWidth = Number(result.imageWidth ?? sourceImage?.width ?? 0);
    const sourceHeight = Number(result.imageHeight ?? sourceImage?.height ?? 0);
    configService.update(
      "dieline.customSourceWidthPx",
      Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : undefined,
    );
    configService.update(
      "dieline.customSourceHeightPx",
      Number.isFinite(sourceHeight) && sourceHeight > 0
        ? sourceHeight
        : undefined,
    );
    configService.update("size.cutMode", "trim");
    configService.update("size.cutMarginMm", 0);
  }

  private async detectPostCommitDiagnostics(
    imageIds: string[],
    expectedExpand: number,
    options?: {
      multiplier?: number;
      format?: "png" | "jpeg";
      detect?: {
        expand?: number;
        smoothing?: boolean;
        simplifyTolerance?: number;
        threshold?: number;
        maxTraceDimension?: number;
        maskMode?: "auto" | "alpha" | "whitebg";
      };
    },
  ): Promise<DetectPostCommitDiagnostics | null> {
    if (!imageIds.length) {
      return null;
    }

    const verifySource = await this.executeCommand<ExportUserCroppedImageResult>(
      "exportUserCroppedImage",
      {
        multiplier: options?.multiplier ?? 2,
        format: options?.format ?? "png",
        imageIds,
      },
    );

    const verifyUrl = verifySource?.url;
    if (!verifyUrl) {
      return null;
    }

    try {
      const verifyResult = await this.executeCommand<DetectEdgeResult | null>(
        "detectEdge",
        verifyUrl,
        {
          expand: options?.detect?.expand ?? 0,
          smoothing: options?.detect?.smoothing ?? true,
          simplifyTolerance: options?.detect?.simplifyTolerance ?? 2,
          threshold: options?.detect?.threshold,
          maxTraceDimension: options?.detect?.maxTraceDimension,
          maskMode: options?.detect?.maskMode,
          debug: false,
        },
      );

      if (!verifyResult) {
        return null;
      }

      return buildDetectPostCommitDiagnostics(
        verifyResult,
        verifySource,
        expectedExpand,
      );
    } finally {
      revokeObjectUrl(verifyUrl);
    }
  }

  async detectDielineFromFrame(
    options: DetectDielineFromFrameOptions = {},
  ): Promise<DetectDielineFromFrameResult | null> {
    const debug = options.detect?.debug === true;
    const includeCroppedImage = options.inspect?.includeCroppedImage === true;
    const includeDiagnostics = options.inspect?.includeDiagnostics === true;
    const expectedExpand = Math.max(0, Number(options.detect?.expand ?? 0));

    const sourceImage = await this.executeCommand<ExportUserCroppedImageResult>(
      "exportUserCroppedImage",
      {
        multiplier: options.export?.multiplier ?? 2,
        format: options.export?.format ?? "png",
        imageIds: options.export?.imageIds,
      },
    );

    const sourceUrl = sourceImage?.url;
    if (!sourceUrl) {
      return null;
    }

    try {
      const result = await this.executeCommand<DetectEdgeResult | null>(
        "detectEdge",
        sourceUrl,
        {
          expand: options.detect?.expand ?? 0,
          smoothing: options.detect?.smoothing ?? true,
          simplifyTolerance: options.detect?.simplifyTolerance ?? 2,
          threshold: options.detect?.threshold,
          maxTraceDimension: options.detect?.maxTraceDimension,
          maskMode: options.detect?.maskMode,
          debug,
        },
      );

      if (!result) {
        return null;
      }

      const diagnostics = buildDetectFrameDiagnostics(result, sourceImage);

      if (options.commit === false) {
        return {
          ...result,
          ...(includeCroppedImage ? { sourceImage } : {}),
          ...(includeDiagnostics ? { diagnostics } : {}),
        };
      }

      this.applyDetectedDielineConfig(result, sourceImage);

      const postCommitDiagnostics = includeDiagnostics
        ? await this.detectPostCommitDiagnostics(
            sourceImage.imageIds,
            expectedExpand,
            {
              multiplier: options.export?.multiplier ?? 2,
              format: options.export?.format ?? "png",
              detect: {
                expand: options.detect?.expand ?? 0,
                smoothing: options.detect?.smoothing ?? true,
                simplifyTolerance: options.detect?.simplifyTolerance ?? 2,
                threshold: options.detect?.threshold,
                maxTraceDimension: options.detect?.maxTraceDimension,
                maskMode: options.detect?.maskMode,
              },
            },
          )
        : null;

      return {
        ...result,
        ...(includeCroppedImage ? { sourceImage } : {}),
        ...(includeDiagnostics ? { diagnostics, postCommitDiagnostics } : {}),
      };
    } finally {
      if (!includeCroppedImage) {
        revokeObjectUrl(sourceUrl);
      }
    }
  }

  async uploadAndDetectEdge(
    url: string,
    options?: UploadAndDetectEdgeOptions,
  ): Promise<UploadAndDetectEdgeResult | null> {
    const imageResult = await this.executeCommand<{
      id: string;
      mode: "replace" | "add";
    }>("upsertImage", url, {
      mode: "add",
    });

    const imageId = String(imageResult?.id || "");
    if (!imageId) {
      return null;
    }

    const result = await this.executeCommand<DetectEdgeResult | null>(
      "detectEdge",
      url,
      {
        expand: options?.expand ?? 10,
        smoothing: options?.smoothing ?? true,
        simplifyTolerance: options?.simplifyTolerance ?? 2,
        maxTraceDimension: options?.maxTraceDimension,
      },
    );

    if (!result) {
      return null;
    }

    this.applyDetectedDielineConfig(result);
    return {
      imageId,
      url,
      pathData: result.pathData,
    };
  }
}
