import Disposable from "../disposable";
import EventBus from "../event";
import { Service, ServiceContext } from "../service";
import ToolRegistryService from "./ToolRegistryService";
import ToolSessionService from "./ToolSessionService";
import { TOOL_REGISTRY_SERVICE, TOOL_SESSION_SERVICE } from "./tokens";

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
  detail?: any;
}

export type ToolSwitchGuard = (
  context: ToolSwitchContext,
) => boolean | Promise<boolean>;

interface GuardItem {
  guard: ToolSwitchGuard;
  priority: number;
}

interface WorkbenchServiceDependencies {
  eventBus?: EventBus;
  toolRegistry?: ToolRegistryService;
  sessionService?: ToolSessionService;
}

export default class WorkbenchService implements Service {
  private _activeToolId: string | null = null;
  private eventBus?: EventBus;
  private toolRegistry?: ToolRegistryService;
  private sessionService?: ToolSessionService;
  private guards: GuardItem[] = [];

  constructor(dependencies: WorkbenchServiceDependencies = {}) {
    this.eventBus = dependencies.eventBus;
    this.toolRegistry = dependencies.toolRegistry;
    this.sessionService = dependencies.sessionService;
  }

  init(context: ServiceContext) {
    this.eventBus ??= context.eventBus;
    this.toolRegistry ??= context.get(TOOL_REGISTRY_SERVICE);
    this.sessionService ??= context.get(TOOL_SESSION_SERVICE);

    if (!this.eventBus) {
      throw new Error("WorkbenchService requires EventBus.");
    }
    if (!this.toolRegistry) {
      throw new Error("WorkbenchService requires ToolRegistryService.");
    }
    if (!this.sessionService) {
      throw new Error("WorkbenchService requires ToolSessionService.");
    }
  }

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
    const eventBus = this.getEventBus();
    const toolRegistry = this.getToolRegistry();
    const sessionService = this.getSessionService();
    const contextReason = options?.reason;

    if (this._activeToolId === id) {
      return { ok: true, from: this._activeToolId, to: id };
    }

    if (id && !toolRegistry.hasTool(id)) {
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
      reason: contextReason,
    };

    console.info("[WorkbenchService] switchTool:start", {
      from: context.from,
      to: context.to,
      reason: contextReason,
      fromDirty: context.from ? sessionService.isDirty(context.from) : false,
    });

    const guardAllowed = await this.runGuards(context);
    if (!guardAllowed) {
      console.warn("[WorkbenchService] switchTool:blocked-by-guard", context);
      eventBus.emit("tool:switch:blocked", {
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

    if (context.from) {
      const leaveResult = await sessionService.handleBeforeLeave(context.from);
      console.info("[WorkbenchService] switchTool:before-leave", {
        from: context.from,
        to: context.to,
        reason: contextReason,
        leaveResult,
      });
      if (leaveResult.decision === "blocked") {
        console.warn("[WorkbenchService] switchTool:blocked-by-session", {
          from: context.from,
          to: context.to,
          reason: contextReason,
          leaveResult,
        });
        eventBus.emit("tool:switch:blocked", {
          ...context,
          reason: leaveResult.reason || "session-blocked",
          detail: leaveResult.detail,
        });
        return {
          ok: false,
          from: this._activeToolId,
          to: id,
          reason: leaveResult.reason || "session-blocked",
          detail: leaveResult.detail,
        };
      }
      sessionService.deactivateSession(context.from);
    }

    if (id) {
      const tool = toolRegistry.getTool(id);
      if (
        tool?.interaction === "session" &&
        tool.session?.autoBegin !== false
      ) {
        await sessionService.begin(id);
        console.info("[WorkbenchService] switchTool:auto-begin-session", {
          toolId: id,
          reason: contextReason,
        });
      }
    }

    const previous = this._activeToolId;
    this._activeToolId = id;
    const reason = contextReason;
    console.info("[WorkbenchService] switchTool:success", {
      previous,
      activeToolId: this._activeToolId,
      reason,
    });
    eventBus.emit("tool:activated", { id, previous, reason });
    eventBus.emit("tool:switch", { from: previous, to: id, reason });
    return { ok: true, from: previous, to: id };
  }

  async activate(id: string | null): Promise<ToolSwitchResult> {
    return await this.switchTool(id, { reason: "activate" });
  }

  async deactivate(): Promise<ToolSwitchResult> {
    return await this.switchTool(null, { reason: "deactivate" });
  }

  private getEventBus(): EventBus {
    if (!this.eventBus) {
      throw new Error("WorkbenchService is not initialized.");
    }
    return this.eventBus;
  }

  private getToolRegistry(): ToolRegistryService {
    if (!this.toolRegistry) {
      throw new Error("WorkbenchService is not initialized.");
    }
    return this.toolRegistry;
  }

  private getSessionService(): ToolSessionService {
    if (!this.sessionService) {
      throw new Error("WorkbenchService is not initialized.");
    }
    return this.sessionService;
  }
}
