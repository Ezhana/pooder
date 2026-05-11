import {
  CONFIGURATION_SERVICE,
  ConfigurationService,
  ExtensionContributions,
  ExtensionDefinition,
  ExtensionContext,
} from "@pooder/core";
import { CANVAS_SERVICE, CanvasService } from "@pooder/core";

export class MirrorTool implements ExtensionDefinition {
  id = "pooder.kit.mirror";

  public metadata = {
    name: "MirrorTool",
  };
  activation = {
    requiresServices: [CANVAS_SERVICE, CONFIGURATION_SERVICE],
  };
  private enabled = false;

  private canvasService?: CanvasService;

  constructor(
    options?: Partial<{
      enabled: boolean;
    }>,
  ) {
    if (options) {
      Object.assign(this, options);
    }
  }

  toJSON() {
    return {
      enabled: this.enabled,
    };
  }

  loadFromJSON(json: any) {
    this.enabled = json.enabled;
  }

  activate(context: ExtensionContext) {
    this.canvasService = context.services.getOrThrow<CanvasService>(
      CANVAS_SERVICE,
    );

    const configService = context.services.getOrThrow<ConfigurationService>(
      CONFIGURATION_SERVICE,
    );
    this.enabled = configService.get("mirror.enabled", this.enabled);
    configService.onAnyChange((e: { key: string; value: any }) => {
      if (e.key === "mirror.enabled") {
        this.applyMirror(e.value);
      }
    });

    // Initialize with current state (if enabled was persisted)
    if (this.enabled) {
      this.applyMirror(true);
    }
  }

  deactivate(context: ExtensionContext) {
    this.applyMirror(false);
    this.canvasService = undefined;
  }

  contribute(): ExtensionContributions {
    return {
      configurations: [
        {
          id: "mirror.enabled",
          type: "boolean",
          label: "Enable Mirror",
          default: false,
        },
      ],
      commands: [
        {
          id: "setMirror",
          command: "setMirror",
          title: "Set Mirror",
          handler: (enabled: boolean) => {
            this.applyMirror(enabled);
            return true;
          },
        },
      ],
    };
  }

  private applyMirror(enabled: boolean) {
    if (!this.canvasService) return;
    this.canvasService.setViewportMirror(enabled);
    this.enabled = enabled;
  }
}
