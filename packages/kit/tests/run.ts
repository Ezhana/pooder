import { ConstraintRegistry } from "../src/constraints";
import { completeFeaturesStrict } from "../src/featureComplete";
import { ConstraintFeature } from "../src/constraints";

function assert(condition: any, message: string) {
  if (!condition) throw new Error(message);
}

function closeTo(a: number, b: number, eps: number = 1e-6) {
  return Math.abs(a - b) <= eps;
}

function testTangentBottom() {
  const feature: ConstraintFeature = {
    id: "stand",
    operation: "add",
    shape: "rect",
    x: 0.5,
    y: 0.2,
    width: 40,
    height: 20,
    constraints: { type: "tangent-bottom", params: { gap: 0 } },
  };

  const out = ConstraintRegistry.apply(feature.x, feature.y, feature, {
    dielineWidth: 100,
    dielineHeight: 100,
  });

  assert(closeTo(out.y, 1.1), `tangent-bottom y expected 1.1, got ${out.y}`);
  assert(closeTo(out.x, 0.5), `tangent-bottom x expected 0.5, got ${out.x}`);
}

function testCompleteFeaturesStrict() {
  const updates: any[] = [];

  const illegal: ConstraintFeature = {
    id: "stand",
    operation: "add",
    shape: "rect",
    x: 0.5,
    y: 0.5,
    width: 40,
    height: 20,
    constraints: { type: "tangent-bottom", params: { gap: 0 } },
  };

  const failed = completeFeaturesStrict(
    [illegal],
    { dielineWidth: 100, dielineHeight: 100 },
    (next) => updates.push({ key: "dieline.features", value: next }),
  );
  assert(failed.ok === false, "completeFeatures should fail for illegal features");
  assert(updates.length === 0, "illegal draft should not update configuration");

  const legal: ConstraintFeature = {
    ...illegal,
    y: 1.1,
  };

  const ok = completeFeaturesStrict(
    [legal],
    { dielineWidth: 100, dielineHeight: 100 },
    (next) => updates.push({ key: "dieline.features", value: next }),
  );
  assert(ok.ok === true, "completeFeatures should succeed for legal features");
  assert(updates.length === 1, "legal draft should update configuration once");
  assert(updates[0].key === "dieline.features", "should update dieline.features");
  assert(
    closeTo(updates[0].value[0].y, 1.1),
    "saved feature y should remain 1.1",
  );
}

function main() {
  testTangentBottom();
  testCompleteFeaturesStrict();
  console.log("ok");
}

main();
