import type { VisibilityExpr } from "./render-spec";

export interface VisibilityLayerState {
  exists: boolean;
  objectCount: number;
}

export interface VisibilityEvalContext {
  activeToolId?: string | null;
  contextValues?: Map<string, unknown> | Record<string, unknown>;
  isWorkflowSessionActive?: (workflowId: string) => boolean;
  hasAnyActiveWorkflowSession?: () => boolean;
  isSessionActive?: (toolId: string) => boolean;
  hasAnyActiveSession?: () => boolean;
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

function readContextValue(
  context: VisibilityEvalContext,
  key: string,
): unknown {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey || !context.contextValues) return undefined;
  if (context.contextValues instanceof Map) {
    return context.contextValues.get(normalizedKey);
  }
  return Object.prototype.hasOwnProperty.call(
    context.contextValues,
    normalizedKey,
  )
    ? context.contextValues[normalizedKey]
    : undefined;
}

export function evaluateVisibilityExpr(
  expr: VisibilityExpr | undefined,
  context: VisibilityEvalContext,
): boolean {
  if (!expr) return true;

  if (expr.op === "const") {
    return Boolean(expr.value);
  }

  if (expr.op === "contextTruthy") {
    return Boolean(readContextValue(context, expr.key));
  }

  if (expr.op === "contextEquals") {
    return Object.is(readContextValue(context, expr.key), expr.value);
  }

  if (expr.op === "workflowSessionActive") {
    const workflowId = String(expr.workflowId || "").trim();
    if (!workflowId) return false;
    return context.isWorkflowSessionActive
      ? context.isWorkflowSessionActive(workflowId)
      : false;
  }

  if (expr.op === "anyWorkflowSessionActive") {
    return context.hasAnyActiveWorkflowSession
      ? context.hasAnyActiveWorkflowSession()
      : false;
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

  if (expr.op === "anySessionActive") {
    return context.hasAnyActiveSession ? context.hasAnyActiveSession() : false;
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
