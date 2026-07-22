import type { RenderEffectSpec } from "./render";
import type { InteractionSpec } from "./interaction-service";
import type { RenderGraphLayer, RenderGraphNode } from "./render-intent";
import type Disposable from "./disposable";
import type { AffinePlacement, CoordinatePoint } from "./coordinate";

export type LayerId = string;
export type ElementId = string;
export type SceneId = string;
export type SceneElementType = "image" | "path" | "rect" | "text";

export const DEFAULT_SCENE_ID = "default";

export type SceneMetadata = Record<string, unknown>;
export type SceneElementData = Record<string, unknown>;
export type SceneElementStyle = Record<string, unknown>;

export type ScenePoint = CoordinatePoint<"scene">;

export interface SceneTransform {
  left?: number;
  top?: number;
  scaleX?: number;
  scaleY?: number;
  angle?: number;
  flipX?: boolean;
  flipY?: boolean;
  skewX?: number;
  skewY?: number;
  originX?: "left" | "center" | "right";
  originY?: "top" | "center" | "bottom";
}

export interface SceneLayer {
  id: LayerId;
  order: number;
  visible: boolean;
  effects?: RenderEffectSpec[];
  tags?: string[];
  metadata?: SceneMetadata;
}

export interface SceneLayerInput {
  id: LayerId;
  order?: number;
  visible?: boolean;
  effects?: RenderEffectSpec[];
  tags?: string[];
  metadata?: SceneMetadata;
}

export interface SceneLayerPatch {
  order?: number;
  visible?: boolean;
  effects?: RenderEffectSpec[];
  tags?: string[];
  metadata?: SceneMetadata;
}

export interface SceneRecord {
  id: SceneId;
  order: number;
  visible: boolean;
  /** @internal Legacy overlay flag. */
  renderable: boolean;
  /** @internal Legacy overlay flag. */
  transient: boolean;
  metadata?: SceneMetadata;
}

export interface SceneInput {
  id: SceneId;
  order?: number;
  visible?: boolean;
  /** @internal Legacy overlay flag. */
  renderable?: boolean;
  /** @internal Legacy overlay flag. */
  transient?: boolean;
  metadata?: SceneMetadata;
}

export interface ScenePatch {
  order?: number;
  visible?: boolean;
  /** @internal Legacy overlay flag. */
  renderable?: boolean;
  /** @internal Legacy overlay flag. */
  transient?: boolean;
  metadata?: SceneMetadata;
}

export interface SceneScopeOptions {
  sceneId?: SceneId;
}

export interface SceneElementBase {
  id: ElementId;
  layerId: LayerId;
  type: SceneElementType;
  order: number;
  visible: boolean;
  effects?: RenderEffectSpec[];
  tags?: string[];
  metadata?: SceneMetadata;
  data?: SceneElementData;
  /** @internal Renderer-specific props belong to the legacy overlay adapter. */
  style?: SceneElementStyle;
  placement?: AffinePlacement;
  transform?: SceneTransform;
  interaction?: InteractionSpec;
  /**
   * Associates a local scene element with the logical RenderGraph projection
   * it temporarily replaces. Render adapters use this only to preserve target
   * identity while composition changes.
   */
  renderGraphProjection?: {
    readonly subjectId: string;
    readonly type?: SceneElementType;
  };
}

export interface SceneImageElement extends SceneElementBase {
  type: "image";
  src: string;
  width?: number;
  height?: number;
}

export interface ScenePathElement extends SceneElementBase {
  type: "path";
  path: string;
}

export interface SceneRectElement extends SceneElementBase {
  type: "rect";
  width: number;
  height: number;
}

export interface SceneTextElement extends SceneElementBase {
  type: "text";
  text: string;
}

export type SceneElement =
  | SceneImageElement
  | ScenePathElement
  | SceneRectElement
  | SceneTextElement;

type SceneElementDefaults = "order" | "visible";

export type SceneElementInput =
  | (Omit<SceneImageElement, SceneElementDefaults> &
      Partial<Pick<SceneImageElement, SceneElementDefaults>>)
  | (Omit<ScenePathElement, SceneElementDefaults> &
      Partial<Pick<ScenePathElement, SceneElementDefaults>>)
  | (Omit<SceneRectElement, SceneElementDefaults> &
      Partial<Pick<SceneRectElement, SceneElementDefaults>>)
  | (Omit<SceneTextElement, SceneElementDefaults> &
      Partial<Pick<SceneTextElement, SceneElementDefaults>>);

