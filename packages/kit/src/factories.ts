import { BackgroundTool } from "./extensions/background";
import { DesignExportExtension } from "./extensions/design-export";
import { DielineWorkflowExtension } from "./extensions/dieline-workflow";
import { DielineTool } from "./extensions/dieline";
import { FeatureTool } from "./extensions/feature";
import { ImageTool } from "./extensions/image";
import { RulerTool } from "./extensions/ruler";
import { SizeTool } from "./extensions/size";
import { TemplateOverlayTool } from "./extensions/template-overlay";
import { WhiteInkTool } from "./extensions/white-ink";

export const createBackgroundExtension = (
  options?: ConstructorParameters<typeof BackgroundTool>[0],
) => new BackgroundTool(options);

export const createDesignExportExtension = () => new DesignExportExtension();

export const createDielineExtension = (
  options?: ConstructorParameters<typeof DielineTool>[0],
) => new DielineTool(options);

export const createDielineWorkflowExtension = () =>
  new DielineWorkflowExtension();

export const createFeatureExtension = (
  options?: ConstructorParameters<typeof FeatureTool>[0],
) => new FeatureTool(options);

export const createImageExtension = () => new ImageTool();

export const createRulerExtension = (
  options?: ConstructorParameters<typeof RulerTool>[0],
) => new RulerTool(options);

export const createSizeExtension = () => new SizeTool();

export const createTemplateOverlayExtension = () => new TemplateOverlayTool();

export const createWhiteInkExtension = () => new WhiteInkTool();
