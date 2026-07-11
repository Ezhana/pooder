export type SessionId = string;
export type SessionStatus =
  | "active"
  | "committing"
  | "committed"
  | "rolled-back"
  | "cancelled";
export type SessionLeavePolicy = "block" | "commit" | "rollback";
export type SessionLeaveDecision = "allow" | "blocked";

export interface SessionScope {
  surfaceId?: string | null;
  subjectId?: string | null;
  channel?: string | null;
}

export interface SessionArtifact<T = unknown> {
  artifactId: string;
  role: string;
  data: T;
  metadata?: Record<string, unknown>;
}

export interface SessionState<TDraft = unknown, TResult = unknown> {
  sessionId: SessionId;
  scope: SessionScope;
  status: SessionStatus;
  dirty: boolean;
  draft?: TDraft;
  artifacts: SessionArtifact[];
  result?: TResult;
  startedAt: number;
  updatedAt: number;
}

export interface SessionValidationResult {
  ok: boolean;
  result?: unknown;
}

export interface SessionLeaveResult {
  decision: SessionLeaveDecision;
  reason?: string;
  detail?: unknown;
}

export interface SessionLifecycle {
  begin?(): void | Promise<void>;
  validate?():
    | boolean
    | SessionValidationResult
    | Promise<boolean | SessionValidationResult>;
  commit?(): unknown | Promise<unknown>;
  rollback?(): void | Promise<void>;
  cancel?(): void | Promise<void>;
}

export interface CreateSessionInput<TDraft = unknown> {
  sessionId?: SessionId;
  scope?: SessionScope;
  draft?: TDraft;
  artifacts?: SessionArtifact[];
  leavePolicy?: SessionLeavePolicy;
  lifecycle?: SessionLifecycle;
}

export interface UpdateSessionInput<TDraft = unknown> {
  draft?: TDraft;
  artifacts?: SessionArtifact[];
  dirty?: boolean;
}

export interface ListSessionsQuery {
  status?: SessionStatus | SessionStatus[];
  scope?: Partial<SessionScope>;
}

export interface SessionChangeEvent {
  sessionId: SessionId;
  reason: string;
  state: SessionState;
  detail?: unknown;
}
