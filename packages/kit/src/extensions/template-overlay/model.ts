export const TEMPLATE_OVERLAY_CONFIG_KEY = "templateOverlay.config";

export const TEMPLATE_OVERLAY_SLOT_NAMES = [
  "normal",
  "frame",
  "prod",
  "small",
  "back",
  "render",
] as const;

export type TemplateOverlaySlotName = (typeof TEMPLATE_OVERLAY_SLOT_NAMES)[number];

export interface TemplateOverlaySlotConfig {
  src: string;
  opacity?: number;
  enabled?: boolean;
}

export interface TemplateOverlayConfig {
  version: 1;
  slots: Partial<Record<TemplateOverlaySlotName, TemplateOverlaySlotConfig>>;
}

export type TemplateOverlayConfigPatch = Partial<{
  version: 1;
  slots: Partial<
    Record<TemplateOverlaySlotName, Partial<TemplateOverlaySlotConfig> | null>
  >;
}>;

export const createEmptyTemplateOverlayConfig = (): TemplateOverlayConfig => ({
  version: 1,
  slots: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const clampOpacity = (value: unknown): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.min(1, parsed));
};

export const normalizeTemplateOverlayConfig = (
  value: unknown,
): TemplateOverlayConfig => {
  if (!isRecord(value)) {
    return createEmptyTemplateOverlayConfig();
  }

  const version = value.version === 1 ? 1 : 1;
  const rawSlots = isRecord(value.slots) ? value.slots : {};
  const slots: TemplateOverlayConfig["slots"] = {};

  TEMPLATE_OVERLAY_SLOT_NAMES.forEach((slotName) => {
    const rawSlot = rawSlots[slotName];
    if (!isRecord(rawSlot)) return;

    const src = typeof rawSlot.src === "string" ? rawSlot.src.trim() : "";
    if (!src) return;

    const normalized: TemplateOverlaySlotConfig = { src };
    const opacity = clampOpacity(rawSlot.opacity);
    if (opacity !== undefined) {
      normalized.opacity = opacity;
    }
    if (typeof rawSlot.enabled === "boolean") {
      normalized.enabled = rawSlot.enabled;
    }

    slots[slotName] = normalized;
  });

  return {
    version,
    slots,
  };
};

export const patchTemplateOverlayConfig = (
  current: unknown,
  patch: unknown,
): TemplateOverlayConfig => {
  const base = normalizeTemplateOverlayConfig(current);
  if (!isRecord(patch)) {
    return base;
  }

  const next: TemplateOverlayConfig = {
    version: 1,
    slots: { ...base.slots },
  };

  const rawSlotPatches = patch.slots;
  if (isRecord(rawSlotPatches)) {
    TEMPLATE_OVERLAY_SLOT_NAMES.forEach((slotName) => {
      if (!Object.prototype.hasOwnProperty.call(rawSlotPatches, slotName)) {
        return;
      }

      const slotPatch = rawSlotPatches[slotName];
      if (slotPatch === null) {
        delete next.slots[slotName];
        return;
      }
      if (!isRecord(slotPatch)) {
        return;
      }

      const merged = {
        ...(next.slots[slotName] || {}),
        ...slotPatch,
      };
      const normalized = normalizeTemplateOverlayConfig({
        version: 1,
        slots: {
          [slotName]: merged,
        },
      }).slots[slotName];

      if (normalized) {
        next.slots[slotName] = normalized;
      } else {
        delete next.slots[slotName];
      }
    });
  }

  return normalizeTemplateOverlayConfig(next);
};
