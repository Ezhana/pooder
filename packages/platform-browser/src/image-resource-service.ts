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

export class BrowserImageResourceService implements ImageResourceService {
  init(): void {}

  async resolve(
    resource: ImageResourceDescriptor,
  ): Promise<ImageResourceResolution> {
    const src = resourceUrl(resource);
    if (!src) return { ok: false, reason: "unsupported" };
    if (typeof Image === "undefined") {
      return resource.intrinsicSize
        ? { ok: true, src, ...resource.intrinsicSize }
        : { ok: false, reason: "unsupported" };
    }
    return new Promise((resolve) => {
      const image = new Image();
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
}
