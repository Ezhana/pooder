import type { CapabilityDefinition } from "@pooder/core";

export const MIRROR_CAPABILITY_ID = "pooder.kit.mirror";

export type MirrorAxis = "horizontal" | "vertical";

export interface MirrorObjectSelector {
  objectId: string;
}

export interface MirrorEffectPayload {
  horizontal?: boolean;
  vertical?: boolean;
}

export interface MirrorState {
  horizontal: boolean;
  vertical: boolean;
}

export interface MirrorCapabilityOptions {
  capabilityId?: string;
}

export interface MirrorCapabilityApi {
  clearObjectMirror(input: MirrorObjectSelector): boolean;
  getObjectMirror(input: MirrorObjectSelector): MirrorState;
  refresh(): void;
  setObjectMirror(
    input: MirrorObjectSelector,
    state: MirrorEffectPayload,
  ): boolean;
  toggleObjectMirror(
    input: MirrorObjectSelector,
    axis: MirrorAxis,
  ): MirrorState;
}

export function normalizeMirrorState(value: unknown): MirrorState {
  const payload = isRecord(value) ? value : {};
  return {
    horizontal: payload.horizontal === true,
    vertical: payload.vertical === true,
  };
}

export function createMirrorCapabilityDefinition(
  facade: MirrorCapabilityApi,
  options: MirrorCapabilityOptions = {},
): CapabilityDefinition<MirrorCapabilityApi> {
  return {
    id: options.capabilityId || MIRROR_CAPABILITY_ID,
    metadata: {
      name: "Mirror",
      description:
        "Apply object-level horizontal and vertical mirror transforms.",
      tags: ["kit", "mirror", "effect"],
    },
    commands: [
      { id: "setObjectMirror", title: "Set Object Mirror" },
      { id: "toggleObjectMirror", title: "Toggle Object Mirror" },
      { id: "clearObjectMirror", title: "Clear Object Mirror" },
      { id: "getObjectMirror", title: "Get Object Mirror" },
      { id: "refreshMirror", title: "Refresh Mirror" },
    ],
    facade,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
