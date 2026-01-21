import { Command } from "../command";
import Disposable from "../disposable";
import { Service } from "../service";

export default class CommandService implements Service {
  private commands: Map<string, Command> = new Map();

  /**
   * Register a command
   * @param commandId Command Name (ID)
   * @param handler Command handler function
   * @param thisArg The `this` context for the handler
   * @returns Disposable to unregister the command
   */
  registerCommand(
    commandId: string,
    handler: (...args: any[]) => any,
    thisArg?: any,
  ): Disposable {
    if (this.commands.has(commandId)) {
      console.warn(`Command "${commandId}" is already registered. Overwriting.`);
    }

    const command: Command = {
      id: commandId,
      handler: thisArg ? handler.bind(thisArg) : handler,
    };

    this.commands.set(commandId, command);

    return {
      dispose: () => {
        if (this.commands.get(commandId) === command) {
          this.commands.delete(commandId);
        }
      },
    };
  }

  /**
   * Execute a command
   * @param commandId Command Name (ID)
   * @param args Arguments to pass to the handler
   * @returns The result of the command handler
   */
  async executeCommand<T = any>(commandId: string, ...args: any[]): Promise<T> {
    const command = this.commands.get(commandId);
    if (!command) {
      throw new Error(`Command "${commandId}" not found.`);
    }

    try {
      return await command.handler(...args);
    } catch (error) {
      console.error(`Error executing command "${commandId}":`, error);
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
  getCommand(commandId: string): Command | undefined {
    return this.commands.get(commandId);
  }

  dispose() {
    this.commands.clear();
  }
}
