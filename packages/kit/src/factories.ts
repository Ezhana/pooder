import { BackgroundCapabilityExtension } from "./extensions/background";
import { DesignExportCapabilityExtension } from "./extensions/design-export";
import { DielineGeometryCapabilityExtension } from "./extensions/dieline";
import { EdgeDetectionCapabilityExtension } from "./extensions/edge-detection";
import { FeatureCapabilityExtension } from "./extensions/feature";
import { ImagePlacementCapabilityExtension } from "./extensions/image";
import { RulerCapabilityExtension } from "./extensions/ruler";
import { SizeCapabilityExtension } from "./extensions/size";
import { TemplateOverlayCapabilityExtension } from "./extensions/template-overlay";
import { WhiteInkCapabilityExtension } from "./extensions/white-ink";

export const createBackgroundCapability = (
  options?: ConstructorParameters<typeof BackgroundCapabilityExtension>[0],
) => new BackgroundCapabilityExtension(options);

export const createDesignExportCapability = (
  options?: ConstructorParameters<typeof DesignExportCapabilityExtension>[0],
) => new DesignExportCapabilityExtension(options);

export const createEdgeDetectionCapability = (
  options?: ConstructorParameters<typeof EdgeDetectionCapabilityExtension>[0],
) => new EdgeDetectionCapabilityExtension(options);

export const createDielineGeometryCapability = (
  options?: ConstructorParameters<typeof DielineGeometryCapabilityExtension>[0],
) => new DielineGeometryCapabilityExtension(options);

export const createFeatureCapability = (
  options?: ConstructorParameters<typeof FeatureCapabilityExtension>[0],
) => new FeatureCapabilityExtension(options);

export const createImagePlacementCapability = (
  options?: ConstructorParameters<typeof ImagePlacementCapabilityExtension>[0],
) => new ImagePlacementCapabilityExtension(options);

export const createSizeCapability = (
  options?: ConstructorParameters<typeof SizeCapabilityExtension>[0],
) => new SizeCapabilityExtension(options);

export const createTemplateOverlayCapability = (
  options?: ConstructorParameters<typeof TemplateOverlayCapabilityExtension>[0],
) => new TemplateOverlayCapabilityExtension(options);

export const createRulerCapability = (
  options?: ConstructorParameters<typeof RulerCapabilityExtension>[0],
) => new RulerCapabilityExtension(options);

export const createWhiteInkCapability = (
  options?: ConstructorParameters<typeof WhiteInkCapabilityExtension>[0],
) => new WhiteInkCapabilityExtension(options);
