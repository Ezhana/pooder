import { Editor, Extension } from "./types";

export { ExtensionManager, DefaultExtensionManager, ExtensionMap };

interface ExtensionManager {
  register(extension: Extension): void;
  unregister(name: string): void;
  enable(name: string): void;
  disable(name: string): void;
  get(name: string): Extension | undefined;
  has(name: string): boolean;
  count(): number;
  list(): Extension[];
  mount(): void;
  unmount(): void;
  update(): void;
  destroy(): void;
}
class ExtensionMap extends Map<string, Extension> {}
class DefaultExtensionManager implements ExtensionManager {
  private readonly editor: Editor;
  private mounted: boolean = false;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  private _registerCommands(extension: Extension) {
    if (extension.commands) {
      Object.entries(extension.commands).forEach(([name, command]) => {
        const commandName = `${extension.name}.${name}`;
        this.editor.registerCommand(commandName, command);
      });
    }
  }

  private _unregisterCommands(extension: Extension) {
    if (extension.commands) {
      Object.keys(extension.commands).forEach((name) => {
        const commandName = `${extension.name}.${name}`;
        this.editor.unregisterCommand(commandName);
      });
    }
  }

  register(extension: Extension) {
    if (this.editor.extensions.has(extension.name)) {
      console.warn(
        `Plugin "${extension.name}" already registered. It will be overwritten.`,
      );
    }

    try {
      if (extension.enabled === undefined) {
        extension.enabled = true;
      }
      this.editor.extensions.set(extension.name, extension);
      extension.onCreate?.(this.editor);
    } catch (error) {
      console.error(
        `Error in onCreate hook for plugin "${extension.name}":`,
        error,
      );
    }

    if (extension.enabled) {
      this._registerCommands(extension);

      if (this.mounted) {
        try {
          extension.onMount?.(this.editor);
        } catch (error) {
          console.error(
            `Error in onMount hook for plugin "${extension.name}":`,
            error,
          );
        }
      }
    }

    console.log(`Plugin "${extension.name}" registered successfully`);
  }

  unregister(name: string) {
    const extension = this.editor.extensions.get(name);
    if (!extension) {
      console.warn(`Plugin "${name}" not found.`);
      return;
    }

    if (this.mounted && extension.enabled) {
      try {
        extension.onUnmount?.(this.editor);
      } catch (error) {
        console.error(`Error in onUnmount hook for plugin "${name}":`, error);
      }
    }

    try {
      extension.onDestroy?.(this.editor);
    } catch (error) {
      console.error(`Error in onDestroy hook for plugin "${name}":`, error);
    }

    this._unregisterCommands(extension);

    this.editor.extensions.delete(name);
    console.log(`Plugin "${name}" unregistered`);
    return true;
  }

  enable(name: string) {
    const extension = this.get(name);
    if (!extension) {
      console.warn(`Plugin "${name}" not found.`);
      return;
    }
    if (extension.enabled) return;

    extension.enabled = true;
    this._registerCommands(extension);

    if (this.mounted) {
      try {
        extension.onMount?.(this.editor);
      } catch (error) {
        console.error(`Error in onMount hook for plugin "${name}":`, error);
      }
    }
  }

  disable(name: string) {
    const extension = this.get(name);
    if (!extension) {
      console.warn(`Plugin "${name}" not found.`);
      return;
    }
    if (!extension.enabled) return;

    extension.enabled = false;
    this._unregisterCommands(extension);

    if (this.mounted) {
      try {
        extension.onUnmount?.(this.editor);
      } catch (error) {
        console.error(`Error in onUnmount hook for plugin "${name}":`, error);
      }
    }
  }

  get(name: string) {
    return this.editor.extensions.get(name);
  }
  has(name: string) {
    return this.editor.extensions.has(name);
  }
  count() {
    return this.editor.extensions.size;
  }
  list() {
    return Array.from(this.editor.extensions.values());
  }
  mount() {
    if (this.mounted) return;

    this.editor.extensions.forEach((extension) => {
      if (extension.enabled) {
        try {
          console.log(`Mounting plugin "${extension.name}"`);
          extension.onMount?.(this.editor);
        } catch (e) {
          console.error(
            `Error in onMount hook for plugin "${extension.name}":`,
            e,
          );
        }
      }
    });
    console.log(`Plugins mounted`);

    this.mounted = true;
  }

  unmount() {
    if (!this.mounted) return;

    this.editor.extensions.forEach((extension) => {
      if (extension.enabled) {
        try {
          extension.onUnmount?.(this.editor);
        } catch (e) {
          console.error(
            `Error in onUnmount hook for plugin "${extension.name}":`,
            e,
          );
        }
      }
    });
    console.log(`Plugins unmounted`);

    this.mounted = false;
  }

  update() {
    const state = this.editor.getState();

    this.editor.extensions.forEach((extension) => {
      if (extension.enabled) {
        try {
          extension.onUpdate?.(this.editor, state);
        } catch (e) {
          console.error(
            `Error in onUpdate hook for plugin "${extension.name}":`,
            e,
          );
        }
      }
    });
  }

  destroy() {
    const extensionNames = Array.from(this.editor.extensions.keys());
    extensionNames.forEach((name) => this.unregister(name));
    this.mounted = false;
  }
}
