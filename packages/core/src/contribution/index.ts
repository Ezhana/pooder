export * from "./points";
export * from "./registry";

export interface Contribution<T = any> {
  pointId: string;
  id: string;
  data: T;
}
