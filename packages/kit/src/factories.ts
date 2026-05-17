import { ClipCapabilityExtension } from "./extensions/clip";
import { ConfigurableVisualCapabilityExtension } from "./extensions/configurable-visual";
import { DesignExportCapabilityExtension } from "./extensions/design-export";
import { DielineGeometryCapabilityExtension } from "./extensions/dieline";
import { EdgeDetectionCapabilityExtension } from "./extensions/edge-detection";
import { FeatureCapabilityExtension } from "./extensions/feature";
import { ImagePlacementCapabilityExtension } from "./extensions/image";
import { RulerCapabilityExtension } from "./extensions/ruler";
import { WhiteInkCapabilityExtension } from "./extensions/white-ink";

export const createClipCapability = (
  options?: ConstructorParameters<typeof ClipCapabilityExtension>[0],
) => new ClipCapabilityExtension(options);

export const createConfigurableVisualCapability = (
  options?: ConstructorParameters<typeof ConfigurableVisualCapabilityExtension>[0],
) => new ConfigurableVisualCapabilityExtension(options);

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

export const createRulerCapability = (
  options?: ConstructorParameters<typeof RulerCapabilityExtension>[0],
) => new RulerCapabilityExtension(options);

export const createWhiteInkCapability = (
  options?: ConstructorParameters<typeof WhiteInkCapabilityExtension>[0],
) => new WhiteInkCapabilityExtension(options);
