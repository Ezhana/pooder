import { Service } from "../service";
import EventBus from "../event";
import { ConfigurationContribution } from "../contribution";

export default class ConfigurationService implements Service {
  private configValues: Map<string, any> = new Map();
  private eventBus: EventBus = new EventBus();

  /**
   * Get a configuration value.
   */
  get<T = any>(key: string, defaultValue?: T): T {
    if (this.configValues.has(key)) {
      return this.configValues.get(key);
    }
    return defaultValue as T;
  }

  /**
   * Update a configuration value.
   * Emits 'change' event.
   */
  update(key: string, value: any) {
    const oldValue = this.configValues.get(key);
    if (oldValue !== value) {
      this.configValues.set(key, value);
      this.eventBus.emit(`change:${key}`, { key, value, oldValue });
      this.eventBus.emit("change", { key, value, oldValue });
    }
  }

  /**
   * Listen for changes to a specific configuration key.
   */
  onDidChange(
    key: string,
    callback: (event: { key: string; value: any; oldValue: any }) => void,
  ) {
    this.eventBus.on(`change:${key}`, callback);
    return {
      dispose: () => this.eventBus.off(`change:${key}`, callback),
    };
  }

  /**
   * Listen for any configuration change.
   */
  onAnyChange(
    callback: (event: { key: string; value: any; oldValue: any }) => void,
  ) {
    this.eventBus.on("change", callback);
    return {
      dispose: () => this.eventBus.off("change", callback),
    };
  }

  /**
   * Export current configuration state as a JSON-serializable object.
   * Useful for saving configuration templates.
   */
  export(): Record<string, any> {
    const exportData: Record<string, any> = {};
    for (const [key, value] of this.configValues) {
      exportData[key] = value;
    }
    return exportData;
  }

  /**
   * Import configuration from a JSON object.
   * This will merge the provided configuration with the current state,
   * overwriting existing keys and triggering change events.
   */
  import(data: Record<string, any>): void {
    if (!data || typeof data !== "object") {
      console.warn("ConfigurationService: Import data must be an object.");
      return;
    }
    Object.entries(data).forEach(([key, value]) => {
      this.update(key, value);
    });
  }

  /**
   * Initialize configuration with defaults from contributions.
   * This should be called when a contribution is registered.
   */
  initializeDefaults(contributions: ConfigurationContribution[]) {
    contributions.forEach((contrib) => {
      if (!contrib.id) {
        console.warn(
          "Configuration contribution missing 'id'. Skipping default initialization.",
          contrib,
        );
        return;
      }
      if (!this.configValues.has(contrib.id) && contrib.default !== undefined) {
        this.configValues.set(contrib.id, contrib.default);
      }
    });
  }

  dispose() {
    this.configValues.clear();
    // EventBus doesn't have a clear/dispose in the snippet, but it's fine for now.
  }
}
