export * from "./points";
export * from "./registry";

export interface ContributionMetadata {
  name: string;
}
export interface Contribution<T = any> {
  data: T;
  metadata?: ContributionMetadata;
}
