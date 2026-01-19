import { PooderCanvas } from "./canvas";
import { PooderObject } from "./obj";
import { PooderLayer } from "./layer";
import { ExtensionMap } from "./extension";
import { CommandMap } from "./command";

export interface CommandArgSchema {
  type: "string" | "number" | "boolean" | "object" | "any";
  label?: string;
  description?: string;
  required?: boolean;
  default?: any;
  // Type-specific constraints
  options?: string[] | { label: string; value: any }[];
  min?: number;
  max?: number;
}

export interface CommandSchema {
  [argName: string]: CommandArgSchema;
}

export interface Command {
  execute(...args: any[]): any;
  schema?: CommandSchema;
}

export interface Event {
  name: string;
  data: any;
}

export type EventHandler = (...args: any[]) => void | boolean;

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

export interface Extension<T extends ExtensionOptions = ExtensionOptions> {
  name: string;
  priority?: number;
  options?: T;
  schema?: Record<keyof T, OptionSchema>;
  enabled?: boolean;

  onCreate?(editor: Editor): void;
  onMount?(editor: Editor): void;
  onEnable?(editor: Editor): void;
  onUpdate?(editor: Editor, state: EditorState): void;
  onDisable?(editor: Editor): void;
  onUnmount?(editor: Editor): void;
  onDestroy?(editor: Editor): void;

  toJSON?(): any;
  loadFromJSON?(data: any): void | Promise<void>;

  commands?: Record<string, Command>;
}

export interface EditorState {
  width: number;
  height: number;
  metadata?: Record<string, any>;
}

export interface Editor {
  state: EditorState;
  canvas: PooderCanvas;
  extensions: ExtensionMap;
  commands: CommandMap;

  use(extension: Extension, enable?: boolean): void;
  unuse(name: string): void;
  getExtension(name: string): Extension | undefined;
  getExtensions(): Extension[];
  enableExtension(name: string): void;
  disableExtension(name: string): void;

  registerCommand(name: string, command: Command): void;
  unregisterCommand(name: string): void;
  executeCommand(name: string, ...args: any[]): any;

  on(event: string, handler: EventHandler, priority?: number): void;
  off(event: string, handler: EventHandler): void;
  emit(event: string, ...args: any[]): void;

  getObjects(): PooderObject[];
  getObject(id: string, layerId?: string): PooderObject | undefined;
  getLayers(): PooderLayer[];
  getLayer(id: string): PooderLayer | undefined;

  updateState(updater: (state: EditorState) => EditorState): void;
  getState(): EditorState;

  toJSON(): any;
  loadFromJSON(json: any): Promise<void>;

  destroy(): void;
}
