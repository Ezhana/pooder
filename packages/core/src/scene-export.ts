import type { CoordinateRect } from "./coordinate";
import type { SceneId } from "./scene";
import type { Service } from "./service";

export type SceneExportFormat = "png" | "jpeg";
export type SceneExportCrop =
  | { type: "sceneRect"; rect: CoordinateRect<"scene"> }
  | { type: "elementBounds"; elementIds?: readonly string[] };

export type SceneExportOutputMaskMode = "alpha" | "outline" | "shape";

export interface SceneExportOutputMaskTransparentColor {
  red: number;
  green: number;
  blue: number;
  tolerance?: number;
}

export interface SceneExportOutputMask {
  sourceKey: string;
  mode?: SceneExportOutputMaskMode;
  transparentColor?: SceneExportOutputMaskTransparentColor;
}

export interface SceneExportSourceSelector {
  layerIds?: readonly string[];
  elementIds?: readonly string[];
  tags?: readonly string[];
  visible?: boolean;
}

export interface SceneExportSourceResult {
  layerIds: string[];
  elementIds: string[];
  tags: string[];
}

export interface SceneExportOptions {
  sceneId: SceneId;
  crop: SceneExportCrop;
  source?: SceneExportSourceSelector;
  format?: SceneExportFormat;
  multiplier?: number;
  includeHidden?: boolean;
  preserveClipPaths?: boolean;
  outputMask?: SceneExportOutputMask;
}

export interface SceneExportResult {
  sceneId: SceneId;
  url: string;
  width: number;
  height: number;
  format: SceneExportFormat;
  multiplier: number;
  source: SceneExportSourceResult;
  crop: CoordinateRect<"scene">;
}

export interface SceneExportService extends Service {
  exportImage(options: SceneExportOptions): Promise<SceneExportResult>;
}
