export interface CommandArgSchema {}

export interface Command {
  schema?: Record<string, CommandArgSchema>;
}
