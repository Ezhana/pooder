import type { ConfigurationContribution } from "@pooder/core";
import { DIELINE_SHAPES } from "../dielineShape";

export function createDielineConfigurations(state: any): ConfigurationContribution[] {
  return [
    {
      id: "dieline.shape",
      type: "select",
      label: "Shape",
      options: Array.from(DIELINE_SHAPES),
      default: state.shape,
    },
    {
      id: "dieline.radius",
      type: "number",
      label: "Corner Radius (mm)",
      min: 0,
      max: 500,
      default: state.radius,
    },
    {
      id: "dieline.shapeStyle",
      type: "json",
      label: "Shape Style",
      default: state.shapeStyle,
    },
    {
      id: "dieline.showBleedLines",
      type: "boolean",
      label: "Show Bleed Lines",
      default: state.showBleedLines,
    },
    {
      id: "dieline.strokeWidth",
      type: "number",
      label: "Line Width",
      min: 0.1,
      max: 10,
      step: 0.1,
      default: state.mainLine.width,
    },
    {
      id: "dieline.strokeColor",
      type: "color",
      label: "Line Color",
      default: state.mainLine.color,
    },
    {
      id: "dieline.dashLength",
      type: "number",
      label: "Dash Length",
      min: 1,
      max: 50,
      default: state.mainLine.dashLength,
    },
    {
      id: "dieline.style",
      type: "select",
      label: "Line Style",
      options: ["solid", "dashed", "hidden"],
      default: state.mainLine.style,
    },
    {
      id: "dieline.offsetStrokeWidth",
      type: "number",
      label: "Offset Line Width",
      min: 0.1,
      max: 10,
      step: 0.1,
      default: state.offsetLine.width,
    },
    {
      id: "dieline.offsetStrokeColor",
      type: "color",
      label: "Offset Line Color",
      default: state.offsetLine.color,
    },
    {
      id: "dieline.offsetDashLength",
      type: "number",
      label: "Offset Dash Length",
      min: 1,
      max: 50,
      default: state.offsetLine.dashLength,
    },
    {
      id: "dieline.offsetStyle",
      type: "select",
      label: "Offset Line Style",
      options: ["solid", "dashed", "hidden"],
      default: state.offsetLine.style,
    },
    {
      id: "dieline.insideColor",
      type: "color",
      label: "Inside Color",
      default: state.insideColor,
    },
    {
      id: "dieline.features",
      type: "json",
      label: "Edge Features",
      default: state.features,
    },
  ];
}
