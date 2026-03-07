export type RenderObjectType = "rect" | "image" | "path" | "text";

export type RenderProps = Record<string, any>;
export type RenderCoordinateSpace = "scene" | "screen";

export interface RenderObjectSpec {
  id: string;
  type: RenderObjectType;
  props: RenderProps;
  data?: Record<string, any>;
  src?: string;
  space?: RenderCoordinateSpace;
}

export interface RenderLayerSpec {
  id: string;
  objects: RenderObjectSpec[];
  props?: RenderProps;
}
