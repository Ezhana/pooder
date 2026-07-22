import type {
  ExtensionContributions,
  ExtensionActivationSpec,
  ExtensionContext,
  ExtensionDefinition,
  ObjectImageResolverService,
} from "@pooder/core";
import { OBJECT_IMAGE_RESOLVER_SERVICE } from "@pooder/core";
import {
  EDGE_DETECTION_CAPABILITY_ID,
  createEdgeDetectionCapabilityDefinition,
  detectImageEdge,
  type EdgeDetectionCapabilityApi,
} from "./capability";

export interface EdgeDetectionCapabilityExtensionOptions {
  id?: string;
  capabilityId?: string;
}

export class EdgeDetectionCapabilityExtension implements ExtensionDefinition {
  id: string;

  metadata = {
    name: "EdgeDetectionCapabilityExtension",
  };

  private readonly capabilityId: string;
  private objectImageResolver?: ObjectImageResolverService;

  constructor(options: EdgeDetectionCapabilityExtensionOptions = {}) {
    this.id = options.id || EDGE_DETECTION_CAPABILITY_ID;
    this.capabilityId = options.capabilityId || EDGE_DETECTION_CAPABILITY_ID;
    this.activation = {
      requiresServices: [OBJECT_IMAGE_RESOLVER_SERVICE],
    };
  }

  activation: ExtensionActivationSpec;

  activate(context: ExtensionContext) {
    this.objectImageResolver =
      context.services.getOrThrow<ObjectImageResolverService>(
        OBJECT_IMAGE_RESOLVER_SERVICE,
      );
  }

  deactivate() {
    this.objectImageResolver = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      capabilities: [
        createEdgeDetectionCapabilityDefinition(this.getFacade(), {
          capabilityId: this.capabilityId,
        }),
      ],
    };
  }

  private getFacade(): EdgeDetectionCapabilityApi {
    return {
      detectEdge: (imageUrl, options) => detectImageEdge(imageUrl, options),
      detectObject: async (objectId, options = {}) => {
        if (!this.objectImageResolver) {
          throw new Error(
            "[EdgeDetectionCapability] Object image resolver is unavailable.",
          );
        }
        const { multiplier = 2, ...detectOptions } = options;
        const sourceImage = await this.objectImageResolver.resolve({
          format: "png",
          multiplier,
          objectId,
          representation: "committed-visual",
        });
        const result = await detectImageEdge(sourceImage.url, detectOptions);
        return { ...result, sourceImage };
      },
    };
  }
}
