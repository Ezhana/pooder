import { Command, Editor } from "./types";

export { CommandManager, DefaultCommandManager, CommandMap };

interface CommandManager {
  register(name: string, command: Command): void;
  unregister(name: string): void;
  execute(name: string, ...args: any[]): any;
  get(name: string): Command | undefined;
  has(name: string): boolean;
  count(): number;
  list(): string[];
  clear(): void;
}
class CommandMap extends Map<string, Command> {}
class DefaultCommandManager implements CommandManager {
  private editor: Editor;
  constructor(editor: Editor) {
    this.editor = editor;
  }

  register(name: string, command: Command) {
    if (this.editor.commands.has(name)) {
      console.warn(`Command "${name}" already exists. It will be overwritten.`);
    }
    this.editor.commands.set(name, command);
  }
  unregister(name: string) {
    this.editor.commands.delete(name);
  }
  execute(name: string, ...args: any[]) {
    const command = this.editor.commands.get(name);
    if (!command) {
      console.warn(`Command "${name}" not found`);
      return false;
    }

    try {
      return command.execute(...args);
    } catch (e) {
      console.error(`Error executing command "${name}":`, e);
      return false;
    }
  }

  get(name: string) {
    return this.editor.commands.get(name);
  }
  has(name: string) {
    return this.editor.commands.has(name);
  }
  count(): number {
    return this.editor.commands.size;
  }
  list() {
    return Array.from(this.editor.commands.keys());
  }
  clear() {
    this.editor.commands.clear();
  }
}
