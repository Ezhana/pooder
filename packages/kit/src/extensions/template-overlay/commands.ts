import type { CommandContribution } from "@pooder/core";
import type { TemplateOverlayConfigPatch } from "./model";

export function createTemplateOverlayCommands(tool: {
  getConfig(): unknown;
  replaceConfig(config: unknown): Promise<unknown> | unknown;
  patchConfig(patch: TemplateOverlayConfigPatch): Promise<unknown> | unknown;
  clearConfig(): Promise<unknown> | unknown;
}): CommandContribution[] {
  return [
    {
      command: "templateOverlay.getConfig",
      id: "templateOverlay.getConfig",
      title: "Get Template Overlay Config",
      handler: () => tool.getConfig(),
    },
    {
      command: "templateOverlay.replaceConfig",
      id: "templateOverlay.replaceConfig",
      title: "Replace Template Overlay Config",
      handler: (config: unknown) => tool.replaceConfig(config),
    },
    {
      command: "templateOverlay.patchConfig",
      id: "templateOverlay.patchConfig",
      title: "Patch Template Overlay Config",
      handler: (patch: TemplateOverlayConfigPatch) => tool.patchConfig(patch),
    },
    {
      command: "templateOverlay.clearConfig",
      id: "templateOverlay.clearConfig",
      title: "Clear Template Overlay Config",
      handler: () => tool.clearConfig(),
    },
  ];
}
