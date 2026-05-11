import type { CapabilityDefinition } from "@pooder/core";
import type { VisibilityExpr } from "@pooder/platform-browser";

export const RULER_CAPABILITY_ID = "pooder.kit.ruler";

export interface RulerLayerOptions {
  rulerLayerId?: string;
}

export interface RulerTheme {
  backgroundColor: string;
  textColor: string;
  lineColor: string;
  fontSize: number;
  thickness: number;
  gap: number;
}

export interface RulerCapabilityOptions {
  capabilityId?: string;
  configNamespace?: string;
  layers?: RulerLayerOptions;
  visibility?: VisibilityExpr;
}

export interface RulerCapabilityApi {
  getTheme(): RulerTheme;
  setTheme(theme: Partial<RulerTheme>): boolean;
  refresh(): void;
}

export function normalizeRulerConfigNamespace(
  namespace: string | undefined,
): string {
  const normalized = String(namespace || "ruler").trim();
  return normalized || "ruler";
}

export function getRulerConfigKey(
  namespace: string | undefined,
  path: string,
): string {
  return `${normalizeRulerConfigNamespace(namespace)}.${path}`;
}

export function normalizeRulerLayerId(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function createRulerCapabilityDefinition(
  facade: RulerCapabilityApi,
  options: RulerCapabilityOptions = {},
): CapabilityDefinition<RulerCapabilityApi> {
  return {
    id: options.capabilityId || RULER_CAPABILITY_ID,
    metadata: {
      name: "Ruler",
      description:
        "Render and theme ruler overlays without requiring a kit-owned " +
        "toolbar tool.",
      tags: ["kit", "ruler", "overlay"],
    },
    commands: [{ id: "setRulerTheme", title: "Set Ruler Theme" }],
    facade,
  };
}
