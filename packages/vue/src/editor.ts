import PooderCanvasHost from "./pooder-canvas-host.vue";
import {
  IMAGE_RESOURCE_SERVICE,
  type ExtensionDefinition,
  type ImageResourceService,
  type Pooder,
} from "@pooder/core";
import type { EditorDocument } from "@pooder/document";
import { collectUnresolvableImageObjectIds } from "@pooder/document-core";

import { getPooderRuntimeCore, type PooderRuntime } from "./runtime";

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

/**
 * Ids of the document's image objects that cannot be drawn because their bytes are
 * unavailable. An unresolvable image renders nothing, so anything that turns the canvas
 * into a deliverable — production artwork above all — must ask before exporting instead
 * of trusting what happens to be on screen.
 */
export function collectPooderUnresolvableImages(
  runtime: PooderRuntime,
  document: EditorDocument,
): Promise<string[]> {
  const service = getEditorRuntimeCore(
    runtime,
  ).services.get<ImageResourceService>(IMAGE_RESOURCE_SERVICE);
  return collectUnresolvableImageObjectIds(document, service);
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
