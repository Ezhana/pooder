import type { VisibilityExpr } from "./renderSpec";

export interface VisibilityLayerState {
  exists: boolean;
  objectCount: number;
}

export interface VisibilityEvalContext {
  activeToolId?: string | null;
  isSessionActive?: (toolId: string) => boolean;
  layers: Map<string, VisibilityLayerState>;
}

function compareLayerObjectCount(
  actual: number,
  cmp: ">" | ">=" | "==" | "<" | "<=",
  expected: number,
): boolean {
  if (cmp === ">") return actual > expected;
  if (cmp === ">=") return actual >= expected;
  if (cmp === "<") return actual < expected;
  if (cmp === "<=") return actual <= expected;
  return actual === expected;
}

function layerState(
  context: VisibilityEvalContext,
  layerId: string,
): VisibilityLayerState {
  return context.layers.get(layerId) || { exists: false, objectCount: 0 };
}

export function evaluateVisibilityExpr(
  expr: VisibilityExpr | undefined,
  context: VisibilityEvalContext,
): boolean {
  if (!expr) return true;

  if (expr.op === "const") {
    return Boolean(expr.value);
  }

  if (expr.op === "activeToolIn") {
    const activeToolId = context.activeToolId ?? null;
    return !!activeToolId && expr.ids.includes(activeToolId);
  }

  if (expr.op === "sessionActive") {
    const toolId = String(expr.toolId || "").trim();
    if (!toolId) return false;
    return context.isSessionActive ? context.isSessionActive(toolId) : false;
  }

  if (expr.op === "layerExists") {
    return layerState(context, expr.layerId).exists === true;
  }

  if (expr.op === "layerObjectCount") {
    const expected = Number(expr.value);
    if (!Number.isFinite(expected)) return false;
    const count = layerState(context, expr.layerId).objectCount;
    return compareLayerObjectCount(count, expr.cmp, expected);
  }

  if (expr.op === "not") {
    return !evaluateVisibilityExpr(expr.expr, context);
  }

  if (expr.op === "all") {
    return expr.exprs.every((item) => evaluateVisibilityExpr(item, context));
  }

  if (expr.op === "any") {
    return expr.exprs.some((item) => evaluateVisibilityExpr(item, context));
  }

  return true;
}
