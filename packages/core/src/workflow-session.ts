export type WorkflowSessionId = string;
export type WorkflowSessionStatus = "idle" | "active";
export type WorkflowSessionLeavePolicy = "block" | "commit" | "rollback";
export type WorkflowSessionLeaveDecision = "allow" | "blocked";

export interface WorkflowSessionState {
  workflowId: WorkflowSessionId;
  status: WorkflowSessionStatus;
  dirty: boolean;
  startedAt?: number;
  lastUpdatedAt?: number;
}

export interface WorkflowSessionValidationResult {
  ok: boolean;
  result?: unknown;
}

export interface WorkflowSessionLeaveResult {
  decision: WorkflowSessionLeaveDecision;
  reason?: string;
  detail?: unknown;
}

export interface WorkflowSessionLifecycle {
  begin?(): void | Promise<void>;
  validate?():
    | boolean
    | WorkflowSessionValidationResult
    | Promise<boolean | WorkflowSessionValidationResult>;
  commit?(): unknown | Promise<unknown>;
  rollback?(): void | Promise<void>;
}

export interface WorkflowSessionDefinition {
  id: WorkflowSessionId;
  leavePolicy?: WorkflowSessionLeavePolicy;
  lifecycle?: WorkflowSessionLifecycle;
  metadata?: Record<string, unknown>;
}

export interface WorkflowSessionChangeEvent {
  workflowId: WorkflowSessionId;
  reason: string;
  detail?: unknown;
  state: WorkflowSessionState;
}
