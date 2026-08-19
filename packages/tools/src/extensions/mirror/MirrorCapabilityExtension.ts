import {
  RENDER_INTENT_SERVICE,
  coordinateMatrix,
  type Matrix2D,
  type ExtensionContext,
  type ExtensionContributions,
  type ExtensionDefinition,
  type RenderGraphNode,
  type RenderIntentCompilerContribution,
  type RenderIntentCompilerContext,
  type RenderIntentPatch,
  type RenderIntentService,
} from "@pooder/core";
import {
  findDocumentObject,
  type PooderDocument,
  type ExtensionObjectEffect,
  type PooderObject,
} from "@pooder/document";
import { getEffectSchema } from "../../document/effect-schemas";
import {
  MIRROR_CAPABILITY_ID,
  createMirrorCapabilityDefinition,
  normalizeMirrorState,
  type MirrorAxis,
  type MirrorCapabilityApi,
  type MirrorCapabilityOptions,
  type MirrorEffectPayload,
  type MirrorObjectSelector,
  type MirrorState,
} from "./capability";

const MIRROR_RUNTIME_PATCH_SOURCE = "pooder.kit.mirror.runtime";
const DEFAULT_EXTENSION_ID = "pooder.kit.mirror";

export interface MirrorCapabilityExtensionOptions extends MirrorCapabilityOptions {
  id?: string;
}

export class MirrorCapabilityExtension implements ExtensionDefinition {
  id: string;

  metadata = {
    name: "MirrorCapabilityExtension",
  };

  activation = {
    requiresServices: [RENDER_INTENT_SERVICE],
  };

  private readonly capabilityId: string;
  private readonly runtimeStates = new Map<string, MirrorState>();
  private renderIntentService?: RenderIntentService;

  constructor(options: MirrorCapabilityExtensionOptions = {}) {
    this.id =
      String(options.id || DEFAULT_EXTENSION_ID).trim() || DEFAULT_EXTENSION_ID;
    this.capabilityId = options.capabilityId || MIRROR_CAPABILITY_ID;
  }

  activate(context: ExtensionContext) {
    this.renderIntentService = context.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
  }

