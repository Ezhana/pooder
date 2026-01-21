interface ContributionSchema {
  [key: string]: any;
}

interface ContributionPoint {
  id: string;
  schema: ContributionSchema;
  description?: string;
}

interface Contribution {
  id: string;
  pointId: string;
  data: any;
  metadata?: any;
}

interface ContributionContext {
  [key: string]: any;
}

export { Contribution, ContributionPoint };
