import type Disposable from "./disposable";
import type {
  ConstraintResolveResult,
  ConstraintResolverService,
  ConstraintSpec,
  TransformInput,
} from "./constraint-resolver";
import type { GeometrySourceService } from "./geometry-source";
import {
  coordinateDelta,
  coordinateMatrix,
  type CoordinateDelta,
  type CoordinateMatrix,
  type Matrix2D,
} from "./coordinate";
import {
  evaluateRuntimeCondition,
  type RuntimeConditionEvalContext,
  type RuntimeConditionExpr,
} from "./render";
import type { Service, ServiceContext } from "./service";
import { TypedEventEmitter } from "./typed-event";
import {
  COMMAND_SERVICE,
  CONSTRAINT_RESOLVER_SERVICE,
  SESSION_SERVICE,
} from "./services/tokens";
import type CommandService from "./services/CommandService";
import type SessionService from "./services/SessionService";
import type {
  SessionHandle,
  SessionInteractionMode,
  SessionLeavePolicy,
  SessionScope,
} from "./workflow-session";
import { SessionConflictError } from "./workflow-session";

export type InteractionActivationTrigger = "primary-pointer" | "double-click";
export type InteractionManipulationKind = "move" | "resize" | "rotate";

export interface InteractionSessionIntent {
  channel: string;
  groupId: string;
  sessionId?: string;
  mode: SessionInteractionMode;
  scope: "subject" | "surface" | "editor";
  leavePolicy?: SessionLeavePolicy;
}

/**
 * Resolved session intent forwarded to the activation command. The command's
 * domain service remains responsible for opening and owning the session so it
 * can install the real draft, lifecycle, and owned resources atomically.
 */
export interface InteractionActivationSessionContext {
  readonly sessionId: string;
  readonly scope: SessionScope;
  readonly interactionMode: SessionInteractionMode;
  readonly leavePolicy: SessionLeavePolicy;
}

export interface InteractionActivationCommandInput {
  readonly layerId?: string;
  readonly renderIntentId?: string;
  readonly session?: InteractionActivationSessionContext;
  readonly sessionId?: string;
  readonly subjectId?: string;
  readonly surfaceId?: string;
  readonly targetData?: Record<string, unknown>;
  readonly trigger: InteractionActivationTrigger;
}

export interface InteractionConstraintSpec {
  activeWhen?: RuntimeConditionExpr;
  spec: ConstraintSpec;
}

export interface InteractionOperationSpec {
  enabled: boolean;
  constraints?: InteractionConstraintSpec[];
  action?: {
    commandId: string;
    payload?: Record<string, unknown>;
  };
}

export interface InteractionSpec {
  hitRegion?: { type: "frame"; space: "scene" };
  enabledWhen?: RuntimeConditionExpr;
  selection?: {
    enabled: boolean;
  };
  activation?: {
    enabled?: boolean;
    trigger?: InteractionActivationTrigger;
    action: {
      commandId: string;
      payload?: Record<string, unknown>;
    };
    session?: InteractionSessionIntent;
  };
  manipulation?: {
    move?: InteractionOperationSpec;
    resize?: InteractionOperationSpec;
    rotate?: InteractionOperationSpec;
  };
}

export interface ResolvedInteractionOperationState {
  enabled: boolean;
  constraints: ConstraintSpec[];
}

export interface ResolvedInteractionState {
  enabled: boolean;
  selectionEnabled: boolean;
  hitTestEnabled: boolean;
  activationEnabled: boolean;
  activationTrigger?: InteractionActivationTrigger;
  manipulation: Record<
    InteractionManipulationKind,
    ResolvedInteractionOperationState
  >;
}

export interface InteractionActivationInput {
  spec: InteractionSpec;
  runtimeContext: RuntimeConditionEvalContext;
  trigger: InteractionActivationTrigger;
  layerId?: string;
  renderIntentId?: string;
  subjectId?: string;
  surfaceId?: string;
  targetData?: Record<string, unknown>;
}

export interface InteractionActivationResult<TResult = unknown> {
  activated: boolean;
  reason?: "disabled" | "trigger-mismatch" | "session-conflict";
  commandId?: string;
  sessionId?: string;
  commandResult?: TResult;
  sessionResult?: SessionHandle;
}

export interface InteractionManipulationInput {
  spec: InteractionSpec;
  runtimeContext: RuntimeConditionEvalContext;
  locked?: boolean;
  transform: TransformInput;
  sceneMatrix?: Matrix2D<"object-local", "scene">;
  coordinateSpace: "scene";
  geometrySource?: GeometrySourceService;
  target?: unknown;
  metadata?: Record<string, unknown>;
  commit?: boolean;
}

export interface InteractionManipulationResult extends ConstraintResolveResult {
  kind: InteractionManipulationKind;
  enabled: boolean;
  commitTransform?: InteractionCommitTransform;
}

export type InteractionCommitTransform =
  | {
      type: "scene-delta";
      delta: CoordinateDelta<"scene">;
    }
  | {
      type: "scene-matrix";
      matrix: CoordinateMatrix<"object-local", "scene">;
    };

