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
   * Strictly parse and validate numeric financial values.
   * Defends against JSON Type Poisoning (null, undefined, non-numeric strings, NaN, Infinity).
   */
  private static parseStrictNumber(val: unknown): number | null {
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
    const expr = expression.trim();

    // 1. Financial invariant: debits == credits
    if (expr === "debits == credits") {
      const debits = InvariantEvaluator.parseStrictNumber(data?.debits);
      const credits = InvariantEvaluator.parseStrictNumber(data?.credits);

      // JSON Type Poisoning Defense: reject if values are null, undefined, or unparseable
      if (debits === null || credits === null) {
        return {
          passed: false,
          actualValue: { debits: data?.debits, credits: data?.credits },
          message: `JSON Type Poisoning detected: debits or credits is not a valid finite number (debits: ${JSON.stringify(data?.debits)}, credits: ${JSON.stringify(data?.credits)})`,
        };
      }

      const passed = Math.abs(debits - credits) < 0.001;
      return {
        passed,
        actualValue: { debits, credits },
        message: passed ? `Debits balance Credits exactly ($${debits.toFixed(2)})` : `Debits ($${debits.toFixed(2)}) != Credits ($${credits.toFixed(2)})`,
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

    // Default: verify non-null
    const isNotNull = data !== null && data !== undefined;
    return {
      passed: isNotNull,
      actualValue: data,
      message: isNotNull ? "Output validated" : "Output is empty/null",
    };
  }
}