  deactivate() {
    this.renderIntentService?.clearRuntimePatches(MIRROR_RUNTIME_PATCH_SOURCE);
    this.runtimeStates.clear();
    this.renderIntentService = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createMirrorCapabilityDefinition(this.getMirrorFacade(), {
          capabilityId: this.capabilityId,
        }),
      ],
      documentExtensions: [
        { id: this.id, effects: [getEffectSchema("mirror")] },
      ],
      renderIntentCompilers: [this.createRenderIntentCompiler()],
    };
  }

  refresh(): void {
    const entries = Array.from(this.runtimeStates.entries());
    this.renderIntentService?.clearRuntimePatches(MIRROR_RUNTIME_PATCH_SOURCE);
    entries.forEach(([objectId, state]) => {
      this.applyRuntimeMirror(objectId, state);
    });
  }

  private createRenderIntentCompiler(): RenderIntentCompilerContribution<
    ExtensionObjectEffect<MirrorEffectPayload>,
    PooderDocument
  > {
    return {
      capabilityId: this.capabilityId,
      effectType: "mirror",
      compile: (context) => this.compileDocumentMirrorEffect(context),
    };
  }

  private compileDocumentMirrorEffect(
    context: RenderIntentCompilerContext<
      ExtensionObjectEffect<MirrorEffectPayload>,
      PooderDocument
    >,
  ): RenderIntentPatch | void {
    if (context.target.kind !== "object" || !context.target.objectId) return;

    const object = findDocumentObject(
      context.document,
      context.target.objectId,
    );
    if (!object) return;

    const state = normalizeMirrorState(context.effect.payload);
    return {
      id: context.target.objectId,
      placementTransform: createMirrorTransform(state),
      data: {
        mirror: state,
      },
    };
  }

  private getMirrorFacade(): MirrorCapabilityApi {
    return {
      clearObjectMirror: (input) => this.clearObjectMirror(input),
      getObjectMirror: (input) => this.getObjectMirror(input),
      refresh: () => this.refresh(),
      setObjectMirror: (input, state) => this.setObjectMirror(input, state),
      toggleObjectMirror: (input, axis) => this.toggleObjectMirror(input, axis),
    };
  }

  private setObjectMirror(
    input: MirrorObjectSelector,
    value: MirrorEffectPayload,
  ): boolean {
    const objectId = normalizeObjectId(input);
    if (!objectId) return false;

    const state = normalizeMirrorState(value);
    if (!this.applyRuntimeMirror(objectId, state)) return false;
    this.runtimeStates.set(objectId, state);
    return true;
  }

  private toggleObjectMirror(
    input: MirrorObjectSelector,
    axis: MirrorAxis,
  ): MirrorState {
    const objectId = normalizeObjectId(input);
    const current = this.getObjectMirror(input);
    const next: MirrorState = {
      ...current,
      ...(axis === "horizontal" ? { horizontal: !current.horizontal } : {}),
      ...(axis === "vertical" ? { vertical: !current.vertical } : {}),
    };
    if (!objectId || !this.setObjectMirror({ objectId }, next)) {
      return current;
    }
    return next;
  }

  private clearObjectMirror(input: MirrorObjectSelector): boolean {
    const objectId = normalizeObjectId(input);
    if (!objectId) return false;
    this.runtimeStates.delete(objectId);
    return (
      this.renderIntentService?.clearRuntimePatch(
        MIRROR_RUNTIME_PATCH_SOURCE,
        objectId,
      ) ?? false
    );
  }

  private getObjectMirror(input: MirrorObjectSelector): MirrorState {
    const objectId = normalizeObjectId(input);
    if (!objectId) return { horizontal: false, vertical: false };
    const node = this.findGraphNode(objectId);
    if (!node) return { horizontal: false, vertical: false };
    return readMirrorStateFromNode(node);
  }

  private applyRuntimeMirror(objectId: string, state: MirrorState): boolean {
    const node = this.findGraphNode(objectId);
    if (!node) return false;

    this.renderIntentService?.patchIntent(MIRROR_RUNTIME_PATCH_SOURCE, {
      id: objectId,
      placementTransform: createMirrorTransform(
        state,
        readMirrorStateFromNode(node),
      ),
      data: {
        mirror: state,
      },
    });
    return true;
  }

  private findGraphNode(objectId: string): RenderGraphNode | undefined {
    const graph = this.renderIntentService?.getGraph();
    if (!graph) return undefined;
    for (const layer of graph.layers) {
      const node = layer.nodes.find(
        (item) => item.subjectId === objectId || item.id === objectId,
      );
      if (node) return node;
    }
    return undefined;
  }
}

function normalizeObjectId(input: MirrorObjectSelector): string {
  return String(input?.objectId || "").trim();
}

function createMirrorTransform(
  state: MirrorState,
  current: MirrorState = { horizontal: false, vertical: false },
): Matrix2D<"object-local", "object-local"> {
  const flipX = state.horizontal !== current.horizontal;
  const flipY = state.vertical !== current.vertical;
  const scaleX = flipX ? -1 : 1;
  const scaleY = flipY ? -1 : 1;
  return coordinateMatrix("object-local", "object-local", [
    scaleX,
    0,
    0,
    scaleY,
    0,
    0,
  ]);
}

function readMirrorStateFromNode(node: RenderGraphNode): MirrorState {
  const mirror = node.data?.mirror;
  if (isMirrorState(mirror)) return mirror;
  return { horizontal: false, vertical: false };
}

function isMirrorState(value: unknown): value is MirrorState {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as MirrorState).horizontal === "boolean" &&
    typeof (value as MirrorState).vertical === "boolean"
  );
}

