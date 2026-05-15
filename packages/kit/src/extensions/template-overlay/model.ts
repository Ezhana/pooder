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
  placement?: TemplateOverlayPlacement;
}

export interface TemplateOverlayConfig {
  version: 1;
  clip?: TemplateOverlayClipConfig;
  slots: Partial<Record<TemplateOverlaySlotName, TemplateOverlaySlotConfig>>;
}

export type TemplateOverlayConfigPatch = Partial<{
  clip: TemplateOverlayClipConfig | null;
  version: 1;
  slots: Partial<
    Record<TemplateOverlaySlotName, Partial<TemplateOverlaySlotConfig> | null>
  >;
}>;

export interface TemplateOverlayPlacement {
  space: "surfaceFrameRatio";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TemplateOverlayClipConfig {
  enabled?: boolean;
  placement?: TemplateOverlayPlacement;
  targetLayerIds?: string[];
}

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

const normalizePositiveNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};

const normalizeFiniteNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizePlacement = (
  value: unknown,
): TemplateOverlayPlacement | undefined => {
  if (!isRecord(value)) return undefined;

  const space = value.space === "surfaceFrameRatio" ? value.space : undefined;
  const x = normalizeFiniteNumber(value.x);
  const y = normalizeFiniteNumber(value.y);
  const width = normalizePositiveNumber(value.width);
  const height = normalizePositiveNumber(value.height);

  if (
    space === undefined ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return undefined;
  }

  return { space, x, y, width, height };
};

const normalizeClipConfig = (
  value: unknown,
): TemplateOverlayClipConfig | undefined => {
  if (!isRecord(value)) return undefined;

  const targetLayerIds = Array.isArray(value.targetLayerIds)
    ? value.targetLayerIds
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : undefined;
  const placement = normalizePlacement(value.placement);
  const normalized: TemplateOverlayClipConfig = {};

  if (typeof value.enabled === "boolean") {
    normalized.enabled = value.enabled;
  }
  if (placement) {
    normalized.placement = placement;
  }
  if (targetLayerIds?.length) {
    normalized.targetLayerIds = Array.from(new Set(targetLayerIds));
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
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
  const clip = normalizeClipConfig(value.clip);

  TEMPLATE_OVERLAY_SLOT_NAMES.forEach((slotName) => {
    const rawSlot = rawSlots[slotName];
    if (!isRecord(rawSlot)) return;

    const src = typeof rawSlot.src === "string" ? rawSlot.src.trim() : "";
    const enabled = typeof rawSlot.enabled === "boolean"
      ? rawSlot.enabled
      : undefined;
    if (!src && enabled !== false) return;

    const normalized: TemplateOverlaySlotConfig = { src };
    const opacity = clampOpacity(rawSlot.opacity);
    if (opacity !== undefined) {
      normalized.opacity = opacity;
    }
    if (enabled !== undefined) {
      normalized.enabled = enabled;
    }
    const placement = normalizePlacement(rawSlot.placement);
    if (placement) {
      normalized.placement = placement;
    }

    slots[slotName] = normalized;
  });

  const config: TemplateOverlayConfig = {
    version,
    slots,
  };

  if (clip) {
    config.clip = clip;
  }

  return config;
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
    ...(base.clip ? { clip: base.clip } : {}),
    version: 1,
    slots: { ...base.slots },
  };

  if (Object.prototype.hasOwnProperty.call(patch, "clip")) {
    if (patch.clip === null) {
      delete next.clip;
    } else {
      const clip = normalizeClipConfig(patch.clip);
      if (clip) {
        next.clip = clip;
      } else {
        delete next.clip;
      }
    }
  }

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
