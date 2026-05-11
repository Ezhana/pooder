import type { ConfigurationContribution } from "@pooder/core";
import { getTemplateOverlayConfigKey } from "./capability";
import { createEmptyTemplateOverlayConfig } from "./model";

export function createTemplateOverlayConfigurations(
  namespace?: string,
): ConfigurationContribution[] {
  return [
    {
      id: getTemplateOverlayConfigKey(namespace, "config"),
      type: "json",
      label: "Template Overlay Config",
      default: createEmptyTemplateOverlayConfig(),
    },
  ];
}
