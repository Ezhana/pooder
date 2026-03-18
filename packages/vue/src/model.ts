import type {
  CommandService,
  ConfigurationService,
  WorkbenchService,
} from "@pooder/core";
import type {
  ImageOperation,
  ImageTransformUpdates,
  ImageViewState,
} from "@pooder/kit";

export type PooderImageTarget = "auto" | "config" | "working";
export type PooderEditorEventHandler = (data: any) => void;
export type PooderEditorImageStateChangeHandler = (
  state: ImageViewState,
) => void;

export interface PooderGenerateCutImageOptions {
  debug?: boolean;
}

export interface PooderUpsertImageOptions {
  id?: string;
  mode?: "replace" | "add";
  addOptions?: any;
  operation?: ImageOperation;
}

export interface PooderExportUserCroppedImageOptions {
  multiplier?: number;
  format?: "png" | "jpeg";
  imageIds?: string[];
}

export interface PooderExportUserCroppedImageResult {
  url: string;
  width: number;
  height: number;
  multiplier: number;
  format: "png" | "jpeg";
  imageIds: string[];
}

export interface PooderDetectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PooderDetectEdgeResult {
  pathData: string;
  rawBounds?: PooderDetectBounds;
  baseBounds?: PooderDetectBounds;
  imageWidth?: number;
  imageHeight?: number;
}

export interface PooderDetectFrameDiagnostics {
  sourceWidth: number;
  sourceHeight: number;
  detectedBounds: PooderDetectBounds | null;
  centerOffsetX: number;
  centerOffsetY: number;
  coverageX: number;
  coverageY: number;
}

export interface PooderDetectMarginDiagnostics {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PooderDetectPostCommitDiagnostics {
  frame: PooderDetectFrameDiagnostics;
  margin: PooderDetectMarginDiagnostics | null;
  expectedExpand: number;
  marginDeltaFromExpected: PooderDetectMarginDiagnostics | null;
  marginAsymmetry: { x: number; y: number } | null;
}

export interface PooderDetectDielineOptions {
  expand?: number;
  smoothing?: boolean;
  simplifyTolerance?: number;
  threshold?: number;
  debug?: boolean;
}

export interface PooderDetectDielineFromFrameOptions {
  detect?: PooderDetectDielineOptions;
  export?: PooderExportUserCroppedImageOptions;
  inspect?: {
    includeCroppedImage?: boolean;
    includeDiagnostics?: boolean;
  };
  commit?: boolean;
}

export interface PooderDetectDielineFromFrameResult
  extends PooderDetectEdgeResult {
  sourceImage?: PooderExportUserCroppedImageResult;
  diagnostics?: PooderDetectFrameDiagnostics;
  postCommitDiagnostics?: PooderDetectPostCommitDiagnostics | null;
}

export interface PooderUploadAndDetectEdgeOptions {
  expand?: number;
  smoothing?: boolean;
  simplifyTolerance?: number;
}

export interface PooderUploadAndDetectEdgeResult {
  imageId: string;
  url: string;
  pathData: string;
}

export interface PooderFocusImageOptions {
  syncCanvasSelection?: boolean;
}

export interface PooderEditorServices {
  workbench: WorkbenchService;
  command: CommandService;
  config: ConfigurationService;
}

export interface PooderToolSwitchResult {
  ok: boolean;
  from: string | null;
  to: string | null;
  reason?: string;
}

export interface PooderEditorExposed {
  importConfig(config: Record<string, any>): void;
  exportConfig(): Record<string, any>;
  generateCutImage(options?: PooderGenerateCutImageOptions): Promise<string | null>;
  addImage(url: string, options?: any): Promise<string>;
  upsertImage(
    url: string,
    options?: PooderUpsertImageOptions,
  ): Promise<{ id: string; mode: "replace" | "add" }>;
  getImageState(): Promise<ImageViewState>;
  onImageStateChange(handler: PooderEditorImageStateChangeHandler): () => void;
  applyImageOperation(
    id: string,
    operation: ImageOperation,
    options?: { target?: PooderImageTarget },
  ): Promise<void>;
  setImageTransform(
    id: string,
    updates: ImageTransformUpdates,
    options?: { target?: PooderImageTarget },
  ): Promise<void>;
  updateImage(id: string, options?: any): Promise<void>;
  clearImages(): Promise<void>;
  exportUserCroppedImage(
    options?: PooderExportUserCroppedImageOptions,
  ): Promise<PooderExportUserCroppedImageResult>;
  focusImage(
    id: string | null,
    options?: PooderFocusImageOptions,
  ): Promise<any>;
  detectDieline(url: string): Promise<string | null>;
  detectDielineFromFrame(
    options?: PooderDetectDielineFromFrameOptions,
  ): Promise<PooderDetectDielineFromFrameResult | null>;
  uploadAndDetectEdge(
    url: string,
    options?: PooderUploadAndDetectEdgeOptions,
  ): Promise<PooderUploadAndDetectEdgeResult | null>;
  activateTool(id: string | null): Promise<PooderToolSwitchResult>;
  deactivateTool(): Promise<PooderToolSwitchResult>;
  on(event: string, handler: PooderEditorEventHandler): void;
  off(event: string, handler: PooderEditorEventHandler): void;
  emit(event: string, data: any): void;
  executeCommand<T = unknown>(id: string, ...args: any[]): Promise<T>;
  getConfig<T = unknown>(key: string): T;
  updateConfig(key: string, val: any): void;
  services: PooderEditorServices;
}

export type PooderEditorImageApi = Pick<
  PooderEditorExposed,
  | "addImage"
  | "upsertImage"
  | "getImageState"
  | "onImageStateChange"
  | "applyImageOperation"
  | "setImageTransform"
  | "updateImage"
  | "clearImages"
  | "focusImage"
>;