export interface SceneElementPatch {
  layerId?: LayerId;
  order?: number;
  visible?: boolean;
  effects?: RenderEffectSpec[];
  tags?: string[];
  metadata?: SceneMetadata;
  data?: SceneElementData;
  style?: SceneElementStyle;
  placement?: AffinePlacement;
  transform?: SceneTransform;
  renderGraphProjection?: SceneElementBase["renderGraphProjection"];
  src?: string;
  width?: number;
  height?: number;
  path?: string;
  text?: string;
}

export interface SceneLayerSelector {
  sceneId?: SceneId;
  ids?: readonly LayerId[];
  layerIds?: readonly LayerId[];
  visible?: boolean;
  tags?: readonly string[];
  metadata?: SceneMetadata;
}

export interface SceneElementSelector {
  sceneId?: SceneId;
  ids?: readonly ElementId[];
  layerIds?: readonly LayerId[];
  types?: readonly SceneElementType[];
  visible?: boolean;
  tags?: readonly string[];
  metadata?: SceneMetadata;
}

export interface SceneChangeSet {
  causes: SceneChangeCause[];
  scenes?: {
    added: SceneId[];
    updated: SceneId[];
    removed: SceneId[];
  };
  sceneChanges?: Record<
    SceneId,
    {
      layers: {
        added: LayerId[];
        updated: LayerId[];
        removed: LayerId[];
      };
      elements: {
        added: ElementId[];
        updated: ElementId[];
        removed: ElementId[];
      };
    }
  >;
  layers: {
    added: LayerId[];
    updated: LayerId[];
    removed: LayerId[];
  };
  elements: {
    added: ElementId[];
    updated: ElementId[];
    removed: ElementId[];
  };
}

export type SceneChangeCause =
  | { type: "scene-content" }
  | {
      type: "interaction-preview";
      sessionId: string;
      toolId?: string;
    };

export interface SceneTransactionOptions {
  cause: SceneChangeCause;
}

export type SceneTransaction<T = void> = () => T;

export interface SessionSceneOwner {
  readonly type: "session";
  readonly sessionId: string;
}

export type SceneOwner = SessionSceneOwner;

export interface RenderGraphProjectionFilterContext {
  readonly layer: RenderGraphLayer;
  readonly node: RenderGraphNode;
}

export type RenderGraphProjectionFilter = (
  context: RenderGraphProjectionFilterContext,
) => boolean;

export interface RenderGraphSceneCompositionEntry {
  readonly source: "render-graph";
  readonly interaction: "disabled";
  readonly filter?: RenderGraphProjectionFilter;
}

export interface LocalSceneCompositionEntry {
  readonly source: "local";
  readonly layerIds: readonly LayerId[];
}

export type SceneCompositionEntry =
  | RenderGraphSceneCompositionEntry
  | LocalSceneCompositionEntry;

export interface SceneComposition {
  readonly entries: readonly SceneCompositionEntry[];
}

export interface CreateSceneInput {
  readonly id: SceneId;
  readonly owner: SceneOwner;
  readonly composition: SceneComposition;
}

export interface SceneSnapshot {
  readonly id: SceneId;
  readonly owner: SceneOwner;
  readonly composition: SceneComposition;
}

export interface SceneHandle extends Disposable {
  readonly id: SceneId;
  readonly owner: SceneOwner;
  readonly composition: SceneComposition;
  getSnapshot(): SceneSnapshot;
  addLayer(layer: SceneLayerInput): SceneLayer;
  updateLayer(id: LayerId, patch: SceneLayerPatch): SceneLayer;
  removeLayer(id: LayerId): boolean;
  addElement(element: SceneElementInput): SceneElement;
  updateElement(id: ElementId, patch: SceneElementPatch): SceneElement;
  removeElement(id: ElementId): boolean;
  selectLayers(selector?: Omit<SceneLayerSelector, "sceneId">): SceneLayer[];
  selectElements(
    selector?: Omit<SceneElementSelector, "sceneId">,
  ): SceneElement[];
}

export interface SceneRootChangeEvent {
  readonly activeRoot: SceneSnapshot | null;
}

export interface SceneServiceEventMap {
  change: SceneChangeSet;
  rootChange: SceneRootChangeEvent;
}
