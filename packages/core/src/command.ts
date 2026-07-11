export interface CommandArgSchema {}

export interface Command {
  id: string;
  handler: (...args: any[]) => any;
  title?: string;
  category?: string;
  description?: string;
  schema?: Record<string, CommandArgSchema>;
}
