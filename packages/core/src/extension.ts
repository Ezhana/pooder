import { ExtensionContext } from "./context";
import Disposable from "./disposable";
import { ExtensionContributions } from "./contribution";
import EventBus from "./event";
import { Service, ServiceIdentifier, isServiceToken } from "./service";
import CapabilityRegistryService from "./services/CapabilityRegistryService";
import CommandService from "./services/CommandService";
import ConfigurationService from "./services/ConfigurationService";
import { RenderIntentCompilerRegistryService } from "./render-intent";
import ToolRegistryService from "./services/ToolRegistryService";

export interface ExtensionActivationSpec {
  requiresExtensions?: string[];
  requiresServices?: ServiceIdentifier[];
  after?: string[];
}

export interface ExtensionDefinition {
  id: string;
  metadata?: { name?: string };
  activation?: ExtensionActivationSpec;
  contribute?(): ExtensionContributions;
  activate(context: ExtensionContext): void | Promise<void>;
  deactivate?(context: ExtensionContext): void | Promise<void>;
}

export type ExtensionState = "registered" | "pending" | "active" | "failed";

export interface ExtensionStateDetails {
  reason?: string;
  message?: string;
  missingExtensions?: string[];
  missingServices?: string[];
  waitingFor?: string[];
  cycle?: string[];
}

export interface ExtensionStateSnapshot extends ExtensionStateDetails {
  id: string;
  state: ExtensionState;
}

export interface ExtensionStateChangeEvent extends ExtensionStateSnapshot {
  previousState?: ExtensionState;
}

interface BlockingResult extends ExtensionStateDetails {
  ready: boolean;
}

interface NormalizedExtensionContributions {
  capabilities: NonNullable<ExtensionContributions["capabilities"]>;
  configurations: NonNullable<ExtensionContributions["configurations"]>;
  commands: NonNullable<ExtensionContributions["commands"]>;
  renderIntentCompilers: NonNullable<
    ExtensionContributions["renderIntentCompilers"]
  >;
  tools: NonNullable<ExtensionContributions["tools"]>;
}

interface ExtensionRecord {
  definition: ExtensionDefinition;
  contributions: NormalizedExtensionContributions;
  registrationOrder: number;
  state: ExtensionState;
  detail: ExtensionStateDetails;
  staticConfigDisposable?: Disposable;
  dynamicDisposables: Disposable[];
}

interface ExtensionManagerDependencies {
  eventBus: EventBus;
  capabilityRegistry: CapabilityRegistryService;
  configurationService: ConfigurationService;
  commandService: CommandService;
  renderIntentCompilerRegistry: RenderIntentCompilerRegistryService;
  toolRegistry: ToolRegistryService;
}

class ExtensionManager {
  private readonly context: ExtensionContext;
  private readonly eventBus: EventBus;
  private readonly capabilityRegistry: CapabilityRegistryService;
  private readonly configurationService: ConfigurationService;
  private readonly commandService: CommandService;
  private readonly renderIntentCompilerRegistry: RenderIntentCompilerRegistryService;
  private readonly toolRegistry: ToolRegistryService;
  private readonly records = new Map<string, ExtensionRecord>();
  private registrationOrder = 0;

  constructor(
    context: ExtensionContext,
    dependencies: ExtensionManagerDependencies,
  ) {
    this.context = context;
    this.eventBus = dependencies.eventBus;
    this.capabilityRegistry = dependencies.capabilityRegistry;
    this.configurationService = dependencies.configurationService;
    this.commandService = dependencies.commandService;
    this.renderIntentCompilerRegistry =
      dependencies.renderIntentCompilerRegistry;
    this.toolRegistry = dependencies.toolRegistry;
  }

