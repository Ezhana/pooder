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
