import type Disposable from "./disposable";
import type {
  ConstraintResolveResult,
  ConstraintResolvePhase,
  ConstraintResolverService,
  ConstraintSpec,
  TransformInput,
} from "./constraint-resolver";
import type { GeometryRef, GeometrySourceService } from "./geometry-source";
import {
  coordinateDelta,
  coordinateMatrix,
  invertCoordinateMatrix,
  multiplyCoordinateMatrices,
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
  GEOMETRY_SOURCE_SERVICE,
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
export type InteractionOperationPhase = ConstraintResolvePhase;

export interface InteractionSubject {
  readonly subjectId: string;
  readonly surfaceId?: string;
  readonly projectionTargets: readonly InteractionProjectionTarget[];
}

export interface InteractionProjectionTarget {
  readonly projectionId: string;
  readonly geometryRef: GeometryRef;
}

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
  /** Selects whether the document service or the declared action owns commit. */
  documentMutation?: "automatic" | "action-owned";
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
  subject?: InteractionSubject;
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
  /** Canonical declarative transform before this interaction began. */
  sourceTransform?: TransformInput;
  /** Declarative matrix of the projection that initiated the operation. */
  sourceSceneMatrix?: Matrix2D<"object-local", "scene">;
  sceneMatrix?: Matrix2D<"object-local", "scene">;
  coordinateSpace: "scene";
  target?: unknown;
  metadata?: Record<string, unknown>;
  projectionId?: string;
  subject: InteractionSubject;
}

export interface InteractionManipulationResult extends ConstraintResolveResult {
  kind: InteractionManipulationKind;
  phase: InteractionOperationPhase;
  enabled: boolean;
  coordinateSpace: "scene";
  subject: InteractionSubject;
  projectionPatches: readonly InteractionProjectionPatch[];
  /** Constraint-resolved absolute matrix of the initiating projection. */
  sceneMatrix?: Matrix2D<"object-local", "scene">;
  /** Present only for commit results; this is the logical Document mutation. */
  documentPatch?: SceneTransformPatch;
}

export interface InteractionProjectionPatch {
  target: {
    kind: "projection";
    projectionId: string;
  };
  coordinateSpace: "scene";
  transform: SceneTransformPatch;
}

export type SceneTransformPatch =
  | {
      type: "translate";
      coordinateSpace: "scene";
      delta: CoordinateDelta<"scene">;
    }
  | {
      type: "replace-matrix";
      coordinateSpace: "scene";
      matrix: CoordinateMatrix<"object-local", "scene">;
    };

export interface InteractionManipulationCommitEvent {
  kind: InteractionManipulationKind;
  subject: InteractionSubject;
  input: InteractionManipulationInput;
  result: InteractionManipulationResult;
}

export interface InteractionSelectionChangeEvent {
  subject: InteractionSubject | null;
}

export type InteractionManipulationCommitListener = (
  event: InteractionManipulationCommitEvent,
) => void;

export interface InteractionServiceEventMap {
  manipulationCommit: InteractionManipulationCommitEvent;
  selectionChange: InteractionSelectionChangeEvent;
}

export class InteractionService implements Service {
  private commandService?: CommandService;
  private constraintResolver?: ConstraintResolverService;
  private geometrySource?: GeometrySourceService;
  private sessionService?: SessionService;
  private readonly events = new TypedEventEmitter<InteractionServiceEventMap>();
  private selectedSubject: InteractionSubject | null = null;

  constructor(
    services: {
      commandService?: CommandService;
      constraintResolver?: ConstraintResolverService;
      geometrySource?: GeometrySourceService;
      sessionService?: SessionService;
    } = {},
  ) {
    this.commandService = services.commandService;
    this.constraintResolver = services.constraintResolver;
    this.geometrySource = services.geometrySource;
    this.sessionService = services.sessionService;
  }

