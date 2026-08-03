import { Service } from "../service";
import { ConfigurationContribution } from "../contribution";
import { TypedEventEmitter } from "../typed-event";

export interface RegisteredConfigurationDefinition extends ConfigurationContribution {
  extensionId: string;
}

export interface ConfigurationDefinitionsChangeEvent {
  added: string[];
  removed: string[];
  extensionId: string;
}

export interface ConfigurationValueChangeEvent {
  key: string;
  value: any;
  oldValue: any;
}

export interface PreparedConfigurationPublication {
  readonly values: Readonly<Record<string, unknown>>;
}

interface ConfigurationServiceEventMap {
  change: ConfigurationValueChangeEvent;
  definitionsChange: ConfigurationDefinitionsChangeEvent;
}

export default class ConfigurationService implements Service {
  private readonly configValues: Map<string, any> = new Map();
  private readonly events =
    new TypedEventEmitter<ConfigurationServiceEventMap>();
  private readonly valueListenersByKey = new Map<
    string,
    Set<(event: ConfigurationValueChangeEvent) => void>
  >();
  private readonly definitionsById = new Map<
    string,
    RegisteredConfigurationDefinition
  >();
  private readonly definitionIdsByExtension = new Map<string, Set<string>>();
  private revision = 0;
  private readonly preparedPublications = new WeakMap<
    PreparedConfigurationPublication,
    {
      values: Map<string, any>;
      changes: ConfigurationValueChangeEvent[];
      revision: number;
    }
  >();
  private readonly pendingPublicationNotifications = new WeakMap<
    PreparedConfigurationPublication,
    ConfigurationValueChangeEvent[]
  >();

  get<T = any>(key: string, defaultValue?: T): T {
    if (this.configValues.has(key)) {
      return this.configValues.get(key);
    }
    return defaultValue as T;
  }

  update(key: string, value: any) {
    const oldValue = this.configValues.get(key);
    if (!sameConfigurationValue(oldValue, value)) {
      this.configValues.set(key, value);
      this.revision += 1;
      this.emitValueChange({ key, value, oldValue });
    }
  }

  onDidChange(
    key: string,
    callback: (event: { key: string; value: any; oldValue: any }) => void,
  ) {
    const listeners = this.valueListenersByKey.get(key) ?? new Set();
    listeners.add(callback);
    this.valueListenersByKey.set(key, listeners);
    return {
      dispose: () => {
        listeners.delete(callback);
        if (listeners.size === 0) this.valueListenersByKey.delete(key);
      },
    };
  }

  onAnyChange(
    callback: (event: { key: string; value: any; oldValue: any }) => void,
  ) {
    return this.events.on("change", callback);
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

  prepareImport(data: Record<string, any>): PreparedConfigurationPublication {
    if (!data || typeof data !== "object") {
      throw new Error("ConfigurationService import data must be an object.");
    }
    const values = new Map(this.configValues);
    const changes: ConfigurationValueChangeEvent[] = [];
    Object.entries(data).forEach(([key, value]) => {
      const oldValue = values.get(key);
      if (sameConfigurationValue(oldValue, value)) return;
      values.set(key, value);
      changes.push({ key, value, oldValue });
    });
    const publication: PreparedConfigurationPublication = {
      values: Object.fromEntries(values),
    };
    this.preparedPublications.set(publication, {
      values,
      changes,
      revision: this.revision,
    });
    return publication;
  }

  assertImportPublicationCurrent(
    publication: PreparedConfigurationPublication,
  ): void {
    this.requireCurrentPublication(publication);
  }

  publishImport(
    publication: PreparedConfigurationPublication,
    options: { notify?: boolean } = {},
  ): void {
    const prepared = this.requireCurrentPublication(publication);
    this.preparedPublications.delete(publication);
    this.configValues.clear();
    prepared.values.forEach((value, key) => this.configValues.set(key, value));
    if (prepared.changes.length) this.revision += 1;
    if (options.notify === false) {
      this.pendingPublicationNotifications.set(publication, prepared.changes);
      return;
    }
    prepared.changes.forEach((event) => this.emitValueChange(event));
  }

  notifyImportPublished(publication: PreparedConfigurationPublication): void {
    const changes = this.pendingPublicationNotifications.get(publication);
    if (!changes) {
      throw new Error(
        "Configuration publication has no pending notifications.",
      );
    }
    this.pendingPublicationNotifications.delete(publication);
    changes.forEach((event) => this.emitValueChange(event));
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
        this.revision += 1;
      }
    });

    this.definitionIdsByExtension.set(extensionId, extensionDefinitions);

    if (added.length > 0) {
      this.events.emit("definitionsChange", {
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

    this.events.emit("definitionsChange", {
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
    return this.events.on("definitionsChange", callback);
  }

  dispose() {
    this.configValues.clear();
    this.definitionsById.clear();
    this.definitionIdsByExtension.clear();
    this.valueListenersByKey.clear();
    this.events.clear();
  }

  private emitValueChange(event: ConfigurationValueChangeEvent): void {
    [...(this.valueListenersByKey.get(event.key) ?? [])].forEach((listener) =>
      listener(event),
    );
    this.events.emit("change", event);
  }

  private requireCurrentPublication(
    publication: PreparedConfigurationPublication,
  ) {
    const prepared = this.preparedPublications.get(publication);
    if (!prepared) {
      throw new Error(
        "Configuration publication is invalid or already published.",
      );
    }
    if (prepared.revision !== this.revision) {
      throw new Error(
        "Configuration publication is stale because configuration changed after prepare.",
      );
    }
    return prepared;
  }
}

function sameConfigurationValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
