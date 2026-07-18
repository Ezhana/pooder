export type SessionId = string;
export const EDITOR_INTERACTION_SESSION_GROUP_ID = "editor-interaction";
export type SessionStatus =
  | "active"
  | "committing"
  | "committed"
  | "rolled-back"
  | "cancelled";
export type SessionLeavePolicy = "block" | "commit" | "rollback";
export type SessionLeaveDecision = "allow" | "blocked";
export type SessionInteractionMode = "exclusive" | "cooperative" | "passive";

export interface SessionScope {
  surfaceId?: string | null;
  subjectId?: string | null;
  channel?: string | null;
  groupId?: string | null;
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
  interactionMode: SessionInteractionMode;
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
  interactionMode?: SessionInteractionMode;
  lifecycle?: SessionLifecycle;
}

export interface SessionRequestResult<TDraft = unknown> {
  ok: boolean;
  state?: SessionState<TDraft>;
  reason?: "session-conflict";
  conflictingSessionId?: SessionId;
  detail?: unknown;
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
