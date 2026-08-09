import type { CommandContribution } from "@pooder/core";
import type { ExportImageOptions } from "./capability";

export function createDesignExportCommands(tool: {
  exportImage(options?: ExportImageOptions): Promise<unknown>;
}): CommandContribution[] {
  return [
    {
      id: "exportImage",
      command: "exportImage",
      title: "Export Image",
      handler: async (options: ExportImageOptions = {}) =>
        await tool.exportImage(options),
    },
  ];
}
