export type RenderObjectType = "rect" | "image" | "path" | "text";

export type RenderProps = Record<string, any>;
export type RenderCoordinateSpace = "scene" | "screen";
export type RenderLayoutLength = number | string;
export type RenderLayoutAlign = "start" | "center" | "end";
export type RenderLayoutReference =
  | "sceneViewport"
  | "screenViewport"
  | "custom";

export interface RenderLayoutInsets {
  top?: RenderLayoutLength;
  right?: RenderLayoutLength;
  bottom?: RenderLayoutLength;
  left?: RenderLayoutLength;
}

export interface RenderLayoutRect {
  left: number;
  top: number;
  width: number;
  height: number;
  space?: RenderCoordinateSpace;
}

export interface RenderObjectLayoutSpec {
  reference?: RenderLayoutReference;
  referenceRect?: RenderLayoutRect;
  inset?: RenderLayoutLength | RenderLayoutInsets;
  alignX?: RenderLayoutAlign;
  alignY?: RenderLayoutAlign;
  offsetX?: RenderLayoutLength;
  offsetY?: RenderLayoutLength;
  width?: RenderLayoutLength;
  height?: RenderLayoutLength;
}

export interface RenderObjectSpec {
  id: string;
  type: RenderObjectType;
  props: RenderProps;
  data?: Record<string, any>;
  src?: string;
  space?: RenderCoordinateSpace;
  layout?: RenderObjectLayoutSpec;
}

export type LayerObjectCountComparator = ">" | ">=" | "==" | "<" | "<=";

export type VisibilityExpr =
  | { op: "const"; value: boolean }
  | { op: "activeToolIn"; ids: string[] }
  | { op: "sessionActive"; toolId: string }
  | { op: "layerExists"; layerId: string }
  | {
      op: "layerObjectCount";
      layerId: string;
      cmp: LayerObjectCountComparator;
      value: number;
    }
  | { op: "not"; expr: VisibilityExpr }
  | { op: "all"; exprs: VisibilityExpr[] }
  | { op: "any"; exprs: VisibilityExpr[] };

export interface RenderClipPathEffectSpec {
  type: "clipPath";
  id?: string;
  source: RenderObjectSpec;
  targetPassIds: string[];
}

export type RenderEffectSpec = RenderClipPathEffectSpec;

export interface RenderPassSpec {
  id: string;
  stack?: number;
  order?: number;
  replace?: boolean;
  visibility?: VisibilityExpr;
  effects?: RenderEffectSpec[];
  objects: RenderObjectSpec[];
}
