export * from "./points";
export * from "./registry";

export interface ContributionMetadata {
  name: string;
  extensionId: string;
}
export interface Contribution<T = any> {
  id: string;
  data: T;
  metadata?: Partial<ContributionMetadata>;
}
