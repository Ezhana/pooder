import { ConstraintContext, ConstraintFeature, ConstraintRegistry } from "./constraints";

export type FeatureCompleteIssue = {
  featureId: string;
  groupId?: string;
  reason: string;
};

export function validateFeaturesStrict(
  features: ConstraintFeature[],
  context: ConstraintContext,
): { ok: boolean; issues?: FeatureCompleteIssue[] } {
  const eps = 1e-6;
  const issues: FeatureCompleteIssue[] = [];

  for (const f of features) {
    if (!f.constraints || f.constraints.length === 0) continue;
    // Pass ALL constraints (including validateOnly) for strict validation check
    const constrained = ConstraintRegistry.apply(f.x, f.y, f, context, f.constraints);
    if (
      Math.abs(constrained.x - f.x) > eps ||
      Math.abs(constrained.y - f.y) > eps
    ) {
      issues.push({
        featureId: f.id,
        groupId: f.groupId,
        reason: "Position violates constraint strategy",
      });
    }
  }

  return { ok: issues.length === 0, issues: issues.length ? issues : undefined };
}

export function completeFeaturesStrict(
  features: ConstraintFeature[],
  context: ConstraintContext,
  update: (nextFeatures: ConstraintFeature[]) => void,
): { ok: boolean; issues?: FeatureCompleteIssue[] } {
  const validation = validateFeaturesStrict(features, context);
  if (!validation.ok) return validation;
  const next = JSON.parse(JSON.stringify(features || [])) as ConstraintFeature[];
  update(next);
  return { ok: true };
}

