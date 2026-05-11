import {
  CONFIGURATION_SERVICE,
  ExtensionContributions,
  ExtensionDefinition,
  ConfigurationService,
  ExtensionContext,
} from "@pooder/core";
import { CANVAS_SERVICE, CanvasService } from "@pooder/platform-browser";
import {
  fromMm,
  normalizeConstraintMode,
  normalizeCutMode,
  normalizeUnit,
  readSizeState,
  sanitizeMmValue,
  toMm,
  type SizeConstraintMode,
  computeSceneLayout,
} from "@pooder/platform-browser";
import type { Unit } from "../../coordinate";
import { IMAGE_OBJECT_LAYER_ID } from "../../shared/constants/layers";
import {
  createSizeCapabilityDefinition,
  SIZE_CAPABILITY_ID,
  type SizeCapabilityApi,
  type SizeCapabilityOptions,
  type UpdateSizeDimensionsInput,
} from "./capability";

export type ChangedSizeField = "width" | "height" | "both";

export interface SizeViewState {
  unit: Unit;
  actualWidthMm: number;
  actualHeightMm: number;
  constraintMode: SizeConstraintMode;
  aspectRatio: number;
  cutMode: string;
  cutMarginMm: number;
  viewPadding: number | string;
  minMm: number;
  maxMm: number;
  stepMm: number;
  actualWidth: number;
  actualHeight: number;
}

export interface SizeToolOptions extends SizeCapabilityOptions {
  id?: string;
  contributeTool?: boolean;
  contributeCommands?: boolean;
  contributeConfigurations?: boolean;
  toolName?: string;
}

/**
 * @deprecated Compatibility wrapper for SizeCapability. Use
 * createSizeCapability().
 */
export class SizeTool implements ExtensionDefinition {
  id: string;
  metadata = {
    name: "SizeTool",
  };
  activation = {
    requiresServices: [CANVAS_SERVICE, CONFIGURATION_SERVICE],
  };

  private context?: ExtensionContext;
  private canvasService?: CanvasService;
  private readonly capabilityId: string;
  private readonly contributeLegacyCommands: boolean;
  private readonly contributeConfigDefinitions: boolean;

