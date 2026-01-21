import { Contribution, ContributionPoint, ContributionPointIds } from "./index";
import { Disposable } from "../command";

export class ContributionRegistry {
  private points: Map<string, ContributionPoint> = new Map();
  private contributions: Map<string, Map<string, Contribution>> = new Map();
  private contributionsById: Map<string, Contribution> = new Map();

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
      this.contributions.set(point.id, new Map());
    }
  }

  /**
   * Generate a deterministic ID for a contribution
   */
  private generateId<T>(
    pointId: string,
    contribution: Contribution<T>,
  ): string {
    const data = contribution.data as any;
    // Strategy: Use metadata name, or data name/id/command, or fallback to random
    const name =
      contribution.metadata?.name || data?.name || data?.id || data?.command;

    if (name) {
      return `${pointId}.${name}`;
    }

    // Fallback only if no identifier is found (though we prefer deterministic)
    return `${pointId}.${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Register a contribution to a specific point
   * @returns Disposable to unregister the contribution
   */
  register<T>(pointId: string, contribution: Contribution<T>): Disposable {
    const id = this.generateId(pointId, contribution);

    if (this.contributionsById.has(id)) {
      console.warn(
        `Contribution with ID "${id}" is already registered. Overwriting.`,
      );
      // We could choose to throw, or overwrite. Let's overwrite for now but warn.
      // If we overwrite, we should probably remove the old one from the list first to avoid duplicates.
      this.unregister(pointId, id);
    }

    if (!this.points.has(pointId)) {
      console.warn(
        `Contribution point ${pointId} does not exist. The contribution ${id} will be queued but may not be valid.`,
      );
      if (!this.contributions.has(pointId)) {
        this.contributions.set(pointId, new Map());
      }
    }

    const point = this.points.get(pointId);
    if (point?.validate) {
      try {
        if (!point.validate(contribution.data)) {
          console.error(
            `Contribution ${id} failed validation for point ${pointId}.`,
          );
          return { dispose: () => {} };
        }
      } catch (e) {
        console.error(`Validation error for contribution ${id}:`, e);
        return { dispose: () => {} };
      }
    }

    const map = this.contributions.get(pointId)!;

    map.set(id, contribution);
    this.contributionsById.set(id, contribution);

    // Auto-register if this is a contribution point contribution
    if (pointId === ContributionPointIds.CONTRIBUTIONS) {
      this.registerPoint(contribution.data as ContributionPoint);
    }

    return {
      dispose: () => {
        this.unregister(pointId, id);
      },
    };
  }

  /**
   * Get all contributions for a given point
   */
  get<T>(pointId: string): Contribution<T>[] {
    return Array.from(
      this.contributions.get(pointId)?.values() || [],
    ) as Contribution<T>[];
  }

  /**
   * Get a specific contribution by ID
   */
  getById<T>(id: string): Contribution<T> | undefined {
    return this.contributionsById.get(id) as Contribution<T> | undefined;
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
    const map = this.contributions.get(pointId);
    if (map) {
      map.delete(contributionId);
    }
    this.contributionsById.delete(contributionId);
  }
}
