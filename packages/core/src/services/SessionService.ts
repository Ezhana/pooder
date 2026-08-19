import type Disposable from "../disposable";
import type { Service } from "../service";
import { TypedEventEmitter } from "../typed-event";
import type {
  CreateSessionInput,
  ListSessionsQuery,
  OpenSessionInput,
  SessionChangeEvent,
  SessionCommitResult,
  SessionDescriptor,
  SessionHandle,
  SessionId,
  SessionLeavePolicy,
  SessionLeaveResult,
  SessionLifecycle,
  SessionLifecycleContext,
  SessionOwnedResource,
  SessionPhase,
  SessionRequestResult,
  SessionScope,
  SessionServiceEventMap,
  SessionSnapshot,
  SessionState,
  SessionStatus,
  SessionTerminalReason,
  SessionValidationResult,
  UpdateSessionInput,
} from "../workflow-session";
import { SessionConflictError } from "../workflow-session";

interface SessionRecord<TDraft = unknown, TResult = unknown> {
  descriptor: SessionDescriptor;
  phase: SessionPhase;
  focused: boolean;
  dirty: boolean;
  draft: TDraft;
  lifecycle?: SessionLifecycle<TDraft, TResult>;
  resources: SessionOwnedResource[];
  handle: SessionHandleImpl<TDraft, TResult>;
  artifacts: LegacySessionArtifact[];
  startedAt: number;
  updatedAt: number;
}

type AnySessionRecord = SessionRecord<any, any>;

interface LegacySessionArtifact {
  artifactId: string;
  role: string;
  data: unknown;
  metadata?: Record<string, unknown>;
}

class SessionHandleImpl<TDraft, TResult>
  implements SessionHandle<TDraft, TResult>, SessionLifecycleContext<TDraft>
{
  constructor(
    private readonly service: SessionService,
    readonly record: SessionRecord<TDraft, TResult>,
  ) {}

  get descriptor(): SessionDescriptor {
    return cloneDescriptor(this.record.descriptor);
  }

  get phase(): SessionPhase {
    return this.record.phase;
  }

  get focused(): boolean {
    return this.record.focused;
  }

  get dirty(): boolean {
    return this.record.dirty;
  }

  getSnapshot(): SessionSnapshot<TDraft> {
    return this.service.snapshot(this.record);
  }

  getDraft(): TDraft {
    return clone(this.record.draft);
  }

  updateDraft(update: TDraft | ((draft: TDraft) => TDraft)): TDraft {
    return this.service.updateHandleDraft(this.record, update);
  }

  setDirty(dirty = true): void {
    this.service.setHandleDirty(this.record, dirty);
  }

  own<T extends SessionOwnedResource>(resource: T): T {
    this.service.ownResource(this.record, resource);
    return resource;
  }

  validate(): Promise<SessionValidationResult> {
    return this.service.validateHandle(this.record);
  }

  commit(): Promise<SessionCommitResult<TResult>> {
    return this.service.commitHandle(this.record);
  }

  rollback(): Promise<void> {
    return this.service.rollbackHandle(this.record);
  }

  cancel(): Promise<void> {
    return this.service.cancelHandle(this.record);
  }
}

export default class SessionService implements Service {
  private readonly sessions = new Map<SessionId, AnySessionRecord>();
  private readonly events = new TypedEventEmitter<SessionServiceEventMap>();
  private openQueue: Promise<void> = Promise.resolve();
  private sequence = 0;

