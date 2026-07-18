import Disposable from "../disposable";
import EventBus from "../event";
import type { Service, ServiceContext } from "../service";
import type {
  CreateSessionInput,
  ListSessionsQuery,
  SessionArtifact,
  SessionChangeEvent,
  SessionId,
  SessionLeavePolicy,
  SessionLeaveResult,
  SessionRequestResult,
  SessionLifecycle,
  SessionScope,
  SessionState,
  SessionStatus,
  SessionValidationResult,
  UpdateSessionInput,
} from "../workflow-session";

interface SessionRecord {
  state: SessionState;
  leavePolicy?: SessionLeavePolicy;
  lifecycle?: SessionLifecycle;
}

export default class SessionService implements Service {
  private readonly sessions = new Map<SessionId, SessionRecord>();
  private readonly dirtyTrackers = new Map<SessionId, () => boolean>();
  private eventBus?: EventBus;
  private focusedSessionId: SessionId | null = null;
  private sequence = 0;

  init(context: ServiceContext) {
    this.eventBus ??= context.eventBus;
  }

  createSession<TDraft = unknown>(
    input: CreateSessionInput<TDraft> = {},
  ): SessionState<TDraft> {
    const sessionId = this.normalizeSessionId(
      input.sessionId || this.createSessionId(input.scope),
    );
    const existing = this.sessions.get(sessionId);
    const now = Date.now();
    if (existing) {
      existing.state = {
        ...existing.state,
        scope: normalizeScope(input.scope ?? existing.state.scope),
        status: "active",
        interactionMode:
          input.interactionMode ?? existing.state.interactionMode,
        dirty: input.draft === undefined ? existing.state.dirty : true,
        ...(input.draft === undefined ? {} : { draft: clone(input.draft) }),
        artifacts: cloneArtifacts(input.artifacts ?? []),
        result: undefined,
        startedAt: now,
        updatedAt: now,
      };
      existing.leavePolicy = input.leavePolicy ?? existing.leavePolicy;
      existing.lifecycle = input.lifecycle ?? existing.lifecycle;
      void existing.lifecycle?.begin?.();
      this.emitSessionChange(sessionId, "create");
      return cloneState(existing.state) as SessionState<TDraft>;
    }

    const state: SessionState = {
      sessionId,
      scope: normalizeScope(input.scope),
      interactionMode: input.interactionMode ?? "cooperative",
      status: "active",
      dirty: input.draft !== undefined,
      ...(input.draft === undefined ? {} : { draft: clone(input.draft) }),
      artifacts: cloneArtifacts(input.artifacts ?? []),
      startedAt: now,
      updatedAt: now,
    };
    this.sessions.set(sessionId, {
      state,
      leavePolicy: input.leavePolicy,
      lifecycle: input.lifecycle,
    });
    void input.lifecycle?.begin?.();
    this.emitSessionChange(sessionId, "create");
    return cloneState(state) as SessionState<TDraft>;
  }

  async requestSession<TDraft = unknown>(
    input: CreateSessionInput<TDraft> = {},
  ): Promise<SessionRequestResult<TDraft>> {
    const sessionId = this.normalizeSessionId(
      input.sessionId || this.createSessionId(input.scope),
    );
    const scope = normalizeScope(input.scope);
    const interactionMode = input.interactionMode ?? "cooperative";
    const conflicts = this.listSessions({ status: "active" }).filter(
      (state) => {
        if (state.sessionId === sessionId) return false;
        if (!scope.groupId || state.scope.groupId !== scope.groupId)
          return false;
        return (
          interactionMode === "exclusive" ||
          state.interactionMode === "exclusive"
        );
      },
    );

    for (const conflict of conflicts) {
      const leave = await this.handleBeforeLeave(conflict.sessionId);
      if (leave.decision === "blocked") {
        return {
          ok: false,
          reason: "session-conflict",
          conflictingSessionId: conflict.sessionId,
          detail: leave.detail ?? leave.reason,
        };
      }
      if (this.isSessionActive(conflict.sessionId)) {
        await this.cancelSession(conflict.sessionId, {
          reason: "exclusive-session-replaced",
          nextSessionId: sessionId,
        });
      }
    }

    const state = this.createSession({
      ...input,
      sessionId,
      scope,
      interactionMode,
    });
    this.focusSession(sessionId);
    return { ok: true, state };
  }

