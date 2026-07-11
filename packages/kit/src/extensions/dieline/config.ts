import type { ConfigurationContribution } from "@pooder/core";
import { DIELINE_SHAPES } from "../dielineShape";
import { getDielineConfigKey } from "./model";

export function createDielineConfigurations(
  state: any,
  namespace?: string,
): ConfigurationContribution[] {
  const configKey = (path: string) => getDielineConfigKey(namespace, path);
  return [
    {
      id: configKey("shape"),
      type: "select",
      label: "Shape",
      options: Array.from(DIELINE_SHAPES),
      default: state.shape,
    },
    {
      id: configKey("radius"),
      type: "number",
      label: "Corner Radius (mm)",
      min: 0,
      max: 500,
      default: state.radius,
    },
    {
      id: configKey("shapeStyle"),
      type: "json",
      label: "Shape Style",
      default: state.shapeStyle,
    },
    {
      id: configKey("showBleedLines"),
      type: "boolean",
      label: "Show Bleed Lines",
      default: state.showBleedLines,
    },
    {
      id: configKey("strokeWidth"),
      type: "number",
      label: "Line Width",
      min: 0.1,
      max: 10,
      step: 0.1,
      default: state.mainLine.width,
    },
    {
      id: configKey("strokeColor"),
      type: "color",
      label: "Line Color",
      default: state.mainLine.color,
    },
    {
      id: configKey("dashLength"),
      type: "number",
      label: "Dash Length",
      min: 1,
      max: 50,
      default: state.mainLine.dashLength,
    },
    {
      id: configKey("style"),
      type: "select",
      label: "Line Style",
      options: ["solid", "dashed", "hidden"],
      default: state.mainLine.style,
    },
    {
      id: configKey("offsetStrokeWidth"),
      type: "number",
      label: "Offset Line Width",
      min: 0.1,
      max: 10,
      step: 0.1,
      default: state.offsetLine.width,
    },
    {
      id: configKey("offsetStrokeColor"),
      type: "color",
      label: "Offset Line Color",
      default: state.offsetLine.color,
    },
    {
      id: configKey("offsetDashLength"),
      type: "number",
      label: "Offset Dash Length",
      min: 1,
      max: 50,
      default: state.offsetLine.dashLength,
    },
    {
      id: configKey("offsetStyle"),
      type: "select",
      label: "Offset Line Style",
      options: ["solid", "dashed", "hidden"],
      default: state.offsetLine.style,
    },
    {
      id: configKey("insideColor"),
      type: "color",
      label: "Inside Color",
      default: state.insideColor,
    },
  ];
}
