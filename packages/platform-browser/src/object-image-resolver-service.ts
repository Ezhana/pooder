import {
  IMAGE_GEOMETRY_DATA_KEY,
  OBJECT_IMAGE_RESOLVER_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_EXPORT_SERVICE,
  coordinateRect,
  createAffinePlacement,
  createLocalToSceneMatrix,
  normalizeImageGeometryDescriptor,
  transformCoordinateRect,
  type ObjectImageResolverService,
  type RenderGraphNode,
  type RenderIntentService,
  type ResolveObjectImageOptions,
  type ResolvedObjectImage,
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
    const graph = this.renderIntentService?.getGraph();
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
    const opacity = Number(node.props.opacity ?? 1);
    if (node.effects.length === 0 && Number.isFinite(opacity) && opacity >= 1) {
      const original = await this.resolveOriginalResource(objectId, revision);
      return {
        ...original,
        representation: "committed-visual",
      };
    }
    const result = await this.requireSceneExportService().exportImage({
      format,
      multiplier,
      source: { elementIds: [objectId] },
      crop: { type: "elementBounds", elementIds: [objectId] },
      preserveClipPaths: true,
    });
    const localBounds = coordinateRect("object-local", {
      left: 0,
      top: 0,
      width: result.width,
      height: result.height,
    });
    const placement = createAffinePlacement({
      localBounds,
      pivot: { x: result.width / 2, y: result.height / 2 },
      localToScene: createLocalToSceneMatrix({
        position: {
          x: result.crop.left + result.crop.width / 2,
          y: result.crop.top + result.crop.height / 2,
        },
        pivot: { x: result.width / 2, y: result.height / 2 },
        scaleX: result.crop.width / result.width,
        scaleY: result.crop.height / result.height,
      }),
    });
    return {
      objectId,
      representation: "committed-visual",
      url: result.url,
      width: result.width,
      height: result.height,
      format: result.format,
      sceneBounds: result.crop,
      placement,
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
