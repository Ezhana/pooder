import type { Service } from "./service";

export type ImageResourceDescriptor = (
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
      mimeType?: string;
      intrinsicSize?: { width: number; height: number };
    }
) & {
  /** Stable business/document identity. The locator above may change independently. */
  assetId?: string;
};

/**
 * A failed resolution carries no locator and no size: an implementation that
 * substituted a placeholder would report a size that is not the resource's own, and
 * every geometry derived from it would be wrong while still looking plausible.
 */
export type ImageResourceResolution =
  | { ok: true; src: string; width: number; height: number }
  | { ok: false; reason: "unsupported" | "load-failed" };

/**
 * A resource locator addresses immutable bytes, so its resolution is a fact rather
 * than a value to recompute. Implementations must honour two invariants:
 *
 * - `read` never performs I/O, so callers on a hot path (document apply, render
 *   intent compilation) can consult it without paying for the network.
 * - a resource that resolved successfully stays resolved for the lifetime of the
 *   service; a later failure must not demote it. Transient outages therefore cannot
 *   rewrite state that was already established.
 */
export interface ImageResourceService extends Service {
  /**
   * Established resolution for a resource, or `undefined` when nothing is known yet.
   * A resource that failed to load also reads as `undefined`, so that retry policy
   * stays owned by `ensure`; only a statically unsupported descriptor may read as a
   * failure, because retrying it can never change the answer.
   */
  read(resource: ImageResourceDescriptor): ImageResourceResolution | undefined;
  /**
   * Converge a resource to a resolution, loading its bytes when required.
   * Idempotent, and deduplicated across concurrent callers.
   */
  ensure(resource: ImageResourceDescriptor): Promise<ImageResourceResolution>;
}
