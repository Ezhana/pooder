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

export interface RenderLayerSpec {
  id: string;
  objects: RenderObjectSpec[];
  props?: RenderProps;
}
