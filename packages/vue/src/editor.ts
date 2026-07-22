import PooderCanvasHost from "./pooder-canvas-host.vue";
import type { ExtensionDefinition, Pooder } from "@pooder/core";

import {
  getPooderRuntimeCore,
  type PooderRuntime,
} from "./runtime";

const getEditorRuntimeCore = (runtime: PooderRuntime): Pooder =>
  getPooderRuntimeCore(runtime) as Pooder;

export { PooderCanvasHost };
export type {
  PooderCanvasHostReadyPayload,
  PooderCanvasHostRenderSyncPayload,
} from "./canvas-host";

export interface PooderToolDefinition {
  readonly id: string;
}

export interface PooderToolState {
  id: string;
  state: string;
  reason?: string;
  message?: string;
  missingExtensions?: string[];
  missingServices?: string[];
  waitingFor?: string[];
  cycle?: string[];
}

export function registerPooderTools(
  runtime: PooderRuntime,
  tools: Iterable<PooderToolDefinition>,
): PooderToolState[] {
  const core = getEditorRuntimeCore(runtime);
  return core.extensions.registerMany(
    Array.from(tools) as ExtensionDefinition[],
  );
}

export function flushPooderTools(
  runtime: PooderRuntime,
): Promise<PooderToolState[]> {
  return getEditorRuntimeCore(runtime).extensions.flushActivation();
}

export function getPooderCapability<TFacade>(
  runtime: PooderRuntime,
  id: string,
): TFacade | null {
  return getEditorRuntimeCore(runtime).capabilities.get<TFacade>(id) ?? null;
}

export function requirePooderCapability<TFacade>(
  runtime: PooderRuntime,
  id: string,
  errorMessage?: string,
): TFacade {
  return getEditorRuntimeCore(runtime).capabilities.getOrThrow<TFacade>(
    id,
    errorMessage,
  );
}