  constructor(options: SizeToolOptions = {}) {
    this.id =
      String(options.id || "pooder.kit.size").trim() || "pooder.kit.size";
    this.capabilityId = options.capabilityId || SIZE_CAPABILITY_ID;
    this.contributeLegacyCommands = options.contributeCommands !== false;
    this.contributeConfigDefinitions =
      options.contributeConfigurations !== false;
  }

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService =
      context.services.getOrThrow<CanvasService>(CANVAS_SERVICE);
    const configService = context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    this.ensureDefaults(configService);
    this.emitStateChanged();
  }

  deactivate(_context: ExtensionContext) {
    this.context = undefined;
    this.canvasService = undefined;
  }

  contribute(): ExtensionContributions {
    const contributions: ExtensionContributions = {
      capabilities: [
        createSizeCapabilityDefinition(this.getSizeFacade(), {
          capabilityId: this.capabilityId,
        }),
      ],
    };

    if (this.contributeConfigDefinitions) {
      contributions.configurations = [
        {
          id: "size.unit",
          type: "select",
          label: "Display Unit",
          options: ["mm", "cm", "in"],
          default: "mm",
        },
        {
          id: "size.actualWidthMm",
          type: "number",
          label: "Actual Width (mm)",
          min: 10,
          max: 2000,
          step: 0.1,
          default: 500,
        },
        {
          id: "size.actualHeightMm",
          type: "number",
          label: "Actual Height (mm)",
          min: 10,
          max: 2000,
          step: 0.1,
          default: 500,
        },
        {
          id: "size.constraintMode",
          type: "select",
          label: "Constraint Mode",
          options: ["free", "lockAspect", "equal"],
          default: "free",
        },
        {
          id: "size.aspectRatio",
          type: "number",
          label: "Aspect Ratio",
          min: 0.01,
          max: 100,
          step: 0.01,
          default: 1,
        },
        {
          id: "size.cutMode",
          type: "select",
          label: "Cut Mode",
          options: ["trim", "outset", "inset"],
          default: "trim",
        },
        {
          id: "size.cutMarginMm",
          type: "number",
          label: "Cut Margin (mm)",
          min: 0,
          max: 100,
          step: 0.1,
          default: 0,
        },
        {
          id: "size.viewPadding",
          type: "select",
          label: "View Padding",
          options: [0, 10, 20, 40, 60, 100, "2%", "5%", "10%", "15%", "20%"],
          default: "10%",
        },
        {
          id: "size.minMm",
          type: "number",
          label: "Min Size (mm)",
          min: 0.1,
          max: 2000,
          step: 0.1,
          default: 10,
        },
        {
          id: "size.maxMm",
          type: "number",
          label: "Max Size (mm)",
          min: 1,
          max: 10000,
          step: 1,
          default: 2000,
        },
        {
          id: "size.stepMm",
          type: "number",
          label: "Size Step (mm)",
          min: 0.001,
          max: 100,
          step: 0.001,
          default: 0.1,
        },
      ];
    }

    if (this.contributeLegacyCommands) {
      contributions.commands = [
        {
          id: "getSizeState",
          command: "getSizeState",
          title: "Get Size State",
          handler: () => this.getStateForUI(),
        },
        {
          id: "updateSizeDimensions",
          command: "updateSizeDimensions",
          title: "Update Size Dimensions",
          handler: (input: UpdateSizeDimensionsInput = {}) =>
            this.updateDimensions(input),
        },
        {
          id: "setSizeConstraintMode",
          command: "setSizeConstraintMode",
          title: "Set Size Constraint Mode",
          handler: (mode: SizeConstraintMode) => this.setConstraintMode(mode),
        },
        {
          id: "setSizeDisplayUnit",
          command: "setSizeDisplayUnit",
          title: "Set Size Display Unit",
          handler: (unit: Unit) => this.setUnit(unit),
        },
        {
          id: "setSizeCut",
          command: "setSizeCut",
          title: "Set Size Cut",
          handler: (cutMode: string, cutMarginMm: number = 0) =>
            this.setCut(cutMode, cutMarginMm),
        },
        {
          id: "getSelectedImageSize",
          command: "getSelectedImageSize",
          title: "Get Selected Image Size",
          handler: (id?: string) => this.getSelectedImageSize(id),
        },
      ];
    }

    return contributions;
  }

  private getSizeFacade(): SizeCapabilityApi {
    return {
      getSelectedImageSize: (id) => this.getSelectedImageSize(id),
      getState: () => this.getStateForUI(),
      setConstraintMode: (mode) => this.setConstraintMode(mode),
      setCut: (cutMode, cutMarginMm) => this.setCut(cutMode, cutMarginMm),
      setUnit: (unit) => this.setUnit(unit),
      updateDimensions: (input = {}) => this.updateDimensions(input),
    };
  }

  private getConfigService(): ConfigurationService | undefined {
    return this.context?.services.get<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
  }

  private ensureDefaults(configService: ConfigurationService) {
    const state = readSizeState(configService);
    configService.update("size.unit", state.unit);
    configService.update("size.actualWidthMm", state.actualWidthMm);
    configService.update("size.actualHeightMm", state.actualHeightMm);
    configService.update("size.constraintMode", state.constraintMode);
    configService.update(
      "size.aspectRatio",
      state.actualWidthMm / Math.max(0.001, state.actualHeightMm),
    );
    configService.update("size.cutMode", state.cutMode);
    configService.update("size.cutMarginMm", state.cutMarginMm);
    configService.update("size.viewPadding", state.viewPadding);
    configService.update("size.minMm", state.minMm);
    configService.update("size.maxMm", state.maxMm);
    configService.update("size.stepMm", state.stepMm);
  }

  private emitStateChanged() {
    const state = this.getStateForUI();
    if (!state) return;
    this.context?.eventBus.emit("size:state:changed", state);
  }

  private getStateForUI(): SizeViewState | null {
    const configService = this.getConfigService();
    if (!configService) return null;
    const state = readSizeState(configService);
    return {
      ...state,
      actualWidth: fromMm(state.actualWidthMm, state.unit),
      actualHeight: fromMm(state.actualHeightMm, state.unit),
    };
  }

  private updateDimensions(input: UpdateSizeDimensionsInput) {
    const configService = this.getConfigService();
    if (!configService) return null;

    const state = readSizeState(configService);
    const inputUnit = normalizeUnit(input.unit ?? state.unit);
    const changed: ChangedSizeField = input.changed || "both";

    const providedWidthMm = Number.isFinite(input.width as any)
      ? toMm(Number(input.width), inputUnit)
      : undefined;
    const providedHeightMm = Number.isFinite(input.height as any)
      ? toMm(Number(input.height), inputUnit)
      : undefined;

    const limits = {
      minMm: state.minMm,
      maxMm: state.maxMm,
      stepMm: state.stepMm,
    };

    let nextWidthMm =
      providedWidthMm !== undefined ? providedWidthMm : state.actualWidthMm;
    let nextHeightMm =
      providedHeightMm !== undefined ? providedHeightMm : state.actualHeightMm;

    if (state.constraintMode === "equal") {
      const anchor =
        changed === "height"
          ? nextHeightMm
          : changed === "width"
            ? nextWidthMm
            : (providedWidthMm ?? providedHeightMm ?? nextWidthMm);
      nextWidthMm = anchor;
      nextHeightMm = anchor;
    } else if (state.constraintMode === "lockAspect") {
      const ratio = Math.max(0.0001, state.aspectRatio);
      if (changed === "height") {
        nextWidthMm = nextHeightMm * ratio;
      } else {
        nextHeightMm = nextWidthMm / ratio;
      }
    }

    nextWidthMm = sanitizeMmValue(nextWidthMm, limits);
    nextHeightMm = sanitizeMmValue(nextHeightMm, limits);

    if (state.constraintMode === "equal") {
      const value = Math.max(nextWidthMm, nextHeightMm);
      nextWidthMm = value;
      nextHeightMm = value;
    } else if (state.constraintMode === "lockAspect") {
      const ratio = Math.max(0.0001, state.aspectRatio);
      if (changed === "height") {
        nextWidthMm = sanitizeMmValue(nextHeightMm * ratio, limits);
      } else {
        nextHeightMm = sanitizeMmValue(nextWidthMm / ratio, limits);
      }
    }

    configService.update("size.actualWidthMm", nextWidthMm);
    configService.update("size.actualHeightMm", nextHeightMm);
    configService.update("size.unit", inputUnit);
    this.emitStateChanged();
    return this.getStateForUI();
  }

  private setConstraintMode(modeRaw: string) {
    const configService = this.getConfigService();
    if (!configService) return null;
    const state = readSizeState(configService);
    const mode = normalizeConstraintMode(modeRaw);

    configService.update("size.constraintMode", mode);
    if (mode === "lockAspect") {
      const ratio = state.actualWidthMm / Math.max(0.001, state.actualHeightMm);
      configService.update("size.aspectRatio", ratio);
    }
    if (mode === "equal") {
      const value = sanitizeMmValue(
        Math.max(state.actualWidthMm, state.actualHeightMm),
        {
          minMm: state.minMm,
          maxMm: state.maxMm,
          stepMm: state.stepMm,
        },
      );
      configService.update("size.actualWidthMm", value);
      configService.update("size.actualHeightMm", value);
      configService.update("size.aspectRatio", 1);
    }
    this.emitStateChanged();
    return this.getStateForUI();
  }

  private setUnit(unitRaw: string) {
    const configService = this.getConfigService();
    if (!configService) return null;
    const unit = normalizeUnit(unitRaw);
    configService.update("size.unit", unit);
    this.emitStateChanged();
    return this.getStateForUI();
  }

  private setCut(cutModeRaw: string, cutMarginMm = 0) {
    const configService = this.getConfigService();
    if (!configService) return null;
    const cutMode = normalizeCutMode(cutModeRaw);
    const margin = Math.max(0, Number(cutMarginMm) || 0);
    configService.update("size.cutMode", cutMode);
    configService.update("size.cutMarginMm", margin);
    this.emitStateChanged();
    return this.getStateForUI();
  }

  private getSelectedImageSize(id?: string) {
    const configService = this.getConfigService();
    if (!configService || !this.canvasService) return null;
    const sizeState = readSizeState(configService);
    const layout = computeSceneLayout(this.canvasService, sizeState);
    if (!layout || layout.scale <= 0) return null;

    const all = this.canvasService.canvas.getObjects() as any[];
    const active = this.canvasService.canvas.getActiveObject() as any;
    const activeId =
      active?.data?.layerId === IMAGE_OBJECT_LAYER_ID ? active?.data?.id : null;
    const targetId = id || activeId;
    const target =
      all.find(
        (obj) =>
          obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID &&
          obj?.data?.id === targetId,
      ) || all.find((obj) => obj?.data?.layerId === IMAGE_OBJECT_LAYER_ID);
    if (!target) return null;

    const objectWidthPx = Math.abs((target.width || 0) * (target.scaleX || 1));
    const objectHeightPx = Math.abs(
      (target.height || 0) * (target.scaleY || 1),
    );
    if (objectWidthPx <= 0 || objectHeightPx <= 0) return null;

    const widthMm = objectWidthPx / layout.scale;
    const heightMm = objectHeightPx / layout.scale;

    return {
      id: target?.data?.id || null,
      widthMm,
      heightMm,
      width: fromMm(widthMm, sizeState.unit),
      height: fromMm(heightMm, sizeState.unit),
      unit: sizeState.unit,
    };
  }
}
