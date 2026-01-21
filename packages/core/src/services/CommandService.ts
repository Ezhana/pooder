import { Command } from "../command";
import { Service } from "../service";

export default class CommandService implements Service {
  private commands: Map<string, Command> = new Map();

  dispose() {}
}
