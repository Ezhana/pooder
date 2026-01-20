import EventBus from "../event";
export { Contribution, ContributionPoint, ContributionRegistry };

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

class ContributionRegistry {
  private contributionPoints = new Map<string, ContributionPoint>();

  private contributions = {
    byId: new Map<string, Contribution>(),
    byPointId: new Map<string, Contribution[]>(),
  };

  private contexts = new Map<string, ContributionContext>();

  constructor() {
    this.createDefaultContext();
  }

  /**
   * Register a new contribution point (extension point).
   * @param contributionPoint The definition of the contribution point.
   */
  registerContributionPoint(contributionPoint: ContributionPoint) {
    if (this.contributionPoints.has(contributionPoint.id)) {
      console.warn(
        `Contribution point '${contributionPoint.id}' is already registered.`,
      );
      return;
    }
    this.contributionPoints.set(contributionPoint.id, contributionPoint);
    this.contributions.byPointId.set(contributionPoint.id, []);
    EventBus.emit("point:registered", contributionPoint);
  }

  /**
   * Register a contribution to a specific point.
   * @param pointId The ID of the contribution point.
   * @param contribution The contribution data.
   */
  registerContribution(
    pointId: string,
    contribution: Omit<Contribution, "pointId"> & { pointId?: string },
  ) {
    if (!this.contributionPoints.has(pointId)) {
      throw new Error(`Contribution point '${pointId}' not found.`);
    }

    const finalContribution: Contribution = {
      ...contribution,
      pointId,
    };

    if (!finalContribution.id) {
      finalContribution.id = this.generateContributionId();
    }

    this.contributions.byId.set(finalContribution.id, finalContribution);

    let list = this.contributions.byPointId.get(pointId);
    if (!list) {
      list = [];
      this.contributions.byPointId.set(pointId, list);
    }
    list.push(finalContribution);

    EventBus.emit("contribution:added", finalContribution);
    return finalContribution;
  }

  /**
   * Get all contributions for a specific point.
   * @param pointId The ID of the contribution point.
   */
  getContributions(pointId: string): Contribution[] {
    return this.contributions.byPointId.get(pointId) || [];
  }

  /**
   * Get a specific contribution by its ID.
   * @param id The ID of the contribution.
   */
  getContribution(id: string): Contribution | undefined {
    return this.contributions.byId.get(id);
  }

  /**
   * Subscribe to registry events.
   */
  on(event: string, handler: any) {
    EventBus.on(event, handler);
  }

  /**
   * Unsubscribe from registry events.
   */
  off(event: string, handler: any) {
    EventBus.off(event, handler);
  }

  private generateContributionId() {
    return (
      Math.random().toString(36).substring(2, 15) + Date.now().toString(36)
    );
  }

  private createDefaultContext() {
    // Initialize default context if needed
    return {};
  }
}
