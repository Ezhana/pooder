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
        constraints: [{ type: "tangent-bottom", params: { gap: 0 } }],
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
        constraints: [{ type: "tangent-bottom", params: { gap: 0 } }],
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
function testPathOffset() {
    const feature = {
        id: "path-test",
        operation: "add",
        shape: "circle",
        x: 0.9, // Near right edge (normalized 0.9 => 40, edge is 50)
        y: 0.5, // Center Y
        width: 10,
        height: 10,
        constraints: [{ type: "path", params: { offset: 10 } }],
    };
    const geometryOptions = {
        shape: "rect",
        width: 100,
        height: 100,
        radius: 0,
        x: 0,
        y: 0,
        features: []
    };
    const out = constraints_1.ConstraintRegistry.apply(feature.x, feature.y, feature, {
        dielineWidth: 100,
        dielineHeight: 100,
        geometry: geometryOptions
    });
    console.log(`Path Offset Test: x=${out.x}, y=${out.y}`);
    // We expect the point to be snapped to the edge (x=1.0) and then offset.
    // Depending on normal direction, it will be 1.1 or 0.9.
    // Either way, it should not be exactly 1.0 if offset is working.
    // And strictly speaking, since we passed x=0.9, if offset=0 it would snap to 1.0.
    assert(out.x !== 1.0, "Path offset should move point away from edge");
}
function main() {
    testTangentBottom();
    testCompleteFeaturesStrict();
    // testPathOffset(); // Requires canvas package for paper.js in Node
    console.log("ok");
}
main();
