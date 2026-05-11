import {
  BackgroundCapabilityExtension,
  BackgroundTool,
} from "./extensions/background";
import {
  DesignExportCapabilityExtension,
  DesignExportExtension,
} from "./extensions/design-export";
import { DielineWorkflowExtension } from "./extensions/dieline-workflow";
import {
  DielineGeometryCapabilityExtension,
  DielineTool,
} from "./extensions/dieline";
import { EdgeDetectionCapabilityExtension } from "./extensions/edge-detection";
import {
  FeatureCapabilityExtension,
  FeatureTool,
} from "./extensions/feature";
import {
  ImagePlacementCapabilityExtension,
  ImageTool,
} from "./extensions/image";
import { RulerCapabilityExtension, RulerTool } from "./extensions/ruler";
import { SizeCapabilityExtension, SizeTool } from "./extensions/size";
import {
  TemplateOverlayCapabilityExtension,
  TemplateOverlayTool,
} from "./extensions/template-overlay";
import {
  WhiteInkCapabilityExtension,
  WhiteInkTool,
} from "./extensions/white-ink";

export const createBackgroundExtension = (
  options?: ConstructorParameters<typeof BackgroundTool>[0],
) => new BackgroundTool(options);

export const createBackgroundCapability = (
  options?: ConstructorParameters<typeof BackgroundCapabilityExtension>[0],
) => new BackgroundCapabilityExtension(options);

export const createDesignExportExtension = (
  options?: ConstructorParameters<typeof DesignExportExtension>[0],
) => new DesignExportExtension(options);

export const createDesignExportCapability = (
  options?: ConstructorParameters<typeof DesignExportCapabilityExtension>[0],
) => new DesignExportCapabilityExtension(options);

/**
 * @deprecated Registers the legacy DielineTool compatibility tool. Use
 * createDielineGeometryCapability().
 */
export const createDielineExtension = (
  options?: ConstructorParameters<typeof DielineTool>[0],
) => new DielineTool(options);

/**
 * Compatibility factory for legacy command-based dieline workflows.
 * Prefer app-owned orchestration with typed kit capability facades.
 */
export const createDielineWorkflowExtension = () =>
  new DielineWorkflowExtension();

export const createEdgeDetectionCapability = (
  options?: ConstructorParameters<typeof EdgeDetectionCapabilityExtension>[0],
) => new EdgeDetectionCapabilityExtension(options);

export const createDielineGeometryCapability = (
  options?: ConstructorParameters<typeof DielineGeometryCapabilityExtension>[0],
) => new DielineGeometryCapabilityExtension(options);

/**
 * @deprecated Registers the legacy FeatureTool compatibility tool. Use
 * createFeatureCapability().
 */
export const createFeatureExtension = (
  options?: ConstructorParameters<typeof FeatureTool>[0],
) => new FeatureTool(options);

export const createFeatureCapability = (
  options?: ConstructorParameters<typeof FeatureCapabilityExtension>[0],
) => new FeatureCapabilityExtension(options);

/**
 * @deprecated Registers the legacy ImageTool compatibility tool. Use
 * createImagePlacementCapability().
 */
export const createImageExtension = () => new ImageTool();

export const createImagePlacementCapability = (
  options?: ConstructorParameters<typeof ImagePlacementCapabilityExtension>[0],
) => new ImagePlacementCapabilityExtension(options);

export const createRulerExtension = (
  options?: ConstructorParameters<typeof RulerTool>[0],
) => new RulerTool(options);

/**
 * @deprecated Registers the legacy SizeTool compatibility tool. Use
 * createSizeCapability().
 */
export const createSizeExtension = () => new SizeTool();

export const createSizeCapability = (
  options?: ConstructorParameters<typeof SizeCapabilityExtension>[0],
) => new SizeCapabilityExtension(options);

export const createTemplateOverlayExtension = (
  options?: ConstructorParameters<typeof TemplateOverlayTool>[0],
) => new TemplateOverlayTool(options);

export const createTemplateOverlayCapability = (
  options?: ConstructorParameters<typeof TemplateOverlayCapabilityExtension>[0],
) => new TemplateOverlayCapabilityExtension(options);

export const createRulerCapability = (
  options?: ConstructorParameters<typeof RulerCapabilityExtension>[0],
) => new RulerCapabilityExtension(options);

/**
 * @deprecated Registers the legacy WhiteInkTool compatibility tool. Use
 * createWhiteInkCapability().
 */
export const createWhiteInkExtension = () => new WhiteInkTool();

export const createWhiteInkCapability = (
  options?: ConstructorParameters<typeof WhiteInkCapabilityExtension>[0],
) => new WhiteInkCapabilityExtension(options);
