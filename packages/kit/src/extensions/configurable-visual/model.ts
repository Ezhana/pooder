export interface ConfigurableVisualSlotConfig {
  enabled?: boolean;
  src?: string;
  opacity?: number;
  [key: string]: unknown;
}

export type ConfigurableVisualConfig = Record<string, ConfigurableVisualSlotConfig>;

export const createEmptyConfigurableVisualConfig =
  (): ConfigurableVisualConfig => ({});

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const normalizeText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
};

const clampOpacity = (value: unknown): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.min(1, parsed));
};

const normalizeConfigEntry = (
  value: unknown,
): ConfigurableVisualSlotConfig | undefined => {
  if (!isRecord(value)) return undefined;

  const src = normalizeText(value.src);
  const enabled = typeof value.enabled === "boolean"
    ? value.enabled
    : undefined;
  const opacity = clampOpacity(value.opacity);
  const normalized: ConfigurableVisualSlotConfig = {};

  Object.entries(value).forEach(([key, item]) => {
    if (
      key === "enabled" ||
      key === "key" ||
      key === "opacity" ||
      key === "src"
    ) {
      return;
    }
    normalized[key] = isRecord(item) ? { ...item } : item;
  });
  if (enabled !== undefined) normalized.enabled = enabled;
  if (src !== undefined) normalized.src = src;
  if (opacity !== undefined) normalized.opacity = opacity;

  return normalized;
};

export const normalizeConfigurableVisualConfig = (
  value: unknown,
): ConfigurableVisualConfig => {
  if (!isRecord(value)) {
    return createEmptyConfigurableVisualConfig();
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [normalizeText(key), normalizeConfigEntry(item)] as const)
      .filter((entry): entry is [string, ConfigurableVisualSlotConfig] =>
        Boolean(entry[0] && entry[1]),
      ),
  );
};