  register(extension: ExtensionDefinition): ExtensionStateSnapshot {
    if (!extension.id) {
      throw new Error("ExtensionDefinition.id is required.");
    }
    if (this.records.has(extension.id)) {
      throw new Error(`Extension "${extension.id}" is already registered.`);
    }

    let contributions: NormalizedExtensionContributions;
    try {
      contributions = this.normalizeContributions(extension.contribute?.());
    } catch (error) {
      const record = this.createRecord(extension, {
        capabilities: [],
        configurations: [],
        commands: [],
        renderIntentCompilers: [],
        tools: [],
      });
      this.records.set(extension.id, record);
      this.applyState(record, "failed", {
        reason: "registration-failed",
        message: this.getErrorMessage(error),
      });
      return this.toSnapshot(record);
    }

    const record = this.createRecord(extension, contributions);
    this.records.set(extension.id, record);

    try {
      record.staticConfigDisposable = this.configurationService.registerDefinitions(
        extension.id,
        contributions.configurations,
      );
      this.applyState(record, "registered");
    } catch (error) {
      this.applyState(record, "failed", {
        reason: "registration-failed",
        message: this.getErrorMessage(error),
      });
    }

    return this.toSnapshot(record);
  }

  registerMany(extensions: Iterable<ExtensionDefinition>): ExtensionStateSnapshot[] {
    const snapshots: ExtensionStateSnapshot[] = [];
    for (const extension of extensions) {
      snapshots.push(this.register(extension));
    }
    return snapshots;
  }

  async flushActivation(): Promise<ExtensionStateSnapshot[]> {
    await this.failCyclicExtensions();

    let progressed = true;
    while (progressed) {
      progressed = false;

      for (const record of this.listRecords()) {
        if (record.state === "active" || record.state === "failed") {
          continue;
        }

        const blocking = this.evaluateBlocking(record);
        if (!blocking.ready) {
          this.applyState(record, "pending", blocking);
          continue;
        }

        await this.activateRecord(record);
        progressed = true;
      }
    }

    for (const record of this.listRecords()) {
      if (record.state === "active" || record.state === "failed") {
        continue;
      }

      const blocking = this.evaluateBlocking(record);
      if (!blocking.ready) {
        this.applyState(record, "pending", blocking);
      }
    }

    return this.listStates();
  }

  getState(id: string): ExtensionStateSnapshot | undefined {
    const record = this.records.get(id);
    return record ? this.toSnapshot(record) : undefined;
  }

  listStates(): ExtensionStateSnapshot[] {
    return this.listRecords().map((record) => this.toSnapshot(record));
  }

  async unregister(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record) {
      return false;
    }

    if (record.state === "active") {
      await this.safeDeactivate(record);
    }

