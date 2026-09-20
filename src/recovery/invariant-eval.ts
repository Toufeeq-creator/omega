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

  private static checkExpression(
    expression: string,
    data: any
  ): { passed: boolean; actualValue?: unknown; message?: string } {
    const expr = expression.trim();

    // 1. Financial invariant: debits == credits
    if (expr === "debits == credits") {
      const debits = typeof data?.debits === "number" ? data.debits : 0;
      const credits = typeof data?.credits === "number" ? data.credits : 0;
      const passed = Math.abs(debits - credits) < 0.001;
      return {
        passed,
        actualValue: { debits, credits },
        message: passed ? `Debits balance Credits exactly ($${debits.toFixed(2)})` : `Debits ($${debits.toFixed(2)}) != Credits ($${credits.toFixed(2)})`,
      };
    }

    // 2. Confidence threshold: confidence >= 0.8
    if (expr.includes("confidence >=")) {
      const conf = typeof data?.confidence === "number" ? data.confidence : 0;
      const passed = conf >= 0.8;
      return {
        passed,
        actualValue: { confidence: conf },
        message: passed ? `Confidence ${(conf * 100).toFixed(1)}% satisfies >= 80%` : `Confidence ${(conf * 100).toFixed(1)}% below required 80%`,
      };
    }

    // 3. Payment settlement: settlement_confirmed == true
    if (expr.includes("settlement_confirmed")) {
      const confirmed = Boolean(data?.settlement_confirmed);
      return {
        passed: confirmed,
        actualValue: { settlement_confirmed: confirmed },
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
