import type {
  RenderIntentPatch,
  RenderIntentService,
  RenderObjectSpec,
  VisibilityExpr,
} from "@pooder/core";

export interface RenderIntentObjectPatchOptions {
  sourceId: string;
  surfaceId?: string;
  layerId: string;
  layerOrder?: number;
  stack?: number;
  channel?: RenderIntentPatch["ordering"] extends infer T
    ? T extends { channel?: infer C }
      ? C
      : never
    : never;
  baseOrder?: number;
  visibility?: VisibilityExpr;
}

export function patchRenderObjectSpecs(
  renderIntentService: RenderIntentService | undefined,
  specs: readonly RenderObjectSpec[],
  options: RenderIntentObjectPatchOptions,
) {
  if (!renderIntentService) return;
  const surfaceId = options.surfaceId || "legacy";
  specs.forEach((spec, index) => {
    renderIntentService.patchIntent(options.sourceId, {
      id: spec.id,
      subject: {
        kind: "object",
        surfaceId,
        layerId: options.layerId,
        objectId: spec.subjectId || spec.id,
        objectType: spec.type,
      },
      visual: {
        type: spec.type,
        ...(spec.src ? { src: spec.src } : {}),
      },
      ordering: {
        layerId: options.layerId,
        layerOrder: options.layerOrder,
        stack: options.stack,
        objectOrder: (options.baseOrder ?? 0) + index,
        channel: options.channel,
      },
      props: { ...(spec.props || {}) },
      data: {
        ...(spec.data || {}),
        layerId: options.layerId,
      },
      export: {
        keys: spec.exportKeys,
        visibility: spec.visibility ?? options.visibility,
        visible: spec.props?.visible !== false,
        exportable: spec.props?.excludeFromExport !== true,
      },
      coordinateSpace: spec.space || "scene",
    });
  });
}

export function clearRenderIntentSource(
  renderIntentService: RenderIntentService | undefined,
  sourceId: string,
) {
  renderIntentService?.clearRuntimePatches(sourceId);
}