  open<TDraft, TResult = unknown>(
    input: OpenSessionInput<TDraft, TResult>,
  ): Promise<SessionHandle<TDraft, TResult>> {
    const operation = this.openQueue.then(() => this.openNow(input));
    this.openQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  getHandle<TDraft = unknown, TResult = unknown>(
    sessionId: SessionId,
  ): SessionHandle<TDraft, TResult> | undefined {
    return this.sessions.get(normalizeSessionId(sessionId))?.handle as
      | SessionHandle<TDraft, TResult>
      | undefined;
  }

  listSnapshots(): SessionSnapshot[] {
    return [...this.sessions.values()]
      .map((record) => this.snapshot(record))
      .sort((left, right) =>
        left.descriptor.sessionId.localeCompare(right.descriptor.sessionId),
      );
  }

  isActive(sessionId: SessionId): boolean {
    return this.sessions.get(normalizeSessionId(sessionId))?.phase === "active";
  }

  hasActive(scope: Partial<SessionScope> = {}): boolean {
    return [...this.sessions.values()].some(
      (record) =>
        isLivePhase(record.phase) &&
        scopeMatches(record.descriptor.scope, scope),
    );
  }

  getFocusedSessionId(): SessionId | null {
    return (
      [...this.sessions.values()].find((record) => record.focused)?.descriptor
        .sessionId ?? null
    );
  }

  on<TKey extends keyof SessionServiceEventMap>(
    type: TKey,
    listener: (event: SessionServiceEventMap[TKey]) => void,
  ): Disposable {
    return this.events.on(type, listener);
  }

  onDidChange(listener: (event: SessionChangeEvent) => void): Disposable {
    return this.events.on("change", listener);
  }

  onDidTerminate(
    listener: (event: SessionServiceEventMap["terminal"]) => void,
  ): Disposable {
    return this.events.on("terminal", listener);
  }

  async dispose(): Promise<void> {
    const errors: unknown[] = [];
    for (const record of [...this.sessions.values()].reverse()) {
      try {
        await this.cancelHandle(record);
      } catch (error) {
        collectErrors(errors, error);
      }
    }
    this.events.clear();
    if (errors.length)
      throw new AggregateError(errors, "Session disposal failed.");
  }

  snapshot<TDraft, TResult>(
    record: SessionRecord<TDraft, TResult>,
  ): SessionSnapshot<TDraft> {
    return {
      descriptor: cloneDescriptor(record.descriptor),
      phase: record.phase,
      focused: record.focused,
      dirty: record.dirty,
      draft: clone(record.draft),
    };
  }

  updateHandleDraft<TDraft, TResult>(
    record: SessionRecord<TDraft, TResult>,
    update: TDraft | ((draft: TDraft) => TDraft),
  ): TDraft {
    this.ensureOwnedRecord(record);
    this.ensureMutable(record);
    const next =
      typeof update === "function"
        ? (update as (draft: TDraft) => TDraft)(clone(record.draft))
        : update;
    record.draft = clone(next);
    record.dirty = true;
    record.updatedAt = Date.now();
    this.emitChange(record, "draft");
    return clone(record.draft);
  }

  setHandleDirty(record: AnySessionRecord, dirty: boolean): void {
    this.ensureOwnedRecord(record);
    this.ensureMutable(record);
    if (record.dirty === dirty) return;
    record.dirty = dirty;
    record.updatedAt = Date.now();
    this.emitChange(record, "dirty");
  }

  ownResource(record: AnySessionRecord, resource: SessionOwnedResource): void {
    this.ensureOwnedRecord(record);
    this.ensureMutable(record);
    if (!isOwnedResource(resource)) {
      throw new TypeError("Session-owned resources must be disposable.");
    }
    record.resources.push(resource);
  }

  async validateHandle(
    record: AnySessionRecord,
  ): Promise<SessionValidationResult> {
    this.ensureOwnedRecord(record);
    if (record.phase !== "active") {
      throw new Error(
        `Session "${record.descriptor.sessionId}" is ${record.phase}.`,
      );
    }
    this.setPhase(record, "validating");
    try {
      const raw = await record.lifecycle?.validate?.(record.handle);
      const result = normalizeValidation(raw);
      this.setPhase(record, "active");
      if (!result.ok) this.emitChange(record, "validation-failed");
      return result;
    } catch (error) {
      this.setPhase(record, "active");
      throw error;
    }
  }

  async commitHandle<TDraft, TResult>(
    record: SessionRecord<TDraft, TResult>,
  ): Promise<SessionCommitResult<TResult>> {
    this.ensureOwnedRecord(record);
    const validation = await this.validateHandle(record);
    if (!validation.ok) return { ok: false, validation };
    this.setPhase(record, "committing");
    let result: TResult;
    try {
      result = record.lifecycle?.commit
        ? await record.lifecycle.commit(record.handle)
        : (undefined as TResult);
    } catch (error) {
      this.setPhase(record, "active");
      throw error;
    }
    record.dirty = false;
    const cleanupErrors = await this.disposeResources(record);
    this.terminate(record, { reason: "committed", result });
    if (cleanupErrors.length) {
      throw new AggregateError(
        cleanupErrors,
        "Committed session cleanup failed.",
      );
    }
    return { ok: true, result };
  }

  async rollbackHandle(record: AnySessionRecord): Promise<void> {
    await this.forceTerminate(record, "rolled-back", "rolling-back", () =>
      record.lifecycle?.rollback?.(record.handle),
    );
  }

  async cancelHandle(record: AnySessionRecord): Promise<void> {
    await this.forceTerminate(record, "cancelled", "cancelling", () =>
      record.lifecycle?.cancel?.(record.handle),
    );
  }

  /** @internal */
  createSession<TDraft = unknown>(
    input: CreateSessionInput<TDraft> = {},
  ): SessionState<TDraft> {
    const sessionId = normalizeSessionId(
      input.sessionId || this.createSessionId(input.scope),
    );
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (input.draft !== undefined)
        this.updateHandleDraft(existing, input.draft);
      existing.artifacts = cloneArtifacts(
        input.artifacts ?? existing.artifacts,
      );
      return this.toLegacyState(existing) as SessionState<TDraft>;
    }
    const descriptor = normalizeDescriptor({
      sessionId,
      ownerId: "legacy",
      scope: input.scope ?? {},
      interactionMode: input.interactionMode ?? "cooperative",
      leavePolicy: input.leavePolicy ?? "block",
    });
    const lifecycle = (
      input.lifecycle
        ? {
            begin: () => input.lifecycle?.begin?.(),
            validate: () => input.lifecycle?.validate?.(),
            commit: () => input.lifecycle?.commit?.(),
            rollback: () => input.lifecycle?.rollback?.(),
            cancel: () => input.lifecycle?.cancel?.(),
          }
        : undefined
    ) as SessionLifecycle<TDraft, unknown> | undefined;
    const record = this.createRecord(
      descriptor,
      input.draft as TDraft,
      lifecycle,
    );
    record.dirty = input.draft !== undefined;
    record.artifacts = cloneArtifacts(input.artifacts ?? []);
    this.sessions.set(sessionId, record);
    void record.lifecycle?.begin?.(record.handle);
    record.phase = "active";
    this.emitChange(record, "opened");
    return this.toLegacyState(record) as SessionState<TDraft>;
  }

