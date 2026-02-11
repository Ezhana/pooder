export function pickExitIndex(
  hits: Array<{ insideAbove: boolean; insideBelow: boolean }>,
): number {
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (h.insideBelow && !h.insideAbove) return i;
  }
  return -1;
}

export function scoreOutsideAbove(samples: Array<{ outsideAbove: boolean }>): number {
  let score = 0;
  for (const s of samples) {
    if (s.outsideAbove) score++;
  }
  return score;
}
