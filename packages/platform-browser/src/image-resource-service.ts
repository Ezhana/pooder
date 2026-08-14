import type {
  ImageResourceDescriptor,
  ImageResourceResolution,
  ImageResourceService,
} from "@pooder/core";

function resourceUrl(resource: ImageResourceDescriptor): string | null {
  if (resource.kind === "data-url") return resource.dataUrl;
  if (resource.kind === "url" || resource.kind === "blob-url")
    return resource.url;
  return null;
}

function probe(src: string): Promise<ImageResourceResolution> {
  return new Promise((resolve) => {
    const image = new Image();
    if (/^https?:\/\//i.test(src)) {
      image.crossOrigin = "anonymous";
    }
    image.onload = () => {
      const width = Number(image.naturalWidth || image.width);
      const height = Number(image.naturalHeight || image.height);
      resolve(
        width > 0 && height > 0
          ? { ok: true, src, width, height }
          : { ok: false, reason: "load-failed" },
      );
    };
    image.onerror = () => resolve({ ok: false, reason: "load-failed" });
    image.src = src;
  });
}

export class BrowserImageResourceService implements ImageResourceService {
  private readonly resolved = new Map<string, ImageResourceResolution>();
  private readonly pending = new Map<
    string,
    Promise<ImageResourceResolution>
  >();

  init(): void {}

  dispose(): void {
    this.resolved.clear();
    this.pending.clear();
  }

  read(resource: ImageResourceDescriptor): ImageResourceResolution | undefined {
    const src = resourceUrl(resource);
    return src ? this.resolved.get(src) : { ok: false, reason: "unsupported" };
  }

  async ensure(
    resource: ImageResourceDescriptor,
  ): Promise<ImageResourceResolution> {
    const src = resourceUrl(resource);
    if (!src) return { ok: false, reason: "unsupported" };

    const established = this.resolved.get(src);
    if (established) return established;

    const inFlight = this.pending.get(src);
    if (inFlight) return await inFlight;

    if (typeof Image === "undefined") {
      return resource.intrinsicSize
        ? this.establish(src, { ok: true, src, ...resource.intrinsicSize })
        : { ok: false, reason: "unsupported" };
    }

    const task = probe(src).finally(() => {
      if (this.pending.get(src) === task) this.pending.delete(src);
    });
    this.pending.set(src, task);
    const resolution = await task;
    return resolution.ok ? this.establish(src, resolution) : resolution;
  }

  private establish(
    src: string,
    resolution: ImageResourceResolution,
  ): ImageResourceResolution {
    this.resolved.set(src, resolution);
    return resolution;
  }
}