  /** @internal */
  async requestSession<TDraft = unknown>(
    input: CreateSessionInput<TDraft> = {},
  ): Promise<SessionRequestResult<TDraft>> {
    const sessionId = normalizeSessionId(
      input.sessionId || this.createSessionId(input.scope),
    );
    try {
      const handle = await this.open({
        descriptor: {
          sessionId,
          ownerId: "legacy",
          scope: input.scope ?? {},
          interactionMode: input.interactionMode ?? "cooperative",
          leavePolicy: input.leavePolicy ?? "block",
        },
        initialDraft: input.draft as TDraft,
        lifecycle: (input.lifecycle
          ? {
              begin: () => input.lifecycle?.begin?.(),
              validate: () => input.lifecycle?.validate?.(),
              commit: () => input.lifecycle?.commit?.(),
              rollback: () => input.lifecycle?.rollback?.(),
              cancel: () => input.lifecycle?.cancel?.(),
            }
          : undefined) as SessionLifecycle<TDraft, unknown> | undefined,
      });
      const record = (handle as SessionHandleImpl<TDraft, unknown>).record;
      record.artifacts = cloneArtifacts(input.artifacts ?? record.artifacts);
      return {
        ok: true,
        state: this.toLegacyState(record) as SessionState<TDraft>,
      };
    } catch (error) {
      if (error instanceof SessionConflictError) {
        return {
          ok: false,
          reason: "session-conflict",
          conflictingSessionId: error.conflictingSessionId,
          detail: error.detail,
        };
      }
      throw error;
    }
  }

