import { Contribution, ContributionPoint, ContributionPointIds } from "./index";
import Disposable from "../disposable";

export class ContributionRegistry {
  private points: Map<string, ContributionPoint> = new Map();
  private contributions={
    byId: new Map<string,Contribution>(),
    byPointId: new Map<string,Contribution[]>()
  }

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
    if (!this.contributions.byPointId.has(point.id)) {
      this.contributions.byPointId.set(point.id, []);
    }
  }

  /**
   * Register a contribution to a specific point
   * @returns Disposable to unregister the contribution
   */
  register<T>(pointId: string, contribution: Contribution<T>): Disposable {
    if (this.contributions.byId.has(contribution.id)) {
      console.warn(
        `Contribution with ID "${contribution.id}" is already registered. Overwriting.`,
      );
      // We could choose to throw, or overwrite. Let's overwrite for now but warn.
      // If we overwrite, we should probably remove the old one from the list first to avoid duplicates.
      this.unregister(pointId, contribution.id);
    }

    if (!this.points.has(pointId)) {
      console.warn(
        `Contribution point ${pointId} does not exist. The contribution ${contribution.id} will be queued but may not be valid.`,
      );
      if (!this.contributions.byPointId.has(pointId)) {
        this.contributions.byPointId.set(pointId, []);
      }
    }

    const point = this.points.get(pointId);
    if (point?.validate) {
      try {
        if (!point.validate(contribution.data)) {
          console.error(
            `Contribution ${contribution.id} failed validation for point ${pointId}.`,
          );
          return { dispose: () => {} };
        }
      } catch (e) {
        console.error(`Validation error for contribution ${contribution.id}:`, e);
        return { dispose: () => {} };
      }
    }

    const arr = this.contributions.byPointId.get(pointId)!;

    arr.push(contribution);
    this.contributions.byId.set(contribution.id, contribution);

    // Auto-register if this is a contribution point contribution
    if (pointId === ContributionPointIds.CONTRIBUTIONS) {
      this.registerPoint(contribution.data as ContributionPoint);
    }

    return {
      dispose: () => {
        this.unregister(pointId, contribution.id);
      },
    };
  }

  /**
   * Get all contributions for a given point
   */
  get<T>(pointId: string): Contribution<T>[] {
    return Array.from(
      this.contributions.byPointId.get(pointId)?.values() || [],
    ) as Contribution<T>[];
  }

  /**
   * Get a specific contribution by ID
   */
  getById<T>(id: string): Contribution<T> | undefined {
    return this.contributions.byId.get(id) as Contribution<T> | undefined;
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
  private unregister(pointId: string, contributionId: string): void {
    const arr = this.contributions.byPointId.get(pointId);
    arr?.splice(
      arr.findIndex((c) => c.id === contributionId),
      1,
    );
    this.contributions.byId.delete(contributionId);
  }
}
