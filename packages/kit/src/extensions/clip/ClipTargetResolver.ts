import type { SceneElement } from "@pooder/core";

export interface ClipTargetResolution {
  targetPassIds: string[];
  targetElementIds: string[];
}

export class ClipTargetResolver {
  resolve(element: SceneElement): ClipTargetResolution | null {
    const targetPassId = String(element.layerId || "").trim();
    const targetElementId = String(element.id || "").trim();
    if (!targetPassId || !targetElementId) return null;
    return {
      targetPassIds: [targetPassId],
      targetElementIds: [targetElementId],
    };
  }
}
