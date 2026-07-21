export interface SourceSize {
  width: number;
  height: number;
}

export interface SourceSizeCache {
  ensureImageSize: (src: string) => Promise<SourceSize | null>;
  rememberSourceSize: (src: string, size: Partial<SourceSize>) => SourceSize | null;
  getSourceSize: (src: string) => SourceSize | null;
  deleteSourceSize: (src: string) => void;
  clear: () => void;
}

export function normalizeSourceSize(size: Partial<SourceSize>): SourceSize | null {
  const width = Number(size.width || 0);
  const height = Number(size.height || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

export function createSourceSizeCache(
  loadSize: (src: string) => Promise<SourceSize | null>,
): SourceSizeCache {
  const sizesBySrc = new Map<string, SourceSize>();
  const pendingBySrc = new Map<string, Promise<SourceSize | null>>();

  const rememberSourceSize = (
    src: string,
    size: Partial<SourceSize>,
  ): SourceSize | null => {
    const normalized = normalizeSourceSize(size);
    if (!src || !normalized) return null;
    sizesBySrc.set(src, normalized);
    return normalized;
  };

  const getSourceSize = (src: string): SourceSize | null => {
    if (!src) return null;
    const cached = sizesBySrc.get(src);
    if (!cached) return null;
    return { width: cached.width, height: cached.height };
  };

  const ensureImageSize = async (src: string): Promise<SourceSize | null> => {
    if (!src) return null;

    const cached = sizesBySrc.get(src);
    if (cached) return { width: cached.width, height: cached.height };

    const pending = pendingBySrc.get(src);
    if (pending) {
      return pending;
    }

    const task = loadSize(src);
    pendingBySrc.set(src, task);

    try {
      const size = await task;
      if (size) {
        rememberSourceSize(src, size);
      }
      return size;
    } finally {
      if (pendingBySrc.get(src) === task) {
        pendingBySrc.delete(src);
      }
    }
  };

  const deleteSourceSize = (src: string) => {
    if (!src) return;
    sizesBySrc.delete(src);
    pendingBySrc.delete(src);
  };

  const clear = () => {
    sizesBySrc.clear();
    pendingBySrc.clear();
  };

  return {
    ensureImageSize,
    rememberSourceSize,
    getSourceSize,
    deleteSourceSize,
    clear,
  };
}
