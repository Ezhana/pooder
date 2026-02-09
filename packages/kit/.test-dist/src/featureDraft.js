"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateDraftFeaturesStrict = validateDraftFeaturesStrict;
exports.saveDraftFeaturesStrict = saveDraftFeaturesStrict;
const constraints_1 = require("./constraints");
function validateDraftFeaturesStrict(draftFeatures, context) {
    const eps = 1e-6;
    const issues = [];
    for (const f of draftFeatures) {
        if (!f.constraints?.type)
            continue;
        const constrained = constraints_1.ConstraintRegistry.apply(f.x, f.y, f, context);
        if (Math.abs(constrained.x - f.x) > eps ||
            Math.abs(constrained.y - f.y) > eps) {
            issues.push({
                featureId: f.id,
                groupId: f.groupId,
                reason: "Position violates constraint strategy",
            });
        }
    }
    return { ok: issues.length === 0, issues: issues.length ? issues : undefined };
}
function saveDraftFeaturesStrict(draftFeatures, context, update) {
    const validation = validateDraftFeaturesStrict(draftFeatures, context);
    if (!validation.ok)
        return validation;
    const next = JSON.parse(JSON.stringify(draftFeatures || []));
    update(next);
    return { ok: true, nextFeatures: next };
}
