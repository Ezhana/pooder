import { ToolContribution } from "../contribution";
import Disposable from "../disposable";
import { Service } from "../service";
import CommandService from "./CommandService";
import ToolRegistryService from "./ToolRegistryService";

export type ToolSessionStatus = "idle" | "active";

export interface ToolSessionState {
  toolId: string;
  status: ToolSessionStatus;
  dirty: boolean;
  startedAt?: number;
  lastUpdatedAt?: number;
}

export type LeaveDecision = "allow" | "blocked";

export interface LeaveResult {
  decision: LeaveDecision;
  reason?: string;
}

export default class ToolSessionService implements Service {
  private readonly sessions = new Map<string, ToolSessionState>();
  private commandService?: CommandService;
  private toolRegistry?: ToolRegistryService;

  setCommandService(commandService: CommandService) {
    this.commandService = commandService;
  }

  setToolRegistry(toolRegistry: ToolRegistryService) {
    this.toolRegistry = toolRegistry;
  }

  registerDirtyTracker(toolId: string, callback: () => boolean): Disposable {
    const wrapped = () => {
      try {
        return callback();
      } catch {
        return false;
      }
    };
    this.dirtyTrackers.set(toolId, wrapped);
    return {
      dispose: () => {
        if (this.dirtyTrackers.get(toolId) === wrapped) {
          this.dirtyTrackers.delete(toolId);
        }
      },
    };
  }

  private readonly dirtyTrackers = new Map<string, () => boolean>();

  private ensureSession(toolId: string): ToolSessionState {
    const existing = this.sessions.get(toolId);
    if (existing) return existing;

    const created: ToolSessionState = {
      toolId,
      status: "idle",
      dirty: false,
    };
    this.sessions.set(toolId, created);
    return created;
  }

  getState(toolId: string): ToolSessionState {
    return { ...this.ensureSession(toolId) };
  }

  isDirty(toolId: string): boolean {
    const tracker = this.dirtyTrackers.get(toolId);
    if (tracker) return tracker();
    return this.ensureSession(toolId).dirty;
  }

  markDirty(toolId: string, dirty = true) {
    const session = this.ensureSession(toolId);
    session.dirty = dirty;
    session.lastUpdatedAt = Date.now();
  }

  private resolveTool(toolId: string): ToolContribution | undefined {
    return this.toolRegistry?.getTool(toolId);
  }

  private async runCommand(commandId: string | undefined, ...args: any[]) {
    if (!commandId || !this.commandService) return undefined;
    return await this.commandService.executeCommand(commandId, ...args);
  }

  async begin(toolId: string): Promise<void> {
    const tool = this.resolveTool(toolId);
    const session = this.ensureSession(toolId);
    if (session.status === "active") return;

    await this.runCommand(tool?.commands?.begin);
    session.status = "active";
    session.startedAt = Date.now();
    session.lastUpdatedAt = session.startedAt;
  }

  async validate(toolId: string): Promise<{ ok: boolean; result?: any }> {
    const tool = this.resolveTool(toolId);
    if (!tool?.commands?.validate) {
      return { ok: true };
    }
    const result = await this.runCommand(tool.commands.validate);
    if (result === false) return { ok: false, result };
    if (result && typeof result === "object" && "ok" in result) {
      return { ok: Boolean((result as any).ok), result };
    }
    return { ok: true, result };
  }

  async commit(toolId: string): Promise<{ ok: boolean; result?: any }> {
    const tool = this.resolveTool(toolId);
    const validateResult = await this.validate(toolId);
    if (!validateResult.ok) return validateResult;

    const result = await this.runCommand(tool?.commands?.commit);
    const session = this.ensureSession(toolId);
    session.dirty = false;
    session.status = "idle";
    session.lastUpdatedAt = Date.now();
    return { ok: true, result };
  }

  async rollback(toolId: string): Promise<void> {
    const tool = this.resolveTool(toolId);
    await this.runCommand(tool?.commands?.rollback || tool?.commands?.reset);
    const session = this.ensureSession(toolId);
    session.dirty = false;
    session.status = "idle";
    session.lastUpdatedAt = Date.now();
  }

  deactivateSession(toolId: string) {
    const session = this.ensureSession(toolId);
    session.status = "idle";
    session.lastUpdatedAt = Date.now();
  }

  async handleBeforeLeave(toolId: string): Promise<LeaveResult> {
    const tool = this.resolveTool(toolId);
    if (!tool) return { decision: "allow" };
    if (tool.interaction !== "session") return { decision: "allow" };

    const dirty = this.isDirty(toolId);
    if (!dirty) return { decision: "allow" };

    const leavePolicy = tool.session?.leavePolicy ?? "block";
    if (leavePolicy === "commit") {
      const committed = await this.commit(toolId);
      if (!committed.ok) {
        return { decision: "blocked", reason: "session-validation-failed" };
      }
      return { decision: "allow" };
    }

    if (leavePolicy === "rollback") {
      await this.rollback(toolId);
      return { decision: "allow" };
    }

    return { decision: "blocked", reason: "session-dirty" };
  }

  dispose() {
    this.sessions.clear();
    this.dirtyTrackers.clear();
  }
}