  /** @internal */
  updateSession<TDraft = unknown>(
    sessionId: SessionId,
    update: UpdateSessionInput<TDraft>,
  ): SessionState<TDraft> {
    const record = this.requireRecord(sessionId);
    if (update.draft !== undefined)
      this.updateHandleDraft(record, update.draft);
    if (update.artifacts !== undefined)
      record.artifacts = cloneArtifacts(update.artifacts);
    if (update.dirty !== undefined) this.setHandleDirty(record, update.dirty);
    return this.toLegacyState(record) as SessionState<TDraft>;
  }

  /** @internal */
  registerDirtyTracker(
    sessionId: SessionId,
    callback: () => boolean,
  ): Disposable {
    const record = this.requireRecord(sessionId);
    const sync = () => this.setHandleDirty(record, Boolean(callback()));
    sync();
    return { dispose() {} };
  }

  /** @internal */
  getSession<TDraft = unknown>(
    sessionId: SessionId,
  ): SessionState<TDraft> | undefined {
    const record = this.sessions.get(normalizeSessionId(sessionId));
    return record
      ? (this.toLegacyState(record) as SessionState<TDraft>)
      : undefined;
  }

  /** @internal */
  listSessions(query: ListSessionsQuery = {}): SessionState[] {
    const statuses = query.status
      ? new Set(Array.isArray(query.status) ? query.status : [query.status])
      : null;
    return [...this.sessions.values()]
      .map((record) => this.toLegacyState(record))
      .filter(
        (state) =>
          (!statuses || statuses.has(state.status)) &&
          (!query.scope || scopeMatches(state.scope, query.scope)),
      );
  }

  /** @internal */
  isSessionActive(sessionId: SessionId): boolean {
    return this.isActive(sessionId);
  }
  /** @internal */
  hasActiveSession(query: { scope?: Partial<SessionScope> } = {}): boolean {
    return this.hasActive(query.scope);
  }
  /** @internal */
  isDirty(sessionId: SessionId): boolean {
    return this.requireRecord(sessionId).dirty;
  }
  /** @internal */
  markDirty(sessionId: SessionId, dirty = true): void {
    this.setHandleDirty(this.requireRecord(sessionId), dirty);
  }
  /** @internal */
  focusSession(sessionId: SessionId | null): void {
    if (sessionId === null) return this.focusRecord(null);
    this.focusRecord(this.requireRecord(sessionId));
  }
  /** @internal */
  async validateSession(
    sessionId: SessionId,
  ): Promise<SessionValidationResult> {
    return this.requireRecord(sessionId).handle.validate();
  }
  /** @internal */
  async commitSession(sessionId: SessionId): Promise<SessionValidationResult> {
    return this.requireRecord(sessionId).handle.commit();
  }
  /** @internal */
  async rollbackSession(sessionId: SessionId): Promise<void> {
    await this.requireRecord(sessionId).handle.rollback();
  }
  /** @internal */
  async cancelSession(sessionId: SessionId, _detail?: unknown): Promise<void> {
    const record = this.requireRecord(sessionId);
    await Promise.resolve();
    if (this.sessions.get(record.descriptor.sessionId) === record) {
      await record.handle.cancel();
    }
  }
  /** @internal */
  async handleBeforeLeave(
    sessionId: SessionId,
    leavePolicy?: SessionLeavePolicy,
  ): Promise<SessionLeaveResult> {
    const record = this.requireRecord(sessionId);
    try {
      await this.leaveConflict(record, leavePolicy);
      return { decision: "allow" };
    } catch (error) {
      if (error instanceof SessionConflictError) {
        return {
          decision: "blocked",
          reason: "session-dirty",
          ...(error.detail === "session-dirty" ? {} : { detail: error.detail }),
        };
      }
      throw error;
    }
  }