export interface InteractionManipulationCommitEvent {
  kind: InteractionManipulationKind;
  input: InteractionManipulationInput;
  result: InteractionManipulationResult;
}

export type InteractionManipulationCommitListener = (
  event: InteractionManipulationCommitEvent,
) => void;

export interface InteractionServiceEventMap {
  manipulationCommit: InteractionManipulationCommitEvent;
}

export class InteractionService implements Service {
  private commandService?: CommandService;
  private constraintResolver?: ConstraintResolverService;
  private sessionService?: SessionService;
  private readonly events = new TypedEventEmitter<InteractionServiceEventMap>();

  constructor(
    services: {
      commandService?: CommandService;
      constraintResolver?: ConstraintResolverService;
      sessionService?: SessionService;
    } = {},
  ) {
    this.commandService = services.commandService;
    this.constraintResolver = services.constraintResolver;
    this.sessionService = services.sessionService;
  }

  init(context: ServiceContext): void {
    this.commandService = context.get(COMMAND_SERVICE) ?? this.commandService;
    this.constraintResolver =
      context.get(CONSTRAINT_RESOLVER_SERVICE) ?? this.constraintResolver;
    this.sessionService = context.get(SESSION_SERVICE) ?? this.sessionService;
  }

  resolveState(
    spec: InteractionSpec | undefined,
    runtimeContext: RuntimeConditionEvalContext,
    locked = false,
  ): ResolvedInteractionState {
    const enabled = Boolean(
      spec && evaluateRuntimeCondition(spec.enabledWhen, runtimeContext),
    );
    const manipulation = {
      move: this.resolveOperationState(
        enabled && !locked ? spec?.manipulation?.move : undefined,
        runtimeContext,
      ),
      resize: this.resolveOperationState(
        enabled && !locked ? spec?.manipulation?.resize : undefined,
        runtimeContext,
      ),
      rotate: this.resolveOperationState(
        enabled && !locked ? spec?.manipulation?.rotate : undefined,
        runtimeContext,
      ),
    };
    const manipulationEnabled = Object.values(manipulation).some(
      (operation) => operation.enabled,
    );
    const selectionEnabled = Boolean(
      enabled && !locked && (spec?.selection?.enabled || manipulationEnabled),
    );
    const activationEnabled = Boolean(
      enabled &&
        spec?.activation &&
        spec.activation.enabled !== false &&
        normalizeId(spec.activation.action.commandId),
    );

    return {
      enabled,
      selectionEnabled,
      hitTestEnabled: selectionEnabled || activationEnabled,
      activationEnabled,
      ...(activationEnabled
        ? {
            activationTrigger: spec?.activation?.trigger ?? "primary-pointer",
          }
        : {}),
      manipulation,
    };
  }

  async activate<TResult = unknown>(
    input: InteractionActivationInput,
  ): Promise<InteractionActivationResult<TResult>> {
    const state = this.resolveState(input.spec, input.runtimeContext, false);
    const activation = input.spec.activation;
    if (!state.activationEnabled || !activation) {
      return { activated: false, reason: "disabled" };
    }
    if (state.activationTrigger !== input.trigger) {
      return { activated: false, reason: "trigger-mismatch" };
    }

    const commandId = normalizeId(activation.action.commandId);
    const actionPayload = cloneRecord(activation.action.payload);
    let sessionId: string | undefined;
    let sessionContext: InteractionActivationSessionContext | undefined;
    if (activation.session) {
      const channel = normalizeId(activation.session.channel) || commandId;
      sessionId =
        normalizeId(activation.session.sessionId) ||
        normalizeId(actionPayload.sessionId) ||
        `${channel}:${normalizeId(input.subjectId) || "editor"}`;
      sessionContext = {
        sessionId,
        scope: createSessionScope(activation.session, {
          channel,
          subjectId: normalizeId(input.subjectId),
          surfaceId: normalizeId(input.surfaceId),
        }),
        interactionMode: activation.session.mode,
        leavePolicy: activation.session.leavePolicy ?? "block",
      };
    }

    let commandResult: TResult;
    try {
      commandResult =
        await this.requireCommandService().executeCommand<TResult>(commandId, {
          ...actionPayload,
          layerId: normalizeId(input.layerId) || undefined,
          renderIntentId: normalizeId(input.renderIntentId) || undefined,
          session: sessionContext,
          sessionId,
          subjectId: normalizeId(input.subjectId) || undefined,
          surfaceId: normalizeId(input.surfaceId) || undefined,
          targetData: cloneRecord(input.targetData),
          trigger: input.trigger,
        });
    } catch (error) {
      if (!(error instanceof SessionConflictError)) throw error;
      return {
        activated: false,
        reason: "session-conflict",
        commandId,
        sessionId,
      };
    }
    if (isSessionConflictCommandResult(commandResult)) {
      return {
        activated: false,
        reason: "session-conflict",
        commandId,
        sessionId,
        commandResult,
      };
    }
    const sessionResult = sessionId
      ? this.requireSessionService().getHandle(sessionId)
      : undefined;
    return {
      activated: true,
      commandId,
      sessionId,
      commandResult,
      sessionResult,
    };
  }

