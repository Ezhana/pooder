"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SizeTool = void 0;
const core_1 = require("@pooder/core");
const sceneLayoutModel_1 = require("./sceneLayoutModel");
class SizeTool {
    constructor() {
        this.id = "pooder.kit.size";
        this.metadata = {
            name: "SizeTool",
        };
    }
    activate(context) {
        this.context = context;
        this.canvasService = context.services.get("CanvasService");
        const configService = context.services.get("ConfigurationService");
        if (!configService)
            return;
        this.ensureDefaults(configService);
        this.emitStateChanged();
    }
    deactivate(_context) {
        this.context = undefined;
        this.canvasService = undefined;
    }
    contribute() {
        return {
            [core_1.ContributionPointIds.TOOLS]: [
                {
                    id: this.id,
                    name: "Size",
                    interaction: "instant",
                },
            ],
            [core_1.ContributionPointIds.CONFIGURATIONS]: [
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
                    default: 140,
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
            ],
            [core_1.ContributionPointIds.COMMANDS]: [
                {
                    command: "getSizeState",
                    title: "Get Size State",
                    handler: () => this.getStateForUI(),
                },
                {
                    command: "updateSizeDimensions",
                    title: "Update Size Dimensions",
                    handler: (input = {}) => this.updateDimensions(input),
                },
                {
                    command: "setSizeConstraintMode",
                    title: "Set Size Constraint Mode",
                    handler: (mode) => this.setConstraintMode(mode),
                },
                {
                    command: "setSizeDisplayUnit",
                    title: "Set Size Display Unit",
                    handler: (unit) => this.setUnit(unit),
                },
                {
                    command: "setSizeCut",
                    title: "Set Size Cut",
                    handler: (cutMode, cutMarginMm = 0) => this.setCut(cutMode, cutMarginMm),
                },
                {
                    command: "getSelectedImageSize",
                    title: "Get Selected Image Size",
                    handler: (id) => this.getSelectedImageSize(id),
                },
            ],
        };
    }
    getConfigService() {
        return this.context?.services.get("ConfigurationService");
    }
    ensureDefaults(configService) {
        const state = (0, sceneLayoutModel_1.readSizeState)(configService);
        configService.update("size.unit", state.unit);
        configService.update("size.actualWidthMm", state.actualWidthMm);
        configService.update("size.actualHeightMm", state.actualHeightMm);
        configService.update("size.constraintMode", state.constraintMode);
        configService.update("size.aspectRatio", state.actualWidthMm / Math.max(0.001, state.actualHeightMm));
        configService.update("size.cutMode", state.cutMode);
        configService.update("size.cutMarginMm", state.cutMarginMm);
        configService.update("size.viewPadding", state.viewPadding);
        configService.update("size.minMm", state.minMm);
        configService.update("size.maxMm", state.maxMm);
        configService.update("size.stepMm", state.stepMm);
    }
    emitStateChanged() {
        const state = this.getStateForUI();
        if (!state)
            return;
        this.context?.eventBus.emit("size:state:changed", state);
    }
    getStateForUI() {
        const configService = this.getConfigService();
        if (!configService)
            return null;
        const state = (0, sceneLayoutModel_1.readSizeState)(configService);
        return {
            ...state,
            actualWidth: (0, sceneLayoutModel_1.fromMm)(state.actualWidthMm, state.unit),
            actualHeight: (0, sceneLayoutModel_1.fromMm)(state.actualHeightMm, state.unit),
        };
    }
    updateDimensions(input) {
        const configService = this.getConfigService();
        if (!configService)
            return null;
        const state = (0, sceneLayoutModel_1.readSizeState)(configService);
        const inputUnit = (0, sceneLayoutModel_1.normalizeUnit)(input.unit ?? state.unit);
        const changed = input.changed || "both";
        const providedWidthMm = Number.isFinite(input.width)
            ? (0, sceneLayoutModel_1.toMm)(Number(input.width), inputUnit)
            : undefined;
        const providedHeightMm = Number.isFinite(input.height)
            ? (0, sceneLayoutModel_1.toMm)(Number(input.height), inputUnit)
            : undefined;
        const limits = {
            minMm: state.minMm,
            maxMm: state.maxMm,
            stepMm: state.stepMm,
        };
        let nextWidthMm = providedWidthMm !== undefined ? providedWidthMm : state.actualWidthMm;
        let nextHeightMm = providedHeightMm !== undefined ? providedHeightMm : state.actualHeightMm;
        if (state.constraintMode === "equal") {
            const anchor = changed === "height"
                ? nextHeightMm
                : changed === "width"
                    ? nextWidthMm
                    : (providedWidthMm ?? providedHeightMm ?? nextWidthMm);
            nextWidthMm = anchor;
            nextHeightMm = anchor;
        }
        else if (state.constraintMode === "lockAspect") {
            const ratio = Math.max(0.0001, state.aspectRatio);
            if (changed === "height") {
                nextWidthMm = nextHeightMm * ratio;
            }
            else {
                nextHeightMm = nextWidthMm / ratio;
            }
        }
        nextWidthMm = (0, sceneLayoutModel_1.sanitizeMmValue)(nextWidthMm, limits);
        nextHeightMm = (0, sceneLayoutModel_1.sanitizeMmValue)(nextHeightMm, limits);
        if (state.constraintMode === "equal") {
            const value = Math.max(nextWidthMm, nextHeightMm);
            nextWidthMm = value;
            nextHeightMm = value;
        }
        else if (state.constraintMode === "lockAspect") {
            const ratio = Math.max(0.0001, state.aspectRatio);
            if (changed === "height") {
                nextWidthMm = (0, sceneLayoutModel_1.sanitizeMmValue)(nextHeightMm * ratio, limits);
            }
            else {
                nextHeightMm = (0, sceneLayoutModel_1.sanitizeMmValue)(nextWidthMm / ratio, limits);
            }
        }
        configService.update("size.actualWidthMm", nextWidthMm);
        configService.update("size.actualHeightMm", nextHeightMm);
        configService.update("size.unit", inputUnit);
        this.emitStateChanged();
        return this.getStateForUI();
    }
    setConstraintMode(modeRaw) {
        const configService = this.getConfigService();
        if (!configService)
            return null;
        const state = (0, sceneLayoutModel_1.readSizeState)(configService);
        const mode = (0, sceneLayoutModel_1.normalizeConstraintMode)(modeRaw);
        configService.update("size.constraintMode", mode);
        if (mode === "lockAspect") {
            const ratio = state.actualWidthMm / Math.max(0.001, state.actualHeightMm);
            configService.update("size.aspectRatio", ratio);
        }
        if (mode === "equal") {
            const value = (0, sceneLayoutModel_1.sanitizeMmValue)(Math.max(state.actualWidthMm, state.actualHeightMm), {
                minMm: state.minMm,
                maxMm: state.maxMm,
                stepMm: state.stepMm,
            });
            configService.update("size.actualWidthMm", value);
            configService.update("size.actualHeightMm", value);
            configService.update("size.aspectRatio", 1);
        }
        this.emitStateChanged();
        return this.getStateForUI();
    }
    setUnit(unitRaw) {
        const configService = this.getConfigService();
        if (!configService)
            return null;
        const unit = (0, sceneLayoutModel_1.normalizeUnit)(unitRaw);
        configService.update("size.unit", unit);
        this.emitStateChanged();
        return this.getStateForUI();
    }
    setCut(cutModeRaw, cutMarginMm = 0) {
        const configService = this.getConfigService();
        if (!configService)
            return null;
        const cutMode = (0, sceneLayoutModel_1.normalizeCutMode)(cutModeRaw);
        const margin = Math.max(0, Number(cutMarginMm) || 0);
        configService.update("size.cutMode", cutMode);
        configService.update("size.cutMarginMm", margin);
        this.emitStateChanged();
        return this.getStateForUI();
    }
    getSelectedImageSize(id) {
        const configService = this.getConfigService();
        if (!configService || !this.canvasService)
            return null;
        const sizeState = (0, sceneLayoutModel_1.readSizeState)(configService);
        const layout = (0, sceneLayoutModel_1.computeSceneLayout)(this.canvasService, sizeState);
        if (!layout || layout.scale <= 0)
            return null;
        const all = this.canvasService.canvas.getObjects();
        const active = this.canvasService.canvas.getActiveObject();
        const activeId = active?.data?.layerId === "image.user" ? active?.data?.id : null;
        const targetId = id || activeId;
        const target = all.find((obj) => obj?.data?.layerId === "image.user" && obj?.data?.id === targetId) || all.find((obj) => obj?.data?.layerId === "image.user");
        if (!target)
            return null;
        const objectWidthPx = Math.abs((target.width || 0) * (target.scaleX || 1));
        const objectHeightPx = Math.abs((target.height || 0) * (target.scaleY || 1));
        if (objectWidthPx <= 0 || objectHeightPx <= 0)
            return null;
        const widthMm = objectWidthPx / layout.scale;
        const heightMm = objectHeightPx / layout.scale;
        return {
            id: target?.data?.id || null,
            widthMm,
            heightMm,
            width: (0, sceneLayoutModel_1.fromMm)(widthMm, sizeState.unit),
            height: (0, sceneLayoutModel_1.fromMm)(heightMm, sizeState.unit),
            unit: sizeState.unit,
        };
    }
}
exports.SizeTool = SizeTool;
