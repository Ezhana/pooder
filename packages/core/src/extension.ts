import { ExtensionContext } from "./context";

interface ExtensionMetadata {
  name: string;
}

interface Extension {
  id: string;
  metadata?: ExtensionMetadata;

  activate(context: ExtensionContext): void;
  deactivate(context: ExtensionContext): void;
  contribute?(): Record<string, any[]>;
}

class ExtensionRegistry extends Map<string, Extension> {}

class ExtensionManager {
  private readonly context: ExtensionContext;
  private extensionRegistry: ExtensionRegistry = new ExtensionRegistry();

  constructor(context: ExtensionContext) {
    this.context = context;
  }

  register(extension: Extension) {
    if (this.extensionRegistry.has(extension.id)) {
      console.warn(
        `Plugin "${extension.id}" already registered. It will be overwritten.`,
      );
    }

    // Process declarative contributions
    if (extension.contribute) {
      for (const [pointId, items] of Object.entries(extension.contribute())) {
        if (Array.isArray(items)) {
          items.forEach((item) => {
            this.context.contributionRegistry.registerContribution({
              pointId,
              id:
                item.id ||
                `${extension.id}.${pointId}.${Math.random().toString(36).substr(2, 9)}`,
              data: item,
            });
          });
        }
      }
    }

    try {
      this.extensionRegistry.set(extension.id, extension);
      this.context.eventBus.emit("extension:register", extension);
    } catch (error) {
      console.error(
        `Error in onCreate hook for plugin "${extension.id}":`,
        error,
      );
    }

    try {
      extension.activate(this.context);
    } catch (error) {
      console.error(
        `Error in onActivate hook for plugin "${extension.id}":`,
        error,
      );
    }

    console.log(`Plugin "${extension.id}" registered successfully`);
  }

  unregister(name: string) {
    const extension = this.extensionRegistry.get(name);
    if (!extension) {
      console.warn(`Plugin "${name}" not found.`);
      return;
    }

    try {
      extension.deactivate(this.context);
    } catch (error) {
      console.error(`Error in deactivate for plugin "${name}":`, error);
    }

    this.extensionRegistry.delete(name);
    console.log(`Plugin "${name}" unregistered`);
    return true;
  }

  enable(name: string) {
    const extension = this.extensionRegistry.get(name);
    if (!extension) {
      console.warn(`Plugin "${name}" not found.`);
      return;
    }
  }

  disable(name: string) {
    const extension = this.extensionRegistry.get(name);
    if (!extension) {
      console.warn(`Plugin "${name}" not found.`);
      return;
    }
  }

  update() {}

  destroy() {
    const extensionNames = Array.from(this.extensionRegistry.keys());
    extensionNames.forEach((name) => this.unregister(name));
  }
}

export { Extension, ExtensionMetadata, ExtensionRegistry, ExtensionManager };
