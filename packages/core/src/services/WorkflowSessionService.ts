import Disposable from "../disposable";
import EventBus from "../event";
import type { Service, ServiceContext } from "../service";
import type {
  WorkflowSessionChangeEvent,
  WorkflowSessionDefinition,
  WorkflowSessionId,
  WorkflowInteractionSessionEvent,
  WorkflowInteractionSessionEventType,
  WorkflowInteractionSessionInput,
  WorkflowInteractionSessionPayload,
  WorkflowSessionLeavePolicy,
  WorkflowSessionLeaveResult,
  WorkflowSessionState,
  WorkflowSessionValidationResult,
} from "../workflow-session";

export default class WorkflowSessionService implements Service {
  private readonly sessions = new Map<WorkflowSessionId, WorkflowSessionState>();
  private readonly definitions = new Map<
    WorkflowSessionId,
    WorkflowSessionDefinition
  >();
  private readonly dirtyTrackers = new Map<WorkflowSessionId, () => boolean>();
  private interactionSessionSeq = 0;
  private eventBus?: EventBus;

  init(context: ServiceContext) {
    this.eventBus ??= context.eventBus;
  }

  registerSession(definition: WorkflowSessionDefinition): Disposable {
    const id = this.normalizeId(definition.id);
    if (this.definitions.has(id)) {
      throw new Error(`Workflow session "${id}" is already registered.`);
    }

    const registered: WorkflowSessionDefinition = {
      ...definition,
      id,
      metadata: definition.metadata ? { ...definition.metadata } : undefined,
    };
    this.definitions.set(id, registered);
    this.ensureSession(id);

    return {
      dispose: () => {
        if (this.definitions.get(id) === registered) {
          this.definitions.delete(id);
        }
      },
    };
  }

  registerDirtyTracker(
    workflowId: WorkflowSessionId,
    callback: () => boolean,
  ): Disposable {
    const id = this.normalizeId(workflowId);
    const wrapped = () => {
      try {
        return callback();
      } catch {
        return false;
      }
    };
    this.dirtyTrackers.set(id, wrapped);
    return {
      dispose: () => {
        if (this.dirtyTrackers.get(id) === wrapped) {
          this.dirtyTrackers.delete(id);
        }
      },
    };
  }

  getState(workflowId: WorkflowSessionId): WorkflowSessionState {
    return { ...this.ensureSession(this.normalizeId(workflowId)) };
  }

  listStates(): WorkflowSessionState[] {
    return Array.from(this.sessions.values())
      .map((state) => ({ ...state }))
      .sort((left, right) => left.workflowId.localeCompare(right.workflowId));
  }

  hasActiveSession(workflowId: WorkflowSessionId): boolean {
    return this.ensureSession(this.normalizeId(workflowId)).status === "active";
  }

  hasAnyActiveSession(): boolean {
    for (const session of this.sessions.values()) {
      if (session.status === "active") {
        return true;
      }
    }
    return false;
  }

  isDirty(workflowId: WorkflowSessionId): boolean {
    const id = this.normalizeId(workflowId);
    const tracker = this.dirtyTrackers.get(id);
    if (tracker) {
      return tracker();
    }
    return this.ensureSession(id).dirty;
  }

  markDirty(workflowId: WorkflowSessionId, dirty = true) {
    const id = this.normalizeId(workflowId);
    const session = this.ensureSession(id);
    session.dirty = dirty;
    session.lastUpdatedAt = Date.now();
    this.emitSessionChange(id, "dirty");
  }

  async begin(workflowId: WorkflowSessionId): Promise<void> {
    const id = this.normalizeId(workflowId);
    const session = this.ensureSession(id);
    if (session.status === "active") {
      return;
    }

    await this.definitions.get(id)?.lifecycle?.begin?.();
    session.status = "active";
    session.startedAt = Date.now();
    session.lastUpdatedAt = session.startedAt;
    this.emitSessionChange(id, "begin");
  }

  startSession(input: WorkflowInteractionSessionInput): WorkflowInteractionSessionPayload {
    const payload = this.normalizeInteractionSessionInput(input);
    this.emitInteractionSession("session:start", payload);
    return payload;
  }

  updateSession(input: WorkflowInteractionSessionInput): WorkflowInteractionSessionPayload {
    const payload = this.normalizeInteractionSessionInput(input);
    this.emitInteractionSession("session:update", payload);
    return payload;
  }

  endSession(input: WorkflowInteractionSessionInput): WorkflowInteractionSessionPayload {
    const payload = this.normalizeInteractionSessionInput(input);
    this.emitInteractionSession("session:end", payload);
    return payload;
  }

  cancelSession(input: WorkflowInteractionSessionInput): WorkflowInteractionSessionPayload {
    const payload = this.normalizeInteractionSessionInput(input);
    this.emitInteractionSession("session:cancel", payload);
    return payload;
  }

  async validate(
    workflowId: WorkflowSessionId,
  ): Promise<WorkflowSessionValidationResult> {
    const id = this.normalizeId(workflowId);
    const result = await this.definitions.get(id)?.lifecycle?.validate?.();
    if (result === undefined || result === true) {
      return { ok: true, result };
    }
    if (result === false) {
      this.emitSessionChange(id, "validate-failed", result);
      return { ok: false, result };
    }
    if (typeof result === "object" && "ok" in result) {
      const ok = Boolean(result.ok);
      if (!ok) {
        this.emitSessionChange(id, "validate-failed", result);
      }
      return { ok, result: result.result };
    }
    return { ok: true, result };
  }

