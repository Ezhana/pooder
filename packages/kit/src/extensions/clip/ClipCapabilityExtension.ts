import {
  CANVAS_SERVICE,
  CONFIGURATION_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_SERVICE,
  type CanvasService,
  type ConfigurationService,
  type ExtensionContext,
  type ExtensionContributions,
  type ExtensionDefinition,
  type RenderEffectSpec,
  type RenderObjectSpec,
  type RenderIntentCompilerContribution,
  type RenderIntentCompilerContext,
  type RenderIntentPatch,
  type RenderIntentService,
  type SceneElement,
  type SceneService,
} from "@pooder/core";
import type { EditorDocument, EditorEffect } from "@pooder/document/kit";
import {
  computeSceneLayout,
  readSizeState,
} from "../../shared/scene/scene-layout-model";
import { buildDielineClipSourceSpec } from "../dieline/renderBuilder";
import { readDielineState } from "../dieline/model";
import {
  CLIP_CAPABILITY_ID,
  createClipCapabilityDefinition,
  normalizeClipEffectPayload,
  type ClipCapabilityApi,
  type ClipCapabilityOptions,
  type ClipEffectMetadata,
  type ClipEffectPayload,
  type ClipSource,
} from "./capability";
import { ClipTargetResolver } from "./ClipTargetResolver";
import { clearRenderIntentSource } from "../../shared/runtime/renderIntentPatches";

const CLIP_METADATA_KEY = "clip";

export class ClipCapabilityExtension implements ExtensionDefinition {
  id: string;
  metadata = { name: "ClipCapability" };
  activation = {
    requiresServices: [
      CANVAS_SERVICE,
      SCENE_SERVICE,
      CONFIGURATION_SERVICE,
      RENDER_INTENT_SERVICE,
    ],
  };

  private canvasService?: CanvasService;
  private renderIntentService?: RenderIntentService;
  private sceneService?: SceneService;
  private configService?: ConfigurationService;
  private readonly capabilityId: string;
  private readonly targetResolver = new ClipTargetResolver();
  private sceneSubscription?: { dispose(): void };
  private configSubscription?: { dispose(): void };

  constructor(options: ClipCapabilityOptions = {}) {
    this.capabilityId = options.capabilityId || CLIP_CAPABILITY_ID;
    this.id = this.capabilityId;
  }

  activate(context: ExtensionContext) {
    this.canvasService =
      context.services.getOrThrow<CanvasService>(CANVAS_SERVICE);
    this.renderIntentService = context.services.getOrThrow<RenderIntentService>(
      RENDER_INTENT_SERVICE,
    );
    this.sceneService =
      context.services.getOrThrow<SceneService>(SCENE_SERVICE);
    this.configService = context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );

