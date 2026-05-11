import type {
  CapabilityDefinition,
  SceneElement,
  SceneService,
} from "@pooder/core";
import type { DetectEdgeResult } from "../edge-detection";
import type { DielineGeometry, DielineState } from "./model";

export const DIELINE_GEOMETRY_CAPABILITY_ID = "pooder.kit.dieline-geometry";

export interface DielineGeometryLayerOptions {
  targetLayerId?: string;
  imageClipLayerIds?: string[];
}

export interface DielineGeometryCapabilityOptions {
  capabilityId?: string;
  configNamespace?: string;
  layers?: DielineGeometryLayerOptions;
}

export interface ApplyDetectedDielineOptions {
  sourceImage?: { width?: number; height?: number };
  normalizeCutMode?: boolean;
}

export interface UpsertDielinePathElementOptions {
  layerId?: string;
  elementId?: string;
  pathData?: string;
  order?: number;
  style?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface DielineGeometryCapabilityApi {
  getState(): DielineState;
  getGeometry(): DielineGeometry | null;
  updateFeaturePosition(groupId: string, x: number, y: number): void;
  applyDetectedPath(
    result: DetectEdgeResult,
    options?: ApplyDetectedDielineOptions,
  ): void;
  refresh(): void;
  upsertPathElement(
    options?: UpsertDielinePathElementOptions,
  ): SceneElement | null;
}

export function normalizeDielineGeometryLayerId(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function upsertScenePathElement(
  sceneService: SceneService,
  options: {
    layerId: string;
    elementId: string;
    pathData: string;
    order?: number;
    style?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): SceneElement {
  const layerId = normalizeDielineGeometryLayerId(options.layerId, "dieline");
  const elementId = normalizeDielineGeometryLayerId(
    options.elementId,
    `${layerId}.path`,
  );

  return sceneService.transaction(() => {
    if (!sceneService.getLayer(layerId)) {
      sceneService.addLayer({
        id: layerId,
        metadata: { owner: "pooder.kit.dieline-geometry" },
      });
    }

    const patch = {
      layerId,
      order: options.order,
      path: options.pathData,
      style: options.style,
      metadata: options.metadata,
      data: { type: "dieline" },
    };

    if (sceneService.getElement(elementId)) {
      return sceneService.updateElement(elementId, patch);
    }

    return sceneService.addElement({
      id: elementId,
      layerId,
      type: "path",
      order: options.order,
      visible: true,
      path: options.pathData,
      style: options.style,
      metadata: options.metadata,
      data: { type: "dieline" },
    });
  });
}

export function createDielineGeometryCapabilityDefinition(
  facade: DielineGeometryCapabilityApi,
  options: DielineGeometryCapabilityOptions = {},
): CapabilityDefinition<DielineGeometryCapabilityApi> {
  return {
    id: options.capabilityId || DIELINE_GEOMETRY_CAPABILITY_ID,
    metadata: {
      name: "Dieline Geometry",
      description:
        "Read, mutate, render, and place dieline geometry without requiring " +
        "a kit-owned toolbar tool.",
      tags: ["kit", "dieline", "geometry"],
    },
    commands: [
      { id: "getDielineGeometry", title: "Get Dieline Geometry" },
      { id: "applyDetectedDielinePath", title: "Apply Detected Dieline Path" },
      { id: "upsertDielinePathElement", title: "Upsert Dieline Path Element" },
    ],
    facade,
  };
}
