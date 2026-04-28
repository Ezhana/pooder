import type { ConfigurationContribution } from "@pooder/core";
import {
  createEmptyTemplateOverlayConfig,
  TEMPLATE_OVERLAY_CONFIG_KEY,
} from "./model";

export function createTemplateOverlayConfigurations(): ConfigurationContribution[] {
  return [
    {
      id: TEMPLATE_OVERLAY_CONFIG_KEY,
      type: "json",
      label: "Template Overlay Config",
      default: createEmptyTemplateOverlayConfig(),
    },
  ];
}
