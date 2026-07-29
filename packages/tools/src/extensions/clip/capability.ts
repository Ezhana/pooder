import type {
  CapabilityDefinition,
  RenderCoordinateSpace,
  RenderProps,
} from "@pooder/core";

export const CLIP_CAPABILITY_ID = "pooder.kit.clip";

export type ClipSource =
  | {
      type: "image";
      src: string;
      space?: RenderCoordinateSpace;
      props?: RenderProps;
    }
  | { type: "path"; pathData: string; space?: RenderCoordinateSpace };

export interface ClipEffectPayload {
  enabled?: boolean;
  source?: ClipSource;
}

export interface ClipEffectMetadata {
  enabled: boolean;
  source: ClipSource;
}

export interface ClipCapabilityOptions {
  capabilityId?: string;
}

export interface ClipCapabilityApi {
  refresh(): void;
}

export function normalizeClipEffectPayload(value: unknown): ClipEffectMetadata {
  const payload = isRecord(value) ? value : {};
  return {
    enabled: payload.enabled !== false,
    source: normalizeClipSource(payload.source),
  };
}

export function createClipCapabilityDefinition(
  facade: ClipCapabilityApi,
  options: ClipCapabilityOptions = {},
): CapabilityDefinition<ClipCapabilityApi> {
  return {
    id: options.capabilityId || CLIP_CAPABILITY_ID,
    metadata: {
      name: "Clip",
      description: "Apply object-level clipping from reusable clip sources.",
      tags: ["kit", "clip", "effect"],
    },
    commands: [{ id: "refreshClipEffects", title: "Refresh Clip Effects" }],
    facade,
  };
}

function normalizeClipSource(value: unknown): ClipSource {
  if (isRecord(value)) {
    if (value.type === "path") {
      const pathData = String(value.pathData || "").trim();
      const space = value.space === "screen" ? "screen" : "scene";
      return { type: "path", pathData, space };
    }

    if (value.type === "image") {
      const src = String(value.src || "").trim();
      const space = value.space === "screen" ? "screen" : "scene";
      return {
        type: "image",
        src,
        space,
        ...(isRecord(value.props) ? { props: { ...value.props } } : {}),
      };
    }

  }

  return { type: "path", pathData: "", space: "scene" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
