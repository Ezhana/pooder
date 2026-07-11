import {
  CANVAS_SERVICE,
  CONFIGURATION_SERVICE,
  RENDER_INTENT_SERVICE,
  SCENE_LAYOUT_SERVICE,
  SCENE_SERVICE,
  SURFACE_FRAME_SERVICE,
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
  type SceneLayoutService,
  type SceneService,
  type SurfaceFrameService,
} from "@pooder/core";
import type { EditorDocument, EditorEffect } from "@pooder/document";
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
  private sceneLayoutService?: SceneLayoutService;
  private surfaceFrameService?: SurfaceFrameService;
  private readonly capabilityId: string;
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
    this.sceneLayoutService = context.services.get<SceneLayoutService>(
      SCENE_LAYOUT_SERVICE,
    );
    this.surfaceFrameService = context.services.get<SurfaceFrameService>(
      SURFACE_FRAME_SERVICE,
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
    this.sceneLayoutService = undefined;
    this.surfaceFrameService = undefined;
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
    if (
      (context.target.kind !== "object" || !context.target.objectId) &&
      (context.target.kind !== "layer" || !context.target.layerId)
    ) {
      console.warn("[ClipCapability] Ignoring non-object clip effect.", {
        target: context.target,
      });
      return;
    }

    const clip = normalizeClipEffectPayload(context.effect.payload);
    if (!clip.enabled || !context.target.layerId) return;
    const targetId =
      context.target.objectId || context.target.layerId || context.target.surfaceId;
    const source = this.buildSourceSpec(
      {
        id: targetId,
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
      id: targetId,
      subject:
        context.target.kind === "layer"
          ? {
              kind: "layer",
              surfaceId: context.target.surfaceId,
              layerId: context.target.layerId,
            }
          : undefined,
      ordering:
        context.target.kind === "layer"
          ? { layerId: context.target.layerId }
          : undefined,
      effects: [
        {
          type: "clipPath",
          id: `clip.${targetId}`,
          source,
          coordinateMode: "absolute",
        },
      ],
      data: {
        [CLIP_METADATA_KEY]: clip,
      },
    };
  }

  private refresh() {
    clearRenderIntentSource(this.renderIntentService, this.id);
    if (!this.sceneService) return;
    this.sceneService.selectElements().forEach((element) => {
      const effect = this.buildClipEffectForElement(element);
      const effects = (element.effects ?? []).filter(
        (item) => item.id !== `clip.${element.id}`,
      );
      if (effect) effects.push(effect);
      if (JSON.stringify(effects) === JSON.stringify(element.effects ?? [])) {
        return;
      }
      this.sceneService?.updateElement(element.id, {
        effects: effects.length ? effects : undefined,
      });
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

    const source = this.buildSourceSpec(element, clip.source);
    if (!source) return null;

    return {
      type: "clipPath",
      id: `clip.${element.id}`,
      source,
      coordinateMode: "absolute",
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

    const sceneLayout = this.sceneLayoutService?.getLayout();
    if (!sceneLayout) return null;
    const viewportSize = this.canvasService.getViewportSize();

    return buildDielineClipSourceSpec({
      state: readDielineState(
        this.configService,
        undefined,
        source.configNamespace,
        this.surfaceFrameService?.getFrames(),
      ),
      sceneLayout,
      canvasWidth: viewportSize.width || 800,
      canvasHeight: viewportSize.height || 600,
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