  init(context: ServiceContext): void {
    this.commandService = context.get(COMMAND_SERVICE) ?? this.commandService;
    this.constraintResolver =
      context.get(CONSTRAINT_RESOLVER_SERVICE) ?? this.constraintResolver;
    this.geometrySource =
      context.get(GEOMETRY_SOURCE_SERVICE) ?? this.geometrySource;
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
    const subjectId = normalizeId(input.subject?.subjectId ?? input.subjectId);
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
        `${channel}:${subjectId || "editor"}`;
      sessionContext = {
        sessionId,
        scope: createSessionScope(activation.session, {
          channel,
          subjectId,
          surfaceId: normalizeId(input.subject?.surfaceId ?? input.surfaceId),
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
          subjectId: subjectId || undefined,
          surfaceId:
            normalizeId(input.subject?.surfaceId ?? input.surfaceId) ||
            undefined,
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

  previewManipulation(
    kind: InteractionManipulationKind,
    input: InteractionManipulationInput,
  ): InteractionManipulationResult {
    return this.resolveManipulation(kind, input, "preview");
  }

  commitManipulation(
    kind: InteractionManipulationKind,
    input: InteractionManipulationInput,
  ): InteractionManipulationResult {
    return this.resolveManipulation(kind, input, "commit");
  }

  private resolveManipulation(
    kind: InteractionManipulationKind,
    input: InteractionManipulationInput,
    phase: InteractionOperationPhase,
  ): InteractionManipulationResult {
    const subject = requireInteractionSubject(input.subject);
    const operation = this.resolveState(
      input.spec,
      input.runtimeContext,
      input.locked,
    ).manipulation[kind];
    const resolved = this.requireConstraintResolver().resolve({
      transform: input.transform,
      constraints: operation.enabled ? operation.constraints : [],
      coordinateSpace: input.coordinateSpace,
      geometrySource: this.requireGeometrySource(),
      phase,
      target: input.target,
      metadata: input.metadata,
    });
    const documentPatch = operation.enabled
      ? createSceneTransformPatch(
          kind,
          resolved,
          input.sourceTransform,
          input.sourceSceneMatrix,
          input.sceneMatrix,
        )
      : undefined;
    const primaryProjectionId = normalizeId(input.projectionId);
    const projectionPatches =
      operation.enabled && documentPatch
        ? createProjectionPatches(
            kind,
            subject,
            documentPatch,
            input.sourceSceneMatrix,
            input.sceneMatrix,
            primaryProjectionId,
            this.requireGeometrySource(),
          )
        : [];
    const primaryMatrixPatch = projectionPatches.find(
      (patch) =>
        patch.transform.type === "replace-matrix" &&
        (!primaryProjectionId ||
          patch.target.projectionId === primaryProjectionId),
    );
    const resultSceneMatrix =
      primaryMatrixPatch?.transform.type === "replace-matrix"
        ? primaryMatrixPatch.transform.matrix
        : createCanonicalSceneMatrix(
            resolved,
            documentPatch,
            input.sourceSceneMatrix,
            input.sceneMatrix,
          );
    const result: InteractionManipulationResult = {
      ...resolved,
      kind,
      phase,
      enabled: operation.enabled,
      coordinateSpace: "scene",
      subject,
      projectionPatches,
      ...(resultSceneMatrix ? { sceneMatrix: resultSceneMatrix } : {}),
      ...(phase === "commit" && documentPatch ? { documentPatch } : {}),
    };
    this.dispatchManipulationAction(kind, input, result);
    if (phase === "commit" && result.enabled) {
      const event = { kind, subject: result.subject, input, result };
      this.events.emit("manipulationCommit", event);
    }
    return result;
  }

  onDidCommitManipulation(
    listener: InteractionManipulationCommitListener,
  ): Disposable {
    return this.events.on("manipulationCommit", listener);
  }

  selectSubject(subject: InteractionSubject | null): void {
    const normalized = normalizeInteractionSubject(subject);
    if (sameInteractionSubject(this.selectedSubject, normalized)) return;
    this.selectedSubject = normalized;
    this.events.emit("selectionChange", { subject: normalized });
  }

  getSelectedSubject(): InteractionSubject | null {
    return this.selectedSubject
      ? {
          ...this.selectedSubject,
          projectionTargets: this.selectedSubject.projectionTargets.map(
            cloneProjectionTarget,
          ),
        }
      : null;
  }

  onDidChangeSelection(
    listener: (event: InteractionSelectionChangeEvent) => void,
  ): Disposable {
    return this.events.on("selectionChange", listener);
  }

  on<TKey extends keyof InteractionServiceEventMap>(
    type: TKey,
    listener: (event: InteractionServiceEventMap[TKey]) => void,
  ): Disposable {
    return this.events.on(type, listener);
  }

  dispose(): void {
    this.selectedSubject = null;
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

  private dispatchManipulationAction(
    kind: InteractionManipulationKind,
    input: InteractionManipulationInput,
    result: InteractionManipulationResult,
  ): void {
    const action = input.spec.manipulation?.[kind]?.action;
    const commandId = normalizeId(action?.commandId);
    if (!result.enabled || !action || !commandId) return;
    void this.requireCommandService()
      .executeCommand(commandId, {
        ...cloneRecord(action.payload),
        coordinateSpace: result.coordinateSpace,
        documentPatch: result.documentPatch,
        kind,
        metadata: cloneRecord(result.result.metadata),
        phase: result.phase,
        projectionPatches: result.projectionPatches,
        sceneMatrix: result.sceneMatrix,
        sceneTransformPatch: result.documentPatch,
        subject: result.subject,
        subjectId: result.subject.subjectId,
        surfaceId: result.subject.surfaceId,
        transform: result.result,
      })
      .catch((error) => {
        console.error(
          `Interaction manipulation action "${commandId}" failed.`,
          error,
        );
      });
  }

  private requireConstraintResolver(): ConstraintResolverService {
    if (!this.constraintResolver) {
      throw new Error("InteractionService requires ConstraintResolverService.");
    }
    return this.constraintResolver;
  }

  private requireGeometrySource(): GeometrySourceService {
    const resolverGeometry =
      this.requireConstraintResolver().getGeometrySource();
    if (
      resolverGeometry &&
      this.geometrySource &&
      resolverGeometry !== this.geometrySource
    ) {
      throw new Error(
        "InteractionService and ConstraintResolverService must share GeometrySourceService.",
      );
    }
    const geometrySource = resolverGeometry ?? this.geometrySource;
    if (!geometrySource) {
      throw new Error("InteractionService requires GeometrySourceService.");
    }
    return geometrySource;
  }

  private requireSessionService(): SessionService {
    if (!this.sessionService) {
      throw new Error("InteractionService requires SessionService.");
    }
    return this.sessionService;
  }
}

function createSceneTransformPatch(
  kind: InteractionManipulationKind,
  resolved: ConstraintResolveResult,
  sourceTransform?: TransformInput,
  sourceSceneMatrix?: Matrix2D<"object-local", "scene">,
  sceneMatrix?: Matrix2D<"object-local", "scene">,
): SceneTransformPatch {
  const before = sourceTransform?.frame ?? resolved.input.frame;
  const after = resolved.result.frame;
  if (kind === "move") {
    const matrixDelta =
      sourceSceneMatrix && sceneMatrix
        ? {
            x: sceneMatrix.values[4] - sourceSceneMatrix.values[4],
            y: sceneMatrix.values[5] - sourceSceneMatrix.values[5],
          }
        : null;
    const constraintCorrection = {
      x:
        (after?.left ?? resolved.result.position?.x ?? 0) -
        (resolved.input.frame?.left ?? resolved.input.position?.x ?? 0),
      y:
        (after?.top ?? resolved.result.position?.y ?? 0) -
        (resolved.input.frame?.top ?? resolved.input.position?.y ?? 0),
    };
    return {
      type: "translate",
      coordinateSpace: "scene",
      delta: coordinateDelta(
        "scene",
        matrixDelta
          ? matrixDelta.x + constraintCorrection.x
          : (after?.left ?? resolved.result.position?.x ?? 0) -
              (before?.left ?? resolved.input.position?.x ?? 0),
        matrixDelta
          ? matrixDelta.y + constraintCorrection.y
          : (after?.top ?? resolved.result.position?.y ?? 0) -
              (before?.top ?? resolved.input.position?.y ?? 0),
      ),
    };
  }

  if (sceneMatrix) {
    return {
      type: "replace-matrix",
      coordinateSpace: "scene",
      matrix: sceneMatrix,
    };
  }

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
    type: "replace-matrix",
    coordinateSpace: "scene",
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

/**
 * Produces the canonical matrix consumed by manipulation actions. Projection
 * patches normally provide it, but actions must not fall back to the raw
 * renderer matrix when a projection snapshot is temporarily unavailable.
 */
function createCanonicalSceneMatrix(
  resolved: ConstraintResolveResult,
  documentPatch: SceneTransformPatch | undefined,
  sourceSceneMatrix: Matrix2D<"object-local", "scene"> | undefined,
  sceneMatrix: Matrix2D<"object-local", "scene"> | undefined,
): Matrix2D<"object-local", "scene"> | undefined {
  if (!documentPatch) return sceneMatrix;
  if (documentPatch.type === "replace-matrix") return documentPatch.matrix;

  const toCanonicalPosition = coordinateMatrix("scene", "scene", [
    1,
    0,
    0,
    1,
    documentPatch.delta.x,
    documentPatch.delta.y,
  ]);
  if (sourceSceneMatrix) {
    return multiplyCoordinateMatrices(toCanonicalPosition, sourceSceneMatrix);
  }
  if (!sceneMatrix) return undefined;

  const inputPosition = resolved.input.frame
    ? {
        x: resolved.input.frame.left,
        y: resolved.input.frame.top,
      }
    : resolved.input.position;
  const resultPosition = resolved.result.frame
    ? {
        x: resolved.result.frame.left,
        y: resolved.result.frame.top,
      }
    : resolved.result.position;
  if (!inputPosition || !resultPosition) return sceneMatrix;

  const constraintCorrection = coordinateMatrix("scene", "scene", [
    1,
    0,
    0,
    1,
    resultPosition.x - inputPosition.x,
    resultPosition.y - inputPosition.y,
  ]);
  return multiplyCoordinateMatrices(constraintCorrection, sceneMatrix);
}

function createProjectionPatches(
  kind: InteractionManipulationKind,
  subject: InteractionSubject,
  documentPatch: SceneTransformPatch,
  sourceSceneMatrix: Matrix2D<"object-local", "scene"> | undefined,
  sceneMatrix: Matrix2D<"object-local", "scene"> | undefined,
  primaryProjectionId: string | undefined,
  geometrySource: GeometrySourceService,
): InteractionProjectionPatch[] {
  const projectionTargets =
    normalizeInteractionSubject(subject)?.projectionTargets ?? [];
  if (kind === "move") {
    const primarySceneMatrix =
      primaryProjectionId && sourceSceneMatrix
        ? applySceneTransformPatch(documentPatch, sourceSceneMatrix)
        : undefined;
    return projectionTargets.map((projectionTarget) => ({
      target: {
        kind: "projection",
        projectionId: projectionTarget.projectionId,
      },
      coordinateSpace: "scene",
      transform:
        primarySceneMatrix &&
        projectionTarget.projectionId === primaryProjectionId
          ? {
              type: "replace-matrix" as const,
              coordinateSpace: "scene" as const,
              matrix: primarySceneMatrix,
            }
          : documentPatch,
    }));
  }

  if (!sourceSceneMatrix || !sceneMatrix) {
    return projectionTargets.map((projectionTarget) => ({
      target: {
        kind: "projection",
        projectionId: projectionTarget.projectionId,
      },
      coordinateSpace: "scene",
      transform: createProjectionTransformFromDocumentPatch(
        projectionTarget,
        documentPatch,
        geometrySource,
      ),
    }));
  }

  let sceneDelta: Matrix2D<"scene", "scene">;
  try {
    sceneDelta = multiplyCoordinateMatrices(
      sceneMatrix,
      invertCoordinateMatrix(sourceSceneMatrix),
    );
  } catch {
    return projectionTargets.map((projectionTarget) => ({
      target: {
        kind: "projection",
        projectionId: projectionTarget.projectionId,
      },
      coordinateSpace: "scene",
      transform: documentPatch,
    }));
  }

  return projectionTargets.map((projectionTarget) => {
    const snapshot = geometrySource.getSnapshot({
      ...projectionTarget.geometryRef,
      purpose: "preview",
    }).value;
    const matrix =
      sceneMatrix && projectionTarget.projectionId === primaryProjectionId
        ? // The hit projection already reports an absolute matrix. Reapplying the
          // delta to its live preview would accumulate earlier preview updates.
          sceneMatrix
        : snapshot
          ? multiplyCoordinateMatrices(
              sceneDelta,
              coordinateMatrix(
                "object-local",
                "scene",
                snapshot.localToScene.values,
              ),
            )
          : sceneMatrix;
    return {
      target: {
        kind: "projection",
        projectionId: projectionTarget.projectionId,
      },
      coordinateSpace: "scene",
      transform: {
        type: "replace-matrix",
        coordinateSpace: "scene",
        matrix,
      },
    };
  });
}

function applySceneTransformPatch(
  patch: SceneTransformPatch,
  sourceSceneMatrix: Matrix2D<"object-local", "scene">,
): Matrix2D<"object-local", "scene"> {
  if (patch.type === "replace-matrix") return patch.matrix;
  return multiplyCoordinateMatrices(
    coordinateMatrix("scene", "scene", [
      1,
      0,
      0,
      1,
      patch.delta.x,
      patch.delta.y,
    ]),
    sourceSceneMatrix,
  );
}

function createProjectionTransformFromDocumentPatch(
  projectionTarget: InteractionProjectionTarget,
  documentPatch: SceneTransformPatch,
  geometrySource: GeometrySourceService,
): SceneTransformPatch {
  if (documentPatch.type === "replace-matrix") return documentPatch;
  const snapshot = geometrySource.getSnapshot({
    ...projectionTarget.geometryRef,
    purpose: "preview",
  }).value;
  if (!snapshot) return documentPatch;
  const translation = coordinateMatrix("scene", "scene", [
    1,
    0,
    0,
    1,
    documentPatch.delta.x,
    documentPatch.delta.y,
  ]);
  return {
    type: "replace-matrix",
    coordinateSpace: "scene",
    matrix: multiplyCoordinateMatrices(
      translation,
      coordinateMatrix("object-local", "scene", snapshot.localToScene.values),
    ),
  };
}

function normalizeInteractionSubject(
  subject: InteractionSubject | undefined | null,
  metadata?: Record<string, unknown>,
): InteractionSubject | null {
  const subjectId = normalizeId(subject?.subjectId ?? metadata?.subjectId);
  if (!subjectId) return null;
  const projectionTargets = Array.from(
    new Map(
      (subject?.projectionTargets ?? [])
        .map((target) => cloneProjectionTarget(target))
        .filter(
          (target) =>
            target.projectionId &&
            target.geometryRef.sourceId &&
            target.geometryRef.geometryId,
        )
        .map((target) => [target.projectionId, target]),
    ).values(),
  );
  return {
    subjectId,
    ...(normalizeId(subject?.surfaceId ?? metadata?.surfaceId)
      ? { surfaceId: normalizeId(subject?.surfaceId ?? metadata?.surfaceId) }
      : {}),
    projectionTargets,
  };
}

function cloneProjectionTarget(
  target: InteractionProjectionTarget,
): InteractionProjectionTarget {
  return {
    projectionId: normalizeId(target?.projectionId),
    geometryRef: {
      sourceId: normalizeId(target?.geometryRef?.sourceId),
      geometryId: normalizeId(target?.geometryRef?.geometryId),
      ...(target?.geometryRef?.purpose
        ? { purpose: target.geometryRef.purpose }
        : {}),
      ...(target?.geometryRef?.variant
        ? { variant: target.geometryRef.variant }
        : {}),
    },
  };
}

function requireInteractionSubject(
  subject: InteractionSubject,
): InteractionSubject {
  const normalized = normalizeInteractionSubject(subject);
  if (!normalized) {
    throw new Error("Interaction operation requires a logical subjectId.");
  }
  return normalized;
}

function sameInteractionSubject(
  left: InteractionSubject | null,
  right: InteractionSubject | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
    ...(spec.application ? { application: { ...spec.application } } : {}),
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
