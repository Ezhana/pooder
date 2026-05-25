import type {
  CanvasRect,
  CapabilityDefinition,
  SceneExportOptions,
  SceneExportSourceResult,
} from "@pooder/core";

export const SCENE_EXPORT_CAPABILITY_ID = "pooder.kit.scene-export";

export interface SceneExportCapabilityOptions {
  capabilityId?: string;
}

export interface SceneExportCapabilityResult {
  url: string;
  width: number;
  height: number;
  format: "png" | "jpeg";
  multiplier: number;
  source: SceneExportSourceResult;
  crop: CanvasRect;
}

export interface SceneExportCapabilityApi {
  exportImage(options?: SceneExportOptions): Promise<SceneExportCapabilityResult>;
}

export function createSceneExportCapabilityDefinition(
  facade: SceneExportCapabilityApi,
  options: SceneExportCapabilityOptions = {},
): CapabilityDefinition<SceneExportCapabilityApi> {
  return {
    id: options.capabilityId || SCENE_EXPORT_CAPABILITY_ID,
    metadata: {
      name: "Scene Export",
      description: "Export caller-selected scene content to raster images.",
      tags: ["kit", "scene", "export"],
    },
    commands: [{ id: "exportImage", title: "Export Image" }],
    facade,
  };
}

export type { SceneExportOptions };
