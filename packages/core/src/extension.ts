import { ExtensionContext } from "./context";
import { ContributionPointIds } from "./contribution";
import Disposable from "./disposable";
import CommandService from "./services/CommandService";

interface ExtensionMetadata {
  name: string;
}

interface Extension {
  metadata?: ExtensionMetadata;

  activate(context: ExtensionContext): void;
  deactivate(context: ExtensionContext): void;
  contribute?(): Record<string, any[]>;
}

class ExtensionRegistry extends Map<string, Extension> {}

class ExtensionManager {
  private readonly context: ExtensionContext;
  private extensionRegistry: ExtensionRegistry = new ExtensionRegistry();
  private extensionDisposables: Map<string, Disposable[]> = new Map();

  constructor(context: ExtensionContext) {
    this.context = context;
  }

  register(extension: Extension) {
    let id: string;
    if (extension.metadata?.name) {
      id = extension.metadata.name.toLowerCase().replace(/\s+/g, "-");
    } else {
      id = `anonymous-extension-${Math.random().toString(36).substr(2, 9)}`;
      console.warn(
        `Plugin registered without metadata.name. Assigned random ID: "${id}". This is not recommended for persistence.`,
      );
    }

    if (this.extensionRegistry.has(id)) {
      console.warn(
        `Plugin "${id}" already registered. It will be overwritten.`,
      );
    }

    // Initialize disposables for this extension
    this.extensionDisposables.set(id, []);
    const disposables = this.extensionDisposables.get(id)!;

    // Process declarative contributions
    if (extension.contribute) {
      for (const [pointId, items] of Object.entries(extension.contribute())) {
        if (Array.isArray(items)) {
          items.forEach((item) => {
            const disposable = this.context.contributions.register(pointId, {
              data: item,
            });

            // Track contribution registration to unregister later
            disposables.push(disposable);

            // Auto-register commands with handlers
            if (pointId === ContributionPointIds.COMMANDS && item.handler) {
              const commandService =
                this.context.services.get<CommandService>("CommandService")!;

              // Use item.command as the identifier for CommandService
              const commandName = item.command;
              if (commandName) {
                const commandDisposable = commandService.registerCommand(
                  commandName,
                  item.handler,
                );
                disposables.push(commandDisposable);
              }
            }
          });
        }
      }
    }

    try {
      this.extensionRegistry.set(id, extension);
      this.context.eventBus.emit("extension:register", extension);
    } catch (error) {
      console.error(`Error in onCreate hook for plugin "${id}":`, error);
    }

    try {
      extension.activate(this.context);
    } catch (error) {
      console.error(`Error in onActivate hook for plugin "${id}":`, error);
    }

    console.log(`Plugin "${id}" registered successfully`);
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

    // Dispose all resources associated with this extension
    const disposables = this.extensionDisposables.get(name);
    if (disposables) {
      disposables.forEach((d) => d.dispose());
      this.extensionDisposables.delete(name);
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
