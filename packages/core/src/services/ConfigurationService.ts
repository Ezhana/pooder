import { Service } from "../service";
import EventBus from "../event";
import { ConfigurationContribution } from "../contribution";

export interface RegisteredConfigurationDefinition
  extends ConfigurationContribution {
  extensionId: string;
}

export interface ConfigurationDefinitionsChangeEvent {
  added: string[];
  removed: string[];
  extensionId: string;
}

export default class ConfigurationService implements Service {
  private readonly configValues: Map<string, any> = new Map();
  private readonly eventBus: EventBus = new EventBus();
  private readonly definitionsById = new Map<
    string,
    RegisteredConfigurationDefinition
  >();
  private readonly definitionIdsByExtension = new Map<string, Set<string>>();

  get<T = any>(key: string, defaultValue?: T): T {
    if (this.configValues.has(key)) {
      return this.configValues.get(key);
    }
    return defaultValue as T;
  }

  update(key: string, value: any) {
    const oldValue = this.configValues.get(key);
    if (oldValue !== value) {
      this.configValues.set(key, value);
      this.eventBus.emit(`change:${key}`, { key, value, oldValue });
      this.eventBus.emit("change", { key, value, oldValue });
    }
  }

  onDidChange(
    key: string,
    callback: (event: { key: string; value: any; oldValue: any }) => void,
  ) {
    this.eventBus.on(`change:${key}`, callback);
    return {
      dispose: () => this.eventBus.off(`change:${key}`, callback),
    };
  }

  onAnyChange(
    callback: (event: { key: string; value: any; oldValue: any }) => void,
  ) {
    this.eventBus.on("change", callback);
    return {
      dispose: () => this.eventBus.off("change", callback),
    };
  }

  export(): Record<string, any> {
    const exportData: Record<string, any> = {};
    for (const [key, value] of this.configValues) {
      exportData[key] = value;
    }
    return exportData;
  }

  import(data: Record<string, any>): void {
    if (!data || typeof data !== "object") {
      console.warn("ConfigurationService: Import data must be an object.");
      return;
    }
    Object.entries(data).forEach(([key, value]) => {
      this.update(key, value);
    });
  }

  registerDefinitions(
    extensionId: string,
    contributions: ConfigurationContribution[] = [],
  ) {
    const extensionDefinitions =
      this.definitionIdsByExtension.get(extensionId) ?? new Set<string>();
    const added: string[] = [];

    contributions.forEach((contribution) => {
      if (!contribution.id) {
        console.warn(
          "Configuration contribution missing 'id'. Skipping registration.",
          contribution,
        );
        return;
      }

      const definition: RegisteredConfigurationDefinition = {
        ...contribution,
        extensionId,
      };

      this.definitionsById.set(definition.id, definition);
      extensionDefinitions.add(definition.id);
      added.push(definition.id);

      if (
        !this.configValues.has(definition.id) &&
        definition.default !== undefined
      ) {
        this.configValues.set(definition.id, definition.default);
      }
    });

    this.definitionIdsByExtension.set(extensionId, extensionDefinitions);

    if (added.length > 0) {
      this.eventBus.emit("definitions:change", {
        added,
        removed: [],
        extensionId,
      } satisfies ConfigurationDefinitionsChangeEvent);
    }

    return {
      dispose: () => {
        this.unregisterDefinitions(extensionId);
      },
    };
  }

  unregisterDefinitions(extensionId: string) {
    const ids = this.definitionIdsByExtension.get(extensionId);
    if (!ids || ids.size === 0) {
      return;
    }

    const removed = Array.from(ids.values());
    removed.forEach((id) => {
      this.definitionsById.delete(id);
    });
    this.definitionIdsByExtension.delete(extensionId);

    this.eventBus.emit("definitions:change", {
      added: [],
      removed,
      extensionId,
    } satisfies ConfigurationDefinitionsChangeEvent);
  }

  listDefinitions(): RegisteredConfigurationDefinition[] {
    return Array.from(this.definitionsById.values())
      .map((definition) => ({ ...definition }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  getDefinition(id: string): RegisteredConfigurationDefinition | undefined {
    const definition = this.definitionsById.get(id);
    return definition ? { ...definition } : undefined;
  }

  onDefinitionsChange(
    callback: (event: ConfigurationDefinitionsChangeEvent) => void,
  ) {
    this.eventBus.on("definitions:change", callback);
    return {
      dispose: () => this.eventBus.off("definitions:change", callback),
    };
  }

  dispose() {
    this.configValues.clear();
    this.definitionsById.clear();
    this.definitionIdsByExtension.clear();
    this.eventBus.clear();
  }
}
