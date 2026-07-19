import type Disposable from "./disposable";

export type SessionId = string;
export const EDITOR_INTERACTION_SESSION_GROUP_ID = "editor-interaction";
export type SessionLeavePolicy = "block" | "commit" | "rollback";
export type SessionInteractionMode = "exclusive" | "cooperative" | "passive";
export type SessionPhase =
  | "opening"
  | "active"
  | "validating"
  | "committing"
  | "rolling-back"
  | "cancelling"
  | "closed";

export interface SessionScope {
  surfaceId?: string | null;
  subjectId?: string | null;
  channel?: string | null;
  groupId?: string | null;
}

export interface SessionDescriptor {
  sessionId: SessionId;
  ownerId: string;
  scope: SessionScope;
  interactionMode: SessionInteractionMode;
  leavePolicy: SessionLeavePolicy;
}

export interface SessionValidationSuccess {
  readonly ok: true;
}

export interface SessionValidationFailure<TDetail = unknown> {
  readonly ok: false;
  readonly detail?: TDetail;
}

export type SessionValidationResult<TDetail = unknown> =
  | SessionValidationSuccess
  | SessionValidationFailure<TDetail>;

export type SessionCommitResult<TResult, TValidationDetail = unknown> =
  | {
      readonly ok: true;
      readonly result: TResult;
    }
  | {
      readonly ok: false;
      readonly validation: SessionValidationFailure<TValidationDetail>;
    };

export interface SessionLifecycleContext<TDraft> {
  readonly descriptor: SessionDescriptor;
  getDraft(): TDraft;
  setDirty(dirty?: boolean): void;
  updateDraft(update: TDraft | ((draft: TDraft) => TDraft)): TDraft;
}

export interface SessionLifecycle<TDraft = unknown, TResult = unknown> {
  begin?(context: SessionLifecycleContext<TDraft>): void | Promise<void>;
  validate?(
    context: SessionLifecycleContext<TDraft>,
  ):
    | boolean
    | SessionValidationResult
    | Promise<boolean | SessionValidationResult>;
  commit?(context: SessionLifecycleContext<TDraft>): TResult | Promise<TResult>;
  rollback?(context: SessionLifecycleContext<TDraft>): void | Promise<void>;
  cancel?(context: SessionLifecycleContext<TDraft>): void | Promise<void>;
}

export interface OpenSessionInput<TDraft, TResult = unknown> {
  descriptor: SessionDescriptor;
  initialDraft: TDraft;
  lifecycle?: SessionLifecycle<TDraft, TResult>;
}

export interface SessionSnapshot<TDraft = unknown> {
  readonly descriptor: SessionDescriptor;
  readonly phase: SessionPhase;
  readonly focused: boolean;
  readonly dirty: boolean;
  readonly draft: TDraft;
}

export type SessionOwnedResource =
  | Disposable
  | { dispose(): void | Promise<void> }
  | { [Symbol.dispose](): void }
  | { [Symbol.asyncDispose](): void | Promise<void> };

export interface SessionHandle<TDraft = unknown, TResult = unknown> {
  readonly descriptor: SessionDescriptor;
  readonly phase: SessionPhase;
  readonly focused: boolean;
  readonly dirty: boolean;
  getSnapshot(): SessionSnapshot<TDraft>;
  getDraft(): TDraft;
  updateDraft(update: TDraft | ((draft: TDraft) => TDraft)): TDraft;
  setDirty(dirty?: boolean): void;
  own<T extends SessionOwnedResource>(resource: T): T;
  validate(): Promise<SessionValidationResult>;
  commit(): Promise<SessionCommitResult<TResult>>;
  rollback(): Promise<void>;
  cancel(): Promise<void>;
}

export type SessionChangeReason =
  | "opened"
  | "draft"
  | "dirty"
  | "focus"
  | "phase"
  | "validation-failed";

export interface SessionChangeEvent<TDraft = unknown> {
  readonly reason: SessionChangeReason;
  readonly snapshot: SessionSnapshot<TDraft>;
}

export type SessionTerminalReason = "committed" | "rolled-back" | "cancelled";

export type SessionTerminalEvent<TResult = unknown> =
  | {
      readonly descriptor: SessionDescriptor;
      readonly reason: "committed";
      readonly result: TResult;
    }
  | {
      readonly descriptor: SessionDescriptor;
      readonly reason: "rolled-back" | "cancelled";
    };

export interface SessionServiceEventMap {
  change: SessionChangeEvent;
  terminal: SessionTerminalEvent;
}

export class SessionConflictError extends Error {
  readonly conflictingSessionId: SessionId;
  readonly detail?: unknown;

  constructor(conflictingSessionId: SessionId, detail?: unknown) {
    super(`Session conflict with "${conflictingSessionId}".`);
    this.name = "SessionConflictError";
    this.conflictingSessionId = conflictingSessionId;
    this.detail = detail;
  }
}

/** @internal Legacy registry state. */
export type SessionStatus =
  | "active"
  | "committing"
  | "committed"
  | "rolled-back"
  | "cancelled";

/** @internal Legacy registry state. */
export interface SessionArtifact<T = unknown> {
  artifactId: string;
  role: string;
  data: T;
  metadata?: Record<string, unknown>;
}

/** @internal Legacy registry state. */
export interface SessionState<TDraft = unknown> {
  sessionId: SessionId;
  scope: SessionScope;
  interactionMode: SessionInteractionMode;
  status: SessionStatus;
  dirty: boolean;
  draft?: TDraft;
  artifacts: SessionArtifact[];
  startedAt: number;
  updatedAt: number;
}

/** @internal */
export interface CreateSessionInput<TDraft = unknown> {
  sessionId?: SessionId;
  scope?: SessionScope;
  draft?: TDraft;
  artifacts?: SessionArtifact[];
  leavePolicy?: SessionLeavePolicy;
  interactionMode?: SessionInteractionMode;
  lifecycle?: {
    begin?(): void | Promise<void>;
    validate?():
      | boolean
      | SessionValidationResult
      | Promise<boolean | SessionValidationResult>;
    commit?(): unknown | Promise<unknown>;
    rollback?(): void | Promise<void>;
    cancel?(): void | Promise<void>;
  };
}

/** @internal */
export interface SessionRequestResult<TDraft = unknown> {
  ok: boolean;
  state?: SessionState<TDraft>;
  reason?: "session-conflict";
  conflictingSessionId?: SessionId;
  detail?: unknown;
}

/** @internal */
export interface UpdateSessionInput<TDraft = unknown> {
  draft?: TDraft;
  artifacts?: SessionArtifact[];
  dirty?: boolean;
}

/** @internal */
export interface ListSessionsQuery {
  status?: SessionStatus | SessionStatus[];
  scope?: Partial<SessionScope>;
}

/** @internal */
export interface SessionLeaveResult {
  decision: "allow" | "blocked";
  reason?: string;
  detail?: unknown;
}
