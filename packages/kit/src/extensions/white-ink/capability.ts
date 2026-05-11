import type { CapabilityDefinition } from "@pooder/core";
import type {
  WhiteInkItem,
  WhiteInkSettings,
  UpdateWhiteInkOptions,
  UpsertWhiteInkOptions,
} from "./WhiteInkTool";

export const WHITE_INK_CAPABILITY_ID = "pooder.kit.white-ink";

export interface WhiteInkLayerOptions {
  sourceLayerIds?: string[];
  whiteLayerId?: string;
  coverLayerId?: string;
  overlayLayerId?: string;
}

export interface WhiteInkCapabilityOptions {
  capabilityId?: string;
  configNamespace?: string;
  layers?: WhiteInkLayerOptions;
}

export interface WhiteInkMaskOptions {
  tint?: "white" | "cover";
}

export interface WhiteInkCapabilityApi {
  getItems(): WhiteInkItem[];
  getWorkingItems(): WhiteInkItem[];
  getSettings(): WhiteInkSettings;
  addWhiteInk(url: string, options?: Partial<WhiteInkItem>): Promise<string>;
  upsertWhiteInk(
    url: string,
    options?: UpsertWhiteInkOptions,
  ): Promise<{ id: string; mode: "replace" | "add" }>;
  updateWhiteInk(
    id: string,
    updates: Partial<WhiteInkItem>,
    options?: UpdateWhiteInkOptions,
  ): Promise<void>;
  removeWhiteInk(id: string): void;
  clearWhiteInks(): void;
  resetSession(): void;
  completeSession(): Promise<{ ok: boolean }>;
  setPrintEnabled(enabled: boolean): { ok: boolean };
  setPreviewImageVisible(visible: boolean): { ok: boolean };
  generateMask(
    sourceUrl: string,
    options?: WhiteInkMaskOptions,
  ): Promise<string>;
  refresh(): void;
}

export function normalizeWhiteInkConfigNamespace(
  namespace: string | undefined,
): string {
  const normalized = String(namespace || "whiteInk").trim();
  return normalized || "whiteInk";
}

export function getWhiteInkConfigKey(
  namespace: string | undefined,
  path: string,
): string {
  return `${normalizeWhiteInkConfigNamespace(namespace)}.${path}`;
}

export function normalizeWhiteInkLayerId(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function createWhiteInkCapabilityDefinition(
  facade: WhiteInkCapabilityApi,
  options: WhiteInkCapabilityOptions = {},
): CapabilityDefinition<WhiteInkCapabilityApi> {
  return {
    id: options.capabilityId || WHITE_INK_CAPABILITY_ID,
    metadata: {
      name: "White Ink",
      description:
        "Generate white ink masks, render previews, and manage print settings " +
        "without requiring a kit-owned toolbar tool.",
      tags: ["kit", "white-ink", "print"],
    },
    commands: [
      { id: "addWhiteInk", title: "Add White Ink" },
      { id: "upsertWhiteInk", title: "Upsert White Ink" },
      { id: "getWhiteInkSettings", title: "Get White Ink Settings" },
      { id: "generateWhiteInkMask", title: "Generate White Ink Mask" },
    ],
    facade,
  };
}
