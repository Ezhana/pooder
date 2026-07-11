import type { Service, ServiceIdentifier } from "./service";

export interface CapabilityMetadata {
  name?: string;
  description?: string;
  version?: string;
  tags?: string[];
}

export interface CapabilityCommandReference {
  id: string;
  title?: string;
  description?: string;
}

export interface CapabilityDependencies {
  capabilities?: string[];
  extensions?: string[];
  services?: ServiceIdentifier<Service>[];
}

export interface CapabilityDefinition<TFacade = unknown> {
  id: string;
  metadata?: CapabilityMetadata;
  dependencies?: CapabilityDependencies;
  commands?: Array<string | CapabilityCommandReference>;
  facade?: TFacade;
  onRegister?(): void;
  onUnregister?(): void;
}

export interface RegisteredCapabilityDefinition<TFacade = unknown>
  extends CapabilityDefinition<TFacade> {
  extensionId: string;
}
