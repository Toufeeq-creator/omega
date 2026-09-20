import { OmegaIR } from "../core/ir.ts";
import { ExecutionState } from "../core/state.ts";
import { NodeId } from "../core/types.ts";

export class Scheduler {
  static readyNodes(ir: OmegaIR, state: ExecutionState): NodeId[] {
    const ready: NodeId[] = [];
    const inbound = new Map<NodeId, NodeId[]>();

    for (const edge of ir.edges) {
      if (!inbound.has(edge.toNode)) inbound.set(edge.toNode, []);
      inbound.get(edge.toNode)!.push(edge.fromNode);
    }

    for (const node of ir.nodes) {
      const current = state.nodeStates[node.id];
      if (current && (current.status === "Pending" || current.status === "Scheduled")) {
        const deps = inbound.get(node.id);
        const allDepsCompleted =
          !deps ||
          deps.every((depId) => {
            const depState = state.nodeStates[depId];
            return depState && depState.status === "Completed";
          });

        if (allDepsCompleted) {
          ready.push(node.id);
        }
      }
    }

    return ready;
  }

  static isFinished(ir: OmegaIR, state: ExecutionState): boolean {
    return ir.nodes.every((node) => {
      const s = state.nodeStates[node.id];
      return s && (s.status === "Completed" || s.status === "Skipped" || s.status === "Compensated");
    });
  }

  static hasFailure(state: ExecutionState): boolean {
    return Object.values(state.nodeStates).some((s) => s.status === "Failed");
  }
}
