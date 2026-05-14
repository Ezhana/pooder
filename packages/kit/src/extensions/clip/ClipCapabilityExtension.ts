import {
  CANVAS_SERVICE,
  CONFIGURATION_SERVICE,
  SCENE_SERVICE,
  type CanvasService,
  type ConfigurationService,
  type EffectApplicationContext,
  type EffectApplicatorContribution,
  type ExtensionContext,
  type ExtensionContributions,
  type ExtensionDefinition,
  type RenderEffectSpec,
  type RenderObjectSpec,
  type SceneElement,
  type SceneService,
} from "@pooder/core";
import type { EditorDocument, EditorEffect } from "@pooder/document/kit";
import {
  computeSceneLayout,
  readSizeState,
} from "../../shared/scene/scene-layout-model";
import {
  buildDielineClipSourceSpec,
} from "../dieline/renderBuilder";
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

const CLIP_METADATA_KEY = "clip";

export class ClipCapabilityExtension implements ExtensionDefinition {
  id: string;
  metadata = { name: "ClipCapability" };
  activation = {
    requiresServices: [CANVAS_SERVICE, SCENE_SERVICE, CONFIGURATION_SERVICE],
  };

  private canvasService?: CanvasService;
  private sceneService?: SceneService;
  private configService?: ConfigurationService;
  private readonly capabilityId: string;
  private readonly targetResolver = new ClipTargetResolver();
  private renderProducerDisposable?: { dispose(): void };
  private sceneSubscription?: { dispose(): void };
  private configSubscription?: { dispose(): void };

  constructor(options: ClipCapabilityOptions = {}) {
    this.capabilityId = options.capabilityId || CLIP_CAPABILITY_ID;
    this.id = this.capabilityId;
  }

  activate(context: ExtensionContext) {
    this.canvasService = context.services.getOrThrow<CanvasService>(
      CANVAS_SERVICE,
    );
    this.sceneService = context.services.getOrThrow<SceneService>(SCENE_SERVICE);
    this.configService = context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );

    this.renderProducerDisposable?.dispose();
    this.renderProducerDisposable = this.canvasService.registerRenderProducer(
      this.id,
      () => ({
        passes: [
          {
            id: `${this.id}.effects`,
            targetLayerId: `${this.id}.effects`,
            replace: true,
            objects: [],
            effects: this.buildClipEffects(),
          },
        ],
      }),
      { priority: 275 },
    );

    this.sceneSubscription?.dispose();
    this.sceneSubscription = this.sceneService.onDidChange(() => this.refresh());
    this.configSubscription?.dispose();
    this.configSubscription = this.configService.onAnyChange(() => this.refresh());
    this.refresh();
  }

  deactivate() {
    this.renderProducerDisposable?.dispose();
    this.sceneSubscription?.dispose();
    this.configSubscription?.dispose();
    this.renderProducerDisposable = undefined;
    this.sceneSubscription = undefined;
    this.configSubscription = undefined;
    if (this.canvasService) {
      void this.canvasService.flushRenderFromProducers();
    }
    this.canvasService = undefined;
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
      effectApplicators: [this.createEffectApplicator()],
    };
  }

  private getFacade(): ClipCapabilityApi {
    return {
      refresh: () => this.refresh(),
    };
  }

  private createEffectApplicator(): EffectApplicatorContribution<
    EditorEffect<ClipEffectPayload>,
    EditorDocument
  > {
    return {
      capabilityId: this.capabilityId,
      effectType: "clip",
      apply: (context) => this.applyDocumentClipEffect(context),
    };
  }

  private applyDocumentClipEffect(
    context: EffectApplicationContext<
      EditorEffect<ClipEffectPayload>,
      EditorDocument
    >,
  ) {
    if (context.target.kind !== "object" || !context.target.objectId) {
      console.warn("[ClipCapability] Ignoring non-object clip effect.", {
        target: context.target,
      });
      return;
    }

    const sceneService = context.services.get<SceneService>(SCENE_SERVICE);
    const element = sceneService?.getElement(context.target.objectId);
    if (!sceneService || !element) return;

    const data = isRecord(element.data) ? element.data : {};
    sceneService.updateElement(element.id, {
      data: {
        ...data,
        [CLIP_METADATA_KEY]: normalizeClipEffectPayload(context.effect.payload),
      },
    });
    this.refresh();
  }

  private refresh() {
    if (!this.canvasService) return;
    void this.canvasService.flushRenderFromProducers();
  }

  private buildClipEffects(): RenderEffectSpec[] {
    if (!this.sceneService) return [];

    return this.sceneService
      .listElements()
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
      targetPassIds: target.targetPassIds,
      targetElementIds: target.targetElementIds,
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
