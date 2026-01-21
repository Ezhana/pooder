import {
  Contribution,
  ContributionPoint,
  ContributionPointIds,
} from "./points";

export class ContributionRegistry {
  private points: Map<string, ContributionPoint> = new Map();
  private contributions: Map<string, Contribution[]> = new Map();

  /**
   * Register a new contribution point
   */
  registerPoint<T>(point: ContributionPoint<T>): void {
    if (this.points.has(point.id)) {
      console.warn(
        `Contribution point ${point.id} already exists. Overwriting definitions may cause issues.`,
      );
    }
    this.points.set(point.id, point);
    if (!this.contributions.has(point.id)) {
      this.contributions.set(point.id, []);
    }
  }

  /**
   * Register a contribution to a specific point
   */
  register<T>(pointId: string, contribution: Contribution<T>): void {
    if (!this.points.has(pointId)) {
      console.warn(
        `Contribution point ${pointId} does not exist. The contribution ${contribution.id} will be queued but may not be valid.`,
      );
      // Optionally we could allow "lazy" registration, but for now let's just warn and init the array
      if (!this.contributions.has(pointId)) {
        this.contributions.set(pointId, []);
      }
    }

    const point = this.points.get(pointId);
    if (point?.validate) {
      try {
        if (!point.validate(contribution.data)) {
          console.error(
            `Contribution ${contribution.id} failed validation for point ${pointId}.`,
          );
          return;
        }
      } catch (e) {
        console.error(
          `Validation error for contribution ${contribution.id}:`,
          e,
        );
        return;
      }
    }

    const list = this.contributions.get(pointId)!;
    // Check for duplicates if needed, or allow multiple
    list.push(contribution);

    // Auto-register if this is a contribution point contribution
    if (pointId === ContributionPointIds.CONTRIBUTIONS) {
      this.registerPoint(contribution.data as ContributionPoint);
    }
  }

  /**
   * Get all contributions for a given point
   */
  get<T>(pointId: string): Contribution<T>[] {
    return (this.contributions.get(pointId) || []) as Contribution<T>[];
  }

  /**
   * Get the contribution point definition
   */
  getPoint(pointId: string): ContributionPoint | undefined {
    return this.points.get(pointId);
  }

  /**
   * Unregister a contribution
   */
  unregister(pointId: string, contributionId: string): void {
    const list = this.contributions.get(pointId);
    if (list) {
      const index = list.findIndex((c) => c.id === contributionId);
      if (index !== -1) {
        list.splice(index, 1);
      }
    }
  }
}