  updateSession<TDraft = unknown>(
    sessionId: SessionId,
    update: UpdateSessionInput<TDraft>,
  ): SessionState<TDraft> {
    const id = this.normalizeSessionId(sessionId);
    const record = this.ensureSession(id);
    record.state = {
      ...record.state,
      ...(update.draft === undefined ? {} : { draft: clone(update.draft) }),
      ...(update.artifacts === undefined
        ? {}
        : { artifacts: cloneArtifacts(update.artifacts) }),
      dirty:
        update.dirty ??
        (update.draft === undefined && update.artifacts === undefined
          ? record.state.dirty
          : true),
      updatedAt: Date.now(),
    };
    this.emitSessionChange(id, "update");
    return cloneState(record.state) as SessionState<TDraft>;
  }

  registerDirtyTracker(
    sessionId: SessionId,
    callback: () => boolean,
  ): Disposable {
    const id = this.normalizeSessionId(sessionId);
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

  getSession<TDraft = unknown, TResult = unknown>(
    sessionId: SessionId,
  ): SessionState<TDraft, TResult> | undefined {
    const record = this.sessions.get(this.normalizeSessionId(sessionId));
    return record
      ? (cloneState(record.state) as SessionState<TDraft, TResult>)
      : undefined;
  }

  listSessions(query: ListSessionsQuery = {}): SessionState[] {
    const statuses = query.status
      ? new Set(Array.isArray(query.status) ? query.status : [query.status])
      : null;
    return Array.from(this.sessions.values())
      .map((record) => record.state)
      .filter((state) => {
        if (statuses && !statuses.has(state.status)) return false;
        if (query.scope && !scopeMatches(state.scope, query.scope))
          return false;
        return true;
      })
      .map(cloneState)
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  }

  isSessionActive(sessionId: SessionId): boolean {
    return (
      this.sessions.get(this.normalizeSessionId(sessionId))?.state.status ===
      "active"
    );
  }

  hasActiveSession(query: { scope?: Partial<SessionScope> } = {}): boolean {
    return (
      this.listSessions({ status: "active", scope: query.scope }).length > 0
    );
  }

  isDirty(sessionId: SessionId): boolean {
    const id = this.normalizeSessionId(sessionId);
    const tracker = this.dirtyTrackers.get(id);
    if (tracker) return tracker();
    return this.sessions.get(id)?.state.dirty ?? false;
  }

  markDirty(sessionId: SessionId, dirty = true) {
    const id = this.normalizeSessionId(sessionId);
    const record = this.ensureSession(id);
    record.state = {
      ...record.state,
      dirty,
      updatedAt: Date.now(),
    };
    this.emitSessionChange(id, "dirty");
  }

  focusSession(sessionId: SessionId | null) {
    const next = sessionId === null ? null : this.normalizeSessionId(sessionId);
    if (next && !this.sessions.has(next)) {
      throw new Error(`Session "${next}" does not exist.`);
    }
    if (this.focusedSessionId === next) return;
    const previous = this.focusedSessionId;
    this.focusedSessionId = next;
    if (previous && this.sessions.has(previous)) {
      this.emitSessionChange(previous, "focus", { focused: false });
    }
    if (next) {
      this.emitSessionChange(next, "focus", { focused: true });
    }
  }

  getFocusedSessionId(): SessionId | null {
    return this.focusedSessionId;
  }

  async validateSession(
    sessionId: SessionId,
  ): Promise<SessionValidationResult> {
    const id = this.normalizeSessionId(sessionId);
    const result = await this.sessions.get(id)?.lifecycle?.validate?.();
    if (result === undefined || result === true) {
      return { ok: true, result };
    }
    if (result === false) {
      this.emitSessionChange(id, "validate-failed", result);
      return { ok: false, result };
    }
    if (typeof result === "object" && result !== null && "ok" in result) {
      const ok = Boolean(result.ok);
      if (!ok) this.emitSessionChange(id, "validate-failed", result);
      return { ok, result: result.result };
    }
    return { ok: true, result };
  }

  async commitSession(sessionId: SessionId): Promise<SessionValidationResult> {
    const id = this.normalizeSessionId(sessionId);
    const record = this.ensureSession(id);
    const validation = await this.validateSession(id);
    if (!validation.ok) return validation;

    record.state = {
      ...record.state,
      status: "committing",
      updatedAt: Date.now(),
    };
    this.emitSessionChange(id, "committing");

    const result = await record.lifecycle?.commit?.();
    record.state = {
      ...record.state,
      status: "committed",
      dirty: false,
      ...(result === undefined ? {} : { result }),
      updatedAt: Date.now(),
    };
    this.emitSessionChange(id, "commit", result);
    this.releaseFocus(id);
    return { ok: true, result };
  }

  async rollbackSession(sessionId: SessionId): Promise<void> {
    const id = this.normalizeSessionId(sessionId);
    const record = this.ensureSession(id);
    await record.lifecycle?.rollback?.();
    record.state = {
      ...record.state,
      status: "rolled-back",
      dirty: false,
      updatedAt: Date.now(),
    };
    this.emitSessionChange(id, "rollback");
    this.releaseFocus(id);
  }

  async cancelSession(sessionId: SessionId, detail?: unknown): Promise<void> {
    const id = this.normalizeSessionId(sessionId);
    const record = this.ensureSession(id);
    await record.lifecycle?.cancel?.();
    record.state = {
      ...record.state,
      status: "cancelled",
      dirty: false,
      updatedAt: Date.now(),
    };
    this.emitSessionChange(id, "cancel", detail);
    this.releaseFocus(id);
  }

  async handleBeforeLeave(
    sessionId: SessionId,
    leavePolicy?: SessionLeavePolicy,
  ): Promise<SessionLeaveResult> {
    const id = this.normalizeSessionId(sessionId);
    const record = this.ensureSession(id);
    if (!this.isDirty(id)) return { decision: "allow" };

    const policy = leavePolicy ?? record.leavePolicy ?? "block";
    if (policy === "commit") {
      const result = await this.commitSession(id);
      if (!result.ok) {
        return {
          decision: "blocked",
          reason: "session-validation-failed",
          detail: result.result,
        };
      }
      return { decision: "allow" };
    }

    if (policy === "rollback") {
      await this.rollbackSession(id);
      return { decision: "allow" };
    }

    return { decision: "blocked", reason: "session-dirty" };
  }

  onDidChange(callback: (event: SessionChangeEvent) => void): Disposable {
    this.eventBus?.on("session:change", callback);
    return {
      dispose: () => this.eventBus?.off("session:change", callback),
    };
  }

  dispose() {
    this.sessions.clear();
    this.dirtyTrackers.clear();
    this.focusedSessionId = null;
    this.eventBus = undefined;
  }

  private ensureSession(sessionId: SessionId): SessionRecord {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    this.createSession({ sessionId });
    return this.sessions.get(sessionId)!;
  }

  private releaseFocus(sessionId: SessionId) {
    if (this.focusedSessionId === sessionId) {
      this.focusSession(null);
    }
  }

  private emitSessionChange(
    sessionId: SessionId,
    reason: string,
    detail?: unknown,
  ) {
    const record = this.sessions.get(sessionId);
    if (!this.eventBus || !record) return;
    this.eventBus.emit("session:change", {
      sessionId,
      reason,
      state: cloneState(record.state),
      detail,
    } satisfies SessionChangeEvent);
  }

  private createSessionId(scope?: SessionScope): SessionId {
    const normalized = normalizeScope(scope);
    const parts = [
      normalized.surfaceId,
      normalized.subjectId,
      normalized.channel,
    ].filter((part): part is string => Boolean(part));
    if (parts.length) return `session:${parts.join(":")}`;
    this.sequence += 1;
    return `session:${Date.now()}:${this.sequence}`;
  }

  private normalizeSessionId(sessionId: SessionId): SessionId {
    const id = String(sessionId || "").trim();
    if (!id) throw new Error("Session id is required.");
    return id;
  }
}

function normalizeScope(scope?: SessionScope): SessionScope {
  return {
    surfaceId: normalizeNullableText(scope?.surfaceId),
    subjectId: normalizeNullableText(scope?.subjectId),
    channel: normalizeNullableText(scope?.channel),
    groupId: normalizeNullableText(scope?.groupId),
  };
}

export function scopeMatches(
  scope: SessionScope,
  query: Partial<SessionScope>,
): boolean {
  const normalizedQuery = normalizeScope(query);
  return (["surfaceId", "subjectId", "channel", "groupId"] as const).every(
    (key) => {
      const expected = normalizedQuery[key];
      return (
        expected === null || expected === undefined || scope[key] === expected
      );
    },
  );
}

function normalizeNullableText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function cloneState<TDraft = unknown, TResult = unknown>(
  state: SessionState<TDraft, TResult>,
): SessionState<TDraft, TResult> {
  return {
    ...state,
    scope: { ...state.scope },
    ...(state.draft === undefined ? {} : { draft: clone(state.draft) }),
    artifacts: cloneArtifacts(state.artifacts),
    ...(state.result === undefined ? {} : { result: clone(state.result) }),
  };
}

function cloneArtifacts(artifacts: SessionArtifact[]): SessionArtifact[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    data: clone(artifact.data),
    ...(artifact.metadata ? { metadata: { ...artifact.metadata } } : {}),
  }));
}

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
