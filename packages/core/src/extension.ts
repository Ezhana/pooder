import { ExtensionContext } from "./context";
import { Contribution, ContributionPointIds } from "./contribution";
import Disposable from "./disposable";
import CommandService from "./services/CommandService";
import { ConfigurationService } from "./services";

interface ExtensionMetadata {
  name: string;
}

interface Extension {
  id: string;
  metadata?: Partial<ExtensionMetadata>;

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
    if (this.extensionRegistry.has(extension.id)) {
      console.warn(
        `Plugin "${extension.id}" already registered. It will be overwritten.`,
      );
    }

    // Initialize disposables for this extension
    this.extensionDisposables.set(extension.id, []);
    const disposables = this.extensionDisposables.get(extension.id)!;

    // Process declarative contributions
    if (extension.contribute) {
      for (const [pointId, items] of Object.entries(extension.contribute())) {
        if (Array.isArray(items)) {
          items.forEach((item) => {
            const contribution: Contribution = {
              id: item.id,
              metadata: {
                extensionId: extension.id,
                ...item?.metadata,
              },
              data: item,
            };
            const disposable = this.context.contributions.register(
              pointId,
              contribution,
            );

            // Track contribution registration to unregister later
            disposables.push(disposable);

            const dispose = this.collectContribution(pointId, contribution);
            if (dispose) {
              disposables.push(dispose);
            }
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

  collectContribution(pointId: string, item: any): Disposable | undefined {
    // If registering configurations, update ConfigurationService defaults
    if (pointId === ContributionPointIds.CONFIGURATIONS) {
      const configService = this.context.services.get<ConfigurationService>(
        "ConfigurationService",
      );
      configService?.initializeDefaults([item]);
    }
    if (pointId === ContributionPointIds.COMMANDS && item.data.handler) {
      const commandService =
        this.context.services.get<CommandService>("CommandService")!;

      return commandService.registerCommand(item.id, item.data.handler);
    }
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