  async commit(
    workflowId: WorkflowSessionId,
  ): Promise<WorkflowSessionValidationResult> {
    const id = this.normalizeId(workflowId);
    const validateResult = await this.validate(id);
    if (!validateResult.ok) {
      return validateResult;
    }

    const result = await this.definitions.get(id)?.lifecycle?.commit?.();
    const session = this.ensureSession(id);
    session.dirty = false;
    session.status = "idle";
    session.lastUpdatedAt = Date.now();
    this.emitSessionChange(id, "commit", result);
    return { ok: true, result };
  }

  async rollback(workflowId: WorkflowSessionId): Promise<void> {
    const id = this.normalizeId(workflowId);
    await this.definitions.get(id)?.lifecycle?.rollback?.();
    const session = this.ensureSession(id);
    session.dirty = false;
    session.status = "idle";
    session.lastUpdatedAt = Date.now();
    this.emitSessionChange(id, "rollback");
  }

  deactivateSession(workflowId: WorkflowSessionId) {
    const id = this.normalizeId(workflowId);
    const session = this.ensureSession(id);
    session.status = "idle";
    session.lastUpdatedAt = Date.now();
    this.emitSessionChange(id, "deactivate");
  }

  async handleBeforeLeave(
    workflowId: WorkflowSessionId,
    leavePolicy?: WorkflowSessionLeavePolicy,
  ): Promise<WorkflowSessionLeaveResult> {
    const id = this.normalizeId(workflowId);
    const dirty = this.isDirty(id);
    if (!dirty) {
      return { decision: "allow" };
    }

    const policy =
      leavePolicy ?? this.definitions.get(id)?.leavePolicy ?? "block";
    if (policy === "commit") {
      const committed = await this.commit(id);
      if (!committed.ok) {
        return {
          decision: "blocked",
          reason: "session-validation-failed",
          detail: committed.result,
        };
      }
      return { decision: "allow" };
    }

    if (policy === "rollback") {
      await this.rollback(id);
      return { decision: "allow" };
    }

    return { decision: "blocked", reason: "session-dirty" };
  }

  onDidChange(callback: (event: WorkflowSessionChangeEvent) => void) {
    this.eventBus?.on("workflow:session:change", callback);
    return {
      dispose: () => this.eventBus?.off("workflow:session:change", callback),
    };
  }

  onSessionStart(callback: (event: WorkflowInteractionSessionEvent) => void) {
    return this.onInteractionSession("session:start", callback);
  }

  onSessionUpdate(callback: (event: WorkflowInteractionSessionEvent) => void) {
    return this.onInteractionSession("session:update", callback);
  }

  onSessionEnd(callback: (event: WorkflowInteractionSessionEvent) => void) {
    return this.onInteractionSession("session:end", callback);
  }

  onSessionCancel(callback: (event: WorkflowInteractionSessionEvent) => void) {
    return this.onInteractionSession("session:cancel", callback);
  }

  dispose() {
    this.sessions.clear();
    this.definitions.clear();
    this.dirtyTrackers.clear();
    this.eventBus = undefined;
  }

  private ensureSession(workflowId: WorkflowSessionId): WorkflowSessionState {
    const existing = this.sessions.get(workflowId);
    if (existing) {
      return existing;
    }

    const created: WorkflowSessionState = {
      workflowId,
      status: "idle",
      dirty: false,
    };
    this.sessions.set(workflowId, created);
    return created;
  }

  private emitSessionChange(
    workflowId: WorkflowSessionId,
    reason: string,
    detail?: unknown,
  ) {
    if (!this.eventBus) {
      return;
    }
    this.eventBus.emit("workflow:session:change", {
      workflowId,
      reason,
      detail,
      state: this.getState(workflowId),
    } satisfies WorkflowSessionChangeEvent);
  }

  private onInteractionSession(
    type: WorkflowInteractionSessionEventType,
    callback: (event: WorkflowInteractionSessionEvent) => void,
  ) {
    this.eventBus?.on(type, callback);
    return {
      dispose: () => this.eventBus?.off(type, callback),
    };
  }

  private emitInteractionSession(
    type: WorkflowInteractionSessionEventType,
    payload: WorkflowInteractionSessionPayload,
  ) {
    this.eventBus?.emit(type, payload);
  }

  private normalizeInteractionSessionInput(
    input: WorkflowInteractionSessionInput,
  ): WorkflowInteractionSessionPayload {
    const kind = String(input.kind || "").trim();
    if (!kind) {
      throw new Error("Workflow interaction session kind is required.");
    }
    const sessionId = String(input.sessionId || "").trim() ||
      `${kind}:${Date.now()}:${++this.interactionSessionSeq}`;
    const source = String(input.source || "").trim() || "unknown";
    const mode = input.mode === undefined || input.mode === null
      ? null
      : String(input.mode).trim() || null;
    return {
      sessionId,
      kind,
      surfaceId: normalizeNullableText(input.surfaceId),
      objectId: normalizeNullableText(input.objectId),
      source,
      mode,
      payload: isRecord(input.payload) ? { ...input.payload } : {},
    };
  }

  private normalizeId(workflowId: WorkflowSessionId): string {
    const id = String(workflowId || "").trim();
    if (!id) {
      throw new Error("Workflow session id is required.");
    }
    return id;
  }
}

function normalizeNullableText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
