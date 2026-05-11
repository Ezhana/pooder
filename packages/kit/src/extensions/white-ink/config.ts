import type { ConfigurationContribution } from "@pooder/core";
import { getWhiteInkConfigKey } from "./capability";

export function createWhiteInkConfigurations(
  namespace?: string,
): ConfigurationContribution[] {
  const configKey = (path: string) => getWhiteInkConfigKey(namespace, path);
  return [
    {
      id: configKey("items"),
      type: "array",
      label: "White Ink Images",
      default: [],
    },
    {
      id: configKey("printWithWhiteInk"),
      type: "boolean",
      label: "Preview White Ink",
      default: true,
    },
    {
      id: configKey("previewImageVisible"),
      type: "boolean",
      label: "Show Cover During White Ink Preview",
      default: true,
    },
    {
      id: configKey("debug"),
      type: "boolean",
      label: "White Ink Debug Log",
      default: false,
    },
  ];
}
