import {
  IMAGE_GEOMETRY_DATA_KEY,
  OBJECT_IMAGE_RESOLVER_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_EXPORT_SERVICE,
  createAffinePlacement,
  createLocalToSceneMatrix,
  invertCoordinateMatrix,
  multiplyCoordinateMatrices,
  normalizeImageGeometryDescriptor,
  resolveImageGeometry,
  transformCoordinateRect,
  type AffinePlacement,
  type CoordinateRect,
  type ObjectImageResolverService,
  type RenderGraphNode,
  type RenderIntentService,
  type ResolveObjectImageOptions,
  type ResolvedObjectImage,
  type SceneExportCrop,
  type SceneExportFormat,
  type SceneExportService,
  type Service,
  type ServiceContext,
} from "@pooder/core";

function normalizeObjectId(value: unknown): string {
  return String(value || "").trim();
}

function normalizeMultiplier(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, numeric) : 2;
}

function inferFormat(url: string): SceneExportFormat {
  return /^data:image\/jpe?g[;,]/i.test(url) || /\.jpe?g(?:[?#]|$)/i.test(url)
    ? "jpeg"
    : "png";
}

function isValidSceneRect(
  rect: CoordinateRect<"scene"> | null | undefined,
): rect is CoordinateRect<"scene"> {
  return Boolean(
    rect &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0,
  );
}

function createPlacementFromSceneCrop(
  crop: Pick<CoordinateRect<"scene">, "left" | "top" | "width" | "height">,
  pixelWidth: number,
  pixelHeight: number,
): AffinePlacement {
  const width = Math.max(1, pixelWidth);
  const height = Math.max(1, pixelHeight);
  return createAffinePlacement({
    localBounds: {
      left: 0,
      top: 0,
      width,
      height,
    },
    pivot: { x: width / 2, y: height / 2 },
    localToScene: createLocalToSceneMatrix({
      position: {
        x: crop.left + crop.width / 2,
        y: crop.top + crop.height / 2,
      },
      pivot: { x: width / 2, y: height / 2 },
      scaleX: crop.width / width,
      scaleY: crop.height / height,
    }),
  });
}

/**
 * Resolve the authoritative clip region for a committed visual.
 * Prefer the live clipPath effect; fall back to imageGeometry.clip.
 */
function resolveCommittedVisualCrop(
  node: RenderGraphNode,
): CoordinateRect<"scene"> | null {
  for (const effect of node.effects) {
    if (effect.type !== "clipPath" || !effect.source?.placement) continue;
    const crop =
      effect.coordinateMode === "object"
        ? transformCoordinateRect(
            node.placement.localToScene,
            effect.source.placement.localBounds,
          )
        : transformCoordinateRect(
            effect.source.placement.localToScene,
            effect.source.placement.localBounds,
          );
    if (isValidSceneRect(crop)) return crop;
  }

  const geometry = normalizeImageGeometryDescriptor(
    node.data[IMAGE_GEOMETRY_DATA_KEY],
  );
  if (!geometry?.clip) return null;
  try {
    const resolved = resolveImageGeometry(
      geometry,
      geometry.source.size ?? {
        width: geometry.frame.width,
        height: geometry.frame.height,
      },
    );
    const objectLocalToScene = multiplyCoordinateMatrices(
      node.placement.localToScene,
      invertCoordinateMatrix(resolved.imageLocalToObjectLocal),
    );
    const crop = transformCoordinateRect(objectLocalToScene, geometry.clip);
    return isValidSceneRect(crop) ? crop : null;
  } catch {
    return null;
  }
}

export class BrowserObjectImageResolverService
  implements Service, ObjectImageResolverService
{
  static readonly token = OBJECT_IMAGE_RESOLVER_SERVICE;

  private renderIntentService?: RenderIntentService;
  private sceneExportService?: SceneExportService;
  private renderIntentSubscription?: { dispose(): void };
  private readonly cache = new Map<string, Promise<ResolvedObjectImage>>();
  private revision = 0;

  init(context: ServiceContext): void {
    this.renderIntentService = context.getOrThrow(RENDER_INTENT_SERVICE);
    this.sceneExportService = context.getOrThrow(SCENE_EXPORT_SERVICE);
    this.renderIntentSubscription = this.renderIntentService.onDidChange(() => {
      this.revision += 1;
      this.cache.clear();
    });
  }

  dispose(): void {
    this.renderIntentSubscription?.dispose();
    this.renderIntentSubscription = undefined;
    this.renderIntentService = undefined;
    this.sceneExportService = undefined;
    this.cache.clear();
  }

  async resolve(
    options: ResolveObjectImageOptions,
  ): Promise<ResolvedObjectImage> {
    const objectId = normalizeObjectId(options.objectId);
    if (!objectId) throw new Error("object-image-object-id-required");
    const representation = options.representation ?? "committed-visual";
    const format = options.format === "jpeg" ? "jpeg" : "png";
    const multiplier = normalizeMultiplier(options.multiplier);
    const revision = this.revision;
    const cacheKey = [
      revision,
      objectId,
      representation,
      format,
      multiplier,
    ].join(":");
    const cached = this.cache.get(cacheKey);
    if (cached) return await cached;
    const task =
      representation === "original-resource"
        ? this.resolveOriginalResource(objectId, revision)
        : this.resolveCommittedVisual(objectId, format, multiplier, revision);
    this.cache.set(cacheKey, task);
    try {
      const result = await task;
      if (this.revision !== revision) {
        if (this.cache.get(cacheKey) === task) this.cache.delete(cacheKey);
        return await this.resolve(options);
      }
      return result;
    } catch (error) {
      if (this.cache.get(cacheKey) === task) this.cache.delete(cacheKey);
      throw error;
    }
  }

  private resolveNode(objectId: string): RenderGraphNode {
    const graph =
      this.renderIntentService?.getDocumentGraph?.() ??
      this.renderIntentService?.getGraph();
    const node = graph?.layers
      .flatMap((layer) => layer.nodes)
      .find(
        (candidate) =>
          candidate.subjectId === objectId ||
          candidate.exportKeys.includes(objectId),
      );
    if (!node) throw new Error("object-image-object-not-found");
    if (node.type !== "image") throw new Error("object-image-object-not-image");
    return node;
  }

  private async resolveOriginalResource(
    objectId: string,
    revision: number,
  ): Promise<ResolvedObjectImage> {
    const node = this.resolveNode(objectId);
    const geometry = normalizeImageGeometryDescriptor(
      node.data[IMAGE_GEOMETRY_DATA_KEY],
    );
    const url = geometry?.source.src || node.visual?.src || "";
    if (!url) throw new Error("object-image-resource-unavailable");
    const width =
      geometry?.source.size?.width ?? node.placement.localBounds.width;
    const height =
      geometry?.source.size?.height ?? node.placement.localBounds.height;
    return {
      objectId,
      representation: "original-resource",
      url,
      width,
      height,
      format: inferFormat(url),
      sceneBounds: transformCoordinateRect(
        node.placement.localToScene,
        node.placement.localBounds,
      ),
      placement: node.placement,
      revision,
      derived: false,
    };
  }

  private async resolveCommittedVisual(
    objectId: string,
    format: SceneExportFormat,
    multiplier: number,
    revision: number,
  ): Promise<ResolvedObjectImage> {
    const node = this.resolveNode(objectId);
    const clipCrop = resolveCommittedVisualCrop(node);
    const opacity = Number(node.props.opacity ?? 1);
    const needsDerivedVisual =
      Boolean(clipCrop) ||
      node.effects.length > 0 ||
      !(Number.isFinite(opacity) && opacity >= 1);

    // Identity path: no clip / effects / opacity processing — reuse the source.
    if (!needsDerivedVisual) {
      const original = await this.resolveOriginalResource(objectId, revision);
      return {
        ...original,
        representation: "committed-visual",
      };
    }

    // Committed visual must match the clip-constrained final look: crop to the
    // clip region (not the possibly overflowing elementBounds).
    const crop: SceneExportCrop = clipCrop
      ? { type: "sceneRect", rect: clipCrop }
      : { type: "elementBounds", elementIds: [objectId] };
    const result = await this.requireSceneExportService().exportImage({
      format,
      multiplier,
      source: { elementIds: [objectId] },
      crop,
      preserveClipPaths: true,
    });
    return {
      objectId,
      representation: "committed-visual",
      url: result.url,
      width: result.width,
      height: result.height,
      format: result.format,
      sceneBounds: result.crop,
      placement: createPlacementFromSceneCrop(
        result.crop,
        result.width,
        result.height,
      ),
      revision,
      derived: true,
    };
  }

  private requireSceneExportService(): SceneExportService {
    if (!this.sceneExportService) {
      throw new Error("object-image-resolver-not-initialized");
    }
    return this.sceneExportService;
  }
}
