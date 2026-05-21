export type LayerId = string;
export type ElementId = string;
export type SceneId = string;
export type SceneElementType = "image" | "path" | "rect" | "text";

export const DEFAULT_SCENE_ID = "default";

export type SceneMetadata = Record<string, unknown>;
export type SceneElementData = Record<string, unknown>;
export type SceneElementStyle = Record<string, unknown>;

export interface ScenePoint {
  x: number;
  y: number;
}

export interface SceneTransform {
  left?: number;
  top?: number;
  scaleX?: number;
  scaleY?: number;
  angle?: number;
  originX?: "left" | "center" | "right";
  originY?: "top" | "center" | "bottom";
}

export interface SceneLayer {
  id: LayerId;
  order: number;
  visible: boolean;
  metadata?: SceneMetadata;
}

export interface SceneLayerInput {
  id: LayerId;
  order?: number;
  visible?: boolean;
  metadata?: SceneMetadata;
}

export interface SceneLayerPatch {
  order?: number;
  visible?: boolean;
  metadata?: SceneMetadata;
}

export interface SceneRecord {
  id: SceneId;
  order: number;
  visible: boolean;
  renderable: boolean;
  transient: boolean;
  metadata?: SceneMetadata;
}

export interface SceneInput {
  id: SceneId;
  order?: number;
  visible?: boolean;
  renderable?: boolean;
  transient?: boolean;
  metadata?: SceneMetadata;
}

export interface ScenePatch {
  order?: number;
  visible?: boolean;
  renderable?: boolean;
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
  metadata?: SceneMetadata;
  data?: SceneElementData;
  style?: SceneElementStyle;
  transform?: SceneTransform;
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
  metadata?: SceneMetadata;
  data?: SceneElementData;
  style?: SceneElementStyle;
  transform?: SceneTransform;
  src?: string;
  width?: number;
  height?: number;
  path?: string;
  text?: string;
}

export interface SceneElementQuery {
  sceneId?: SceneId;
  layerId?: LayerId;
  type?: SceneElementType;
  visible?: boolean;
}

export interface SceneChangeSet {
  scenes?: {
    added: SceneId[];
    updated: SceneId[];
    removed: SceneId[];
  };
  sceneChanges?: Record<SceneId, {
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
  }>;
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

export type SceneTransaction<T = void> = () => T;
