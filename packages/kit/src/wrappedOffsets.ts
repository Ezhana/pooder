export function wrappedDistance(total: number, start: number, end: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;

  const s = ((start % total) + total) % total;
  const e = ((end % total) + total) % total;
  return e >= s ? e - s : total - s + e;
}

export function sampleWrappedOffsets(
  total: number,
  start: number,
  end: number,
  count: number,
): number[] {
  if (!Number.isFinite(total) || total <= 0) return [];
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];

  const n = Math.max(0, Math.floor(count));
  if (n <= 0) return [];

  const dist = wrappedDistance(total, start, end);
  if (n === 1) return [((start % total) + total) % total];

  const step = dist / (n - 1);
  const offsets: number[] = [];
  for (let i = 0; i < n; i++) {
    const raw = start + step * i;
    const wrapped = ((raw % total) + total) % total;
    offsets.push(wrapped);
  }
  return offsets;
}
