import {
  type CapabilityDefinition,
  type RegisteredCapabilityDefinition,
} from "../capability";
import Disposable from "../disposable";
import type { Service } from "../service";
import { TypedEventEmitter } from "../typed-event";

export interface CapabilityRegistryChangeEvent {
  added: string[];
  removed: string[];
  extensionId?: string;
}

interface CapabilityRegistryEventMap {
  change: CapabilityRegistryChangeEvent;
}

export default class CapabilityRegistryService implements Service {
  private readonly events = new TypedEventEmitter<CapabilityRegistryEventMap>();
  private readonly capabilitiesById = new Map<
    string,
    RegisteredCapabilityDefinition
  >();
  private readonly capabilityIdsByExtension = new Map<string, Set<string>>();

  registerCapability<TFacade = unknown>(
    extensionId: string,
    capability: CapabilityDefinition<TFacade>,
  ): Disposable {
    if (!extensionId) {
      throw new Error("Capability extension id is required.");
    }
    if (!capability?.id) {
      throw new Error("CapabilityDefinition.id is required.");
    }
    if (this.capabilitiesById.has(capability.id)) {
      throw new Error(`Capability "${capability.id}" is already registered.`);
    }

    const registered: RegisteredCapabilityDefinition<TFacade> = {
      ...capability,
      metadata: this.cloneMetadata(capability.metadata),
      dependencies: this.cloneDependencies(capability.dependencies),
      commands: capability.commands?.map((command) =>
        typeof command === "string" ? command : { ...command },
      ),
      extensionId,
    };

    this.capabilitiesById.set(registered.id, registered);
    const extensionCapabilities =
      this.capabilityIdsByExtension.get(extensionId) ?? new Set<string>();
    extensionCapabilities.add(registered.id);
    this.capabilityIdsByExtension.set(extensionId, extensionCapabilities);

    try {
      registered.onRegister?.();
    } catch (error) {
      this.capabilitiesById.delete(registered.id);
      extensionCapabilities.delete(registered.id);
      if (extensionCapabilities.size === 0) {
        this.capabilityIdsByExtension.delete(extensionId);
      }
      throw error;
    }

    this.emitChange({ added: [registered.id], removed: [], extensionId });

    return {
      dispose: () => {
        if (this.capabilitiesById.get(registered.id) === registered) {
          this.unregisterCapability(registered.id);
        }
      },
    };
  }

  unregisterCapability(id: string): boolean {
    const registered = this.capabilitiesById.get(id);
    if (!registered) {
      return false;
    }

    this.capabilitiesById.delete(id);
    const extensionCapabilities = this.capabilityIdsByExtension.get(
      registered.extensionId,
    );
    extensionCapabilities?.delete(id);
    if (extensionCapabilities?.size === 0) {
      this.capabilityIdsByExtension.delete(registered.extensionId);
    }

    try {
      registered.onUnregister?.();
    } catch (error) {
      console.error(`Error unregistering capability "${id}":`, error);
    }

    this.emitChange({
      added: [],
      removed: [id],
      extensionId: registered.extensionId,
    });
    return true;
  }

  unregisterCapabilities(extensionId: string) {
    const ids = this.capabilityIdsByExtension.get(extensionId);
    if (!ids) {
      return;
    }

    Array.from(ids.values()).forEach((id) => this.unregisterCapability(id));
  }

  getCapability<TFacade = unknown>(
    id: string,
  ): RegisteredCapabilityDefinition<TFacade> | undefined {
    const capability = this.capabilitiesById.get(id);
    return capability
      ? (this.cloneCapability(
          capability,
        ) as RegisteredCapabilityDefinition<TFacade>)
      : undefined;
  }

  getFacade<TFacade = unknown>(id: string): TFacade | undefined {
    return this.capabilitiesById.get(id)?.facade as TFacade | undefined;
  }

  listCapabilities(): RegisteredCapabilityDefinition[] {
    return Array.from(this.capabilitiesById.values())
      .map((capability) => this.cloneCapability(capability))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  hasCapability(id: string): boolean {
    return this.capabilitiesById.has(id);
  }

  onDidChange(callback: (event: CapabilityRegistryChangeEvent) => void) {
    return this.events.on("change", callback);
  }

  dispose() {
    Array.from(this.capabilityIdsByExtension.keys()).forEach((extensionId) =>
      this.unregisterCapabilities(extensionId),
    );
    this.capabilitiesById.clear();
    this.capabilityIdsByExtension.clear();
    this.events.clear();
  }

  private emitChange(event: CapabilityRegistryChangeEvent) {
    this.events.emit("change", event);
  }

  private cloneCapability<TFacade>(
    capability: RegisteredCapabilityDefinition<TFacade>,
  ): RegisteredCapabilityDefinition<TFacade> {
    return {
      ...capability,
      metadata: this.cloneMetadata(capability.metadata),
      dependencies: this.cloneDependencies(capability.dependencies),
      commands: capability.commands?.map((command) =>
        typeof command === "string" ? command : { ...command },
      ),
    };
  }

  private cloneMetadata(metadata?: CapabilityDefinition["metadata"]) {
    return metadata
      ? {
          ...metadata,
          tags: metadata.tags?.slice(),
        }
      : undefined;
  }

  private cloneDependencies(
    dependencies?: CapabilityDefinition["dependencies"],
  ) {
    return dependencies
      ? {
          capabilities: dependencies.capabilities?.slice(),
          extensions: dependencies.extensions?.slice(),
          services: dependencies.services?.slice(),
        }
      : undefined;
  }
}
