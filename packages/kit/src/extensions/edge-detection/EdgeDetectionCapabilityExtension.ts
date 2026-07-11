import type {
  ExtensionContributions,
  ExtensionContext,
  ExtensionDefinition,
} from "@pooder/core";
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

  constructor(options: EdgeDetectionCapabilityExtensionOptions = {}) {
    this.id = options.id || EDGE_DETECTION_CAPABILITY_ID;
    this.capabilityId = options.capabilityId || EDGE_DETECTION_CAPABILITY_ID;
  }

  activate(_context: ExtensionContext) {}

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
    };
  }
}
