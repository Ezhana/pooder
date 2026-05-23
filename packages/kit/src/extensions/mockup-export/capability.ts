import type {
  CanvasRect,
  CapabilityDefinition,
  SceneExportCrop,
  SceneExportOutputMask,
  SceneExportOptions,
  SceneExportSourceResult,
} from "@pooder/core";

export const MOCKUP_EXPORT_CAPABILITY_ID = "pooder.kit.mockup-export";

export type MockupExportFormat = "png" | "jpeg";

export interface MockupExportOptions
  extends Omit<SceneExportOptions, "format"> {
  format?: MockupExportFormat;
  outputMask?: SceneExportOutputMask;
}

export interface MockupExportResult {
  url: string;
  width: number;
  height: number;
  format: MockupExportFormat;
  multiplier: number;
  source: SceneExportSourceResult;
  crop: CanvasRect;
}

export interface MockupExportCapabilityOptions {
  capabilityId?: string;
}

export interface MockupExportCapabilityApi {
  exportMockup(options?: MockupExportOptions): Promise<MockupExportResult>;
}

export function createMockupExportCapabilityDefinition(
  facade: MockupExportCapabilityApi,
  options: MockupExportCapabilityOptions = {},
): CapabilityDefinition<MockupExportCapabilityApi> {
  return {
    id: options.capabilityId || MOCKUP_EXPORT_CAPABILITY_ID,
    metadata: {
      name: "Mockup Export",
      description:
        "Export caller-selected scene layers as a clipped 2D mockup preview.",
      tags: ["kit", "mockup", "export"],
    },
    commands: [{ id: "exportMockup", title: "Export Mockup" }],
    facade,
  };
}

export type { SceneExportCrop };
