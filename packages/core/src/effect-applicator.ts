import type EventBus from "./event";
import type Disposable from "./disposable";
import type { Service, ServiceContext } from "./service";

export type EffectApplicationTargetKind = "surface" | "layer" | "object";

export interface EffectApplicationTarget {
  kind: EffectApplicationTargetKind;
  surfaceId: string;
  layerId?: string;
  objectId?: string;
  objectType?: string;
}

export interface EffectApplicationContext<TEffect = unknown, TDocument = unknown> {
  document: TDocument;
  effect: TEffect;
  eventBus?: EventBus;
  services: ServiceContext;
  target: EffectApplicationTarget;
}

export interface EffectApplicatorContribution<
  TEffect = unknown,
  TDocument = unknown,
> {
  capabilityId?: string;
  effectType?: string;
  apply(
    context: EffectApplicationContext<TEffect, TDocument>,
  ): void | Promise<void>;
}

export interface RegisteredEffectApplicator
  extends EffectApplicatorContribution {
  extensionId: string;
}

export interface EffectApplicatorQuery {
  capabilityId?: string;
  effectType: string;
}

class EffectApplicatorDisposable implements Disposable {
  private disposed = false;

  constructor(private readonly disposeFn: () => void) {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeFn();
  }
}

export default class EffectApplicatorRegistryService implements Service {
  private readonly applicators: RegisteredEffectApplicator[] = [];

  init(): void {}

  registerApplicator(
    extensionId: string,
    applicator: EffectApplicatorContribution,
  ): Disposable {
    const effectType = String(applicator.effectType || "").trim();
    const capabilityId = String(applicator.capabilityId || "").trim();
    if (!effectType && !capabilityId) {
      throw new Error("Effect applicator requires effectType or capabilityId.");
    }

    const registered: RegisteredEffectApplicator = {
      ...applicator,
      ...(capabilityId ? { capabilityId } : {}),
      ...(effectType ? { effectType } : {}),
      extensionId,
    };
    this.applicators.push(registered);

    return new EffectApplicatorDisposable(() => {
      const index = this.applicators.indexOf(registered);
      if (index >= 0) this.applicators.splice(index, 1);
    });
  }

  getApplicators(query: EffectApplicatorQuery): RegisteredEffectApplicator[] {
    const capabilityId = String(query.capabilityId || "").trim();
    const effectType = String(query.effectType || "").trim();
    return this.applicators.filter((applicator) => {
      if (applicator.capabilityId && applicator.capabilityId !== capabilityId) {
        return false;
      }
      if (applicator.effectType && applicator.effectType !== effectType) {
        return false;
      }
      return true;
    });
  }

  hasApplicator(query: EffectApplicatorQuery): boolean {
    return this.getApplicators(query).length > 0;
  }

  listApplicators(): RegisteredEffectApplicator[] {
    return this.applicators.slice();
  }
}
