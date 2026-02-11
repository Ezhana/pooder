import Disposable from "../disposable";
import EventBus from "../event";
import { Service } from "../service";
import ToolRegistryService from "./ToolRegistryService";
import ToolSessionService from "./ToolSessionService";

export interface ToolSwitchContext {
  from: string | null;
  to: string | null;
  reason?: string;
}

export interface ToolSwitchResult {
  ok: boolean;
  from: string | null;
  to: string | null;
  reason?: string;
}

export type ToolSwitchGuard = (
  context: ToolSwitchContext,
) => boolean | Promise<boolean>;

interface GuardItem {
  guard: ToolSwitchGuard;
  priority: number;
}

export default class WorkbenchService implements Service {
  private _activeToolId: string | null = null;
  private eventBus?: EventBus;
  private toolRegistry?: ToolRegistryService;
  private sessionService?: ToolSessionService;
  private guards: GuardItem[] = [];

  init() {}

  dispose() {
    this.guards = [];
  }

  setEventBus(bus: EventBus) {
    this.eventBus = bus;
  }

  setToolRegistry(toolRegistry: ToolRegistryService) {
    this.toolRegistry = toolRegistry;
  }

  setToolSessionService(sessionService: ToolSessionService) {
    this.sessionService = sessionService;
  }

  get activeToolId(): string | null {
    return this._activeToolId;
  }

  registerSwitchGuard(
    guard: ToolSwitchGuard,
    priority: number = 0,
  ): Disposable {
    const item: GuardItem = { guard, priority };
    this.guards.push(item);
    this.guards.sort((a, b) => b.priority - a.priority);
    return {
      dispose: () => {
        const index = this.guards.indexOf(item);
        if (index >= 0) this.guards.splice(index, 1);
      },
    };
  }

  private async runGuards(context: ToolSwitchContext): Promise<boolean> {
    for (const { guard } of this.guards) {
      const allowed = await Promise.resolve(guard(context));
      if (!allowed) return false;
    }
    return true;
  }

  async switchTool(
    id: string | null,
    options?: { reason?: string },
  ): Promise<ToolSwitchResult> {
    if (this._activeToolId === id) {
      return { ok: true, from: this._activeToolId, to: id };
    }

    if (id && this.toolRegistry && !this.toolRegistry.hasTool(id)) {
      return {
        ok: false,
        from: this._activeToolId,
        to: id,
        reason: `tool-not-registered:${id}`,
      };
    }

    const context: ToolSwitchContext = {
      from: this._activeToolId,
      to: id,
      reason: options?.reason,
    };

    const guardAllowed = await this.runGuards(context);
    if (!guardAllowed) {
      this.eventBus?.emit("tool:switch:blocked", {
        ...context,
        reason: "blocked-by-guard",
      });
      return {
        ok: false,
        from: this._activeToolId,
        to: id,
        reason: "blocked-by-guard",
      };
    }

    if (context.from && this.sessionService) {
      const leaveResult = await this.sessionService.handleBeforeLeave(
        context.from,
      );
      if (leaveResult.decision === "blocked") {
        this.eventBus?.emit("tool:switch:blocked", {
          ...context,
          reason: leaveResult.reason || "session-blocked",
        });
        return {
          ok: false,
          from: this._activeToolId,
          to: id,
          reason: leaveResult.reason || "session-blocked",
        };
      }
      this.sessionService.deactivateSession(context.from);
    }

    if (id && this.sessionService && this.toolRegistry) {
      const tool = this.toolRegistry.getTool(id);
      if (tool?.interaction === "session" && tool.session?.autoBegin !== false) {
        await this.sessionService.begin(id);
      }
    }

    const previous = this._activeToolId;
    this._activeToolId = id;
    this.eventBus?.emit("tool:activated", { id, previous });
    this.eventBus?.emit("tool:switch", { from: previous, to: id });
    return { ok: true, from: previous, to: id };
  }

  async activate(id: string | null): Promise<ToolSwitchResult> {
    return await this.switchTool(id, { reason: "activate" });
  }

  async deactivate(): Promise<ToolSwitchResult> {
    return await this.switchTool(null, { reason: "deactivate" });
  }
}
