import type { ConfigurationContribution } from "@pooder/core";

export function createWhiteInkConfigurations(): ConfigurationContribution[] {
  return [
    {
      id: "whiteInk.items",
      type: "array",
      label: "White Ink Images",
      default: [],
    },
    {
      id: "whiteInk.printWithWhiteInk",
      type: "boolean",
      label: "Preview White Ink",
      default: true,
    },
    {
      id: "whiteInk.previewImageVisible",
      type: "boolean",
      label: "Show Cover During White Ink Preview",
      default: true,
    },
    {
      id: "whiteInk.debug",
      type: "boolean",
      label: "White Ink Debug Log",
      default: false,
    },
  ];
}
