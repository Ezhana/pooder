import { Contribution } from "./contribution";
import EventBus from "./event";

export { ExtensionRegistry, ExtensionManager };
export interface ExtensionOptions {
  [key: string]: any;
}
export interface OptionSchema {
  type: "string" | "number" | "boolean" | "color" | "select";
  options?: string[] | { label: string; value: any }[];
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}
interface ExtensionMetadata {
  name: string;
  contributions?: Contribution[];
}

export interface Extension {
  id: string;
  metadata?: ExtensionMetadata;

  activate(): void;
  deactivate(): void;
}

class ExtensionRegistry extends Map<string, Extension> {}
class ExtensionManager {
  private readonly extensionRegistry: ExtensionRegistry;

  constructor(extensionRegistry: ExtensionRegistry) {
    this.extensionRegistry = extensionRegistry;
  }

  register(extension: Extension) {
    if (this.extensionRegistry.has(extension.id)) {
      console.warn(
        `Plugin "${extension.id}" already registered. It will be overwritten.`,
      );
    }

    try {
      this.extensionRegistry.set(extension.id, extension);
      EventBus.emit("extension:register", extension);
    } catch (error) {
      console.error(
        `Error in onCreate hook for plugin "${extension.id}":`,
        error,
      );
    }

    try {
      extension.activate();
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
      extension.deactivate();
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
