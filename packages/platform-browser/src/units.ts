import { Coordinate, Unit } from "./coordinate";

export function parseLengthToMm(
  input: number | string,
  defaultUnit: Unit,
): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return 0;
    return Coordinate.convertUnit(input, defaultUnit, "mm");
  }

  const raw = input.trim();
  if (!raw) return 0;

  const match = raw.match(/^([+-]?\d+(?:\.\d+)?)\s*(px|mm|cm|in)?$/i);
  if (!match) return 0;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;

  const unit = (match[2]?.toLowerCase() as Unit | undefined) ?? defaultUnit;
  return Coordinate.convertUnit(value, unit, "mm");
}
