import { Command, Disposable } from "../command";
import { Service } from "../service";

export default class CommandService implements Service {
  private commands: Map<string, Command> = new Map();

  /**
   * Register a command
   * @param id Command ID
   * @param handler Command handler function
   * @param thisArg The `this` context for the handler
   * @returns Disposable to unregister the command
   */
  registerCommand(
    id: string,
    handler: (...args: any[]) => any,
    thisArg?: any,
  ): Disposable {
    if (this.commands.has(id)) {
      console.warn(`Command "${id}" is already registered. Overwriting.`);
    }

    const command: Command = {
      id,
      handler: thisArg ? handler.bind(thisArg) : handler,
    };

    this.commands.set(id, command);

    return {
      dispose: () => {
        if (this.commands.get(id) === command) {
          this.commands.delete(id);
        }
      },
    };
  }

  /**
   * Execute a command
   * @param id Command ID
   * @param args Arguments to pass to the handler
   * @returns The result of the command handler
   */
  async executeCommand<T = any>(id: string, ...args: any[]): Promise<T> {
    const command = this.commands.get(id);
    if (!command) {
      throw new Error(`Command "${id}" not found.`);
    }

    try {
      return await command.handler(...args);
    } catch (error) {
      console.error(`Error executing command "${id}":`, error);
      throw error;
    }
  }

  /**
   * Get all registered commands
   */
  getCommands(): Map<string, Command> {
    return this.commands;
  }

  /**
   * Get a specific command
   */
  getCommand(id: string): Command | undefined {
    return this.commands.get(id);
  }

  dispose() {
    this.commands.clear();
  }
}
