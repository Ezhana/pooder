import {
  POODER_PRODUCTION_MASK_CAPABILITY_ID,
  POODER_PRODUCTION_MASK_EFFECT_SCHEMA,
  createProductionMaskCapability,
} from "../src";

declare const process: { exit(code: number): never };

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const validPayload = {
  process: "reverse",
  enabled: true,
  reference: { type: "document-object", objectId: "front.image" },
  source: {
    type: "asset",
    assetId: "reverse-mask",
  },
  alpha: {
    selection: "transparent",
    mapping: "threshold",
    threshold: 0.2,
    softness: 0.05,
    outputOpacity: 1,
  },
};

const validate = (payload: unknown, id = "front.reverse") =>
  POODER_PRODUCTION_MASK_EFFECT_SCHEMA.validate(payload, {
    effect: { id, type: "production-mask", payload },
    effectPath: "surfaces[0].layers[0].effects[0]",
    effectType: "production-mask",
  });

async function main() {
  assert(
    validate(validPayload).length === 0,
    "valid production masks should pass validation",
  );
  assert(
    validate({ ...validPayload, enabled: true, source: undefined }).some(
      (issue) => issue.path === "source",
    ),
    "enabled production masks should require a source",
  );
  assert(
    validate({
      ...validPayload,
      alpha: { ...validPayload.alpha, threshold: 2 },
    }).some((issue) => issue.path === "alpha.threshold"),
    "production alpha parameters should stay in the unit interval",
  );
  assert(
    validate(validPayload, "").some(
      (issue) => issue.code === "effect-id-required",
    ),
    "production masks should require stable effect ids",
  );
  const capability = createProductionMaskCapability();
  assert(
    capability.id === POODER_PRODUCTION_MASK_CAPABILITY_ID,
    "factory should use the production mask capability id",
  );
  const compiler = capability.contribute().renderIntentCompilers?.[0];
  assert(
    compiler?.capabilityId === POODER_PRODUCTION_MASK_CAPABILITY_ID &&
      compiler.effectType === "production-mask",
    "production mask effects should contribute their RenderIntent compiler",
  );
  const compiled = await compiler?.compile({
    document: {
      version: 7,
      assets: [
        {
          id: "reverse-mask",
          type: "image",
          source: { kind: "url", url: "https://example.com/reverse.png" },
        },
      ],
      config: {},
      surfaces: [],
    },
    effect: {
      id: "front.production-mask.reverse",
      type: "production-mask",
      payload: validPayload,
    },
    target: {
      kind: "layer",
      surfaceId: "front",
      layerId: "front.production-masks",
    },
  });
  const compiledPatch = Array.isArray(compiled) ? compiled[0] : compiled;
  assert(
    compiledPatch?.id === "front.image",
    "production mask compiler should bind the effect to its reference object",
  );
  console.log("ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
