import { FailureClass } from "../core/errors.ts";
import { NodeId } from "../core/types.ts";

export type RepairAction =
  | { type: "WaitBackoff"; delayMs: number }
  | { type: "RefreshCredentials"; provider: string }
  | { type: "AppendPromptConstraint"; constraint: string }
  | { type: "RerouteModel"; fallbackModel: string }
  | { type: "PatchNodeConfig"; patch: Record<string, unknown> }
  | { type: "ReplayFromNode"; nodeId: NodeId }
  | { type: "CompensateWorkflow" };

export interface RepairPlan {
  planId: string;
  targetNode: NodeId;
  failureClass: FailureClass;
  strategyName: string;
  actions: RepairAction[];
  requiredInvariants: string[];
  estimatedCostUsd: number;
}

export class RepairPlanner {
  static plan(targetNode: NodeId, failureClass: FailureClass, strategyName: string): RepairPlan {
    const planId = `repair_${Math.random().toString(36).slice(2, 10)}`;
    let actions: RepairAction[] = [];

    switch (failureClass) {
      case FailureClass.NetworkTransient:
        actions = [
          { type: "WaitBackoff", delayMs: 1500 },
          { type: "ReplayFromNode", nodeId: targetNode },
        ];
        break;

      case FailureClass.RateLimit:
        actions = [
          { type: "WaitBackoff", delayMs: 3000 },
          { type: "ReplayFromNode", nodeId: targetNode },
        ];
        break;

      case FailureClass.AuthExpired:
        actions = [
          { type: "RefreshCredentials", provider: "default" },
          { type: "ReplayFromNode", nodeId: targetNode },
        ];
        break;

      case FailureClass.LLMOutputMalformed:
        actions = [
          {
            type: "AppendPromptConstraint",
            constraint: "CRITICAL: Respond ONLY with valid, minified JSON matching the exact schema without commentary or markdown code blocks.",
          },
          { type: "ReplayFromNode", nodeId: targetNode },
        ];
        break;

      case FailureClass.LLMRefusal:
        actions = [
          { type: "RerouteModel", fallbackModel: "gpt-4o-mini" },
          { type: "ReplayFromNode", nodeId: targetNode },
        ];
        break;

      case FailureClass.StateCorruption:
        actions = [{ type: "CompensateWorkflow" }];
        break;

      default:
        actions = [
          { type: "WaitBackoff", delayMs: 1000 },
          { type: "ReplayFromNode", nodeId: targetNode },
        ];
        break;
    }

    return {
      planId,
      targetNode,
      failureClass,
      strategyName,
      actions,
      requiredInvariants: [`node_${targetNode}_output_valid`, "state_consistency_preserved"],
      estimatedCostUsd: 0.002,
    };
  }
}
