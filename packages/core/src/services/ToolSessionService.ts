import { ToolContribution } from "../contribution";
import Disposable from "../disposable";
import { Service, ServiceContext } from "../service";
import EventBus from "../event";
import type {
  WorkflowSessionLeaveResult,
  WorkflowSessionState,
  WorkflowSessionStatus,
} from "../workflow-session";
import CommandService from "./CommandService";
import ToolRegistryService from "./ToolRegistryService";
import WorkflowSessionService from "./WorkflowSessionService";
import {
  COMMAND_SERVICE,
  TOOL_REGISTRY_SERVICE,
  WORKFLOW_SESSION_SERVICE,
} from "./tokens";

export type ToolSessionStatus = WorkflowSessionStatus;

export interface ToolSessionState {
  toolId: string;
  status: ToolSessionStatus;
  dirty: boolean;
  startedAt?: number;
  lastUpdatedAt?: number;
}

export type LeaveDecision = WorkflowSessionLeaveResult["decision"];

export interface LeaveResult extends WorkflowSessionLeaveResult {}

interface ToolSessionServiceDependencies {
  commandService?: CommandService;
  toolRegistry?: ToolRegistryService;
  workflowSessionService?: WorkflowSessionService;
}

export default class ToolSessionService implements Service {
  private commandService?: CommandService;
  private toolRegistry?: ToolRegistryService;
  private workflowSessionService?: WorkflowSessionService;
  private eventBus?: EventBus;

  constructor(dependencies: ToolSessionServiceDependencies = {}) {
    this.commandService = dependencies.commandService;
    this.toolRegistry = dependencies.toolRegistry;
    this.workflowSessionService = dependencies.workflowSessionService;
  }

  init(context: ServiceContext) {
    this.commandService ??= context.get(COMMAND_SERVICE);
    this.toolRegistry ??= context.get(TOOL_REGISTRY_SERVICE);
    this.workflowSessionService ??= context.get(WORKFLOW_SESSION_SERVICE);
    this.eventBus ??= context.eventBus;

    if (!this.commandService) {
      throw new Error("ToolSessionService requires CommandService.");
    }
    if (!this.toolRegistry) {
      throw new Error("ToolSessionService requires ToolRegistryService.");
    }
    if (!this.workflowSessionService) {
      throw new Error("ToolSessionService requires WorkflowSessionService.");
    }
  }

  setCommandService(commandService: CommandService) {
    this.commandService = commandService;
  }

  setToolRegistry(toolRegistry: ToolRegistryService) {
    this.toolRegistry = toolRegistry;
  }

  setWorkflowSessionService(workflowSessionService: WorkflowSessionService) {
    this.workflowSessionService = workflowSessionService;
  }

  registerDirtyTracker(toolId: string, callback: () => boolean): Disposable {
    return this.getWorkflowSessionService().registerDirtyTracker(
      toolId,
      callback,
    );
  }

  getState(toolId: string): ToolSessionState {
    return this.toToolSessionState(
      this.getWorkflowSessionService().getState(toolId),
    );
  }

  hasActiveSession(toolId: string): boolean {
    return this.getWorkflowSessionService().hasActiveSession(toolId);
  }

  hasAnyActiveSession(): boolean {
    return this.getWorkflowSessionService().hasAnyActiveSession();
  }

  private emitSessionChange(toolId: string, reason: string, detail?: any) {
    if (!this.eventBus) return;
    this.eventBus.emit("tool:session:change", {
      toolId,
      reason,
      detail,
      state: this.getState(toolId),
    });
  }

  isDirty(toolId: string): boolean {
    return this.getWorkflowSessionService().isDirty(toolId);
  }

  markDirty(toolId: string, dirty = true) {
    this.getWorkflowSessionService().markDirty(toolId, dirty);
    this.emitSessionChange(toolId, "dirty");
  }

  private resolveTool(toolId: string): ToolContribution | undefined {
    return this.getToolRegistry().getTool(toolId);
  }

  private async runCommand(commandId: string | undefined, ...args: any[]) {
    if (!commandId) return undefined;
    return await this.getCommandService().executeCommand(commandId, ...args);
  }

