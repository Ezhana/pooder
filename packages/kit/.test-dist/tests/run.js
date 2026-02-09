"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constraints_1 = require("../src/constraints");
const featureComplete_1 = require("../src/featureComplete");
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
function closeTo(a, b, eps = 1e-6) {
    return Math.abs(a - b) <= eps;
}
function testTangentBottom() {
    const feature = {
        id: "stand",
        operation: "add",
        shape: "rect",
        x: 0.5,
        y: 0.2,
        width: 40,
        height: 20,
        constraints: { type: "tangent-bottom", params: { gap: 0 } },
    };
    const out = constraints_1.ConstraintRegistry.apply(feature.x, feature.y, feature, {
        dielineWidth: 100,
        dielineHeight: 100,
    });
    assert(closeTo(out.y, 1.1), `tangent-bottom y expected 1.1, got ${out.y}`);
    assert(closeTo(out.x, 0.5), `tangent-bottom x expected 0.5, got ${out.x}`);
}
function testCompleteFeaturesStrict() {
    const updates = [];
    const illegal = {
        id: "stand",
        operation: "add",
        shape: "rect",
        x: 0.5,
        y: 0.5,
        width: 40,
        height: 20,
        constraints: { type: "tangent-bottom", params: { gap: 0 } },
    };
    const failed = (0, featureComplete_1.completeFeaturesStrict)([illegal], { dielineWidth: 100, dielineHeight: 100 }, (next) => updates.push({ key: "dieline.features", value: next }));
    assert(failed.ok === false, "completeFeatures should fail for illegal features");
    assert(updates.length === 0, "illegal draft should not update configuration");
    const legal = {
        ...illegal,
        y: 1.1,
    };
    const ok = (0, featureComplete_1.completeFeaturesStrict)([legal], { dielineWidth: 100, dielineHeight: 100 }, (next) => updates.push({ key: "dieline.features", value: next }));
    assert(ok.ok === true, "completeFeatures should succeed for legal features");
    assert(updates.length === 1, "legal draft should update configuration once");
    assert(updates[0].key === "dieline.features", "should update dieline.features");
    assert(closeTo(updates[0].value[0].y, 1.1), "saved feature y should remain 1.1");
}
function main() {
    testTangentBottom();
    testCompleteFeaturesStrict();
    console.log("ok");
}
main();
