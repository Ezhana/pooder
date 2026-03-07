export type RenderObjectType = "rect" | "image" | "path" | "text";

export type RenderProps = Record<string, any>;

export interface RenderObjectSpec {
  id: string;
  type: RenderObjectType;
  props: RenderProps;
  data?: Record<string, any>;
  src?: string;
}

export interface RenderLayerSpec {
  id: string;
  objects: RenderObjectSpec[];
  props?: RenderProps;
}