  private getCommandService(): CommandService {
    if (!this.commandService) {
      throw new Error("ToolSessionService is not initialized.");
    }
    return this.commandService;
  }

  private getToolRegistry(): ToolRegistryService {
    if (!this.toolRegistry) {
      throw new Error("ToolSessionService is not initialized.");
    }
    return this.toolRegistry;
  }

  async begin(toolId: string): Promise<void> {
    const tool = this.resolveTool(toolId);
    const session = this.getWorkflowSessionService().getState(toolId);
    if (session.status === "active") return;

    await this.runCommand(tool?.commands?.begin);
    await this.getWorkflowSessionService().begin(toolId);
    this.emitSessionChange(toolId, "begin");
  }

  async validate(toolId: string): Promise<{ ok: boolean; result?: any }> {
    const tool = this.resolveTool(toolId);
    if (!tool?.commands?.validate) {
      return { ok: true };
    }
    const result = await this.runCommand(tool.commands.validate);
    if (result === false) {
      this.emitSessionChange(toolId, "validate-failed", result);
      return { ok: false, result };
    }
    if (result && typeof result === "object" && "ok" in result) {
      const ok = Boolean((result as any).ok);
      if (!ok) {
        this.emitSessionChange(toolId, "validate-failed", result);
      }
      return { ok, result };
    }
    return { ok: true, result };
  }

  async commit(toolId: string): Promise<{ ok: boolean; result?: any }> {
    const tool = this.resolveTool(toolId);
    const validateResult = await this.validate(toolId);
    if (!validateResult.ok) return validateResult;

    const result = await this.runCommand(tool?.commands?.commit);
    await this.getWorkflowSessionService().commit(toolId);
    this.emitSessionChange(toolId, "commit");
    return { ok: true, result };
  }

  async rollback(toolId: string): Promise<void> {
    const tool = this.resolveTool(toolId);
    await this.runCommand(tool?.commands?.rollback || tool?.commands?.reset);
    await this.getWorkflowSessionService().rollback(toolId);
    this.emitSessionChange(toolId, "rollback");
  }

  deactivateSession(toolId: string) {
    this.getWorkflowSessionService().deactivateSession(toolId);
    this.emitSessionChange(toolId, "deactivate");
  }

  async handleBeforeLeave(toolId: string): Promise<LeaveResult> {
    const tool = this.resolveTool(toolId);
    if (!tool) return { decision: "allow" };
    if (tool.interaction !== "session") return { decision: "allow" };

    const dirty = this.isDirty(toolId);
    const leavePolicy = tool.session?.leavePolicy ?? "block";
    console.info("[ToolSessionService] handleBeforeLeave:check", {
      toolId,
      dirty,
      leavePolicy,
      status: this.getState(toolId).status,
    });
    if (!dirty) return { decision: "allow" };

    if (leavePolicy === "commit") {
      const committed = await this.commit(toolId);
      console.info("[ToolSessionService] handleBeforeLeave:commit-policy", {
        toolId,
        committed,
      });
      if (!committed.ok) {
        return {
          decision: "blocked",
          reason: "session-validation-failed",
          detail: committed.result,
        };
      }
      return { decision: "allow" };
    }

    if (leavePolicy === "rollback") {
      await this.rollback(toolId);
      console.info("[ToolSessionService] handleBeforeLeave:rollback-policy", {
        toolId,
      });
      return { decision: "allow" };
    }

    console.warn("[ToolSessionService] handleBeforeLeave:block-dirty", {
      toolId,
      leavePolicy,
    });
    return { decision: "blocked", reason: "session-dirty" };
  }

  dispose() {
    this.eventBus = undefined;
  }

  private getWorkflowSessionService(): WorkflowSessionService {
    if (!this.workflowSessionService) {
      throw new Error("ToolSessionService is not initialized.");
    }
    return this.workflowSessionService;
  }

  private toToolSessionState(state: WorkflowSessionState): ToolSessionState {
    return {
      toolId: state.workflowId,
      status: state.status,
      dirty: state.dirty,
      startedAt: state.startedAt,
      lastUpdatedAt: state.lastUpdatedAt,
    };
  }
}