  private async openNow<TDraft, TResult>(
    input: OpenSessionInput<TDraft, TResult>,
  ): Promise<SessionHandle<TDraft, TResult>> {
    const descriptor = normalizeDescriptor(input.descriptor);
    const existing = this.sessions.get(descriptor.sessionId);
    if (existing) {
      if (existing.descriptor.ownerId !== descriptor.ownerId) {
        throw new Error(
          `Session "${descriptor.sessionId}" is owned by "${existing.descriptor.ownerId}", not "${descriptor.ownerId}".`,
        );
      }
      this.focusRecord(existing);
      return existing.handle as SessionHandle<TDraft, TResult>;
    }

    const sameScopeSessions = [...this.sessions.values()].filter((record) =>
      scopesEqual(record.descriptor.scope, descriptor.scope),
    );
    const concurrency = input.concurrency ?? "parallel";
    if (concurrency === "reject" && sameScopeSessions.length) {
      throw new SessionConflictError(
        sameScopeSessions[0]!.descriptor.sessionId,
        "same-scope-session-active",
      );
    }
    if (concurrency === "replace") {
      for (const session of sameScopeSessions) {
        await session.handle.rollback();
      }
    }

    const conflicts = [...this.sessions.values()].filter((record) =>
      sessionsConflict(record.descriptor, descriptor),
    );
    for (const conflict of conflicts) await this.leaveConflict(conflict);

    const record = this.createRecord(
      descriptor,
      input.initialDraft,
      input.lifecycle,
    );
    this.sessions.set(descriptor.sessionId, record);
    try {
      await record.lifecycle?.begin?.(record.handle);
    } catch (error) {
      const cleanupErrors = await this.disposeResources(record);
      this.sessions.delete(descriptor.sessionId);
      if (cleanupErrors.length) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          "Session begin and cleanup failed.",
        );
      }
      throw error;
    }
    this.setPhase(record, "active");
    this.focusRecord(record);
    this.emitChange(record, "opened");
    return record.handle;
  }

  private createRecord<TDraft, TResult>(
    descriptor: SessionDescriptor,
    draft: TDraft,
    lifecycle?: SessionLifecycle<TDraft, TResult>,
  ): SessionRecord<TDraft, TResult> {
    const now = Date.now();
    const record: SessionRecord<TDraft, TResult> = {
      descriptor,
      phase: "opening" as SessionPhase,
      focused: false,
      dirty: false,
      draft: clone(draft),
      lifecycle,
      resources: [],
      handle: undefined as unknown as SessionHandleImpl<TDraft, TResult>,
      artifacts: [],
      startedAt: now,
      updatedAt: now,
    };
    record.handle = new SessionHandleImpl(this, record);
    return record;
  }

  private async leaveConflict(
    record: AnySessionRecord,
    override?: SessionLeavePolicy,
  ): Promise<void> {
    if (!record.dirty) {
      await record.handle.cancel();
      return;
    }
    const policy = override ?? record.descriptor.leavePolicy;
    if (policy === "commit") {
      const result = await record.handle.commit();
      if (!result.ok) {
        throw new SessionConflictError(
          record.descriptor.sessionId,
          result.validation.detail,
        );
      }
      return;
    }
    if (policy === "rollback") {
      await record.handle.rollback();
      return;
    }
    throw new SessionConflictError(
      record.descriptor.sessionId,
      "session-dirty",
    );
  }

  private async forceTerminate(
    record: AnySessionRecord,
    reason: Exclude<SessionTerminalReason, "committed">,
    phase: "rolling-back" | "cancelling",
    lifecycle: () => void | Promise<void> | undefined,
  ): Promise<void> {
    this.ensureOwnedRecord(record);
    this.setPhase(record, phase);
    const errors: unknown[] = [];
    try {
      await lifecycle();
    } catch (error) {
      collectErrors(errors, error);
    }
    errors.push(...(await this.disposeResources(record)));
    record.dirty = false;
    this.terminate(record, { reason });
    if (errors.length)
      throw new AggregateError(errors, `Session ${reason} failed.`);
  }

  private terminate(
    record: AnySessionRecord,
    outcome:
      | { reason: "committed"; result: unknown }
      | { reason: Exclude<SessionTerminalReason, "committed"> },
  ): void {
    record.phase = "closed";
    record.focused = false;
    const descriptor = cloneDescriptor(record.descriptor);
    if (outcome.reason === "committed") {
      this.events.emit("terminal", {
        descriptor,
        reason: outcome.reason,
        result: clone(outcome.result),
      });
    } else {
      this.events.emit("terminal", { descriptor, reason: outcome.reason });
    }
    this.sessions.delete(record.descriptor.sessionId);
  }

  private async disposeResources(record: AnySessionRecord): Promise<unknown[]> {
    const errors: unknown[] = [];
    while (record.resources.length) {
      const resource = record.resources.pop()!;
      try {
        await disposeResource(resource);
      } catch (error) {
        collectErrors(errors, error);
      }
    }
    return errors;
  }

  private focusRecord(next: AnySessionRecord | null): void {
    for (const record of this.sessions.values()) {
      const focused = record === next;
      if (record.focused === focused) continue;
      record.focused = focused;
      record.updatedAt = Date.now();
      this.emitChange(record, "focus");
    }
  }

  private setPhase(record: AnySessionRecord, phase: SessionPhase): void {
    record.phase = phase;
    record.updatedAt = Date.now();
    this.emitChange(record, "phase");
  }

  private emitChange(
    record: AnySessionRecord,
    reason: SessionChangeEvent["reason"],
  ): void {
    this.events.emit("change", { reason, snapshot: this.snapshot(record) });
  }

  private ensureOwnedRecord(record: AnySessionRecord): void {
    if (this.sessions.get(record.descriptor.sessionId) !== record) {
      throw new Error(`Session "${record.descriptor.sessionId}" is closed.`);
    }
  }

  private ensureMutable(record: AnySessionRecord): void {
    if (
      record.phase !== "active" &&
      record.phase !== "opening" &&
      record.phase !== "validating"
    ) {
      throw new Error(
        `Session "${record.descriptor.sessionId}" is ${record.phase}.`,
      );
    }
  }

  private requireRecord(sessionId: SessionId): AnySessionRecord {
    const id = normalizeSessionId(sessionId);
    const record = this.sessions.get(id);
    if (!record) throw new Error(`Session "${id}" does not exist.`);
    return record;
  }

  private createSessionId(scope?: SessionScope): SessionId {
    const normalized = normalizeScope(scope);
    const parts = [
      normalized.sceneId,
      normalized.subjectId,
      normalized.channel,
    ].filter((part): part is string => Boolean(part));
    if (parts.length) return `session:${parts.join(":")}`;
    this.sequence += 1;
    return `session:${Date.now()}:${this.sequence}`;
  }

  private toLegacyState(record: AnySessionRecord): SessionState {
    return {
      sessionId: record.descriptor.sessionId,
      scope: { ...record.descriptor.scope },
      interactionMode: record.descriptor.interactionMode,
      status: toLegacyStatus(record.phase),
      dirty: record.dirty,
      draft: clone(record.draft),
      artifacts: cloneArtifacts(record.artifacts),
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
    };
  }
}

