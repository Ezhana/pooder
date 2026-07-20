import type { Service } from "./service";

export type ImageResourceDescriptor =
  | {
      kind: "url";
      url: string;
      mimeType?: string;
      intrinsicSize?: { width: number; height: number };
    }
  | {
      kind: "data-url";
      dataUrl: string;
      mimeType?: string;
      intrinsicSize?: { width: number; height: number };
    }
  | {
      kind: "blob-url";
      url: string;
      transient: true;
      intrinsicSize?: { width: number; height: number };
    };

export type ImageResourceResolution =
  | { ok: true; src: string; width: number; height: number }
  | { ok: false; reason: "unsupported" | "load-failed" };

export interface ImageResourceService extends Service {
  resolve(resource: ImageResourceDescriptor): Promise<ImageResourceResolution>;
}
