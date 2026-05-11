import type { ConfigurationContribution } from "@pooder/core";

function normalizeConfigNamespace(namespace: string | undefined): string {
  const normalized = String(namespace || "image").trim();
  return normalized || "image";
}

export function createImageConfigurations(
  namespace = "image",
): ConfigurationContribution[] {
  const configNamespace = normalizeConfigNamespace(namespace);
  const key = (path: string) => `${configNamespace}.${path}`;

  return [
    {
      id: key("items"),
      type: "array",
      label: "Images",
      default: [],
    },
    {
      id: key("debug"),
      type: "boolean",
      label: "Image Debug Log",
      default: false,
    },
    {
      id: key("control.cornerSize"),
      type: "number",
      label: "Image Control Corner Size",
      min: 4,
      max: 64,
      step: 1,
      default: 14,
    },
    {
      id: key("control.touchCornerSize"),
      type: "number",
      label: "Image Control Touch Corner Size",
      min: 8,
      max: 96,
      step: 1,
      default: 24,
    },
    {
      id: key("control.cornerStyle"),
      type: "select",
      label: "Image Control Corner Style",
      options: ["circle", "rect"],
      default: "circle",
    },
    {
      id: key("control.cornerColor"),
      type: "color",
      label: "Image Control Corner Color",
      default: "#ffffff",
    },
    {
      id: key("control.cornerStrokeColor"),
      type: "color",
      label: "Image Control Corner Stroke Color",
      default: "#1677ff",
    },
    {
      id: key("control.transparentCorners"),
      type: "boolean",
      label: "Image Control Transparent Corners",
      default: false,
    },
    {
      id: key("control.borderColor"),
      type: "color",
      label: "Image Control Border Color",
      default: "#1677ff",
    },
    {
      id: key("control.borderScaleFactor"),
      type: "number",
      label: "Image Control Border Width",
      min: 0.5,
      max: 8,
      step: 0.1,
      default: 1.5,
    },
    {
      id: key("control.padding"),
      type: "number",
      label: "Image Control Padding",
      min: 0,
      max: 64,
      step: 1,
      default: 0,
    },
    {
      id: key("frame.strokeColor"),
      type: "color",
      label: "Image Frame Stroke Color",
      default: "#808080",
    },
    {
      id: key("frame.strokeWidth"),
      type: "number",
      label: "Image Frame Stroke Width",
      min: 0,
      max: 20,
      step: 0.5,
      default: 2,
    },
    {
      id: key("frame.strokeStyle"),
      type: "select",
      label: "Image Frame Stroke Style",
      options: ["solid", "dashed", "hidden"],
      default: "dashed",
    },
    {
      id: key("frame.dashLength"),
      type: "number",
      label: "Image Frame Dash Length",
      min: 1,
      max: 40,
      step: 1,
      default: 8,
    },
    {
      id: key("frame.innerBackground"),
      type: "color",
      label: "Image Frame Inner Background",
      default: "rgba(0,0,0,0)",
    },
    {
      id: key("frame.outerBackground"),
      type: "color",
      label: "Image Frame Outer Background",
      default: "#f5f5f5",
    },
    {
      id: key("session.placementPolicy"),
      type: "select",
      label: "Image Session Placement Policy",
      options: ["free", "warn", "strict"],
      default: "warn",
    },
  ];
}
