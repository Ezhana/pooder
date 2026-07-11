import type { CommandContribution } from "@pooder/core";
import type { ExportImageOptions } from "./capability";
import { createLegacyCommandBridge } from "../legacyCommandBridge";

export function createDesignExportCommands(tool: {
  exportImage(options?: ExportImageOptions): Promise<unknown>;
}): CommandContribution[] {
  return [
    createLegacyCommandBridge(
      "exportImage",
      "Export Image",
      async (options: ExportImageOptions = {}) => await tool.exportImage(options),
    ),
  ];
}
