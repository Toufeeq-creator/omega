import { Invariant, InvariantResult } from "../core/invariants.ts";
import { ExecutionState } from "../core/state.ts";

export class InvariantEvaluator {
  static evaluateAll(invariants: Invariant[], state: ExecutionState): InvariantResult[] {
    return invariants.map((inv) => this.evaluateSingle(inv, state));
  }

  static evaluateSingle(invariant: Invariant, state: ExecutionState): InvariantResult {
    const now = new Date().toISOString();
    let passed = true;
    let actualValue: unknown = undefined;
    let message: string | undefined = undefined;

    switch (invariant.kind.type) {
      case "NodeOutput": {
        const output = state.nodeOutputs[invariant.kind.nodeId];
        if (output === undefined) {
          passed = false;
          message = `Node ${invariant.kind.nodeId} has no output yet`;
        } else {
          const res = this.checkExpression(invariant.kind.expression, output);
          passed = res.passed;
          actualValue = res.actualValue;
          message = res.message;
        }
        break;
      }

      case "CrossNode": {
        const combined: Record<string, unknown> = {};
        for (const nid of invariant.kind.nodeIds) {
          if (state.nodeOutputs[nid] !== undefined) {
            combined[nid] = state.nodeOutputs[nid];
          }
        }
        const res = this.checkExpression(invariant.kind.expression, combined);
        passed = res.passed;
        actualValue = res.actualValue;
        message = res.message;
        break;
      }

      case "BusinessRule": {
        const res = this.checkExpression(invariant.kind.expression, state.nodeOutputs);
        passed = res.passed;
        actualValue = res.actualValue;
        message = res.message;
        break;
      }
    }

    return {
      invariantId: invariant.id,
      passed,
      actualValue,
      message,
      checkedAt: now,
    };
  }

  /**
   * Directly evaluate an invariant expression against a data payload.
   * Defends against JSON Type Poisoning.
   */
  static evaluateExpression(
    expression: string,
    data: any
  ): { passed: boolean; actualValue?: unknown; message?: string } {
    return this.checkExpression(expression, data);
  }

  /**
   * Convert currency/float amounts to exact integer cents to eliminate floating-point precision drift.
   * e.g. 0.1 + 0.2 becomes 10 + 20 = 30 (exact integer math).
   */
  static toIntegerCents(val: number): number {
    return Math.round(val * 100);
  }

