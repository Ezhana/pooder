import { ClipCapabilityExtension } from "./extensions/clip";
import { ConfigurableVisualCapabilityExtension } from "./extensions/configurable-visual";
import { DesignExportCapabilityExtension } from "./extensions/design-export";
import { DielineGeometryCapabilityExtension } from "./extensions/dieline";
import { EdgeDetectionCapabilityExtension } from "./extensions/edge-detection";
import { FeatureCapabilityExtension } from "./extensions/feature";
import { ImageMaskCapabilityExtension } from "./extensions/image-mask";
import { ImageSlotCapabilityExtension } from "./extensions/image-slot";
import { MirrorCapabilityExtension } from "./extensions/mirror";
import { SceneExportCapabilityExtension } from "./extensions/scene-export";
import { defineLegacyExtension } from "@pooder/core/internal/legacy-extension";

export const createClipCapability = (
  options?: ConstructorParameters<typeof ClipCapabilityExtension>[0],
) => defineLegacyExtension(new ClipCapabilityExtension(options));

export const createConfigurableVisualCapability = (
  options?: ConstructorParameters<
    typeof ConfigurableVisualCapabilityExtension
  >[0],
) => defineLegacyExtension(new ConfigurableVisualCapabilityExtension(options));

export const createDesignExportCapability = (
  options?: ConstructorParameters<typeof DesignExportCapabilityExtension>[0],
) => defineLegacyExtension(new DesignExportCapabilityExtension(options));

export const createEdgeDetectionCapability = (
  options?: ConstructorParameters<typeof EdgeDetectionCapabilityExtension>[0],
) => defineLegacyExtension(new EdgeDetectionCapabilityExtension(options));

export const createDielineGeometryCapability = (
  options?: ConstructorParameters<typeof DielineGeometryCapabilityExtension>[0],
) => defineLegacyExtension(new DielineGeometryCapabilityExtension(options));

export const createFeatureCapability = (
  options?: ConstructorParameters<typeof FeatureCapabilityExtension>[0],
) => defineLegacyExtension(new FeatureCapabilityExtension(options));

export const createImageSlotCapability = () =>
  new ImageSlotCapabilityExtension();

export const createImageMaskCapability = (
  options?: ConstructorParameters<typeof ImageMaskCapabilityExtension>[0],
) => defineLegacyExtension(new ImageMaskCapabilityExtension(options));

export const createMirrorCapability = (
  options?: ConstructorParameters<typeof MirrorCapabilityExtension>[0],
) => defineLegacyExtension(new MirrorCapabilityExtension(options));

export const createSceneExportCapability = (
  options?: ConstructorParameters<typeof SceneExportCapabilityExtension>[0],
) => defineLegacyExtension(new SceneExportCapabilityExtension(options));
