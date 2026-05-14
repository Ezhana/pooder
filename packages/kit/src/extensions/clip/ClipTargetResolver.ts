import type { SceneElement } from "@pooder/core";

export interface ClipTargetResolution {
  targetLayerIds: string[];
  targetSubjectIds: string[];
}

export class ClipTargetResolver {
  resolve(element: SceneElement): ClipTargetResolution | null {
    const targetLayerId = String(element.layerId || "").trim();
    const targetSubjectId = String(element.id || "").trim();
    if (!targetLayerId || !targetSubjectId) return null;
    return {
      targetLayerIds: [targetLayerId],
      targetSubjectIds: [targetSubjectId],
    };
  }
}