  resolveManipulation(
    kind: InteractionManipulationKind,
    input: InteractionManipulationInput,
  ): InteractionManipulationResult {
    const operation = this.resolveState(
      input.spec,
      input.runtimeContext,
      input.locked,
    ).manipulation[kind];
    const resolved = this.requireConstraintResolver().resolve({
      transform: input.transform,
      constraints: operation.enabled ? operation.constraints : [],
      coordinateSpace: input.coordinateSpace,
      geometrySource: input.geometrySource,
      target: input.target,
      metadata: input.metadata,
    });
    const result: InteractionManipulationResult = {
      ...resolved,
      kind,
      enabled: operation.enabled,
      ...(input.commit && operation.enabled
        ? {
            commitTransform: createCommitTransform(
              kind,
              resolved,
              input.sceneMatrix,
            ),
          }
        : {}),
    };
    if (input.commit && result.enabled) {
      const event = { kind, input, result };
      this.events.emit("manipulationCommit", event);
    }
    return result;
  }

  onDidCommitManipulation(
    listener: InteractionManipulationCommitListener,
  ): Disposable {
    return this.events.on("manipulationCommit", listener);
  }

  on<TKey extends keyof InteractionServiceEventMap>(
    type: TKey,
    listener: (event: InteractionServiceEventMap[TKey]) => void,
  ): Disposable {
    return this.events.on(type, listener);
  }

  dispose(): void {
    this.events.clear();
  }

  private resolveOperationState(
    operation: InteractionOperationSpec | undefined,
    runtimeContext: RuntimeConditionEvalContext,
  ): ResolvedInteractionOperationState {
    const enabled = operation?.enabled === true;
    return {
      enabled,
      constraints: enabled
        ? (operation.constraints ?? [])
            .filter((constraint) =>
              evaluateRuntimeCondition(constraint.activeWhen, runtimeContext),
            )
            .map((constraint) => cloneConstraintSpec(constraint.spec))
        : [],
    };
  }

  private requireCommandService(): CommandService {
    if (!this.commandService) {
      throw new Error("InteractionService requires CommandService.");
    }
    return this.commandService;
  }

  private requireConstraintResolver(): ConstraintResolverService {
    if (!this.constraintResolver) {
      throw new Error("InteractionService requires ConstraintResolverService.");
    }
    return this.constraintResolver;
  }

  private requireSessionService(): SessionService {
    if (!this.sessionService) {
      throw new Error("InteractionService requires SessionService.");
    }
    return this.sessionService;
  }
}

function createCommitTransform(
  kind: InteractionManipulationKind,
  resolved: ConstraintResolveResult,
  sceneMatrix?: Matrix2D<"object-local", "scene">,
): InteractionCommitTransform {
  const before = resolved.input.frame;
  const after = resolved.result.frame;
  if (kind === "move") {
    return {
      type: "scene-delta",
      delta: coordinateDelta(
        "scene",
        (after?.left ?? resolved.result.position?.x ?? 0) -
          (before?.left ?? resolved.input.position?.x ?? 0),
        (after?.top ?? resolved.result.position?.y ?? 0) -
          (before?.top ?? resolved.input.position?.y ?? 0),
      ),
    };
  }

  if (sceneMatrix) return { type: "scene-matrix", matrix: sceneMatrix };

  const position = resolved.result.position ?? {
    x: after?.left ?? 0,
    y: after?.top ?? 0,
  };
  const scale = resolved.result.scale;
  const scaleX = typeof scale === "number" ? scale : (scale?.x ?? 1);
  const scaleY = typeof scale === "number" ? scale : (scale?.y ?? 1);
  const radians = ((resolved.result.rotation ?? 0) * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    type: "scene-matrix",
    matrix: coordinateMatrix("object-local", "scene", [
      cosine * scaleX,
      sine * scaleX,
      -sine * scaleY,
      cosine * scaleY,
      position.x,
      position.y,
    ]),
  };
}

function createSessionScope(
  session: InteractionSessionIntent,
  context: { channel: string; subjectId: string; surfaceId: string },
): SessionScope {
  return {
    channel: context.channel,
    groupId: normalizeId(session.groupId) || null,
    surfaceId: session.scope === "editor" ? null : context.surfaceId || null,
    subjectId: session.scope === "subject" ? context.subjectId || null : null,
  };
}

function cloneConstraintSpec(spec: ConstraintSpec): ConstraintSpec {
  return {
    ...spec,
    ...(spec.params ? { params: cloneRecord(spec.params) } : {}),
  };
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cloneRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return value ? { ...value } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSessionConflictCommandResult(
  value: unknown,
): value is { ok: false; reason: "session-conflict" } {
  return (
    isRecord(value) && value.ok === false && value.reason === "session-conflict"
  );
}