function normalizeDescriptor(descriptor: SessionDescriptor): SessionDescriptor {
  return {
    sessionId: normalizeSessionId(descriptor.sessionId),
    ownerId: normalizeRequiredText(descriptor.ownerId, "Session ownerId"),
    scope: normalizeScope(descriptor.scope),
    interactionMode: descriptor.interactionMode ?? "cooperative",
    leavePolicy: descriptor.leavePolicy ?? "block",
  };
}

function cloneDescriptor(descriptor: SessionDescriptor): SessionDescriptor {
  return { ...descriptor, scope: { ...descriptor.scope } };
}

function normalizeSessionId(value: unknown): SessionId {
  return normalizeRequiredText(value, "Session id");
}

function normalizeRequiredText(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeScope(scope: SessionScope = {}): SessionScope {
  return {
    sceneId: normalizeNullableText(scope.sceneId),
    subjectId: normalizeNullableText(scope.subjectId),
    channel: normalizeNullableText(scope.channel),
    groupId: normalizeNullableText(scope.groupId),
  };
}

export function scopeMatches(
  scope: SessionScope,
  query: Partial<SessionScope>,
): boolean {
  return (["sceneId", "subjectId", "channel", "groupId"] as const).every(
    (key) => {
      const expected = query[key];
      return (
        expected === undefined ||
        expected === null ||
        scope[key] === normalizeNullableText(expected)
      );
    },
  );
}

function normalizeNullableText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function sessionsConflict(
  left: SessionDescriptor,
  right: SessionDescriptor,
): boolean {
  return Boolean(
    left.scope.groupId &&
    left.scope.groupId === right.scope.groupId &&
    (left.interactionMode === "exclusive" ||
      right.interactionMode === "exclusive"),
  );
}

function scopesEqual(left: SessionScope, right: SessionScope): boolean {
  return (["sceneId", "subjectId", "channel", "groupId"] as const).every(
    (key) => left[key] === right[key],
  );
}

function normalizeValidation(value: unknown): SessionValidationResult {
  if (value === undefined || value === true) return { ok: true };
  if (value === false) return { ok: false };
  if (typeof value === "object" && value !== null && "ok" in value) {
    const result = value as SessionValidationResult;
    if (result.ok) return { ok: true };
    return result.detail === undefined
      ? { ok: false }
      : { ok: false, detail: clone(result.detail) };
  }
  return { ok: true };
}

function isLivePhase(phase: SessionPhase): boolean {
  return phase !== "closed";
}

function toLegacyStatus(phase: SessionPhase): SessionStatus {
  return phase === "committing" ? "committing" : "active";
}

function isOwnedResource(value: unknown): value is SessionOwnedResource {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  )
    return false;
  const resource = value as Record<PropertyKey, unknown>;
  return (
    typeof resource.dispose === "function" ||
    typeof resource[Symbol.dispose] === "function" ||
    typeof resource[Symbol.asyncDispose] === "function"
  );
}

async function disposeResource(resource: SessionOwnedResource): Promise<void> {
  const value = resource as Record<PropertyKey, unknown>;
  if (typeof value[Symbol.asyncDispose] === "function") {
    await (value[Symbol.asyncDispose] as () => void | Promise<void>).call(
      resource,
    );
    return;
  }
  if (typeof value[Symbol.dispose] === "function") {
    (value[Symbol.dispose] as () => void).call(resource);
    return;
  }
  await (value.dispose as () => void | Promise<void>).call(resource);
}

function collectErrors(target: unknown[], error: unknown): void {
  if (error instanceof AggregateError) target.push(...error.errors);
  else target.push(error);
}

function cloneArtifacts<T extends LegacySessionArtifact>(
  artifacts: readonly T[],
): T[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    data: clone(artifact.data),
    ...(artifact.metadata ? { metadata: { ...artifact.metadata } } : {}),
  })) as T[];
}

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (typeof globalThis.structuredClone === "function")
    return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
