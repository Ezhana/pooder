export * from "./extensions";
export * from "./factories";
export * from "./document";
export {
  createOfficialToolCapabilitiesForDocument,
  /** @deprecated Use createOfficialToolCapabilitiesForDocument. */
  createKitCapabilitiesForDocument,
} from "./document/capabilities";
export {
  KIT_LEGACY_LAYER_PRESET,
  type KitLegacyLayerPreset,
} from "./shared/constants/layers";