    this.sceneSubscription?.dispose();
    this.sceneSubscription = this.sceneService.onDidChange(() =>
      this.refresh(),
    );
    this.configSubscription?.dispose();
    this.configSubscription = this.configService.onAnyChange(() =>
      this.refresh(),
    );
    this.refresh();
  }

  deactivate() {
    this.sceneSubscription?.dispose();
    this.configSubscription?.dispose();
    this.sceneSubscription = undefined;
    this.configSubscription = undefined;
    clearRenderIntentSource(this.renderIntentService, this.id);
    this.canvasService = undefined;
    this.renderIntentService = undefined;
    this.sceneService = undefined;
    this.configService = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createClipCapabilityDefinition(this.getFacade(), {
          capabilityId: this.capabilityId,
        }),
      ],
      renderIntentCompilers: [this.createRenderIntentCompiler()],
    };
  }

  private getFacade(): ClipCapabilityApi {
    return {
      refresh: () => this.refresh(),
    };
  }

  private createRenderIntentCompiler(): RenderIntentCompilerContribution<
    EditorEffect<ClipEffectPayload>,
    EditorDocument
  > {
    return {
      capabilityId: this.capabilityId,
      effectType: "clip",
      compile: (context) => this.compileDocumentClipEffect(context),
    };
  }

  private compileDocumentClipEffect(
    context: RenderIntentCompilerContext<
      EditorEffect<ClipEffectPayload>,
      EditorDocument
    >,
  ): RenderIntentPatch | void {
    if (context.target.kind !== "object" || !context.target.objectId) {
      console.warn("[ClipCapability] Ignoring non-object clip effect.", {
        target: context.target,
      });
      return;
    }

    const clip = normalizeClipEffectPayload(context.effect.payload);
    if (!clip.enabled || !context.target.layerId) return;
    const source = this.buildSourceSpec(
      {
        id: context.target.objectId,
        layerId: context.target.layerId,
        type: "rect",
        order: 0,
        visible: true,
        data: {},
      } as SceneElement,
      clip.source,
    );
    if (!source) return;
    return {
      id: context.target.objectId,
      clipping: {
        enabled: true,
        effects: [
          {
            type: "clipPath",
            id: `clip.${context.target.objectId}`,
            source,
            targetLayerIds: [context.target.layerId],
            targetSubjectIds: [context.target.objectId],
          },
        ],
      },
      data: {
        [CLIP_METADATA_KEY]: clip,
      },
    };
  }

  private refresh() {
    if (!this.renderIntentService) return;
    const effects = this.buildClipEffects();
    if (!effects.length) {
      clearRenderIntentSource(this.renderIntentService, this.id);
      return;
    }
    this.renderIntentService.patchIntent(this.id, {
      id: `${this.id}.effects`,
      subject: {
        kind: "layer",
        surfaceId: "legacy",
        layerId: `${this.id}.effects`,
      },
      ordering: {
        layerId: `${this.id}.effects`,
        stack: 0,
        layerOrder: 0,
      },
      clipping: { enabled: true, effects },
    });
  }

  private buildClipEffects(): RenderEffectSpec[] {
    if (!this.sceneService) return [];

    return this.sceneService
      .selectElements()
      .map((element) => this.buildClipEffectForElement(element))
      .filter((effect): effect is RenderEffectSpec => Boolean(effect));
  }

  private buildClipEffectForElement(
    element: SceneElement,
  ): RenderEffectSpec | null {
    const clip = readClipMetadata(element);
    if (!clip?.enabled) return null;

    const target = this.targetResolver.resolve(element);
    if (!target) return null;

    const source = this.buildSourceSpec(element, clip.source);
    if (!source) return null;

    return {
      type: "clipPath",
      id: `clip.${element.id}`,
      source,
      targetLayerIds: target.targetLayerIds,
      targetSubjectIds: target.targetSubjectIds,
    };
  }

  private buildSourceSpec(
    element: SceneElement,
    source: ClipSource,
  ): RenderObjectSpec | null {
    if (source.type === "path") {
      const pathData = String(source.pathData || "").trim();
      if (!pathData) return null;
      return {
        id: `clip.${element.id}.path-source`,
        type: "path",
        space: source.space ?? "scene",
        data: {
          id: `clip.${element.id}.path-source`,
          type: "clip-effect",
          effect: "clipPath",
        },
        props: {
          pathData,
          fill: "#000000",
          stroke: null,
          originX: "left",
          originY: "top",
          selectable: false,
          evented: false,
          excludeFromExport: true,
        },
      };
    }

    if (source.type === "image") {
      const src = String(source.src || "").trim();
      if (!src) return null;
      return {
        id: `clip.${element.id}.image-source`,
        type: "image",
        src,
        space: source.space ?? "scene",
        data: {
          id: `clip.${element.id}.image-source`,
          type: "clip-effect",
          effect: "clipPath",
        },
        props: {
          ...(source.props || {}),
          originX: "left",
          originY: "top",
          selectable: false,
          evented: false,
          excludeFromExport: true,
        },
      };
    }

    return this.buildDielineSourceSpec(element, source);
  }

  private buildDielineSourceSpec(
    element: SceneElement,
    source: Extract<ClipSource, { type: "dieline" }>,
  ): RenderObjectSpec | null {
    if (!this.canvasService || !this.configService) return null;

    const sceneLayout = computeSceneLayout(
      this.canvasService,
      readSizeState(this.configService),
    );
    if (!sceneLayout) return null;

    return buildDielineClipSourceSpec({
      state: readDielineState(
        this.configService,
        undefined,
        source.configNamespace,
      ),
      sceneLayout,
      canvasWidth:
        sceneLayout.canvasWidth ||
        this.canvasService.getViewportSize().width ||
        800,
      canvasHeight:
        sceneLayout.canvasHeight ||
        this.canvasService.getViewportSize().height ||
        600,
      id: `clip.${element.id}.dieline-source`,
    });
  }
}

function readClipMetadata(element: SceneElement): ClipEffectMetadata | null {
  const data = isRecord(element.data) ? element.data : {};
  const raw = data[CLIP_METADATA_KEY];
  return isRecord(raw) ? normalizeClipEffectPayload(raw) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
