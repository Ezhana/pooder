import { DesignExportCapabilityExtension } from "./extensions/design-export";
import { EdgeDetectionCapabilityExtension } from "./extensions/edge-detection";
import { ImageMaskCapabilityExtension } from "./extensions/image-mask";
import { ImageSlotCapabilityExtension } from "./extensions/image-slot";
import { MirrorCapabilityExtension } from "./extensions/mirror";
import { SceneExportCapabilityExtension } from "./extensions/scene-export";

export const createDesignExportCapability = (
  options?: ConstructorParameters<typeof DesignExportCapabilityExtension>[0],
) => new DesignExportCapabilityExtension(options);

export const createEdgeDetectionCapability = (
  options?: ConstructorParameters<typeof EdgeDetectionCapabilityExtension>[0],
) => new EdgeDetectionCapabilityExtension(options);

export const createImageSlotCapability = (
  options?: ConstructorParameters<typeof ImageSlotCapabilityExtension>[0],
) => new ImageSlotCapabilityExtension(options);

export const createImageMaskCapability = (
  options?: ConstructorParameters<typeof ImageMaskCapabilityExtension>[0],
) => new ImageMaskCapabilityExtension(options);

export const createMirrorCapability = (
  options?: ConstructorParameters<typeof MirrorCapabilityExtension>[0],
) => new MirrorCapabilityExtension(options);

export const createSceneExportCapability = (
  options?: ConstructorParameters<typeof SceneExportCapabilityExtension>[0],
) => new SceneExportCapabilityExtension(options);
