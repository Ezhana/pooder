import {
  COMMAND_SERVICE,
  CONSTRAINT_RESOLVER_CAPABILITY_ID,
  CONSTRAINT_RESOLVER_SERVICE,
  GEOMETRY_SOURCE_CAPABILITY_ID,
  GEOMETRY_SOURCE_SERVICE,
  SESSION_SERVICE,
  createConstraintResolverCapabilityDefinition,
  createGeometrySourceCapabilityDefinition,
  type CommandService,
  type ConstraintResolverCapability,
  type DefaultConstraintResolverCapability,
  type DefaultGeometrySourceCapability,
  type ExtensionContext,
  type ExtensionContributions,
  type ExtensionDefinition,
  type GeometrySourceCapability,
  type SessionInteractionMode,
  type SessionLeavePolicy,
  type SessionScope,
  type SessionService,
} from "@pooder/core";

export const INTERACTION_CAPABILITY_ID = "pooder.kit.interaction";

interface InteractionActivationEvent {
  activation?: unknown;
  layerId?: unknown;
  renderIntentId?: unknown;
  subjectId?: unknown;
  surfaceId?: unknown;
  targetData?: unknown;
  trigger?: unknown;
}

export class InteractionCapabilityExtension implements ExtensionDefinition {
  readonly id = "pooder.kit.interaction";
  readonly activation = {
    requiresServices: [
      COMMAND_SERVICE,
      CONSTRAINT_RESOLVER_SERVICE,
      GEOMETRY_SOURCE_SERVICE,
      SESSION_SERVICE,
    ],
  };
  private geometrySource?: GeometrySourceCapability;
  private constraintResolver?: ConstraintResolverCapability;
  private commandService?: CommandService;
  private sessionService?: SessionService;
  private context?: ExtensionContext;

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createGeometrySourceCapabilityDefinition(this.getGeometryFacade()),
        createConstraintResolverCapabilityDefinition(
          this.getConstraintFacade(),
        ),
        {
          id: INTERACTION_CAPABILITY_ID,
          metadata: {
            name: "Interaction",
            description:
              "Dispatch document-declared object interactions and constraints.",
            tags: ["core", "interaction", "constraint"],
          },
        },
      ],
    };
  }

  activate(context: ExtensionContext): void {
    this.context = context;
    this.geometrySource = context.services.get<DefaultGeometrySourceCapability>(
      GEOMETRY_SOURCE_SERVICE,
    );
    this.constraintResolver =
      context.services.get<DefaultConstraintResolverCapability>(
        CONSTRAINT_RESOLVER_SERVICE,
      );
    this.commandService =
      context.services.getOrThrow<CommandService>(COMMAND_SERVICE);
    this.sessionService =
      context.services.getOrThrow<SessionService>(SESSION_SERVICE);
    if (!this.geometrySource || !this.constraintResolver) {
      throw new Error(
        "GeometrySource, ConstraintResolver, and CommandService are required.",
      );
    }
    context.eventBus.on("interaction:activate", this.onInteractionActivate);
  }

  deactivate(): void {
    this.context?.eventBus.off(
      "interaction:activate",
      this.onInteractionActivate,
    );
    this.context = undefined;
    this.geometrySource = undefined;
    this.constraintResolver = undefined;
    this.commandService = undefined;
    this.sessionService = undefined;
  }

  private readonly onInteractionActivate = (
    rawEvent: InteractionActivationEvent,
  ) => {
    void this.dispatchInteraction(rawEvent);
  };

  private async dispatchInteraction(event: InteractionActivationEvent) {
    const activation = isRecord(event.activation) ? event.activation : {};
    const action = isRecord(activation.action) ? activation.action : {};
    const command = normalizeId(action.command);
    if (!command) return;

    const subjectId = normalizeId(event.subjectId);
    const surfaceId = normalizeId(event.surfaceId);
    const targetData = isRecord(event.targetData) ? event.targetData : {};
    const actionPayload = isRecord(action.payload)
      ? cloneRecord(action.payload)
      : {};
    const session = isRecord(activation.session)
      ? activation.session
      : undefined;
    let sessionId: string | undefined;

    if (session) {
      const channel = normalizeId(session.channel) || command;
      const placement = isRecord(targetData.imagePlacement)
        ? targetData.imagePlacement
        : {};
      sessionId =
        normalizeId(session.sessionId) ||
        normalizeId(actionPayload.sessionId) ||
        normalizeId(placement.sessionKey) ||
        `${channel}:${subjectId || "editor"}`;
      const scope = createSessionScope(session, {
        channel,
        subjectId,
        surfaceId,
      });
      const result = await this.sessionService?.requestSession({
        sessionId,
        scope,
        interactionMode: normalizeInteractionMode(session.mode),
        leavePolicy: normalizeLeavePolicy(session.leavePolicy),
      });
      if (result && !result.ok) {
        this.context?.eventBus.emit("interaction:activation-blocked", {
          command,
          event,
          result,
        });
        return;
      }
    }

    await this.commandService?.executeCommand(command, {
      ...actionPayload,
      layerId: normalizeId(event.layerId) || undefined,
      renderIntentId: normalizeId(event.renderIntentId) || undefined,
      sessionId,
      subjectId: subjectId || undefined,
      surfaceId: surfaceId || undefined,
      targetData: cloneRecord(targetData),
      trigger: normalizeId(event.trigger) || undefined,
    });
  }

  private getGeometryFacade(): GeometrySourceCapability {
    return {
      registerSource: (source) =>
        this.requireGeometrySource().registerSource(source),
      getGeometry: (ref) => this.requireGeometrySource().getGeometry(ref),
      listGeometries: (sourceId) =>
        this.requireGeometrySource().listGeometries(sourceId),
      projectGeometry: (ref, space) =>
        this.requireGeometrySource().projectGeometry(ref, space),
    };
  }

  private getConstraintFacade(): ConstraintResolverCapability {
    return {
      resolve: (input) => this.requireConstraintResolver().resolve(input),
      registerConstraint: (type, resolver) =>
        this.requireConstraintResolver().registerConstraint(type, resolver),
    };
  }

  private requireGeometrySource(): GeometrySourceCapability {
    if (!this.geometrySource) {
      throw new Error(
        `Capability "${GEOMETRY_SOURCE_CAPABILITY_ID}" is not active.`,
      );
    }
    return this.geometrySource;
  }

  private requireConstraintResolver(): ConstraintResolverCapability {
    if (!this.constraintResolver) {
      throw new Error(
        `Capability "${CONSTRAINT_RESOLVER_CAPABILITY_ID}" is not active.`,
      );
    }
    return this.constraintResolver;
  }
}

function createSessionScope(
  session: Record<string, unknown>,
  context: { channel: string; subjectId: string; surfaceId: string },
): SessionScope {
  const scope = normalizeId(session.scope) || "subject";
  return {
    channel: context.channel,
    groupId: normalizeId(session.groupId) || null,
    surfaceId: scope === "editor" ? null : context.surfaceId || null,
    subjectId: scope === "subject" ? context.subjectId || null : null,
  };
}

function normalizeInteractionMode(value: unknown): SessionInteractionMode {
  return value === "cooperative" || value === "passive" ? value : "exclusive";
}

function normalizeLeavePolicy(value: unknown): SessionLeavePolicy {
  return value === "commit" || value === "rollback" ? value : "block";
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