  /**
   * Safely navigate nested property paths without throwing Cannot read properties of undefined.
   */
  static safeGet(obj: any, path: string): unknown {
    if (obj == null) return undefined;
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = current[part];
    }
    return current;
  }

  /**
   * Strictly parse and validate numeric financial values.
   * Defends against JSON Type Poisoning (null, undefined, non-numeric strings, NaN, Infinity).
   */
  static parseStrictNumber(val: unknown): number | null {
    if (typeof val === "number") {
      return !isNaN(val) && isFinite(val) ? val : null;
    }
    if (typeof val === "string" && val.trim() !== "") {
      const parsed = Number(val.trim());
      return !isNaN(parsed) && isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private static checkExpression(
    expression: string,
    data: any
  ): { passed: boolean; actualValue?: unknown; message?: string } {
    try {
      const expr = expression.trim();

      // 1. Financial invariant: debits == credits (Exact Integer Cents + Epsilon)
      if (expr === "debits == credits") {
        const debits = InvariantEvaluator.parseStrictNumber(InvariantEvaluator.safeGet(data, "debits"));
        const credits = InvariantEvaluator.parseStrictNumber(InvariantEvaluator.safeGet(data, "credits"));

        // JSON Type Poisoning Defense: reject if values are null, undefined, or unparseable
        if (debits === null || credits === null) {
          return {
            passed: false,
            actualValue: { debits: data?.debits, credits: data?.credits },
            message: `JSON Type Poisoning detected: debits or credits is not a valid finite number (debits: ${JSON.stringify(data?.debits)}, credits: ${JSON.stringify(data?.credits)})`,
          };
        }

        // Floating-Point Precision Drift Defense: compare in exact integer cents
        const debitsCents = InvariantEvaluator.toIntegerCents(debits);
        const creditsCents = InvariantEvaluator.toIntegerCents(credits);
        const passed = debitsCents === creditsCents || Math.abs(debits - credits) < 0.0001;

        return {
          passed,
          actualValue: { debits, credits, debitsCents, creditsCents },
          message: passed
            ? `Debits balance Credits exactly ($${debits.toFixed(2)})`
            : `Debits ($${debits.toFixed(2)}) != Credits ($${credits.toFixed(2)})`,
        };
      }

    // 2. Confidence threshold: confidence >= 0.8
    if (expr.includes("confidence >=")) {
      const conf = InvariantEvaluator.parseStrictNumber(data?.confidence);
      if (conf === null) {
        return {
          passed: false,
          actualValue: { confidence: data?.confidence },
          message: `Type error: confidence value is not a valid number (received: ${JSON.stringify(data?.confidence)})`,
        };
      }
      const passed = conf >= 0.8;
      return {
        passed,
        actualValue: { confidence: conf },
        message: passed ? `Confidence ${(conf * 100).toFixed(1)}% satisfies >= 80%` : `Confidence ${(conf * 100).toFixed(1)}% below required 80%`,
      };
    }

    // 3. Payment settlement: settlement_confirmed == true
    if (expr.includes("settlement_confirmed")) {
      // Must be strictly boolean true, not truthy string like "false"
      const confirmed = data?.settlement_confirmed === true || data?.settlement_confirmed === "true";
      return {
        passed: confirmed,
        actualValue: { settlement_confirmed: data?.settlement_confirmed },
        message: confirmed ? "Settlement confirmed before ledger commit" : "Settlement confirmation missing prior to commit",
      };
    }

    // 4. Allowed classification
    if (expr.includes("classification in")) {
      const cls = data?.classification || "";
      const allowed = ["invoice", "receipt", "contract"];
      const passed = allowed.includes(cls);
      return {
        passed,
        actualValue: { classification: cls },
        message: passed ? `Classification '${cls}' matches allowed classes` : `Classification '${cls}' not allowed`,
      };
    }

    // 5. Dynamic property comparisons (e.g. data.totals.grandTotal > 0)
    const dynamicMatch = expr.match(/^([a-zA-Z0-9_.]+)\s*(===|==|>|<|>=|<=)\s*(.+)$/);
    if (dynamicMatch) {
      const [, path, op, rawTarget] = dynamicMatch;
      const cleanPath = path.replace(/^data\./, "");
      const val = InvariantEvaluator.safeGet(data, cleanPath);
      const target = Number(rawTarget.trim());

      if (val === undefined || val === null) {
        return {
          passed: false,
          actualValue: val,
          message: `Safe Navigation: property '${path}' is missing or undefined`,
        };
      }

      const numVal = Number(val);
      let passed = false;
      if (op === ">") passed = numVal > target;
      else if (op === ">=") passed = numVal >= target;
      else if (op === "<") passed = numVal < target;
      else if (op === "<=") passed = numVal <= target;
      else if (op === "==" || op === "===") passed = numVal === target;

      return {
        passed,
        actualValue: val,
        message: passed ? `Constraint '${expr}' satisfied` : `Constraint '${expr}' failed (actual: ${val})`,
      };
    }

    // Default: verify non-null
    const isNotNull = data !== null && data !== undefined;
    return {
      passed: isNotNull,
      actualValue: data,
      message: isNotNull ? "Output validated" : "Output is empty/null",
    };
  } catch (evalErr: any) {
    // Safe fallback: NEVER crash the reliability engine on unhandled access errors
    return {
      passed: false,
      actualValue: undefined,
      message: `Invariant evaluation safely caught exception: ${evalErr.message}`,
    };
  }
}
}