    this.disposeDynamicContributions(record);
    record.staticConfigDisposable?.dispose();
    record.staticConfigDisposable = undefined;
    this.records.delete(id);
    return true;
  }

  async destroy(): Promise<void> {
    const records = this.listRecords().reverse();
    for (const record of records) {
      await this.unregister(record.definition.id);
    }
  }

  private createRecord(
    definition: ExtensionDefinition,
    contributions: NormalizedExtensionContributions,
  ): ExtensionRecord {
    return {
      definition,
      contributions,
      registrationOrder: this.registrationOrder++,
      state: "registered",
      detail: {},
      dynamicDisposables: [],
    };
  }

  private normalizeContributions(
    contributions?: ExtensionContributions,
  ): NormalizedExtensionContributions {
    return {
      capabilities: [...(contributions?.capabilities ?? [])],
      configurations: [...(contributions?.configurations ?? [])],
      commands: [...(contributions?.commands ?? [])],
      renderIntentCompilers: [
        ...(contributions?.renderIntentCompilers ?? []),
      ],
      tools: [...(contributions?.tools ?? [])],
    };
  }

  private evaluateBlocking(record: ExtensionRecord): BlockingResult {
    const activation = record.definition.activation;
    const missingExtensions = (activation?.requiresExtensions ?? []).filter(
      (id) => this.records.get(id)?.state !== "active",
    );
    const missingServices = (activation?.requiresServices ?? [])
      .filter((identifier) => !this.context.services.has(identifier))
      .map((identifier) => this.describeService(identifier));
    const waitingFor = (activation?.after ?? []).filter((id) => {
      const target = this.records.get(id);
      return !!target && target.state !== "active" && target.state !== "failed";
    });

    if (
      missingExtensions.length === 0 &&
      missingServices.length === 0 &&
      waitingFor.length === 0
    ) {
      return { ready: true };
    }

    const reason =
      missingExtensions.length > 0 && missingServices.length > 0
        ? "missing-required-dependencies"
        : missingExtensions.length > 0
          ? "missing-required-extensions"
          : missingServices.length > 0
            ? "missing-required-services"
            : "waiting-for-order";

    return {
      ready: false,
      reason,
      missingExtensions:
        missingExtensions.length > 0 ? missingExtensions : undefined,
      missingServices: missingServices.length > 0 ? missingServices : undefined,
      waitingFor: waitingFor.length > 0 ? waitingFor : undefined,
    };
  }

  private async activateRecord(record: ExtensionRecord) {
    try {
      await record.definition.activate(this.context);
      record.dynamicDisposables = this.registerDynamicContributions(record);
      this.applyState(record, "active");
    } catch (error) {
      this.disposeDynamicContributions(record);
      await this.safeDeactivate(record);
      this.applyState(record, "failed", {
        reason: "activation-failed",
        message: this.getErrorMessage(error),
      });
    }
  }

  private registerDynamicContributions(record: ExtensionRecord): Disposable[] {
    const disposables: Disposable[] = [];

    try {
      record.contributions.capabilities.forEach((capability) => {
        disposables.push(
          this.capabilityRegistry.registerCapability(
            record.definition.id,
            capability,
          ),
        );
      });

      record.contributions.commands.forEach((command) => {
        if (!command.handler) {
          return;
        }
        const commandId = command.command || command.id;
        disposables.push(
          this.commandService.registerCommand(
            commandId,
            command.handler,
            undefined,
            {
              title: command.title,
            },
          ),
        );
      });

      record.contributions.renderIntentCompilers.forEach((compiler) => {
        disposables.push(
          this.renderIntentCompilerRegistry.registerCompiler(
            record.definition.id,
            compiler,
          ),
        );
      });

      record.contributions.tools.forEach((tool) => {
        disposables.push(this.toolRegistry.registerTool(tool));
      });

      return disposables;
    } catch (error) {
      disposables.reverse().forEach((disposable) => disposable.dispose());
      throw error;
    }
  }

  private disposeDynamicContributions(record: ExtensionRecord) {
    const disposables = record.dynamicDisposables.splice(0);
    disposables.reverse().forEach((disposable) => disposable.dispose());
  }

  private async safeDeactivate(record: ExtensionRecord) {
    if (!record.definition.deactivate) {
      return;
    }

    try {
      await record.definition.deactivate(this.context);
    } catch (error) {
      console.error(
        `Error while deactivating extension "${record.definition.id}":`,
        error,
      );
    }
  }

  private async failCyclicExtensions() {
    const cyclicIds = this.findCyclicExtensionIds();
    if (cyclicIds.size === 0) {
      return;
    }

    for (const id of cyclicIds) {
      const record = this.records.get(id);
      if (!record || record.state === "failed") {
        continue;
      }

      if (record.state === "active") {
        await this.safeDeactivate(record);
      }
      this.disposeDynamicContributions(record);
      this.applyState(record, "failed", {
        reason: "cycle-detected",
        cycle: Array.from(cyclicIds.values()).sort(),
      });
    }
  }

  private findCyclicExtensionIds(): Set<string> {
    const adjacency = new Map<string, string[]>();
    const registeredIds = new Set(this.records.keys());

    this.records.forEach((record, id) => {
      const activation = record.definition.activation;
      const targets = [
        ...(activation?.requiresExtensions ?? []),
        ...(activation?.after ?? []),
      ].filter((target) => registeredIds.has(target));

      adjacency.set(id, Array.from(new Set(targets.values())));
    });

    const indexById = new Map<string, number>();
    const lowlinkById = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const cyclicIds = new Set<string>();
    let index = 0;

    const visit = (id: string) => {
      indexById.set(id, index);
      lowlinkById.set(id, index);
      index += 1;
      stack.push(id);
      onStack.add(id);

      for (const next of adjacency.get(id) ?? []) {
        if (!indexById.has(next)) {
          visit(next);
          lowlinkById.set(
            id,
            Math.min(lowlinkById.get(id)!, lowlinkById.get(next)!),
          );
          continue;
        }

        if (onStack.has(next)) {
          lowlinkById.set(
            id,
            Math.min(lowlinkById.get(id)!, indexById.get(next)!),
          );
        }
      }

      if (lowlinkById.get(id) !== indexById.get(id)) {
        return;
      }

      const component: string[] = [];
      while (stack.length > 0) {
        const current = stack.pop()!;
        onStack.delete(current);
        component.push(current);
        if (current === id) {
          break;
        }
      }

      if (component.length > 1) {
        component.forEach((value) => cyclicIds.add(value));
        return;
      }

      const [single] = component;
      if ((adjacency.get(single) ?? []).includes(single)) {
        cyclicIds.add(single);
      }
    };

    this.records.forEach((_record, id) => {
      if (!indexById.has(id)) {
        visit(id);
      }
    });

    return cyclicIds;
  }

  private applyState(
    record: ExtensionRecord,
    nextState: ExtensionState,
    nextDetail: ExtensionStateDetails = {},
  ) {
    const previousState = record.state;
    const previousDetail = record.detail;
    const changed =
      previousState !== nextState ||
      !this.sameDetails(previousDetail, nextDetail);

    record.state = nextState;
    record.detail = this.cloneDetails(nextDetail);

    if (!changed) {
      return;
    }

    const event = {
      previousState,
      ...this.toSnapshot(record),
    } satisfies ExtensionStateChangeEvent;

    this.eventBus.emit("extension:state-change", event);

    if (nextState === "pending") {
      this.eventBus.emit("extension:activation-blocked", event);
      return;
    }

    if (nextState === "failed") {
      this.eventBus.emit("extension:activation-failed", event);
      return;
    }

    if (nextState === "active") {
      this.eventBus.emit("extension:activated", event);
    }
  }

  private toSnapshot(record: ExtensionRecord): ExtensionStateSnapshot {
    return {
      id: record.definition.id,
      state: record.state,
      ...this.cloneDetails(record.detail),
    };
  }

  private cloneDetails(detail: ExtensionStateDetails): ExtensionStateDetails {
    return {
      reason: detail.reason,
      message: detail.message,
      missingExtensions: detail.missingExtensions?.slice(),
      missingServices: detail.missingServices?.slice(),
      waitingFor: detail.waitingFor?.slice(),
      cycle: detail.cycle?.slice(),
    };
  }

  private sameDetails(
    left: ExtensionStateDetails,
    right: ExtensionStateDetails,
  ): boolean {
    return (
      left.reason === right.reason &&
      left.message === right.message &&
      this.sameStringArray(left.missingExtensions, right.missingExtensions) &&
      this.sameStringArray(left.missingServices, right.missingServices) &&
      this.sameStringArray(left.waitingFor, right.waitingFor) &&
      this.sameStringArray(left.cycle, right.cycle)
    );
  }

  private sameStringArray(left?: string[], right?: string[]): boolean {
    if (!left && !right) {
      return true;
    }
    if (!left || !right || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => value === right[index]);
  }

  private describeService(identifier: ServiceIdentifier<Service>): string {
    return isServiceToken(identifier) ? identifier.name : identifier;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private listRecords(): ExtensionRecord[] {
    return Array.from(this.records.values()).sort(
      (left, right) => left.registrationOrder - right.registrationOrder,
    );
  }
}

export { ExtensionManager };
